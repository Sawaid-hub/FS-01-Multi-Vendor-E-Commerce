/**
 * One-time script to obtain a Gmail OAuth2 refresh token via a local redirect.
 *
 * Usage:
 *   node src/scripts/get-gmail-token.js
 *
 * This starts a temporary HTTP server on localhost:3333 to receive the OAuth
 * callback automatically — no copy-paste of an authorization code required.
 *
 * Prerequisites:
 *   In Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 client:
 *   Add  http://localhost:3333/oauth2callback  to "Authorized redirect URIs" and Save.
 *
 * Then run this script, open the printed URL, sign in with the Gmail account
 * you want to send FROM, and the refresh_token will be printed here automatically.
 */

require('dotenv').config();
const http = require('node:http');
const { google } = require('googleapis');

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const PORT = 3333;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in server/.env first.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

// Temporary local server to capture the callback code automatically.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end(`<h2>Error: ${error}</h2><p>Close this tab and check the terminal.</p>`);
    server.close();
    console.error('OAuth error:', error);
    process.exit(1);
  }

  if (!code) {
    res.end('<p>Waiting for authorization code...</p>');
    return;
  }

  res.end('<h2>✅ Authorized!</h2><p>You can close this tab. Check the terminal for your refresh_token.</p>');
  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n─────────────────────────────────────────────────────────');
    console.log('SUCCESS — Add these to server/.env:');
    console.log('─────────────────────────────────────────────────────────');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('─────────────────────────────────────────────────────────');
    console.log('\nNever commit this value. It is already excluded by .gitignore via server/.env.');
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('\n─────────────────────────────────────────────────────────');
  console.log('STEP 1 — Make sure http://localhost:3333/oauth2callback is');
  console.log('         listed in your Google Cloud OAuth client\'s');
  console.log('         Authorized Redirect URIs.');
  console.log('─────────────────────────────────────────────────────────');
  console.log('STEP 2 — Open this URL in your browser:');
  console.log('─────────────────────────────────────────────────────────');
  console.log(authUrl);
  console.log('─────────────────────────────────────────────────────────');
  console.log('Waiting for Google to redirect back to localhost:3333...\n');
});
