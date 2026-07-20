const crypto = require('crypto');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const signingSecret = process.env.AUTH_SIGNING_SECRET || '';

function connectionValue(name) {
  const match = connectionString.split(';').map((part) => part.split('=')).find(([key]) => key === name);
  return match ? match.slice(1).join('=') : '';
}

const accountName = connectionValue('AccountName');
const accountKey = connectionValue('AccountKey');
const credential = accountName && accountKey ? new AzureNamedKeyCredential(accountName, accountKey) : null;
const endpoint = accountName ? `https://${accountName}.table.core.windows.net` : '';

function table(name) {
  if (!credential) throw new Error('Azure Table Storage no está configurado');
  return new TableClient(endpoint, name, credential);
}

const users = () => table('accessusers');
const requests = () => table('accessrequests');
const rowKey = (email) => Buffer.from(email.toLowerCase()).toString('base64url');

function principal(req) {
  const encoded = req.headers?.['x-ms-client-principal']
    || req.headers?.['X-MS-CLIENT-PRINCIPAL']
    || req.headers?.get?.('x-ms-client-principal');
  if (!encoded) return null;
  const value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  const email = String(value.userDetails || '').trim().toLowerCase();
  return email ? { email, name: value.userDetails, provider: value.identityProvider || 'aad' } : null;
}

async function getUser(email) {
  try { return await users().getEntity('user', rowKey(email)); }
  catch (error) { if (error.statusCode === 404) return null; throw error; }
}

async function ensureAdmin(identity) {
  if (!adminEmail || identity.email !== adminEmail) return;
  const now = new Date().toISOString();
  await users().upsertEntity({
    partitionKey: 'user', rowKey: rowKey(identity.email), email: identity.email,
    displayName: identity.name || 'Administrador', role: 'admin', status: 'approved',
    createdAt: now, updatedAt: now
  }, 'Merge');
}

function sign(payload) {
  if (!signingSecret) throw new Error('AUTH_SIGNING_SECRET no está configurado');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', signingSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

async function requireAdmin(req) {
  const identity = principal(req);
  if (!identity) return null;
  await ensureAdmin(identity);
  const access = await getUser(identity.email);
  return access?.role === 'admin' && access?.status === 'approved' ? { ...identity, ...access } : null;
}

async function requireUser(req) {
  const identity = principal(req);
  if (!identity) return null;
  await ensureAdmin(identity);
  const access = await getUser(identity.email);
  return access?.status === 'approved' && ['admin', 'user'].includes(access?.role)
    ? { ...identity, ...access }
    : null;
}

function publicUser(entity) {
  return {
    email: entity.email, display_name: entity.displayName, role: entity.role,
    status: entity.status, created_at: entity.createdAt, updated_at: entity.updatedAt
  };
}

function publicRequest(entity) {
  return {
    email: entity.email, display_name: entity.displayName, provider: entity.provider,
    status: entity.status, requested_at: entity.requestedAt, resolved_at: entity.resolvedAt || null
  };
}

module.exports = {
  adminEmail, ensureAdmin, getUser, principal, publicRequest, publicUser,
  requests, requireAdmin, requireUser, rowKey, sign, users
};
