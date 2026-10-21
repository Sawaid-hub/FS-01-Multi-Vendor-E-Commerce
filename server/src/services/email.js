const { ApiError } = require('../utils/api-error');

/**
 * Email delivery service — supports three modes:
 *
 *  console  (default / development)
 *    Prints the email as structured JSON to stdout. Zero config needed locally.
 *
 *  gmail
 *    Sends via Gmail API with OAuth2. Requires:
 *      GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER
 *    Run `node src/scripts/get-gmail-token.js` once to obtain the refresh token.
 *
 *  api
 *    Generic HTTP delivery (e.g. SendGrid, Resend). Requires:
 *      EMAIL_DELIVERY_URL, EMAIL_API_KEY
 */

let _gmailClient = null;

function getGmailClient(config) {
  if (_gmailClient) return _gmailClient;

  const { google } = require('googleapis');
  const oauth2Client = new google.auth.OAuth2(
    config.gmailClientId,
    config.gmailClientSecret,
  );
  oauth2Client.setCredentials({ refresh_token: config.gmailRefreshToken });

  _gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
  return _gmailClient;
}

async function deliver(config, { to, subject, text }) {
  // ── Gmail OAuth2 mode ──────────────────────────────────────────────────────
  if (config.emailMode === 'gmail') {
    if (!config.gmailClientId || !config.gmailClientSecret || !config.gmailRefreshToken || !config.gmailSender) {
      throw new ApiError(503, 'email_delivery_not_configured', 'Gmail OAuth2 credentials are incomplete.');
    }
    const gmail = getGmailClient(config);
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject || '').toString('base64')}?=`;
    const messageParts = [
      `From: <${config.gmailSender}>`,
      `To: <${to}>`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      text || '',
    ];
    const rawMessage = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    try {
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });
    } catch (err) {
      throw new ApiError(503, 'email_delivery_failed', `Gmail API delivery failed: ${err.message}`);
    }
    return;
  }

  // ── Generic HTTP API mode (SendGrid, Resend, etc.) ─────────────────────────
  if (config.emailDeliveryUrl && config.emailApiKey) {
    const response = await fetch(config.emailDeliveryUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.emailApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new ApiError(503, 'email_delivery_failed', 'Email delivery is temporarily unavailable.');
    return;
  }

  // ── Console / development fallback ────────────────────────────────────────
  if (config.nodeEnv === 'production' || config.emailMode !== 'console') {
    throw new ApiError(503, 'email_delivery_not_configured');
  }
  console.info(JSON.stringify({ event: 'development_email', to, subject, text }));
}

module.exports = { deliver };
