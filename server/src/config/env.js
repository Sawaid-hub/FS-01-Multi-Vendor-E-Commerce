function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const mongoUri = env.MONGODB_URI;
  const jwtSecret = env.JWT_SECRET;
  const refreshSecret = env.REFRESH_TOKEN_SECRET || jwtSecret;
  const port = Number(env.PORT || 4000);
  const commissionBps = Number(env.COMMISSION_BPS || 1000);
  const emailDeliveryUrl = env.EMAIL_DELIVERY_URL || '';
  const emailApiKey = env.EMAIL_API_KEY || '';
  const searchProvider = env.SEARCH_PROVIDER || 'mongodb';
  const clientBaseUrl = env.CLIENT_BASE_URL || 'http://localhost:5173';
  const accessTokenTtl = String(env.ACCESS_TOKEN_TTL || '15m').trim();
  const accessTokenMatch = /^(\d+)(s|m|h)$/.exec(accessTokenTtl);
  const accessTokenSeconds = accessTokenMatch ? Number(accessTokenMatch[1]) * ({ s: 1, m: 60, h: 3600 }[accessTokenMatch[2]]) : NaN;

  if (!mongoUri) throw new Error('MONGODB_URI is required. Copy .env.example to .env and configure it.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  if (!refreshSecret || refreshSecret.length < 32) throw new Error('REFRESH_TOKEN_SECRET must contain at least 32 characters.');
  const refreshTokenDays = Number(env.REFRESH_TOKEN_DAYS || 30);
  if (!Number.isInteger(refreshTokenDays) || refreshTokenDays < 1 || refreshTokenDays > 90) throw new Error('REFRESH_TOKEN_DAYS must be an integer between 1 and 90.');
  if (!Number.isInteger(accessTokenSeconds) || accessTokenSeconds < 300 || accessTokenSeconds > 3600) throw new Error('ACCESS_TOKEN_TTL must be between 5m and 1h, using s, m, or h.');
  if (nodeEnv === 'production' && jwtSecret === refreshSecret) {
    throw new Error('JWT_SECRET and REFRESH_TOKEN_SECRET must be different in production.');
  }
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 5000) throw new Error('COMMISSION_BPS must be an integer from 0 to 5000.');
  if (nodeEnv === 'production' && (!env.STRIPE_SECRET_KEY || !env.STRIPE_SECRET_KEY.startsWith('sk_test_'))) {
    throw new Error('Live payment processing is not supported by this application. Configure Stripe test-mode credentials only.');
  }
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error('STRIPE_SECRET_KEY must be a Stripe test-mode key starting with sk_test_.');
  if (nodeEnv === 'production' && !env.CORS_ORIGINS) throw new Error('CORS_ORIGINS must list the exact deployed client origins.');
  if (nodeEnv === 'production' && (!emailDeliveryUrl || !emailApiKey)) throw new Error('EMAIL_DELIVERY_URL and EMAIL_API_KEY are required in production.');
  if (nodeEnv === 'production' && !env.REDIS_URL) throw new Error('REDIS_URL is required in production for shared carts and rate limiting.');
  if (nodeEnv === 'production' && !env.REDIS_URL.startsWith('rediss://')) throw new Error('REDIS_URL must use TLS (rediss://) in production.');
  if (nodeEnv === 'production' && !env.S3_BUCKET) throw new Error('S3_BUCKET is required in production.');
  if (nodeEnv === 'production' && !env.FX_API_URL && !env.FX_RATES_JSON) throw new Error('Configure a verified FX_API_URL or FX_RATES_JSON before production startup.');
  if (nodeEnv === 'production') {
    const clientUrl = new URL(clientBaseUrl);
    const origins = (env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (clientUrl.protocol !== 'https:' || clientUrl.origin !== clientBaseUrl) throw new Error('CLIENT_BASE_URL must be a plain HTTPS origin in production.');
    if (origins.some((origin) => { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin; })) throw new Error('CORS_ORIGINS must contain plain HTTPS origins in production.');
    if (emailDeliveryUrl && new URL(emailDeliveryUrl).protocol !== 'https:') throw new Error('EMAIL_DELIVERY_URL must use HTTPS in production.');
    if (env.ELASTICSEARCH_URL && new URL(env.ELASTICSEARCH_URL).protocol !== 'https:') throw new Error('ELASTICSEARCH_URL must use HTTPS in production.');
    if (env.S3_ENDPOINT && new URL(env.S3_ENDPOINT).protocol !== 'https:') throw new Error('S3_ENDPOINT must use HTTPS in production.');
  }
  if (!['mongodb', 'elastic'].includes(searchProvider)) throw new Error('SEARCH_PROVIDER must be mongodb or elastic.');
  if (searchProvider === 'elastic' && (!env.ELASTICSEARCH_URL || !env.ELASTICSEARCH_API_KEY || !env.ELASTICSEARCH_INDEX)) throw new Error('ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY, and ELASTICSEARCH_INDEX are required for Elastic search.');
  if (nodeEnv === 'production' && searchProvider !== 'elastic') throw new Error('Production deployments must use the configured Elastic search adapter.');
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is required when Stripe test mode is enabled.');

  return {
    nodeEnv, mongoUri, port, jwtSecret, refreshSecret, refreshTokenDays, accessTokenSeconds, commissionBps,
    allowedOrigins: (env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean),
    stripeSecretKey: env.STRIPE_SECRET_KEY || '', stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    stripeTaxEnabled: env.STRIPE_TAX_ENABLED === 'true', clientBaseUrl,
    redisUrl: env.REDIS_URL || '', fxApiUrl: env.FX_API_URL || 'https://api.frankfurter.dev/v1/latest',
    searchProvider, elasticsearchUrl: env.ELASTICSEARCH_URL || '', elasticsearchApiKey: env.ELASTICSEARCH_API_KEY || '', elasticsearchIndex: env.ELASTICSEARCH_INDEX || 'market-lane-products',
    fxRatesOverride: env.FX_RATES_JSON || '', uploadsDir: env.UPLOADS_DIR || 'uploads',
    s3Bucket: env.S3_BUCKET || '', s3Region: env.S3_REGION || 'us-east-1',
    s3Endpoint: env.S3_ENDPOINT || '', s3AccessKeyId: env.S3_ACCESS_KEY_ID || '', s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
    cookieSecure: nodeEnv === 'production' || env.COOKIE_SECURE === 'true',
    cookieSameSite: nodeEnv === 'production' ? 'none' : 'lax',
    emailDeliveryUrl, emailApiKey, emailMode: env.EMAIL_MODE || 'console'
  };
}

module.exports = { loadConfig };
