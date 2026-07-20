const { ensureAdmin, getUser, principal, requests, rowKey, sign } = require('../shared/access');

module.exports = async function (context, req) {
  try {
    const identity = principal(req);
    if (!identity) {
      context.res = { status: 401, jsonBody: { error: 'Identidad Microsoft no disponible' } };
      return;
    }
    await ensureAdmin(identity);
    let access = await getUser(identity.email);
    if (!access) {
      const now = new Date().toISOString();
      await requests().upsertEntity({
        partitionKey: 'request', rowKey: rowKey(identity.email), email: identity.email,
        displayName: identity.name || identity.email, provider: identity.provider,
        status: 'pending', requestedAt: now, resolvedAt: ''
      }, 'Merge');
    }
    access = await getUser(identity.email);
    const role = access?.role || 'pending';
    const status = access?.status || 'pending';
    const token = sign({
      email: identity.email, name: identity.name || identity.email, provider: identity.provider,
      role, status, exp: Math.floor(Date.now() / 1000) + 3600
    });
    context.res = {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ email: identity.email, name: identity.name, role, status, access_token: token })
    };
  } catch (error) {
    context.log.error(error);
    const diagnostic = [error.code, error.statusCode, error.name].filter(Boolean).join(' / ');
    context.res = {
      status: 500,
      jsonBody: { error: 'No se pudo crear la sesión Azure', diagnostic: diagnostic || 'FUNCTION_ERROR' }
    };
  }
};
