const { finalizeJson, requireUser } = require('../shared/access');
const { find, movies, readUrl } = require('../shared/blob');

module.exports = async function (context, req) {
  try {
    const user = await requireUser(req);
    if (!user) {
      context.res = { status: 403, jsonBody: { error: 'Acceso aprobado requerido' } };
      return;
    }
    const route = String(context.bindingData.path || '').split('/').filter(Boolean).map(decodeURIComponent);
    if (route.length === 0) {
      const items = await movies(String(req.query?.search || '').trim());
      context.res = { headers: { 'Cache-Control': 'private, max-age=60' }, jsonBody: { items, count: items.length } };
      return;
    }
    const movie = await find(route[0]);
    if (!movie) { context.res = { status: 404 }; return; }
    const blobName = route[1] === 'image' ? movie.poster_blob : route[1] === 'stream' ? movie.blob_name : null;
    const url = blobName && readUrl(blobName);
    context.res = url
      ? { status: 307, headers: { Location: url, 'Cache-Control': 'no-store' } }
      : { status: 404 };
  } catch (error) {
    context.log.error(error);
    context.res = { status: 500, jsonBody: { error: 'No se pudo consultar la biblioteca Azure' } };
  } finally {
    finalizeJson(context);
  }
};
