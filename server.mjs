import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

const port = Number(process.env.PORT ?? 4173);
const root = process.cwd();
const distDir = join(root, 'dist');
const publicDir = join(root, 'public');
const dataDir = join(root, 'data');
await mkdir(dataDir, { recursive: true });

const execFileAsync = promisify(execFile);

const { Pool } = pg;
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        database: process.env.PG_DATABASE ?? 'stock_trading',
        host: process.env.PGHOST ?? '/var/run/postgresql',
        user: process.env.PGUSER ?? process.env.USER ?? 'root',
      },
);

await pool.query(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    initial_cash REAL NOT NULL,
    current_cash REAL NOT NULL,
    current_equity REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trades (
    id BIGSERIAL PRIMARY KEY,
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
  CREATE INDEX IF NOT EXISTS idx_trades_session_id_id ON trades(session_id, id DESC);
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

async function upsertSession(body) {
  const now = new Date().toISOString();
  await pool.query(`
    INSERT INTO sessions (id, initial_cash, current_cash, current_equity, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(id) DO UPDATE SET
      current_cash = excluded.current_cash,
      current_equity = excluded.current_equity,
      updated_at = excluded.updated_at
  `, [body.sessionId, body.initialCash, body.cash, body.equity, now, now]);
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
    await upsertSession(body);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/trades') {
    const body = await readJson(req);
    await upsertSession(body);
    const trade = body.trade;
    await pool.query(`
      INSERT INTO trades (
        session_id, case_id, symbol, side, trade_date, trade_time,
        price, quantity, amount, realized_pnl, cash_after, equity_after, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
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
    ]);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/analysis') {
    const sessionId = url.searchParams.get('sessionId');
    const summary = await pool.query(`
      SELECT
        COUNT(*) AS trade_count,
        COALESCE(SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END), 0) AS buy_count,
        COALESCE(SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END), 0) AS sell_count,
        COALESCE(SUM(realized_pnl), 0) AS realized_pnl,
        COALESCE(SUM(CASE WHEN side = 'sell' AND realized_pnl > 0 THEN 1 ELSE 0 END), 0) AS winning_sells
      FROM trades WHERE session_id = $1
    `, [sessionId]);
    const session = await pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    const recent = await pool.query(`
      SELECT symbol, side, trade_date, trade_time, price, quantity, amount, realized_pnl
      FROM trades WHERE session_id = $1 ORDER BY id DESC LIMIT 20
    `, [sessionId]);
    return json(res, 200, {
      session: session.rows[0] ?? null,
      summary: {
        trade_count: Number(summary.rows[0].trade_count),
        buy_count: Number(summary.rows[0].buy_count),
        sell_count: Number(summary.rows[0].sell_count),
        realized_pnl: Number(summary.rows[0].realized_pnl),
        winning_sells: Number(summary.rows[0].winning_sells),
      },
      recent: recent.rows,
    });
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
