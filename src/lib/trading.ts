import type { PortfolioState, PositionLot, SimTrade } from '../types';

export const INITIAL_CASH = 100_000;
export const BOARD_LOT = 100;

function randomId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${time}-${random}`;
}

export function createPortfolio(): PortfolioState {
  return {
    sessionId: randomId(),
    initialCash: INITIAL_CASH,
    cash: INITIAL_CASH,
    lots: [],
    trades: [],
  };
}

export function normalizePortfolio(value: unknown): PortfolioState {
  if (!value || typeof value !== 'object') return createPortfolio();
  const candidate = value as Partial<PortfolioState>;
  const fallback = createPortfolio();
  return {
    sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : fallback.sessionId,
    initialCash: Number.isFinite(candidate.initialCash) ? Number(candidate.initialCash) : INITIAL_CASH,
    cash: Number.isFinite(candidate.cash) ? Number(candidate.cash) : INITIAL_CASH,
    lots: Array.isArray(candidate.lots) ? candidate.lots : [],
    trades: Array.isArray(candidate.trades) ? candidate.trades : [],
  };
}

export function positionQuantity(portfolio: PortfolioState): number {
  return portfolio.lots.reduce((sum, lot) => sum + lot.quantity, 0);
}

export function sellableQuantity(portfolio: PortfolioState, currentDate: string): number {
  return portfolio.lots
    .filter((lot) => lot.date < currentDate)
    .reduce((sum, lot) => sum + lot.quantity, 0);
}

export function averageCost(portfolio: PortfolioState): number {
  const quantity = positionQuantity(portfolio);
  if (!quantity) return 0;
  return portfolio.lots.reduce((sum, lot) => sum + lot.price * lot.quantity, 0) / quantity;
}

export function equity(portfolio: PortfolioState, price: number): number {
  return portfolio.cash + positionQuantity(portfolio) * price;
}

export function buyShares(
  portfolio: PortfolioState,
  percent: number,
  price: number,
  date: string,
  time: string,
  caseId: string,
  symbol: string,
): { portfolio: PortfolioState; trade: SimTrade | null } {
  const budget = portfolio.cash * percent / 100;
  const quantity = Math.floor(budget / price / BOARD_LOT) * BOARD_LOT;
  if (quantity < BOARD_LOT) return { portfolio, trade: null };

  const amount = quantity * price;
  const lot: PositionLot = { id: randomId(), quantity, price, date, time };
  const trade: SimTrade = {
    id: randomId(),
    caseId,
    symbol,
    side: 'buy',
    date,
    time,
    price,
    quantity,
    amount,
    realizedPnl: 0,
  };
  return {
    portfolio: {
      ...portfolio,
      cash: portfolio.cash - amount,
      lots: [...portfolio.lots, lot],
      trades: [...portfolio.trades, trade],
    },
    trade,
  };
}

export function sellShares(
  portfolio: PortfolioState,
  percent: number,
  price: number,
  date: string,
  time: string,
  caseId: string,
  symbol: string,
): { portfolio: PortfolioState; trade: SimTrade | null } {
  const sellable = sellableQuantity(portfolio, date);
  const requested = percent === 100
    ? sellable
    : Math.floor(sellable * percent / 100 / BOARD_LOT) * BOARD_LOT;
  if (requested < BOARD_LOT) return { portfolio, trade: null };

  let remaining = requested;
  let cost = 0;
  const lots: PositionLot[] = [];
  for (const lot of portfolio.lots) {
    if (remaining > 0 && lot.date < date) {
      const used = Math.min(lot.quantity, remaining);
      cost += used * lot.price;
      remaining -= used;
      if (lot.quantity > used) lots.push({ ...lot, quantity: lot.quantity - used });
    } else {
      lots.push(lot);
    }
  }

  const amount = requested * price;
  const trade: SimTrade = {
    id: randomId(),
    caseId,
    symbol,
    side: 'sell',
    date,
    time,
    price,
    quantity: requested,
    amount,
    realizedPnl: amount - cost,
  };
  return {
    portfolio: {
      ...portfolio,
      cash: portfolio.cash + amount,
      lots,
      trades: [...portfolio.trades, trade],
    },
    trade,
  };
}

export async function persistTrade(portfolio: PortfolioState, trade: SimTrade, currentEquity: number) {
  await fetch('/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: portfolio.sessionId,
      initialCash: portfolio.initialCash,
      cash: portfolio.cash,
      equity: currentEquity,
      trade,
    }),
  });
}
