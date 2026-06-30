import { json } from '../http.mjs';

export async function handleAnalysisRoutes(pool, req, res, url) {
  if (req.method !== 'GET' || url.pathname !== '/api/analysis') return false;
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return json(res, 400, { error: 'Missing sessionId' });

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
