const { ApiError } = require('../utils/api-error');

// A process-local fallback keeps local development usable; configured Redis uses one atomic shared counter.
function createRateLimit({ windowMs, max, redis, namespace = 'api' }) {
  const buckets = new Map();
  let lastCleanup = Date.now();
  return async (req, _res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    if (redis) {
      try {
        const redisKey = `market-lane:limit:${namespace}:${key}`;
        const count = Number(await redis.eval(
          "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
          { keys: [redisKey], arguments: [String(Math.ceil(windowMs / 1000))] }
        ));
        if (count > max) return next(new ApiError(429, 'rate_limit_exceeded', 'Too many attempts. Try again later.'));
        return next();
      } catch {
        return next(new ApiError(503, 'rate_limit_store_unavailable', 'Request security service is temporarily unavailable.'));
      }
    }
    const now = Date.now();
    if (now - lastCleanup > windowMs) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
      lastCleanup = now;
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) return next(new ApiError(429, 'rate_limit_exceeded', 'Too many attempts. Try again later.'));
    next();
  };
}

module.exports = { createRateLimit };
