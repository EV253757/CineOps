import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential
} from '@azure/storage-blob';
import cors from 'cors';
import express from 'express';

const PORT = Number(process.env.PORT || 3001);
const DATABASE_PATH = path.resolve(process.env.DATABASE_PATH || './data/cineops.db');
const MEDIA_ROOTS = (process.env.MEDIA_ROOTS || '')
  .split(';')
  .map((item) => item.trim())
  .filter(Boolean);
const VIDEO_EXTENSIONS = new Set([
  '.avi', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.ts', '.webm', '.wmv'
]);
const JELLYFIN_URL = (process.env.JELLYFIN_URL || '').replace(/\/$/, '');
const JELLYFIN_PUBLIC_URL = (process.env.JELLYFIN_PUBLIC_URL || '').replace(/\/$/, '');
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY || '';
const AUTH_SIGNING_SECRET = process.env.AUTH_SIGNING_SECRET || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const AZURE_STORAGE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER || 'movies';

function connectionValue(name) {
  const match = AZURE_STORAGE_CONNECTION_STRING.split(';')
    .map((part) => part.split('='))
    .find(([key]) => key === name);
  return match ? match.slice(1).join('=') : '';
}

const storageAccountName = connectionValue('AccountName');
const storageAccountKey = connectionValue('AccountKey');
const blobService = AZURE_STORAGE_CONNECTION_STRING
  ? BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING)
  : null;
const blobContainer = blobService?.getContainerClient(AZURE_STORAGE_CONTAINER);
const blobCredential = storageAccountName && storageAccountKey
  ? new StorageSharedKeyCredential(storageAccountName, storageAccountKey)
  : null;
let cloudCache = { expiresAt: 0, items: [], names: new Map() };

async function jellyfinFetch(endpoint, options = {}) {
  if (!JELLYFIN_URL || !JELLYFIN_API_KEY) throw new Error('Jellyfin no está configurado');
  const headers = new Headers(options.headers || {});
  headers.set('X-Emby-Token', JELLYFIN_API_KEY);
  const response = await fetch(`${JELLYFIN_URL}${endpoint}`, { ...options, headers });
  if (!response.ok) throw new Error(`Jellyfin respondió ${response.status}`);
  return response;
}

function mapJellyfinItem(item) {
  const source = item.MediaSources?.[0] || {};
  return {
    id: item.Id,
    title: item.Name,
    library: item.Path?.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] || 'Jellyfin',
    extension: source.Container?.split(',')[0] || path.extname(item.Path || '').slice(1) || 'video',
    size_bytes: source.Size || 0,
    modified_at: item.DateCreated,
    year: item.ProductionYear,
    overview: item.Overview || '',
    genres: item.Genres || [],
    rating: item.CommunityRating,
    has_image: Boolean(item.ImageTags?.Primary),
    has_backdrop: Boolean(item.BackdropImageTags?.length),
    jellyfin_url: JELLYFIN_PUBLIC_URL ? `${JELLYFIN_PUBLIC_URL}/web/#/details?id=${item.Id}` : null
  };
}

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
const db = new DatabaseSync(DATABASE_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS movies (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    library TEXT NOT NULL,
    extension TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    indexed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS access_users (
    email TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    status TEXT NOT NULL CHECK(status IN ('approved', 'blocked')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS access_requests (
    email TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
    requested_at TEXT NOT NULL,
    resolved_at TEXT
  );
`);

if (ADMIN_EMAIL) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO access_users (email, display_name, role, status, created_at, updated_at)
              VALUES (?, ?, 'admin', 'approved', ?, ?)
              ON CONFLICT(email) DO UPDATE SET role='admin', status='approved', updated_at=excluded.updated_at`)
    .run(ADMIN_EMAIL, 'Administrador', now, now);
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signSession(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', AUTH_SIGNING_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifySession(token) {
  if (!AUTH_SIGNING_SECRET || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', AUTH_SIGNING_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  const actualBuffer = Buffer.from(parts[2]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  return payload.exp >= Math.floor(Date.now() / 1000) ? payload : null;
}

function cookieValue(request, name) {
  const cookies = Object.fromEntries((request.headers.cookie || '').split(';').map((item) => {
    const index = item.indexOf('=');
    return index < 0 ? ['', ''] : [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1))];
  }));
  return cookies[name];
}

function currentAccess(email) {
  return db.prepare('SELECT email, display_name, role, status FROM access_users WHERE email = ?').get(email.toLowerCase());
}

function requireUser(request, response, next) {
  const bearer = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : null;
  const identity = verifySession(cookieValue(request, 'cineops_session') || bearer || request.query.access_token);
  if (!identity?.email) return response.status(401).json({ error: 'Sesión requerida' });
  const access = currentAccess(identity.email);
  if (!access || access.status !== 'approved') return response.status(403).json({ error: 'Acceso pendiente' });
  request.identity = { ...identity, ...access };
  next();
}

function requireAdmin(request, response, next) {
  requireUser(request, response, () => request.identity.role === 'admin'
    ? next()
    : response.status(403).json({ error: 'Rol de administrador requerido' }));
}

const upsertMovie = db.prepare(`
  INSERT INTO movies (id, title, file_path, library, extension, size_bytes, modified_at, indexed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(file_path) DO UPDATE SET
    title = excluded.title,
    library = excluded.library,
    extension = excluded.extension,
    size_bytes = excluded.size_bytes,
    modified_at = excluded.modified_at,
    indexed_at = excluded.indexed_at
`);
const getMovie = db.prepare('SELECT * FROM movies WHERE id = ?');

function movieTitle(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cloudMovieId(blobName) {
  return `azure_${crypto.createHash('sha256').update(blobName).digest('hex').slice(0, 24)}`;
}

function movieIdentity(title = '') {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(2160p|1080p|720p|4k|uhd|bluray|web[ .-]?dl|webrip|dual|latino|lat|cinecalidad|rip|hdr|x26[45])\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function metadataGenres(value = '') {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}
  return value.split(',').map((genre) => genre.trim()).filter(Boolean);
}

function metadataText(value = '') {
  try { return decodeURIComponent(value); } catch { return value; }
}

async function cloudMovies(force = false) {
  if (!blobContainer) return [];
  if (!force && cloudCache.expiresAt > Date.now()) return cloudCache.items;

  const items = [];
  const names = new Map();
  for await (const blob of blobContainer.listBlobsFlat({ includeMetadata: true })) {
    const extension = path.extname(blob.name).slice(1).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(`.${extension}`)) continue;
    const id = cloudMovieId(blob.name);
    names.set(id, blob.name);
    items.push({
      id,
      title: metadataText(blob.metadata?.title) || movieTitle(blob.name),
      library: 'Azure',
      extension,
      size_bytes: blob.properties.contentLength || 0,
      modified_at: blob.properties.lastModified?.toISOString(),
      year: Number(blob.metadata?.year) || null,
      overview: metadataText(blob.metadata?.overview),
      genres: metadataGenres(metadataText(blob.metadata?.genres)),
      rating: Number(blob.metadata?.rating) || null,
      has_image: Boolean(blob.metadata?.poster),
      has_backdrop: false,
      poster_blob: blob.metadata?.poster || null,
      source: 'azure'
    });
  }
  items.sort((a, b) => a.title.localeCompare(b.title, 'es'));
  cloudCache = { expiresAt: Date.now() + 300_000, items, names };
  return items;
}

async function cloudBlobName(id) {
  await cloudMovies();
  if (!cloudCache.names.has(id)) await cloudMovies(true);
  return cloudCache.names.get(id);
}

function cloudReadUrl(blobName) {
  if (!blobCredential) return null;
  const startsOn = new Date(Date.now() - 60_000);
  const expiresOn = new Date(Date.now() + 15 * 60_000);
  const sas = generateBlobSASQueryParameters({
    containerName: AZURE_STORAGE_CONTAINER,
    blobName,
    permissions: BlobSASPermissions.parse('r'),
    startsOn,
    expiresOn,
    protocol: 'https'
  }, blobCredential).toString();
  return `${blobContainer.getBlobClient(blobName).url}?${sas}`;
}

async function enrichCloudMovie(id) {
  if (!JELLYFIN_URL || !JELLYFIN_API_KEY) throw new Error('Jellyfin no está disponible para buscar metadatos');
  const blobName = await cloudBlobName(id);
  if (!blobName) throw new Error('Película Azure no encontrada');
  const cloudItem = cloudCache.items.find((item) => item.id === id);
  const sourceTitle = cloudItem?.title || movieTitle(blobName);
  const targetIdentity = movieIdentity(sourceTitle);
  const params = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Video',
    SearchTerm: targetIdentity,
    Fields: 'Overview,ProductionYear,Genres,CommunityRating',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary',
    Limit: '10'
  });
  const result = await (await jellyfinFetch(`/Items?${params}`)).json();
  const match = result.Items.find((item) => movieIdentity(item.Name) === targetIdentity) || result.Items[0];
  if (!match) throw new Error('No se encontró una coincidencia en Jellyfin');

  const metadata = {
    title: encodeURIComponent(match.Name || cloudItem?.title || movieTitle(blobName)),
    year: String(match.ProductionYear || ''),
    genres: encodeURIComponent((match.Genres || []).join(',')),
    overview: encodeURIComponent(String(match.Overview || '').slice(0, 1800)),
    rating: String(match.CommunityRating || '')
  };
  if (match.ImageTags?.Primary) {
    const posterName = `posters/${id}.jpg`;
    const posterResponse = await jellyfinFetch(`/Items/${encodeURIComponent(match.Id)}/Images/Primary?maxWidth=800&quality=90`);
    const poster = Buffer.from(await posterResponse.arrayBuffer());
    await blobContainer.getBlockBlobClient(posterName).uploadData(poster, {
      blobHTTPHeaders: { blobContentType: posterResponse.headers.get('content-type') || 'image/jpeg' }
    });
    metadata.poster = posterName;
  }
  await blobContainer.getBlockBlobClient(blobName).setMetadata(metadata);
  cloudCache.expiresAt = 0;
  await cloudMovies(true);
  return cloudCache.items.find((item) => item.id === id);
}

function* walk(directory) {
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    console.warn(`No se pudo leer ${directory}: ${error.message}`);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) yield fullPath;
  }
}

function scanLibraries() {
  const indexedAt = new Date().toISOString();
  let indexed = 0;
  const roots = MEDIA_ROOTS.filter((root) => fs.existsSync(root));

  db.exec('BEGIN');
  try {
    for (const root of roots) {
      for (const filePath of walk(root)) {
        const stat = fs.statSync(filePath);
        const id = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 24);
        upsertMovie.run(
          id,
          movieTitle(filePath),
          filePath,
          path.basename(root),
          path.extname(filePath).slice(1).toLowerCase(),
          stat.size,
          stat.mtime.toISOString(),
          indexedAt
        );
        indexed += 1;
      }
    }
    db.prepare('DELETE FROM movies WHERE indexed_at <> ?').run(indexedAt);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { indexed, roots };
}

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',');
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.post('/api/auth/exchange', (request, response) => {
  const identity = verifySession(request.body?.token);
  if (!identity?.email) return response.status(401).json({ error: 'Identidad Microsoft inválida' });
  const email = identity.email.toLowerCase();
  let access = currentAccess(email);
  const now = new Date().toISOString();
  if (!access) {
    db.prepare(`INSERT INTO access_requests (email, display_name, provider, status, requested_at)
                VALUES (?, ?, ?, 'pending', ?)
                ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name, status='pending', requested_at=excluded.requested_at`)
      .run(email, identity.name || email, identity.provider || 'aad', now);
  }
  access = currentAccess(email);
  const session = signSession({ email, name: identity.name || email, provider: identity.provider || 'aad', exp: Math.floor(Date.now() / 1000) + 3600 });
  response.setHeader('Set-Cookie', `cineops_session=${session}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=3600`);
  return response.json({ email, name: identity.name || email, role: access?.role || 'pending', status: access?.status || 'pending', access_token: session });
});

app.get('/api/auth/me', (request, response) => {
  const identity = verifySession(cookieValue(request, 'cineops_session'));
  if (!identity?.email) return response.status(401).json({ error: 'Sesión requerida' });
  const access = currentAccess(identity.email);
  return response.json({ email: identity.email, name: identity.name, role: access?.role || 'pending', status: access?.status || 'pending' });
});

app.get('/api/admin/requests', requireAdmin, (_request, response) => {
  response.json({ items: db.prepare(`SELECT email, display_name, provider, status, requested_at
                                     FROM access_requests WHERE status='pending' ORDER BY requested_at`).all() });
});

app.get('/api/admin/users', requireAdmin, (_request, response) => {
  response.json({ items: db.prepare(`SELECT email, display_name, role, status, created_at, updated_at
                                     FROM access_users ORDER BY role, display_name`).all() });
});

app.post('/api/admin/requests/:email/approve', requireAdmin, (request, response) => {
  const email = decodeURIComponent(request.params.email).toLowerCase();
  const pending = db.prepare('SELECT * FROM access_requests WHERE email = ?').get(email);
  if (!pending) return response.sendStatus(404);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO access_users (email, display_name, role, status, created_at, updated_at)
              VALUES (?, ?, 'user', 'approved', ?, ?)
              ON CONFLICT(email) DO UPDATE SET role='user', status='approved', updated_at=excluded.updated_at`)
    .run(email, pending.display_name, now, now);
  db.prepare(`UPDATE access_requests SET status='approved', resolved_at=? WHERE email=?`).run(now, email);
  return response.json({ email, role: 'user', status: 'approved' });
});

app.post('/api/admin/requests/:email/reject', requireAdmin, (request, response) => {
  const email = decodeURIComponent(request.params.email).toLowerCase();
  const result = db.prepare(`UPDATE access_requests SET status='rejected', resolved_at=? WHERE email=? AND status='pending'`)
    .run(new Date().toISOString(), email);
  return result.changes ? response.json({ email, status: 'rejected' }) : response.sendStatus(404);
});

app.post('/api/admin/users/:email/status', requireAdmin, (request, response) => {
  const email = decodeURIComponent(request.params.email).toLowerCase();
  const status = request.body?.status;
  if (!['approved', 'blocked'].includes(status)) return response.status(400).json({ error: 'Estado inválido' });
  const user = currentAccess(email);
  if (!user) return response.sendStatus(404);
  if (user.role === 'admin') return response.status(400).json({ error: 'No se puede bloquear una cuenta administradora' });
  db.prepare('UPDATE access_users SET status=?, updated_at=? WHERE email=?').run(status, new Date().toISOString(), email);
  return response.json({ email, status });
});

app.delete('/api/admin/users/:email', requireAdmin, (request, response) => {
  const email = decodeURIComponent(request.params.email).toLowerCase();
  const user = currentAccess(email);
  if (!user) return response.sendStatus(404);
  if (user.role === 'admin') return response.status(400).json({ error: 'No se puede eliminar una cuenta administradora' });
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM access_users WHERE email=?').run(email);
    db.prepare('DELETE FROM access_requests WHERE email=?').run(email);
    db.exec('COMMIT');
    return response.json({ email, status: 'deleted' });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

app.get('/api/admin/cloud', requireAdmin, async (_request, response, next) => {
  try {
    const items = await cloudMovies(true);
    const usedBytes = items.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
    response.json({ items, used_bytes: usedBytes, limit_bytes: 100 * 1024 ** 3 });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/cloud/upload-url', requireAdmin, async (request, response, next) => {
  try {
    if (!blobCredential || !blobContainer) return response.status(503).json({ error: 'Azure Blob no está configurado' });
    const title = String(request.body?.name || '').trim();
    const size = Number(request.body?.size || 0);
    const extension = path.extname(title).toLowerCase();
    if (!title || !VIDEO_EXTENSIONS.has(extension) || !Number.isFinite(size) || size <= 0) {
      return response.status(400).json({ error: 'Selecciona un archivo de video válido' });
    }
    const items = await cloudMovies(true);
    const usedBytes = items.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
    const limitBytes = 100 * 1024 ** 3;
    if (usedBytes + size > limitBytes) {
      return response.status(409).json({ error: 'La carga superaría el límite operativo de 100 GB', used_bytes: usedBytes, limit_bytes: limitBytes });
    }
    const blobName = `uploads/${crypto.randomUUID()}${extension}`;
    const startsOn = new Date(Date.now() - 60_000);
    const expiresOn = new Date(Date.now() + 12 * 60 * 60_000);
    const sas = generateBlobSASQueryParameters({
      containerName: AZURE_STORAGE_CONTAINER,
      blobName,
      permissions: BlobSASPermissions.parse('cw'),
      startsOn,
      expiresOn,
      protocol: 'https'
    }, blobCredential).toString();
    response.json({
      blob_name: blobName,
      upload_url: `${blobContainer.getBlockBlobClient(blobName).url}?${sas}`,
      expires_at: expiresOn.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/cloud/finalize', requireAdmin, async (request, response, next) => {
  try {
    const blobName = String(request.body?.blob_name || '');
    const title = String(request.body?.title || '').trim();
    if (!blobName.startsWith('uploads/') || !title) return response.status(400).json({ error: 'Carga inválida' });
    const client = blobContainer.getBlockBlobClient(blobName);
    if (!(await client.exists())) return response.sendStatus(404);
    await client.setMetadata({ title: encodeURIComponent(movieTitle(title)) });
    cloudCache.expiresAt = 0;
    const id = cloudMovieId(blobName);
    let metadata = null;
    try { metadata = await enrichCloudMovie(id); } catch (error) { console.warn(`Metadatos pendientes: ${error.message}`); }
    response.json({ status: 'ready', id, metadata: Boolean(metadata) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/cloud/:id/enrich', requireAdmin, async (request, response, next) => {
  try {
    response.json(await enrichCloudMovie(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/cloud/cancel', requireAdmin, async (request, response, next) => {
  try {
    const blobName = String(request.body?.blob_name || '');
    if (!blobName.startsWith('uploads/')) return response.status(400).json({ error: 'Carga inválida' });
    const client = blobContainer.getBlockBlobClient(blobName);
    try {
      await client.commitBlockList([]);
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
    await client.deleteIfExists();
    cloudCache.expiresAt = 0;
    response.json({ status: 'cancelled' });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/cloud/:id', requireAdmin, async (request, response, next) => {
  try {
    const blobName = await cloudBlobName(request.params.id);
    if (!blobName) return response.sendStatus(404);
    const item = cloudCache.items.find((movie) => movie.id === request.params.id);
    await blobContainer.deleteBlob(blobName);
    if (item?.poster_blob) await blobContainer.deleteBlob(item.poster_blob, { deleteSnapshots: 'include' }).catch(() => {});
    cloudCache.expiresAt = 0;
    response.json({ status: 'deleted', id: request.params.id });
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', libraries: MEDIA_ROOTS.length, azure_blob: Boolean(blobContainer) });
});

app.get('/api/movies', requireUser, async (request, response, next) => {
  const search = String(request.query.search || '').trim();
  const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
  let primaryItems = [];
  let primarySource = 'local';
  let localAvailable = true;
  if (JELLYFIN_URL && JELLYFIN_API_KEY) {
    try {
      const params = new URLSearchParams({
        Recursive: 'true', IncludeItemTypes: 'Movie,Video',
        Fields: 'Path,MediaSources,Overview,ProductionYear,Genres,CommunityRating,DateCreated',
        ImageTypeLimit: '1', EnableImageTypes: 'Primary,Backdrop', Limit: String(limit),
        SortBy: 'SortName', SortOrder: 'Ascending'
      });
      if (search) params.set('SearchTerm', search);
      const jfResponse = await jellyfinFetch(`/Items?${params}`);
      const data = await jfResponse.json();
      primaryItems = data.Items.map(mapJellyfinItem);
      primarySource = 'jellyfin';
    } catch (error) {
      localAvailable = false;
      console.warn(`Jellyfin no está disponible: ${error.message}`);
    }
  } else {
    primaryItems = search
      ? db.prepare(`SELECT id, title, library, extension, size_bytes, modified_at
                    FROM movies WHERE title LIKE ? ORDER BY title LIMIT ?`).all(`%${search}%`, limit)
      : db.prepare(`SELECT id, title, library, extension, size_bytes, modified_at
                    FROM movies ORDER BY title LIMIT ?`).all(limit);
  }

  try {
    const azureItems = (await cloudMovies()).filter((movie) => !search
      || movie.title.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
    const localTitles = new Set(primaryItems.map((movie) => movieIdentity(movie.title)));
    const visibleAzureItems = localAvailable
      ? azureItems.filter((movie) => !localTitles.has(movieIdentity(movie.title)))
      : azureItems;
    const items = [...primaryItems, ...visibleAzureItems]
      .sort((a, b) => a.title.localeCompare(b.title, 'es'))
      .slice(0, limit);
    return response.json({
      items,
      count: items.length,
      source: visibleAzureItems.length ? `${primarySource}+azure` : primarySource,
      availability: { local: localAvailable, azure: true }
    });
  } catch (error) {
    console.warn(`No se pudo consultar Azure Blob: ${error.message}`);
    return response.json({
      items: primaryItems,
      count: primaryItems.length,
      source: primarySource,
      availability: { local: localAvailable, azure: false },
      azure_error: true
    });
  }
});

app.get('/api/movies/:id/image', requireUser, async (request, response, next) => {
  try {
    if (request.params.id.startsWith('azure_')) {
      await cloudMovies();
      const movie = cloudCache.items.find((item) => item.id === request.params.id);
      if (!movie?.poster_blob) return response.sendStatus(404);
      return response.redirect(307, cloudReadUrl(movie.poster_blob));
    }
    const type = request.query.type === 'Backdrop' ? 'Backdrop' : 'Primary';
    const width = Math.min(Math.max(Number(request.query.width) || 500, 100), 1920);
    const jfResponse = await jellyfinFetch(`/Items/${encodeURIComponent(request.params.id)}/Images/${type}?maxWidth=${width}&quality=85`);
    response.status(jfResponse.status);
    response.setHeader('Content-Type', jfResponse.headers.get('content-type') || 'image/jpeg');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    Readable.fromWeb(jfResponse.body).pipe(response);
  } catch (error) {
    next(error);
  }
});

app.post('/api/libraries/scan', requireAdmin, (_request, response, next) => {
  try {
    response.json(scanLibraries());
  } catch (error) {
    next(error);
  }
});

app.get('/api/movies/:id/stream', requireUser, async (request, response) => {
  if (request.params.id.startsWith('azure_')) {
    try {
      const blobName = await cloudBlobName(request.params.id);
      if (!blobName) return response.sendStatus(404);
      const url = cloudReadUrl(blobName);
      return url ? response.redirect(307, url) : response.sendStatus(503);
    } catch (error) {
      console.error(error);
      return response.sendStatus(502);
    }
  }
  if (JELLYFIN_URL && JELLYFIN_API_KEY) {
    const headers = request.headers.range ? { Range: request.headers.range } : {};
    return jellyfinFetch(`/Videos/${encodeURIComponent(request.params.id)}/stream?static=true`, { headers })
      .then((jfResponse) => {
        response.status(jfResponse.status);
        for (const header of ['accept-ranges', 'content-length', 'content-range', 'content-type']) {
          const value = jfResponse.headers.get(header);
          if (value) response.setHeader(header, value);
        }
        Readable.fromWeb(jfResponse.body).pipe(response);
      })
      .catch(() => response.sendStatus(502));
  }
  const movie = getMovie.get(request.params.id);
  if (!movie || !fs.existsSync(movie.file_path)) return response.sendStatus(404);

  const size = fs.statSync(movie.file_path).size;
  const range = request.headers.range;
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', `video/${movie.extension === 'mkv' ? 'x-matroska' : movie.extension}`);

  if (!range) {
    response.setHeader('Content-Length', size);
    return fs.createReadStream(movie.file_path).pipe(response);
  }

  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) return response.sendStatus(416);
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) return response.sendStatus(416);

  response.status(206);
  response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  response.setHeader('Content-Length', end - start + 1);
  return fs.createReadStream(movie.file_path, { start, end }).pipe(response);
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`CineOps API disponible en http://localhost:${PORT}`);
  if (MEDIA_ROOTS.length) {
    const result = scanLibraries();
    console.log(`Catálogo actualizado: ${result.indexed} videos`);
  } else {
    console.warn('MEDIA_ROOTS está vacío; configura las bibliotecas antes de escanear.');
  }
});
