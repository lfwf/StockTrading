import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export async function serveFile(res, filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('not file');
  const body = await readFile(filePath);
  const extension = extname(filePath);
  const headers = {
    'Content-Type': mime[extension] ?? 'application/octet-stream',
    ...(extension === '.html' ? { 'Cache-Control': 'no-store' } : {}),
  };
  res.writeHead(200, headers);
  res.end(body);
}
