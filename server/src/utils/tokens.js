const crypto = require('node:crypto');
const { ApiError } = require('./api-error');

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function signAccessToken(user, config) {
  const now = Math.floor(Date.now() / 1000);
  const accessTokenSeconds = config.accessTokenSeconds || 900;
  const payload = { sub: user.id, role: user.role, iat: now, exp: now + accessTokenSeconds, iss: 'market-lane-api', aud: 'market-lane-client' };
  const input = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${crypto.createHmac('sha256', config.jwtSecret).update(input).digest('base64url')}`;
}
function verifyAccessToken(token, config) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError(401, 'invalid_token');
  const input = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(input).digest();
  let actual;
  try { actual = Buffer.from(parts[2], 'base64url'); } catch { throw new ApiError(401, 'invalid_token'); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new ApiError(401, 'invalid_token');
  let header; let payload;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); payload = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { throw new ApiError(401, 'invalid_token'); }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'HS256' || payload.iss !== 'market-lane-api' || payload.aud !== 'market-lane-client' || !payload.sub || !payload.exp || payload.exp <= now) throw new ApiError(401, 'expired_or_invalid_token');
  return payload;
}
function createRefreshToken() { return crypto.randomBytes(48).toString('base64url'); }
function hashToken(token, secret) { return crypto.createHmac('sha256', secret).update(token).digest('hex'); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derived) => error ? reject(error) : resolve(`${salt}:${derived.toString('hex')}`)));
}
async function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(':');
  if (!salt || !expectedHex) return false;
  const actual = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derived) => error ? reject(error) : resolve(derived)));
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { signAccessToken, verifyAccessToken, createRefreshToken, hashToken, hashPassword, verifyPassword };
