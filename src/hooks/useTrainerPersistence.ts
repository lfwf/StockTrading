import { useEffect } from 'react';
import type { MarketCursor, PortfolioState, TimeMode } from '../types';
import type { MistakeItem } from '../domain/learning';
import type { TrainingPhase } from '../domain/trainingPhase';

export type BackendSummary = {
  trade_count: number;
  buy_count: number;
  sell_count: number;
  realized_pnl: number;
  winning_sells: number;
};

export function useTrainerPersistence(params: {
  enabled: boolean;
  phase: TrainingPhase;
  portfolio: PortfolioState;
  currentEquity: number;
  mistakes: MistakeItem[];
  baseCaseId: string;
  cursor: MarketCursor;
  mode: TimeMode;
  onBackendSummary: (summary: BackendSummary | null) => void;
}) {
  const { enabled, phase, portfolio, currentEquity, mistakes, baseCaseId, cursor, mode, onBackendSummary } = params;

  useEffect(() => {
    if (!enabled) return;
    localStorage.setItem(`stock-trading-portfolio-${phase}`, JSON.stringify(portfolio));
    localStorage.setItem(`stock-trading-last-equity-${phase}`, String(currentEquity));
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
  }, [enabled, phase, portfolio, currentEquity]);

  useEffect(() => {
    if (!enabled) return;
    localStorage.setItem('stock-trading-mistakes', JSON.stringify(mistakes.slice(0, 80)));
  }, [enabled, mistakes]);

  useEffect(() => {
    if (!enabled) return;
    fetch(`/api/analysis?sessionId=${encodeURIComponent(portfolio.sessionId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => onBackendSummary(data?.summary ?? null))
      .catch(() => undefined);
  }, [enabled, portfolio.sessionId, portfolio.trades.length, onBackendSummary]);

  useEffect(() => {
    if (!enabled) return;
    localStorage.setItem(`stock-trading-game-${phase}`, JSON.stringify({ caseId: baseCaseId, cursor, mode }));
  }, [enabled, phase, baseCaseId, cursor, mode]);
}
