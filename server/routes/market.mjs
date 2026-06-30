import { json } from '../http.mjs';
import { getIntradayPoints, getMarketStatus } from '../repositories/marketRepo.mjs';

export async function handleMarketRoutes(pool, req, res, url) {
  if (req.method !== 'GET') return false;

  if (url.pathname === '/api/market/status') {
    return json(res, 200, await getMarketStatus(pool));
  }

  if (url.pathname === '/api/market/intraday') {
    const symbol = url.searchParams.get('symbol') ?? '';
    const date = url.searchParams.get('date') ?? '';
    if (!/^\d{6}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json(res, 400, { error: 'Invalid symbol or date' });
    }
    const points = await getIntradayPoints(pool, symbol, date);
    return json(res, 200, { source: points.length ? 'postgresql' : 'missing', points });
  }

  return false;
}
