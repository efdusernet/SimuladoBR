const { Issuer, generators } = require('openid-client');

let googleClient = null;

async function getGoogleClient() {
  if (googleClient) return googleClient;
  const Google = await Issuer.discover('https://accounts.google.com');
  googleClient = new Google.Client({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uris: [ `${process.env.BACKEND_BASE || 'http://localhost:3000'}/api/auth/google/callback`, `${process.env.BACKEND_BASE || 'http://localhost:3000'}/api/v1/auth/google/callback` ],
    response_types: ['code']
  });
  return googleClient;
}

function genPKCE() {
  const code_verifier = generators.codeVerifier();
  const code_challenge = generators.codeChallenge(code_verifier);
  return { code_verifier, code_challenge };
}

module.exports = { getGoogleClient, genPKCE };
