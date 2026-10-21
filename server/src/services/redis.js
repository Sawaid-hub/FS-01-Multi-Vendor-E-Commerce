const { createClient } = require('redis');

/**
 * Build a Redis client that handles both plain (redis://) and TLS (rediss://)
 * connections correctly.
 *
 * TLS behaviour:
 *  - rediss:// URLs automatically enable TLS via the `socket.tls` flag.
 *  - REDIS_TLS_REJECT_UNAUTHORIZED=0 disables certificate verification; useful
 *    for Upstash and Render Redis which present self-signed certificates in the
 *    free tier. Never disable this in production without a clear provider note.
 *
 * Reconnect strategy: exponential back-off capped at 30 s, giving up after
 * 10 consecutive failures so the process does not silently loop forever.
 */
async function createRedis(config) {
  if (!config.redisUrl) return null;

  const isTls = config.redisUrl.startsWith('rediss://');
  const rejectUnauthorized = config.redisTlsRejectUnauthorized !== false;

  /** @type {import('redis').RedisClientOptions} */
  const clientOptions = {
    url: config.redisUrl,
    socket: {
      tls: isTls,
      rejectUnauthorized: isTls ? rejectUnauthorized : undefined,
      reconnectStrategy(retries) {
        if (retries >= 10) {
          // Stop trying; surface as a fatal connection error.
          return new Error('Redis: maximum reconnect attempts reached');
        }
        // Exponential back-off: 50 ms, 100 ms, 200 ms … capped at 30 s.
        return Math.min(50 * 2 ** retries, 30_000);
      },
    },
  };

  const client = createClient(clientOptions);

  client.on('error', (error) =>
    console.error(
      JSON.stringify({
        event: 'redis_error',
        errorType: error.name || 'Error',
        code: error.code || 'redis_error',
        message: error.message,
      }),
    ),
  );

  client.on('reconnecting', () =>
    console.warn(JSON.stringify({ event: 'redis_reconnecting' })),
  );

  await client.connect();
  return client;
}

/**
 * Ping the Redis connection and return true, or throw on failure.
 * Used by the /ready health-check endpoint.
 */
async function redisHealthCheck(redis) {
  if (!redis) return true; // Redis is optional in development.
  const pong = await redis.ping();
  if (pong !== 'PONG') throw new Error('Redis PING did not return PONG');
  return true;
}

module.exports = { createRedis, redisHealthCheck };
