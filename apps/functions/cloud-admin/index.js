const crypto = require('crypto');
const path = require('path');
const { BlobSASPermissions, generateBlobSASQueryParameters } = require('@azure/storage-blob');
const { finalizeJson, requireAdmin } = require('../shared/access');
const { container, containerName, credential, find, movieId, movies, title: movieTitle } = require('../shared/blob');

const extensions = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.m2ts']);
const limitBytes = 100 * 1024 ** 3;

module.exports = async function (context, req) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) { context.res = { status: 403, jsonBody: { error: 'Rol de administrador requerido' } }; return; }
    if (!container || !credential) { context.res = { status: 503, jsonBody: { error: 'Azure Blob no está configurado' } }; return; }

    const route = String(context.bindingData.path || '').split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method.toUpperCase();
    if (method === 'GET' && route.length === 0) {
      const items = await movies();
      context.res = { jsonBody: {
        items, used_bytes: items.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0), limit_bytes: limitBytes
      } };
      return;
    }
    if (method === 'POST' && route[0] === 'upload-url') {
      const fileName = String(req.body?.name || '').trim();
      const size = Number(req.body?.size || 0);
      const extension = path.extname(fileName).toLowerCase();
      if (!fileName || !extensions.has(extension) || !Number.isFinite(size) || size <= 0) {
        context.res = { status: 400, jsonBody: { error: 'Selecciona un archivo de video válido' } }; return;
      }
      const items = await movies();
      const usedBytes = items.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
      if (usedBytes + size > limitBytes) {
        context.res = { status: 409, jsonBody: { error: 'La carga superaría el límite operativo de 100 GB', used_bytes: usedBytes, limit_bytes: limitBytes } }; return;
      }
      const blobName = `uploads/${crypto.randomUUID()}${extension}`;
      const expiresOn = new Date(Date.now() + 12 * 60 * 60_000);
      const sas = generateBlobSASQueryParameters({
        containerName, blobName, permissions: BlobSASPermissions.parse('cw'),
        startsOn: new Date(Date.now() - 60_000), expiresOn, protocol: 'https'
      }, credential).toString();
      context.res = { jsonBody: {
        blob_name: blobName, upload_url: `${container.getBlockBlobClient(blobName).url}?${sas}`,
        expires_at: expiresOn.toISOString()
      } };
      return;
    }
    if (method === 'POST' && route[0] === 'finalize') {
      const blobName = String(req.body?.blob_name || '');
      const originalTitle = String(req.body?.title || '').trim();
      if (!blobName.startsWith('uploads/') || !originalTitle) { context.res = { status: 400, jsonBody: { error: 'Carga inválida' } }; return; }
      const client = container.getBlockBlobClient(blobName);
      if (!(await client.exists())) { context.res = { status: 404 }; return; }
      await client.setMetadata({ title: encodeURIComponent(movieTitle(originalTitle)) });
      context.res = { jsonBody: { status: 'ready', id: movieId(blobName), metadata: false } };
      return;
    }
    if (method === 'POST' && route[0] === 'cancel') {
      const blobName = String(req.body?.blob_name || '');
      if (!blobName.startsWith('uploads/')) { context.res = { status: 400, jsonBody: { error: 'Carga inválida' } }; return; }
      const client = container.getBlockBlobClient(blobName);
      try { await client.commitBlockList([]); } catch (error) { if (error.statusCode !== 404) throw error; }
      await client.deleteIfExists();
      context.res = { jsonBody: { status: 'cancelled' } };
      return;
    }
    if (method === 'DELETE' && route[0]) {
      const movie = await find(route[0]);
      if (!movie) { context.res = { status: 404 }; return; }
      await container.deleteBlob(movie.blob_name);
      if (movie.poster_blob) await container.deleteBlob(movie.poster_blob, { deleteSnapshots: 'include' }).catch(() => {});
      context.res = { jsonBody: { status: 'deleted', id: movie.id } };
      return;
    }
    context.res = { status: 404, jsonBody: { error: 'Operación Blob no encontrada' } };
  } catch (error) {
    context.log.error(error);
    context.res = { status: 500, jsonBody: { error: 'No se pudo administrar Azure Blob' } };
  } finally {
    finalizeJson(context);
  }
};
