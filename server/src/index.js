require('dotenv').config();

const mongoose = require('mongoose');
const { loadConfig } = require('./config/env');
const createApp = require('./app');
const { createStripe } = require('./services/stripe');
const { createRedis } = require('./services/redis');
const { createStorage } = require('./services/storage');
const { expireReservations } = require('./services/checkout');
const { startPayoutWorker } = require('./jobs/payouts');
const { createSearchAdapter, startSearchOutboxWorker } = require('./services/search');

let server;
let shuttingDown = false;
let redis;
let expiryWorker;
let payoutWorker;
let searchWorker;

async function start() {
  const config = loadConfig();
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const stripe = createStripe(config);
  try { redis = await createRedis(config); }
  catch (error) {
    if (config.nodeEnv === 'production') throw error;
    console.error(JSON.stringify({ event: 'redis_unavailable', errorType: error.name || 'Error', code: error.code || 'redis_unavailable' }));
  }
  const search = createSearchAdapter(config);
  const dependencies = { stripe, redis, storage: createStorage(config), search };
  const app = createApp(config, dependencies);
  expiryWorker = setInterval(() => expireReservations().catch((error) => console.error(JSON.stringify({ event: 'reservation_cleanup_failed', errorType: error.name || 'Error', code: error.code || 'cleanup_failed' }))), 60 * 1000);
  expiryWorker.unref();
  payoutWorker = startPayoutWorker({ stripe });
  searchWorker = startSearchOutboxWorker(search);
  server = app.listen(config.port, () => console.log(`Marketplace API listening on port ${config.port}`));
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    clearInterval(expiryWorker);
    payoutWorker?.();
    searchWorker?.();
    const forceClose = setTimeout(() => process.exit(1), 10000);
    forceClose.unref();
    server.close(async (error) => {
      try { if (redis?.isOpen) await redis.quit(); await mongoose.disconnect(); } finally { process.exit(error ? 1 : 0); }
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error(JSON.stringify({ event: 'api_start_failed', errorType: error.name || 'Error', code: error.code || 'startup_failed', message: error.message, stack: error.stack }));
  process.exitCode = 1;
});
