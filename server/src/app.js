const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const createAuthRouter = require('./modules/auth/routes');
const { ApiError } = require('./utils/api-error');
const { authenticate } = require('./middleware/auth');
const createMarketplaceRouter = require('./modules/marketplace/routes');
const createAdminRouter = require('./modules/admin/routes');
const createWebhookRouter = require('./modules/payments/webhook');
const { redisHealthCheck } = require('./services/redis');

function createApp(config, dependencies = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.nodeEnv === 'production' ? 1 : false);
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.set({ 'X-Request-Id': req.id, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id, Idempotency-Key, Stripe-Signature');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    } else if (origin && config.allowedOrigins.length && req.method === 'OPTIONS') {
      return next(new ApiError(403, 'origin_not_allowed'));
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use('/api/v1/webhooks', createWebhookRouter(config, dependencies));
  app.use(express.json({ limit: '1mb', strict: true }));
  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  app.get('/ready', async (_request, response) => {
    const mongoReady = mongoose.connection.readyState === 1;
    let redisReady = true;
    let searchReady = true;
    let storageReady = true;
    let paymentsReady = true;
    try { await redisHealthCheck(dependencies.redis); } catch { redisReady = false; }
    try { if (config.searchProvider === 'elastic') searchReady = await dependencies.search?.healthCheck?.() || false; } catch { searchReady = false; }
    try { if (config.s3Bucket) storageReady = await dependencies.storage?.healthCheck?.() || false; } catch { storageReady = false; }
    try { if (config.stripeSecretKey) { await dependencies.stripe?.balance.retrieve(); paymentsReady = Boolean(dependencies.stripe); } } catch { paymentsReady = false; }
    const ready = mongoReady && (!config.redisUrl || redisReady) && searchReady && storageReady && paymentsReady;
    response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', dependencies: {
      mongodb: mongoReady ? 'connected' : 'disconnected',
      redis: config.redisUrl ? (redisReady ? 'connected' : 'disconnected') : 'not_configured',
      objectStorage: config.s3Bucket ? (storageReady ? 'connected' : 'unavailable') : 'local_development_adapter',
      payments: config.stripeSecretKey ? (paymentsReady ? 'stripe_test_mode' : 'unavailable') : 'not_configured',
      search: config.searchProvider === 'elastic' ? (searchReady ? 'elastic_connected' : 'elastic_unavailable') : 'mongodb_text'
    } });
  });
  app.use('/api/v1/auth', createAuthRouter(config, dependencies));
  app.use('/api/v1', createMarketplaceRouter(config, dependencies));
  app.use('/api/v1/admin', authenticate(config), createAdminRouter(config, dependencies));
  app.use((_req, _res, next) => next(new ApiError(404, 'not_found')));
  app.use((error, req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof mongoose.Error.ValidationError) error = new ApiError(400, 'validation_error');
    if (error instanceof mongoose.Error.CastError) error = new ApiError(400, 'invalid_identifier');
    if (error && error.code === 11000) error = new ApiError(409, 'conflict');
    const status = Number.isInteger(error.status) ? error.status : 500;
    const code = error.code || 'internal_server_error';
    if (status >= 500) console.error(JSON.stringify({ requestId: req.id, code, errorType: error.name || 'Error' }));
    const body = { error: { code, message: status < 500 ? error.message : 'An unexpected error occurred.', requestId: req.id } };
    if (error.details && status < 500) body.error.details = error.details;
    res.status(status).json(body);
  });
  return app;
}

module.exports = createApp;
