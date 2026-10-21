const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../src/models/user');
const RefreshSession = require('../src/models/refresh-session');
const EmailToken = require('../src/models/email-token');
const AuditEvent = require('../src/models/audit-event');
const createApp = require('../src/app');
const { loadConfig } = require('../src/config/env');
const { requireRole } = require('../src/middleware/auth');
const { hashPassword, verifyPassword, verifyAccessToken, signAccessToken } = require('../src/utils/tokens');

const originals = {};
const users = new Map();
const sessions = new Map();
const emailTokens = new Map();
const config = {
  nodeEnv: 'test', mongoUri: 'mongodb://127.0.0.1:27017/market-lane-test', port: 0,
  jwtSecret: 'test-jwt-secret-0123456789012345678901',
  refreshSecret: 'test-refresh-secret-0123453456789012345678901', refreshTokenDays: 1,
  allowedOrigins: ['http://localhost:5173'], emailMode: 'console', cookieSecure: false, clientBaseUrl: 'http://localhost:5173'
};

function patchMethod(target, name, implementation) {
  originals[target.modelName] ||= {};
  if (!(name in originals[target.modelName])) originals[target.modelName][name] = target[name];
  target[name] = implementation;
}

function makeUser(data) {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    id: null,
    name: data.name,
    email: data.email,
    passwordHash: data.passwordHash,
    role: data.role || 'customer',
    status: data.status || 'active', emailVerifiedAt: data.emailVerifiedAt === undefined ? new Date() : data.emailVerifiedAt
  };
  user.id = user._id.toString();
  users.set(user.id, user);
  return user;
}

function installModelFakes() {
  users.clear();
  sessions.clear();
  emailTokens.clear();
  patchMethod(User, 'exists', async ({ email }) => Array.from(users.values()).some((user) => user.email === email));
  patchMethod(User, 'create', async (data) => makeUser(data));
  patchMethod(User, 'findOne', (filter) => ({ select: async () => Array.from(users.values()).find((user) => user.email === filter.email) || null }));
  patchMethod(User, 'findById', (id) => {
    const query = Promise.resolve(users.get(String(id)) || null);
    query.select = () => query;
    return query;
  });
  patchMethod(RefreshSession, 'create', async (data) => {
    const session = { ...data, _id: new mongoose.Types.ObjectId(), revokedAt: null };
    sessions.set(data.tokenHash, session);
    return session;
  });
  patchMethod(RefreshSession, 'findOneAndUpdate', async (filter) => {
    const session = sessions.get(filter.tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= filter.expiresAt.$gt) return null;
    session.revokedAt = new Date();
    return session;
  });
  patchMethod(RefreshSession, 'updateOne', async ({ tokenHash }) => {
    const session = sessions.get(tokenHash);
    if (session && !session.revokedAt) session.revokedAt = new Date();
    return { modifiedCount: session ? 1 : 0 };
  });
  patchMethod(EmailToken, 'updateMany', async () => ({ modifiedCount: 0 }));
  patchMethod(EmailToken, 'create', async (data) => { emailTokens.set(data.tokenHash, { ...data, consumedAt: null }); return data; });
  patchMethod(EmailToken, 'findOneAndUpdate', async (filter) => {
    const record = emailTokens.get(filter.tokenHash);
    if (!record || record.consumedAt || record.purpose !== filter.purpose || record.expiresAt <= filter.expiresAt.$gt) return null;
    record.consumedAt = new Date();
    return record;
  });
  patchMethod(User, 'updateOne', async (filter, update) => {
    const user = users.get(String(filter._id));
    if (user) Object.assign(user, update.$set);
    return { modifiedCount: user ? 1 : 0 };
  });
  patchMethod(AuditEvent, 'create', async (data) => data);
}

async function withServer(run) {
  const server = createApp(config).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function request(base, path, { method = 'GET', body, token, origin, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

describe('backend authentication and request boundary', { concurrency: false }, () => {
  beforeEach(installModelFakes);
  afterEach(() => {
    for (const [modelName, methods] of Object.entries(originals)) {
      const model = modelName === 'User' ? User : modelName === 'RefreshSession' ? RefreshSession : modelName === 'EmailToken' ? EmailToken : AuditEvent;
      for (const [name, method] of Object.entries(methods)) model[name] = method;
    }
    for (const methods of Object.values(originals)) for (const key of Object.keys(methods)) delete methods[key];
  });

  it('registers only customers, normalizes email, and never returns a password hash', async () => {
    await withServer(async (base) => {
      const originalInfo = console.info;
      let email;
      console.info = (line) => { email = JSON.parse(line); };
      try {
        const { response, body } = await request(base, '/api/v1/auth/register', { method: 'POST', body: { name: '  Ada User ', email: 'ADA@example.com', password: 'secure-password-123', role: 'admin' } });
        assert.equal(response.status, 201);
        assert.equal(body.data.user.role, 'customer');
        assert.equal(body.data.user.email, 'ada@example.com');
        assert.equal(body.data.user.name, 'Ada User');
        assert.equal('passwordHash' in body.data.user, false);
        assert.equal(body.data.message, 'Check your email to verify your account.');
        assert.equal('accessToken' in body.data, false);
        assert.equal('refreshToken' in body.data, false);
        assert.equal(response.headers.get('set-cookie'), null);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(users.size, 1);
        assert.notEqual(Array.from(users.values())[0].passwordHash, 'secure-password-123');
        const token = new URL(email.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
        const verified = await request(base, '/api/v1/auth/verify-email', { method: 'POST', body: { token } });
        assert.equal(verified.response.status, 200);
        assert.equal(users.values().next().value.emailVerifiedAt instanceof Date, true);
        const login = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email: 'ada@example.com', password: 'secure-password-123' } });
        assert.equal(login.response.status, 200);
        assert.equal(typeof login.body.data.accessToken, 'string');
        assert.match(login.response.headers.get('set-cookie'), /HttpOnly/);
        assert.equal('refreshToken' in login.body.data, false);
      } finally { console.info = originalInfo; }
    });
  });

  it('rejects malformed registration fields and duplicate normalized emails', async () => {
    const originalInfo = console.info;
    console.info = () => {};
    try {
      await withServer(async (base) => {
        for (const body of [
          { name: 'A', email: 'a@example.com', password: 'secure-password-123' },
          { name: 'Alice', email: 'not-an-email', password: 'secure-password-123' },
          { name: 'Alice', email: 'a@example.com', password: 'short' },
          { name: 'Alice', email: 'a@example.com', password: 'secure-password-123', role: { $ne: 'customer' } }
        ]) {
          const { response } = await request(base, '/api/v1/auth/register', { method: 'POST', body });
          if (body.role) assert.equal(response.status, 201); // Unknown role fields are ignored; assignment stays server controlled.
          else assert.equal(response.status, 400);
        }
        const duplicate = await request(base, '/api/v1/auth/register', { method: 'POST', body: { name: 'Alice', email: 'A@EXAMPLE.COM', password: 'secure-password-123' } });
        assert.equal(duplicate.response.status, 409);
        assert.equal(duplicate.body.error.code, 'email_already_registered');
      });
    } finally { console.info = originalInfo; }
  });

  it('maps a concurrent unique-email insert conflict to a safe 409 response', async () => {
    patchMethod(User, 'create', async () => { const error = new Error('index details must not leak'); error.code = 11000; throw error; });
    await withServer(async (base) => {
      const result = await request(base, '/api/v1/auth/register', { method: 'POST', body: { name: 'Race User', email: 'race@example.com', password: 'secure-password-123' } });
      assert.equal(result.response.status, 409);
      assert.equal(result.body.error.code, 'conflict');
      assert.equal(JSON.stringify(result.body).includes('index details'), false);
    });
  });

  it('authenticates valid credentials and rejects bad credentials and disabled accounts', async () => {
    const passwordHash = await hashPassword('secure-password-123');
    const user = makeUser({ name: 'Customer', email: 'customer@example.com', passwordHash });
    await withServer(async (base) => {
      for (const [email, password] of [['customer@example.com', 'wrong-password'], ['missing@example.com', 'secure-password-123']]) {
        const result = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email, password } });
        assert.equal(result.response.status, 401);
        assert.equal(result.body.error.code, 'invalid_credentials');
      }
      user.status = 'disabled';
      const result = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email: user.email, password: 'secure-password-123' } });
      assert.equal(result.response.status, 401);
    });
  });

  it('protects /me against missing, tampered, expired, and disabled-user bearer tokens', async () => {
    const user = makeUser({ name: 'Bearer User', email: 'bearer@example.com', passwordHash: await hashPassword('secure-password-123') });
    const { signAccessToken } = require('../src/utils/tokens');
    const token = signAccessToken(user, config);
    await withServer(async (base) => {
      const missing = await request(base, '/api/v1/auth/me');
      assert.equal(missing.response.status, 401);
      const invalid = await request(base, '/api/v1/auth/me', { token: `${token.slice(0, -1)}x` });
      assert.equal(invalid.response.status, 401);
      const crypto = require('node:crypto');
      const expiredInput = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'admin', iat: 1, exp: 1, iss: 'market-lane-api', aud: 'market-lane-client' })).toString('base64url')}`;
      const expired = `${expiredInput}.${crypto.createHmac('sha256', config.jwtSecret).update(expiredInput).digest('base64url')}`;
      const expiredResult = await request(base, '/api/v1/auth/me', { token: expired });
      assert.equal(expiredResult.response.status, 401);
      const valid = await request(base, '/api/v1/auth/me', { token });
      assert.equal(valid.response.status, 200);
      assert.equal(valid.body.data.user.role, 'customer');
      assert.equal(valid.response.headers.get('cache-control'), 'no-store');
      user.status = 'disabled';
      const disabled = await request(base, '/api/v1/auth/me', { token });
      assert.equal(disabled.response.status, 401);
    });
  });

  it('rotates refresh tokens once, rejects replay, and revokes on logout', async () => {
    const user = makeUser({ name: 'Refresh User', email: 'refresh@example.com', passwordHash: await hashPassword('secure-password-123') });
    const { signAccessToken, createRefreshToken, hashToken } = require('../src/utils/tokens');
    assert.equal(typeof signAccessToken, 'function');
    const first = createRefreshToken();
    const storedHash = hashToken(first, config.refreshSecret);
    sessions.set(storedHash, { tokenHash: storedHash, userId: user.id, expiresAt: new Date(Date.now() + 60000), revokedAt: null });
    await withServer(async (base) => {
      const rotated = await request(base, '/api/v1/auth/refresh', { method: 'POST', cookie: `ml_refresh=${first}` });
      assert.equal(rotated.response.status, 200);
      const rotatedToken = rotated.response.headers.get('set-cookie').match(/ml_refresh=([^;]+)/)[1];
      assert.notEqual(rotatedToken, first);
      assert.equal('refreshToken' in rotated.body.data, false);
      const replay = await request(base, '/api/v1/auth/refresh', { method: 'POST', cookie: `ml_refresh=${first}` });
      assert.equal(replay.response.status, 401);
      const logout = await request(base, '/api/v1/auth/logout', { method: 'POST', cookie: `ml_refresh=${rotatedToken}` });
      assert.equal(logout.response.status, 204);
      const afterLogout = await request(base, '/api/v1/auth/refresh', { method: 'POST', cookie: `ml_refresh=${rotatedToken}` });
      assert.equal(afterLogout.response.status, 401);
    });
  });

  it('allows at most one winner when the same refresh token is submitted concurrently', async () => {
    const user = makeUser({ name: 'Concurrent Refresh', email: 'concurrent@example.com', passwordHash: await hashPassword('secure-password-123') });
    const { createRefreshToken, hashToken } = require('../src/utils/tokens');
    const refreshToken = createRefreshToken();
    const tokenHash = hashToken(refreshToken, config.refreshSecret);
    sessions.set(tokenHash, { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 60000), revokedAt: null });
    await withServer(async (base) => {
      const results = await Promise.all([
        request(base, '/api/v1/auth/refresh', { method: 'POST', cookie: `ml_refresh=${refreshToken}` }),
        request(base, '/api/v1/auth/refresh', { method: 'POST', cookie: `ml_refresh=${refreshToken}` })
      ]);
      assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 401]);
    });
  });

  it('applies login rate limits without exposing credential data', async () => {
    await withServer(async (base) => {
      let final;
      for (let attempt = 0; attempt < 11; attempt += 1) final = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email: 'rate@example.com', password: 'wrong' } });
      assert.equal(final.response.status, 429);
      assert.equal(final.body.error.code, 'rate_limit_exceeded');
      assert.equal(JSON.stringify(final.body).includes('wrong'), false);
    });
  });

  it('sets security and allowed-origin headers, reports dependency readiness, and shapes 404 errors', async () => {
    await withServer(async (base) => {
      const health = await request(base, '/health', { origin: 'http://localhost:5173' });
      assert.equal(health.response.status, 200);
      assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(health.response.headers.get('x-frame-options'), 'DENY');
      assert.equal(health.response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      assert.ok(health.response.headers.get('x-request-id'));
      const readiness = await request(base, '/ready');
      assert.equal(readiness.response.status, 503);
      const missing = await request(base, '/api/v1/no-such-route');
      assert.equal(missing.response.status, 404);
      assert.equal(missing.body.error.code, 'not_found');
      const preflight = await request(base, '/health', { method: 'OPTIONS', origin: 'http://evil.example' });
      assert.equal(preflight.response.status, 403);
      const invalidJson = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":' });
      assert.equal(invalidJson.status, 400);
      const oversized = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(1_100_000) }) });
      assert.equal(oversized.status, 413);
    });
  });

  it('enforces role middleware and validates environment configuration', () => {
    let called = false;
    requireRole('admin')({ user: { role: 'customer' } }, {}, (error) => { called = true; assert.equal(error.status, 403); });
    assert.equal(called, true);
    assert.throws(() => loadConfig({ MONGODB_URI: 'mongodb://localhost', JWT_SECRET: 'short', REFRESH_TOKEN_SECRET: 'another-short' }), /at least 32 characters/);
    assert.throws(() => loadConfig({ MONGODB_URI: 'mongodb://localhost', JWT_SECRET: 'a'.repeat(32), REFRESH_TOKEN_SECRET: 'b'.repeat(32), PORT: 'not-a-port' }), /PORT must be a valid/);
  });

  it('denies customer tokens from vendor and admin APIs before protected data access', async () => {
    const passwordHash = await hashPassword('secure-password-123');
    const customer = makeUser({ name: 'Customer', email: 'customer@example.com', passwordHash });
    const token = signAccessToken(customer, config);
    await withServer(async (base) => {
      const vendor = await request(base, '/api/v1/vendor/products', { token });
      const admin = await request(base, '/api/v1/admin/overview', { token });
      assert.equal(vendor.response.status, 403);
      assert.equal(vendor.body.error.code, 'forbidden');
      assert.equal(admin.response.status, 403);
      assert.equal(admin.body.error.code, 'forbidden');
    });
  });

  it('verifies password hashes and rejects tokens signed with another key', async () => {
    const stored = await hashPassword('secure-password-123');
    assert.equal(await verifyPassword('secure-password-123', stored), true);
    assert.equal(await verifyPassword('wrong-password', stored), false);
    assert.equal(await verifyPassword('password', 'invalid'), false);
    const { signAccessToken } = require('../src/utils/tokens');
    const token = signAccessToken({ id: 'abc', role: 'customer' }, config);
    assert.throws(() => verifyAccessToken(token, { ...config, jwtSecret: 'c'.repeat(40) }), { code: 'invalid_token' });
  });
});
