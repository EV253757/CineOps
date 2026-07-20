const sessionFunction = require('../apps/functions/access-session');
const adminFunction = require('../apps/functions/access-admin');
const cloudFunction = require('../apps/functions/cloud-media');

const email = String(process.env.ADMIN_EMAIL || '').toLowerCase();
if (!email) throw new Error('ADMIN_EMAIL es requerido');
const principal = Buffer.from(JSON.stringify({
  identityProvider: 'aad', userDetails: email, userRoles: ['authenticated']
})).toString('base64');

async function invoke(handler, req, path = '') {
  const context = { bindingData: { path }, log: { error: console.error } };
  await handler(context, { headers: { 'x-ms-client-principal': principal }, ...req });
  return context.res;
}

async function smoke() {
  const session = await invoke(sessionFunction, { method: 'GET' });
  if (session.status && session.status >= 400) throw new Error(`Sesión: HTTP ${session.status}`);
  const users = await invoke(adminFunction, { method: 'GET' }, 'users');
  if (users.status && users.status >= 400) throw new Error(`Usuarios: HTTP ${users.status}`);
  const requests = await invoke(adminFunction, { method: 'GET' }, 'requests');
  if (requests.status && requests.status >= 400) throw new Error(`Solicitudes: HTTP ${requests.status}`);
  const usersBody = users.jsonBody || JSON.parse(users.body);
  const requestsBody = requests.jsonBody || JSON.parse(requests.body);
  const cloud = await invoke(cloudFunction, { method: 'GET', query: {} });
  if (cloud.status && cloud.status >= 400) throw new Error(`Catálogo Azure: HTTP ${cloud.status}`);
  const cloudBody = cloud.jsonBody || JSON.parse(cloud.body);
  console.log(JSON.stringify({
    session: 'ok', users: usersBody.items.length,
    pendingRequests: requestsBody.items.length, cloudMovies: cloudBody.items.length
  }));
}

smoke().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
