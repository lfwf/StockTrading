export async function getIntradayPoints(pool, symbol, date) {
  const result = await pool.query(`
    SELECT to_char(time, 'HH24:MI') AS time, price, avg_price, volume
    FROM minute_bars
    WHERE symbol = $1 AND date = $2
    ORDER BY time
  `, [symbol, date]);
  return result.rows.map((row) => ({
    time: row.time,
    price: Number(row.price),
    avgPrice: Number(row.avg_price),
    volume: Number(row.volume),
  }));
}

export async function getMarketStatus(pool) {
  const [daily, minute, members] = await Promise.all([
    pool.query('SELECT MAX(date) AS latest_date, COUNT(*)::int AS rows FROM daily_bars'),
    pool.query('SELECT MAX(date) AS latest_date, COUNT(*)::int AS rows FROM minute_bars'),
    pool.query('SELECT COUNT(*)::int AS active_members FROM members WHERE active = TRUE'),
  ]);
  return {
    daily: daily.rows[0] ?? null,
    minute: minute.rows[0] ?? null,
    members: members.rows[0] ?? null,
  };
}
