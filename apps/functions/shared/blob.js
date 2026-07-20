const crypto = require('crypto');
const path = require('path');
const {
  BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} = require('@azure/storage-blob');

const connection = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const containerName = process.env.AZURE_STORAGE_CONTAINER || 'movies';
const values = Object.fromEntries(connection.split(';').filter(Boolean).map((part) => {
  const index = part.indexOf('=');
  return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
}));
const accountName = values.AccountName;
const accountKey = values.AccountKey;
const credential = accountName && accountKey ? new StorageSharedKeyCredential(accountName, accountKey) : null;
const service = connection ? BlobServiceClient.fromConnectionString(connection) : null;
const container = service?.getContainerClient(containerName);
const extensions = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.m2ts']);

const movieId = (name) => `azure_${crypto.createHash('sha256').update(name).digest('hex').slice(0, 24)}`;
const text = (value = '') => { try { return decodeURIComponent(value); } catch { return value; } };
const title = (name) => path.basename(name, path.extname(name)).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
const genres = (value = '') => {
  if (!value) return [];
  try { const parsed = JSON.parse(text(value)); if (Array.isArray(parsed)) return parsed.map(String); } catch {}
  return text(value).split(',').map((item) => item.trim()).filter(Boolean);
};

async function movies(search = '') {
  if (!container) throw new Error('Azure Blob no está configurado');
  const items = [];
  for await (const blob of container.listBlobsFlat({ includeMetadata: true })) {
    const extension = path.extname(blob.name).toLowerCase();
    if (!extensions.has(extension)) continue;
    const item = {
      id: movieId(blob.name), blob_name: blob.name,
      title: text(blob.metadata?.title) || title(blob.name), library: 'Azure',
      extension: extension.slice(1), size_bytes: blob.properties.contentLength || 0,
      modified_at: blob.properties.lastModified?.toISOString(),
      year: Number(blob.metadata?.year) || null, overview: text(blob.metadata?.overview),
      genres: genres(blob.metadata?.genres), rating: Number(blob.metadata?.rating) || null,
      has_image: Boolean(blob.metadata?.poster), has_backdrop: false,
      poster_blob: blob.metadata?.poster || null, source: 'azure'
    };
    if (!search || item.title.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))) items.push(item);
  }
  return items.sort((a, b) => a.title.localeCompare(b.title, 'es'));
}

async function find(id) {
  return (await movies()).find((movie) => movie.id === id) || null;
}

function readUrl(blobName) {
  if (!credential || !container) return null;
  const sas = generateBlobSASQueryParameters({
    containerName, blobName, permissions: BlobSASPermissions.parse('r'),
    startsOn: new Date(Date.now() - 60_000), expiresOn: new Date(Date.now() + 15 * 60_000), protocol: 'https'
  }, credential).toString();
  return `${container.getBlobClient(blobName).url}?${sas}`;
}

module.exports = { container, containerName, credential, find, movieId, movies, readUrl, title };
