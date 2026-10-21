const crypto = require('node:crypto');
const express = require('express');
const User = require('../../models/user');
const RefreshSession = require('../../models/refresh-session');
const EmailToken = require('../../models/email-token');
const { ApiError } = require('../../utils/api-error');
const { hashPassword, verifyPassword, createRefreshToken, hashToken, signAccessToken } = require('../../utils/tokens');
const { authenticate } = require('../../middleware/auth');
const { createRateLimit } = require('../../middleware/rate-limit');
const { deliver } = require('../../services/email');
const { writeAudit } = require('../../services/audit');

const COOKIE_NAME = 'ml_refresh';
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: Boolean(user.emailVerifiedAt) });

function cookieOptions(config, maxAge) {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite || 'strict', path: '/api/v1/auth', maxAge };
}

function sameOrigin(config) {
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (!origin && config.nodeEnv === 'production') return next(new ApiError(403, 'origin_required'));
    if (origin && !config.allowedOrigins.includes(origin)) return next(new ApiError(403, 'origin_not_allowed'));
    next();
  };
}

function readCookie(req, name) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function createAuthRouter(config, dependencies = {}) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const loginLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 10, redis: dependencies.redis, namespace: 'login' });
  const registrationLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 8, redis: dependencies.redis, namespace: 'register' });
  const emailLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 5, redis: dependencies.redis, namespace: 'email' });

  async function issueTokens(user, res) {
    const refreshToken = createRefreshToken();
    const expiresAt = new Date(Date.now() + config.refreshTokenDays * 86400000);
    await RefreshSession.create({ userId: user._id, tokenHash: hashToken(refreshToken, config.refreshSecret), expiresAt });
    res.cookie(COOKIE_NAME, refreshToken, cookieOptions(config, config.refreshTokenDays * 86400000));
    return { accessToken: signAccessToken(user, config), tokenType: 'Bearer', expiresIn: config.accessTokenSeconds || 900, user: publicUser(user) };
  }

  async function issueEmailToken(user, purpose) {
    await EmailToken.updateMany({ userId: user._id, purpose, consumedAt: null }, { $set: { consumedAt: new Date() } });
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await EmailToken.create({ userId: user._id, purpose, tokenHash: hashToken(rawToken, config.refreshSecret), expiresAt: new Date(Date.now() + (purpose === 'verify_email' ? 30 : 60) * 60000) });
    const url = new URL(purpose === 'verify_email' ? '/verify-email' : '/reset-password', config.clientBaseUrl);
    url.searchParams.set('token', rawToken);
    await deliver(config, { to: user.email, subject: purpose === 'verify_email' ? 'Verify your Market Lane account' : 'Reset your Market Lane password', text: `Open this one-time link to continue: ${url.toString()}` });
  }

  router.post('/register', registrationLimit, async (req, res) => {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) throw new ApiError(400, 'invalid_name');
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ApiError(400, 'invalid_email');
    if (typeof password !== 'string' || password.length < 12 || password.length > 200) throw new ApiError(400, 'invalid_password', 'Password must be 12 to 200 characters.');
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) throw new ApiError(409, 'email_already_registered');
    const user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash: await hashPassword(password), role: 'customer' });
    await issueEmailToken(user, 'verify_email');
    res.status(201).json({ data: { user: publicUser(user), message: 'Check your email to verify your account.' } });
  });

  router.post('/login', loginLimit, async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') throw new ApiError(400, 'email_and_password_required');
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
    if (!user || user.status !== 'active' || !(await verifyPassword(password, user.passwordHash))) throw new ApiError(401, 'invalid_credentials');
    if (!user.emailVerifiedAt) throw new ApiError(403, 'email_verification_required', 'Verify your email before signing in.');
    res.json({ data: await issueTokens(user, res) });
  });

  router.post('/refresh', sameOrigin(config), async (req, res) => {
    const refreshToken = readCookie(req, COOKIE_NAME);
    if (!refreshToken) throw new ApiError(401, 'refresh_token_required');
    const session = await RefreshSession.findOneAndUpdate(
      { tokenHash: hashToken(refreshToken, config.refreshSecret), revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { revokedAt: new Date() } }, { new: false }
    );
    if (!session) { res.clearCookie(COOKIE_NAME, cookieOptions(config)); throw new ApiError(401, 'invalid_or_expired_refresh_token'); }
    const user = await User.findById(session.userId);
    if (!user || user.status !== 'active' || !user.emailVerifiedAt) throw new ApiError(401, 'invalid_or_disabled_account');
    res.json({ data: await issueTokens(user, res) });
  });

  router.post('/logout', sameOrigin(config), async (req, res) => {
    const refreshToken = readCookie(req, COOKIE_NAME);
    if (refreshToken) await RefreshSession.updateOne({ tokenHash: hashToken(refreshToken, config.refreshSecret), revokedAt: null }, { $set: { revokedAt: new Date() } });
    res.clearCookie(COOKIE_NAME, cookieOptions(config)).status(204).end();
  });

  router.post('/verify-email', emailLimit, async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || token.length > 128) throw new ApiError(400, 'verification_token_required');
    const record = await EmailToken.findOneAndUpdate({ purpose: 'verify_email', tokenHash: hashToken(token, config.refreshSecret), consumedAt: null, expiresAt: { $gt: new Date() } }, { $set: { consumedAt: new Date() } }, { new: false });
    if (!record) throw new ApiError(400, 'invalid_or_expired_token');
    await User.updateOne({ _id: record.userId }, { $set: { emailVerifiedAt: new Date() } });
    await writeAudit({ actorUserId: record.userId, action: 'auth.email_verified', resourceType: 'user', resourceId: record.userId });
    res.json({ data: { message: 'Email verified. You can sign in now.' } });
  });

  router.post('/resend-verification', emailLimit, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email) {
      const user = await User.findOne({ email });
      if (user && !user.emailVerifiedAt && user.status === 'active') await issueEmailToken(user, 'verify_email');
    }
    res.status(202).json({ data: { message: 'If the account needs verification, a new link has been sent.' } });
  });

  router.post('/forgot-password', emailLimit, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email) {
      const user = await User.findOne({ email });
      if (user && user.status === 'active') await issueEmailToken(user, 'reset_password');
    }
    res.status(202).json({ data: { message: 'If the account exists, a password reset link has been sent.' } });
  });

  router.post('/reset-password', emailLimit, async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || token.length > 128 || typeof password !== 'string' || password.length < 12 || password.length > 200) throw new ApiError(400, 'invalid_reset_request');
    const record = await EmailToken.findOneAndUpdate({ purpose: 'reset_password', tokenHash: hashToken(token, config.refreshSecret), consumedAt: null, expiresAt: { $gt: new Date() } }, { $set: { consumedAt: new Date() } }, { new: false });
    if (!record) throw new ApiError(400, 'invalid_or_expired_token');
    await User.updateOne({ _id: record.userId, status: 'active' }, { $set: { passwordHash: await hashPassword(password) } });
    await RefreshSession.updateMany({ userId: record.userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await writeAudit({ actorUserId: record.userId, action: 'auth.password_reset', resourceType: 'user', resourceId: record.userId });
    res.json({ data: { message: 'Password updated. Sign in with your new password.' } });
  });

  router.get('/me', authenticate(config), (req, res) => res.json({ data: { user: req.user } }));
  router.patch('/me', authenticate(config), async (req, res) => {
    const name = req.body?.name;
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) throw new ApiError(400, 'invalid_name');
    const user = await User.findByIdAndUpdate(req.user.id, { $set: { name: name.trim() } }, { new: true, runValidators: true }).select('name email role status emailVerifiedAt');
    res.json({ data: { user: { ...publicUser(user), emailVerified: Boolean(user.emailVerifiedAt) } } });
  });
  return router;
}

module.exports = createAuthRouter;
