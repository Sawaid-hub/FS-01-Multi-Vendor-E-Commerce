const { ApiError } = require('../utils/api-error');

async function deliver(config, { to, subject, text }) {
  if (config.emailDeliveryUrl && config.emailApiKey) {
    const response = await fetch(config.emailDeliveryUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.emailApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, text }), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new ApiError(503, 'email_delivery_failed', 'Email delivery is temporarily unavailable.');
    return;
  }
  if (config.nodeEnv === 'production' || config.emailMode !== 'console') throw new ApiError(503, 'email_delivery_not_configured');
  console.info(JSON.stringify({ event: 'development_email', to, subject, text }));
}

module.exports = { deliver };
