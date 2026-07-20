const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { TableClient } = require('@azure/data-tables');

const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!connection) throw new Error('AZURE_STORAGE_CONNECTION_STRING es requerido');

const databasePath = path.resolve(process.env.DATABASE_PATH || 'data/cineops.db');
const db = new DatabaseSync(databasePath, { readOnly: true });
const usersTable = TableClient.fromConnectionString(connection, 'accessusers');
const requestsTable = TableClient.fromConnectionString(connection, 'accessrequests');
const rowKey = (email) => Buffer.from(email.toLowerCase()).toString('base64url');

async function migrate() {
  const localUsers = db.prepare('SELECT * FROM access_users').all();
  const localRequests = db.prepare('SELECT * FROM access_requests').all();

  for (const user of localUsers) {
    await usersTable.upsertEntity({
      partitionKey: 'user', rowKey: rowKey(user.email), email: user.email.toLowerCase(),
      displayName: user.display_name, role: user.role, status: user.status,
      createdAt: user.created_at, updatedAt: user.updated_at
    }, 'Merge');
  }
  for (const request of localRequests) {
    await requestsTable.upsertEntity({
      partitionKey: 'request', rowKey: rowKey(request.email), email: request.email.toLowerCase(),
      displayName: request.display_name, provider: request.provider, status: request.status,
      requestedAt: request.requested_at, resolvedAt: request.resolved_at || ''
    }, 'Merge');
  }
  console.log(JSON.stringify({ usersMigrated: localUsers.length, requestsMigrated: localRequests.length }));
}

migrate().finally(() => db.close()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
