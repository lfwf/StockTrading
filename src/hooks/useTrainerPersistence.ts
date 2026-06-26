import { useEffect } from 'react';
import type { MarketCursor, PortfolioState, TimeMode } from '../types';
import type { MistakeItem } from '../domain/learning';

export type BackendSummary = {
  trade_count: number;
  buy_count: number;
  sell_count: number;
  realized_pnl: number;
  winning_sells: number;
};

export function useTrainerPersistence(params: {
  portfolio: PortfolioState;
  currentEquity: number;
  mistakes: MistakeItem[];
  baseCaseId: string;
  cursor: MarketCursor;
  mode: TimeMode;
  onBackendSummary: (summary: BackendSummary | null) => void;
}) {
  const { portfolio, currentEquity, mistakes, baseCaseId, cursor, mode, onBackendSummary } = params;

  useEffect(() => {
    localStorage.setItem('stock-trading-portfolio', JSON.stringify(portfolio));
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: portfolio.sessionId,
        initialCash: portfolio.initialCash,
        cash: portfolio.cash,
        equity: currentEquity,
      }),
    }).catch(() => undefined);
  }, [portfolio, currentEquity]);

  useEffect(() => {
    localStorage.setItem('stock-trading-mistakes', JSON.stringify(mistakes.slice(0, 80)));
  }, [mistakes]);

  useEffect(() => {
    fetch(`/api/analysis?sessionId=${encodeURIComponent(portfolio.sessionId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => onBackendSummary(data?.summary ?? null))
      .catch(() => undefined);
  }, [portfolio.sessionId, portfolio.trades.length, onBackendSummary]);

  useEffect(() => {
    localStorage.setItem('stock-trading-game', JSON.stringify({ caseId: baseCaseId, cursor, mode }));
  }, [baseCaseId, cursor, mode]);
}
