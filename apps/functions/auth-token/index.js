const crypto = require('crypto');

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

module.exports = async function (context, req) {
  const encodedPrincipal = req.headers['x-ms-client-principal'];
  const secret = process.env.AUTH_SIGNING_SECRET;
  if (!encodedPrincipal || !secret) {
    context.res = { status: 401, jsonBody: { error: 'Identidad no disponible' } };
    return;
  }

  const principal = JSON.parse(Buffer.from(encodedPrincipal, 'base64').toString('utf8'));
  const payload = {
    email: String(principal.userDetails || '').toLowerCase(),
    name: principal.userDetails,
    provider: principal.identityProvider || 'aad',
    exp: Math.floor(Date.now() / 1000) + 300
  };
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  context.res = {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ token: `${header}.${body}.${signature}` })
  };
};

