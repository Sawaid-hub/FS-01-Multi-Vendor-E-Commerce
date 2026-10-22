function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const mongoUri = env.MONGODB_URI;
  const jwtSecret = env.JWT_SECRET;
  const refreshSecret = env.REFRESH_TOKEN_SECRET || jwtSecret;
  const port = Number(env.PORT || 4000);
  const commissionBps = Number(env.COMMISSION_BPS || 1000);
  const emailDeliveryUrl = env.EMAIL_DELIVERY_URL || '';
  const emailApiKey = env.EMAIL_API_KEY || '';
  const emailMode = env.EMAIL_MODE || 'console';
  const gmailClientId = env.GMAIL_CLIENT_ID || '';
  const gmailClientSecret = env.GMAIL_CLIENT_SECRET || '';
  const gmailRefreshToken = env.GMAIL_REFRESH_TOKEN || '';
  const gmailSender = env.GMAIL_SENDER || '';
  const searchProvider = env.SEARCH_PROVIDER || 'mongodb';
  const clientBaseUrl = env.CLIENT_BASE_URL || 'http://localhost:5173';
  // TLS certificate verification for rediss:// connections.
  // Set to '0' only when your provider (e.g. Upstash, Render Redis free tier)
  // uses self-signed certificates. Never disable without a provider-specific reason.
  const redisTlsRejectUnauthorized = env.REDIS_TLS_REJECT_UNAUTHORIZED !== '0';
  const allowPilotSeed = env.ALLOW_PILOT_SEED === 'true';
  const demoPassword = env.DEMO_PASSWORD || '';
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
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    throw new Error('STRIPE_SECRET_KEY must be a Stripe test-mode key starting with sk_test_.');
  }
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required when Stripe test mode is enabled.');
  }
  if (nodeEnv === 'production' && !env.STRIPE_SECRET_KEY) {
    console.warn(JSON.stringify({ event: 'stripe_not_configured', warning: 'STRIPE_SECRET_KEY is not set; test payments are disabled.' }));
  }
  const gmailConfigured = gmailClientId && gmailClientSecret && gmailRefreshToken && gmailSender;
  if (nodeEnv === 'production' && emailMode !== 'gmail' && (!emailDeliveryUrl || !emailApiKey)) throw new Error('Configure Gmail (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/SENDER) or EMAIL_DELIVERY_URL + EMAIL_API_KEY for production email delivery.');
  if (nodeEnv === 'production' && emailMode === 'gmail' && !gmailConfigured) throw new Error('GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_SENDER are all required when EMAIL_MODE=gmail.');
  if (env.REDIS_URL && !env.REDIS_URL.startsWith('rediss://') && nodeEnv === 'production') {
    throw new Error('REDIS_URL must use TLS (rediss://) in production.');
  }
  if (nodeEnv === 'production' && !env.REDIS_URL) {
    console.warn(JSON.stringify({ event: 'redis_not_configured', warning: 'REDIS_URL is not set; using local in-memory fallback for rate limiting.' }));
  }
  if (nodeEnv === 'production' && env.REDIS_URL && !redisTlsRejectUnauthorized) {
    // Permitted only when the provider documents use of self-signed certs (e.g. Upstash free).
    console.warn(JSON.stringify({ event: 'redis_tls_unverified', warning: 'REDIS_TLS_REJECT_UNAUTHORIZED=0; TLS certificate verification is disabled.' }));
  }
  if (nodeEnv === 'production' && !env.S3_BUCKET) {
    console.warn(JSON.stringify({ event: 'storage_local_fallback', warning: 'S3_BUCKET is not set; using local storage adapter.' }));
  }
  if (nodeEnv === 'production' && !env.FX_API_URL && !env.FX_RATES_JSON) throw new Error('Configure a verified FX_API_URL or FX_RATES_JSON before production startup.');
  if (nodeEnv === 'production') {
    if (clientBaseUrl && clientBaseUrl.startsWith('https://')) {
      const clientUrl = new URL(clientBaseUrl);
      if (clientUrl.origin !== clientBaseUrl) throw new Error('CLIENT_BASE_URL must be a plain HTTPS origin in production.');
    }
    const origins = (env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
    for (const origin of origins) {
      if (origin.startsWith('https://')) {
        const url = new URL(origin);
        if (url.origin !== origin) throw new Error('CORS_ORIGINS must contain plain HTTPS origins in production.');
      }
    }
    if (emailDeliveryUrl && new URL(emailDeliveryUrl).protocol !== 'https:') throw new Error('EMAIL_DELIVERY_URL must use HTTPS in production.');
    if (env.ELASTICSEARCH_URL && new URL(env.ELASTICSEARCH_URL).protocol !== 'https:') throw new Error('ELASTICSEARCH_URL must use HTTPS in production.');
    if (env.S3_ENDPOINT && new URL(env.S3_ENDPOINT).protocol !== 'https:') throw new Error('S3_ENDPOINT must use HTTPS in production.');
  }
  if (!['mongodb', 'elastic'].includes(searchProvider)) throw new Error('SEARCH_PROVIDER must be mongodb or elastic.');
  if (searchProvider === 'elastic' && (!env.ELASTICSEARCH_URL || !env.ELASTICSEARCH_API_KEY || !env.ELASTICSEARCH_INDEX)) throw new Error('ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY, and ELASTICSEARCH_INDEX are required for Elastic search.');
  if (nodeEnv === 'production' && searchProvider !== 'elastic') throw new Error('Production deployments must use the configured Elastic search adapter.');

  return {
    nodeEnv, mongoUri, port, jwtSecret, refreshSecret, refreshTokenDays, accessTokenSeconds, commissionBps,
    allowedOrigins: (env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean),
    stripeSecretKey: env.STRIPE_SECRET_KEY || '', stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    stripeTaxEnabled: env.STRIPE_TAX_ENABLED === 'true', clientBaseUrl,
    redisUrl: env.REDIS_URL || '',
    redisTlsRejectUnauthorized,
    fxApiUrl: env.FX_API_URL || 'https://api.frankfurter.dev/v1/latest',
    searchProvider, elasticsearchUrl: env.ELASTICSEARCH_URL || '', elasticsearchApiKey: env.ELASTICSEARCH_API_KEY || '', elasticsearchIndex: env.ELASTICSEARCH_INDEX || 'market-lane-products',
    fxRatesOverride: env.FX_RATES_JSON || '', uploadsDir: env.UPLOADS_DIR || 'uploads',
    s3Bucket: env.S3_BUCKET || '', s3Region: env.S3_REGION || 'us-east-1',
    s3Endpoint: env.S3_ENDPOINT || '', s3AccessKeyId: env.S3_ACCESS_KEY_ID || '', s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
    cookieSecure: nodeEnv === 'production' || env.COOKIE_SECURE === 'true',
    cookieSameSite: nodeEnv === 'production' ? 'none' : 'lax',
    emailDeliveryUrl, emailApiKey, emailMode,
    gmailClientId, gmailClientSecret, gmailRefreshToken, gmailSender,
    allowPilotSeed, demoPassword,
  };
}

module.exports = { loadConfig };
