const User = require('../models/user');
const { ApiError } = require('../utils/api-error');
const { verifyAccessToken } = require('../utils/tokens');

function authenticate(config) {
  return async (req, _res, next) => {
    try {
      const header = req.get('authorization') || '';
      const match = /^Bearer ([^\s]+)$/i.exec(header);
      if (!match) throw new ApiError(401, 'authentication_required');
      const claims = verifyAccessToken(match[1], config);
      const user = await User.findById(claims.sub).select('name email role status emailVerifiedAt');
      if (!user || user.status !== 'active') throw new ApiError(401, 'invalid_or_disabled_account');
      req.user = { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: Boolean(user.emailVerifiedAt) };
      next();
    } catch (error) { next(error); }
  };
}

function requireRole(...roles) {
  return (req, _res, next) => req.user && roles.includes(req.user.role) ? next() : next(new ApiError(req.user ? 403 : 401, req.user ? 'forbidden' : 'authentication_required'));
}

module.exports = { authenticate, requireRole };
