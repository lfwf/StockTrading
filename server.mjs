import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { ensureSchema, pool } from './server/db.mjs';
import { json, serveFile } from './server/http.mjs';
import { handleTrainingCaseRoutes } from './server/routes/trainingCases.mjs';
import { handleMarketRoutes } from './server/routes/market.mjs';
import { handleSessionRoutes } from './server/routes/sessions.mjs';
import { handleAnalysisRoutes } from './server/routes/analysis.mjs';

const port = Number(process.env.PORT ?? 4173);
const root = process.cwd();
const distDir = join(root, 'dist');
const publicDir = join(root, 'public');
const dataDir = join(root, 'data');
await mkdir(dataDir, { recursive: true });
await ensureSchema();

async function handleApi(req, res, url) {
  for (const handler of [
    handleTrainingCaseRoutes,
    handleMarketRoutes,
    handleSessionRoutes,
    handleAnalysisRoutes,
  ]) {
    const handled = await handler(pool, req, res, url);
    if (handled !== false) return handled;
  }
  return json(res, 404, { error: 'Not found' });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    if (url.pathname.startsWith('/data/')) {
      const relative = normalize(url.pathname.slice(1));
      if (relative.includes('..')) return json(res, 400, { error: 'Invalid path' });
      return await serveFile(res, join(publicDir, relative));
    }

    const relative = url.pathname === '/' ? 'index.html' : normalize(url.pathname.slice(1));
    if (!relative.includes('..')) {
      try {
        return await serveFile(res, join(distDir, relative));
      } catch {
        return await serveFile(res, join(distDir, 'index.html'));
      }
    }
    return json(res, 400, { error: 'Invalid path' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Internal server error' });
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`StockTrading server listening on http://0.0.0.0:${port}`);
});
