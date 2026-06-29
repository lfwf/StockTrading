import { useEffect } from 'react';
import type { BaseCase, MarketCursor, PortfolioState, ReviewResult, TimeMode } from '../types';
import { createRandomMode, initialCursorForMode } from '../lib/market';
import { loadTrainingDataset, pickTrainingCase } from '../lib/dataset';

export function useDatasetBootstrap(params: {
  portfolio: PortfolioState;
  onTrainingCases: (cases: BaseCase[]) => void;
  onCurrentCases: (cases: BaseCase[]) => void;
  onDataStatus: (status: string) => void;
  onBaseCase: (item: BaseCase) => void;
  onMode: (mode: TimeMode) => void;
  onCursor: (cursor: MarketCursor) => void;
  onReview: (review: ReviewResult | null) => void;
  onAdvisor: (advisor: null) => void;
  onUserChoice: (choice: null) => void;
  onReady: () => void;
}) {
  const {
    portfolio,
    onTrainingCases,
    onCurrentCases,
    onDataStatus,
    onBaseCase,
    onMode,
    onCursor,
    onReview,
    onAdvisor,
    onUserChoice,
    onReady,
  } = params;

  useEffect(() => {
    let cancelled = false;

    loadTrainingDataset().then((dataset) => {
      if (cancelled) return;
      if (!dataset) {
        onDataStatus('模拟数据 · 运行 AKShare 脚本后自动切换');
        onReady();
        return;
      }

      const historyCases = dataset.historyCases?.length ? dataset.historyCases : dataset.cases;
      const currentCases = dataset.currentCases ?? [];
      const allCases = [...historyCases, ...currentCases];
      const seed = Date.now() + Math.floor(Math.random() * 100000);
      let saved: { caseId?: string; cursor?: MarketCursor; mode?: TimeMode } | null = null;
      try {
        const savedGame = localStorage.getItem('stock-trading-game');
        saved = savedGame ? JSON.parse(savedGame) as { caseId?: string; cursor?: MarketCursor; mode?: TimeMode } : null;
      } catch {
        localStorage.removeItem('stock-trading-game');
      }
      const heldCaseId = portfolio.lots.length > 0 ? portfolio.trades.at(-1)?.caseId : null;
      const picked = (heldCaseId ? allCases.find((item) => item.id === heldCaseId) : null)
        ?? (saved?.caseId ? allCases.find((item) => item.id === saved.caseId) : null)
        ?? pickTrainingCase(historyCases, seed);

      onTrainingCases(historyCases);
      onCurrentCases(currentCases);
      const minuteStatus = dataset.quality
        ? `真实分钟线 ${dataset.quality.realStockIntradayCases}/${dataset.quality.totalCases}`
        : '分钟线质量未标记';
      const currentStatus = currentCases.length ? `当前盘面 ${currentCases.length}题` : '当前盘面未生成';
      onDataStatus(`${dataset.source} · 真实日线 · ${minuteStatus} · 历史${historyCases.length}题 · ${currentStatus} · ${dataset.generatedAt.slice(0, 10)}`);

      if (picked) {
        const nextMode = saved?.mode ?? createRandomMode(seed);
        onBaseCase(picked);
        onMode(nextMode);
        const initialCursor = initialCursorForMode(picked, nextMode);
        const savedCursor = saved?.caseId === picked.id && saved.cursor ? saved.cursor : null;
        const maxDayOffset = Math.max(0, picked.daily.length - picked.decisionIndex - 1);
        onCursor(savedCursor
          ? {
              dayOffset: Math.max(0, Math.min(maxDayOffset, Number(savedCursor.dayOffset) || 0)),
              pointIndex: Math.max(0, Number(savedCursor.pointIndex) || 0),
            }
          : initialCursor);
        onReview(null);
        onAdvisor(null);
        onUserChoice(null);
      }
      onReady();
    }).catch(() => {
      if (!cancelled) onReady();
    });

    return () => {
      cancelled = true;
    };
  }, []);
}
