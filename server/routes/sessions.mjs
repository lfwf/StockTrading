import { json, readJson } from '../http.mjs';

async function upsertSession(pool, body) {
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

export async function handleSessionRoutes(pool, req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = await readJson(req);
    await upsertSession(pool, body);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/trades') {
    const body = await readJson(req);
    await upsertSession(pool, body);
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

  return false;
}
