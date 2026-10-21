const { createClient } = require('redis');

async function createRedis(config) {
  if (!config.redisUrl) return null;
  const client = createClient({ url: config.redisUrl });
  client.on('error', (error) => console.error(JSON.stringify({ event: 'redis_error', errorType: error.name || 'Error', code: error.code || 'redis_error' })));
  await client.connect();
  return client;
}

module.exports = { createRedis };
