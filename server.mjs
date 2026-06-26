import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const port = Number(process.env.PORT ?? 4173);
const root = process.cwd();
const distDir = join(root, 'dist');
const publicDir = join(root, 'public');
const dataDir = join(root, 'data');
await mkdir(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'trading.db'));
const execFileAsync = promisify(execFile);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    initial_cash REAL NOT NULL,
    current_cash REAL NOT NULL,
    current_equity REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
    trade_date TEXT NOT NULL,
    trade_time TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    amount REAL NOT NULL,
    realized_pnl REAL NOT NULL DEFAULT 0,
    cash_after REAL NOT NULL,
    equity_after REAL NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
};

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function upsertSession(body) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sessions (id, initial_cash, current_cash, current_equity, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      current_cash = excluded.current_cash,
      current_equity = excluded.current_equity,
      updated_at = excluded.updated_at
  `).run(body.sessionId, body.initialCash, body.cash, body.equity, now, now);
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/market/intraday') {
    const symbol = url.searchParams.get('symbol') ?? '';
    const date = url.searchParams.get('date') ?? '';
    if (!/^\d{6}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json(res, 400, { error: 'Invalid symbol or date' });
    }
    const { stdout } = await execFileAsync(
      join(root, '.venv/bin/python'),
      [join(root, 'scripts/fetch_intraday_day.py'), symbol, date],
      { cwd: root, timeout: 20_000, maxBuffer: 2_000_000 },
    );
    const line = stdout.trim().split('\n').findLast((item) => item.startsWith('{'));
    return json(res, 200, line ? JSON.parse(line) : { source: 'baostock', points: [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = await readJson(req);
    upsertSession(body);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/trades') {
    const body = await readJson(req);
    upsertSession(body);
    const trade = body.trade;
    db.prepare(`
      INSERT INTO trades (
        session_id, case_id, symbol, side, trade_date, trade_time,
        price, quantity, amount, realized_pnl, cash_after, equity_after, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.sessionId,
      trade.caseId,
      trade.symbol,
      trade.side,
      trade.date,
      trade.time,
      trade.price,
      trade.quantity,
      trade.amount,
      trade.realizedPnl ?? 0,
      body.cash,
      body.equity,
      new Date().toISOString(),
    );
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/analysis') {
    const sessionId = url.searchParams.get('sessionId');
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS trade_count,
        SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) AS buy_count,
        SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) AS sell_count,
        COALESCE(SUM(realized_pnl), 0) AS realized_pnl,
        COALESCE(SUM(CASE WHEN side = 'sell' AND realized_pnl > 0 THEN 1 ELSE 0 END), 0) AS winning_sells
      FROM trades WHERE session_id = ?
    `).get(sessionId);
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    const recent = db.prepare(`
      SELECT symbol, side, trade_date, trade_time, price, quantity, amount, realized_pnl
      FROM trades WHERE session_id = ? ORDER BY id DESC LIMIT 20
    `).all(sessionId);
    return json(res, 200, { session, summary, recent });
  }

  return json(res, 404, { error: 'Not found' });
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serveFile(res, filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('not file');
  const body = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': mime[extname(filePath)] ?? 'application/octet-stream' });
  res.end(body);
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
