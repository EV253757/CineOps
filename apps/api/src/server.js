import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
`);

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
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', libraries: MEDIA_ROOTS.length });
});

app.get('/api/movies', (request, response) => {
  const search = String(request.query.search || '').trim();
  const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
  const rows = search
    ? db.prepare(`SELECT id, title, library, extension, size_bytes, modified_at
                  FROM movies WHERE title LIKE ? ORDER BY title LIMIT ?`).all(`%${search}%`, limit)
    : db.prepare(`SELECT id, title, library, extension, size_bytes, modified_at
                  FROM movies ORDER BY title LIMIT ?`).all(limit);
  response.json({ items: rows, count: rows.length });
});

app.post('/api/libraries/scan', (_request, response, next) => {
  try {
    response.json(scanLibraries());
  } catch (error) {
    next(error);
  }
});

app.get('/api/movies/:id/stream', (request, response) => {
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

