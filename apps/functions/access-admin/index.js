const {
  publicRequest, publicUser, requests, requireAdmin, rowKey, users
} = require('../shared/access');

async function list(client, partitionKey) {
  const result = [];
  for await (const entity of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${partitionKey}'` } })) result.push(entity);
  return result;
}

async function requestByEmail(email) {
  try { return await requests().getEntity('request', rowKey(email)); }
  catch (error) { if (error.statusCode === 404) return null; throw error; }
}

module.exports = async function (context, req) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      context.res = { status: 403, jsonBody: { error: 'Rol de administrador requerido' } };
      return;
    }
    const route = String(context.bindingData.path || '').split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method.toUpperCase();

    if (method === 'GET' && route[0] === 'requests') {
      const items = (await list(requests(), 'request')).filter((item) => item.status === 'pending').map(publicRequest);
      context.res = { jsonBody: { items: items.sort((a, b) => a.requested_at.localeCompare(b.requested_at)) } };
      return;
    }
    if (method === 'GET' && route[0] === 'users') {
      const items = (await list(users(), 'user')).map(publicUser);
      context.res = { jsonBody: { items: items.sort((a, b) => a.display_name.localeCompare(b.display_name, 'es')) } };
      return;
    }

    const email = String(route[1] || '').toLowerCase();
    const now = new Date().toISOString();
    if (method === 'POST' && route[0] === 'requests' && route[2] === 'approve') {
      const pending = await requestByEmail(email);
      if (!pending) { context.res = { status: 404 }; return; }
      await users().upsertEntity({
        partitionKey: 'user', rowKey: rowKey(email), email, displayName: pending.displayName,
        role: 'user', status: 'approved', createdAt: now, updatedAt: now
      }, 'Merge');
      await requests().updateEntity({
        partitionKey: 'request', rowKey: rowKey(email), email,
        displayName: pending.displayName, provider: pending.provider,
        status: 'approved', requestedAt: pending.requestedAt, resolvedAt: now
      }, 'Replace');
      context.res = { jsonBody: { email, role: 'user', status: 'approved' } };
      return;
    }
    if (method === 'POST' && route[0] === 'requests' && route[2] === 'reject') {
      const pending = await requestByEmail(email);
      if (!pending) { context.res = { status: 404 }; return; }
      await requests().updateEntity({
        partitionKey: 'request', rowKey: rowKey(email), email,
        displayName: pending.displayName, provider: pending.provider,
        status: 'rejected', requestedAt: pending.requestedAt, resolvedAt: now
      }, 'Replace');
      context.res = { jsonBody: { email, status: 'rejected' } };
      return;
    }
    if (method === 'POST' && route[0] === 'users' && route[2] === 'status') {
      const status = req.body?.status;
      if (!['approved', 'blocked'].includes(status)) { context.res = { status: 400, jsonBody: { error: 'Estado inválido' } }; return; }
      const entity = await users().getEntity('user', rowKey(email));
      if (entity.role === 'admin') { context.res = { status: 400, jsonBody: { error: 'No se puede bloquear al administrador' } }; return; }
      await users().updateEntity({
        partitionKey: 'user', rowKey: rowKey(email), email,
        displayName: entity.displayName, role: entity.role, status,
        createdAt: entity.createdAt, updatedAt: now
      }, 'Replace');
      context.res = { jsonBody: { email, status } };
      return;
    }
    if (method === 'DELETE' && route[0] === 'users') {
      const entity = await users().getEntity('user', rowKey(email));
      if (entity.role === 'admin') { context.res = { status: 400, jsonBody: { error: 'No se puede eliminar al administrador' } }; return; }
      await users().deleteEntity('user', rowKey(email));
      await requests().deleteEntity('request', rowKey(email)).catch((error) => { if (error.statusCode !== 404) throw error; });
      context.res = { jsonBody: { email, status: 'deleted' } };
      return;
    }
    context.res = { status: 404, jsonBody: { error: 'Ruta administrativa no encontrada' } };
  } catch (error) {
    context.log.error(error);
    context.res = { status: error.statusCode === 404 ? 404 : 500, jsonBody: { error: 'Error administrando accesos Azure' } };
  }
};
