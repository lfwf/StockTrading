import { useEffect, useMemo, useState } from 'react';
import type { AdvisorResult, BaseCase, DecisionChoice, DecisionInput, IntradayPoint, MarketCursor, PortfolioState, PositionSize, ReviewResult, TimeMode } from '../types';
import { buildTradingScenarioView, createBaseCase, createRandomMode, initialCursorForMode } from '../lib/market';
import { average, change, rollingHigh, rollingLow } from '../lib/indicators';
import { reviewDecision, reviewSkip } from '../lib/review';
import { loadTrainingDataset, pickTrainingCase } from '../lib/dataset';
import { assessScenario } from '../lib/advisor';
import { averageCost, buyShares, createPortfolio, equity, persistTrade, positionQuantity, sellableQuantity, sellShares } from '../lib/trading';
import {
  DEFAULT_CHECKLIST,
  caseMatchesPreset,
  checklistReasons,
  createMistakeItem,
  loadMistakes,
  shouldRecordMistake,
  type DecisionChecklistState,
  type MistakeItem,
  type TrainingPreset,
} from '../domain/learning';

export type BackendSummary = {
  trade_count: number;
  buy_count: number;
  sell_count: number;
  realized_pnl: number;
  winning_sells: number;
};

export function useTradingTrainer() {
  const [trainingCases, setTrainingCases] = useState<BaseCase[]>([]);
  const [dataStatus, setDataStatus] = useState('正在检查 AKShare 数据');
  const [baseCase, setBaseCase] = useState(() => createBaseCase());
  const [mode, setMode] = useState<TimeMode>(() => createRandomMode());
  const [cursor, setCursor] = useState<MarketCursor>(() => ({ dayOffset: 0, pointIndex: 0 }));
  const [showStock, setShowStock] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [positionSize, setPositionSize] = useState<PositionSize>(50);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [pendingReview, setPendingReview] = useState<ReviewResult | null>(null);
  const [advisor, setAdvisor] = useState<AdvisorResult | null>(null);
  const [userChoice, setUserChoice] = useState<DecisionChoice | null>(null);
  const [tradeMessage, setTradeMessage] = useState('');
  const [trainingPreset, setTrainingPreset] = useState<TrainingPreset>('random');
  const [checklist, setChecklist] = useState<DecisionChecklistState>(DEFAULT_CHECKLIST);
  const [mistakes, setMistakes] = useState<MistakeItem[]>(() => loadMistakes());
  const [backendSummary, setBackendSummary] = useState<BackendSummary | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioState>(() => {
    const saved = localStorage.getItem('stock-trading-portfolio');
    return saved ? JSON.parse(saved) as PortfolioState : createPortfolio();
  });

  const scenario = useMemo(() => buildTradingScenarioView(baseCase, cursor), [baseCase, cursor]);
  const currentDate = scenario.decisionBar.date;
  const currentTime = scenario.visibleIntraday.at(-1)?.time ?? '09:30';
  const heldQuantity = positionQuantity(portfolio);
  const availableQuantity = sellableQuantity(portfolio, currentDate);
  const currentEquity = equity(portfolio, scenario.buyPrice);
  const cost = averageCost(portfolio);
  const isBankrupt = currentEquity <= 0.01;

  useEffect(() => {
    let cancelled = false;

    loadTrainingDataset().then((dataset) => {
      if (cancelled) return;
      if (!dataset) {
        setDataStatus('模拟数据 · 运行 AKShare 脚本后自动切换');
        return;
      }

      const seed = Date.now() + Math.floor(Math.random() * 100000);
      const savedGame = localStorage.getItem('stock-trading-game');
      const saved = savedGame ? JSON.parse(savedGame) as { caseId?: string; cursor?: MarketCursor; mode?: TimeMode } : null;
      const heldCaseId = portfolio.lots.length > 0 ? portfolio.trades.at(-1)?.caseId : null;
      const picked = (heldCaseId ? dataset.cases.find((item) => item.id === heldCaseId) : null)
        ?? (saved?.caseId ? dataset.cases.find((item) => item.id === saved.caseId) : null)
        ?? pickTrainingCase(dataset.cases, seed);

      setTrainingCases(dataset.cases);
      const minuteStatus = dataset.quality
        ? `真实分钟线 ${dataset.quality.realStockIntradayCases}/${dataset.quality.totalCases}`
        : '分钟线质量未标记';
      setDataStatus(`${dataset.source} · 真实日线 · ${minuteStatus} · ${dataset.cases.length}题 · ${dataset.generatedAt.slice(0, 10)}`);

      if (picked) {
        const nextMode = saved?.mode ?? createRandomMode(seed);
        setBaseCase(picked);
        setMode(nextMode);
        setCursor(saved?.caseId === picked.id && saved.cursor ? saved.cursor : initialCursorForMode(picked, nextMode));
        setReview(null);
        setAdvisor(null);
        setUserChoice(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

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
      .then((data) => setBackendSummary(data?.summary ?? null))
      .catch(() => undefined);
  }, [portfolio.sessionId, portfolio.trades.length]);

  useEffect(() => {
    localStorage.setItem('stock-trading-game', JSON.stringify({ caseId: baseCase.id, cursor, mode }));
  }, [baseCase.id, cursor, mode]);

  const intradayHigh = Math.max(...scenario.visibleIntraday.map((point) => point.price));
  const intradayLow = Math.min(...scenario.visibleIntraday.map((point) => point.price));
  const intradayVolume = scenario.visibleIntraday.reduce((sum, point) => sum + point.volume, 0);
  const openChange = change(scenario.decisionBar.preClose, scenario.buyPrice);
  const visibleHigh20 = rollingHigh(scenario.visibleDaily, Math.min(20, scenario.visibleDaily.length));
  const visibleLow20 = rollingLow(scenario.visibleDaily, Math.min(20, scenario.visibleDaily.length));
  const visibleHigh60 = rollingHigh(scenario.visibleDaily, Math.min(60, scenario.visibleDaily.length));
  const volumeMa20 = average(scenario.visibleDaily.slice(-20).map((bar) => bar.volume));
  const indexLast = scenario.visibleIndexIntraday.at(-1)?.price ?? scenario.visibleIndexDaily.at(-1)?.close ?? 0;
  const indexPreClose = scenario.visibleIndexDaily.at(-1)?.preClose ?? scenario.visibleIndexDaily.at(-1)?.close ?? 1;
  const indexChange = change(indexPreClose, indexLast);
  const filteredCount = trainingCases.filter((item) => caseMatchesPreset(item, trainingPreset, mistakes)).length;

  function getNextBaseCase(seed: number): BaseCase {
    const filtered = trainingCases.filter((item) => caseMatchesPreset(item, trainingPreset, mistakes));
    const source = filtered.length > 0 ? filtered : trainingCases;
    return pickTrainingCase(source, seed) ?? createBaseCase(seed);
  }

  function resetTraining(seed = Date.now() + Math.floor(Math.random() * 100000)) {
    if (isBankrupt) {
      setTradeMessage('总资产已经归零，本轮模拟结束。');
      return;
    }
    if (heldQuantity > 0) {
      setTradeMessage('必须先卖出全部持仓，才能进入下一题。');
      return;
    }

    const nextBase = getNextBaseCase(seed);
    const nextMode = createRandomMode(seed);
    setBaseCase(nextBase);
    setMode(nextMode);
    setCursor(initialCursorForMode(nextBase, nextMode));
    setReview(null);
    setPendingReview(null);
    setAdvisor(null);
    setUserChoice(null);
    setChecklist(DEFAULT_CHECKLIST);
    setTradeMessage('');
  }

  function switchMode(next: TimeMode) {
    if (heldQuantity > 0 || portfolio.trades.some((trade) => trade.caseId === baseCase.id)) {
      setTradeMessage('开始交易后已锁定时间轴，不能切换训练场景。');
      return;
    }

    setMode(next);
    setCursor(initialCursorForMode(baseCase, next));
    setReview(null);
    setPendingReview(null);
    setAdvisor(null);
    setUserChoice(null);
  }

  function addMistakeIfNeeded(result: ReviewResult, action: DecisionChoice) {
    if (!shouldRecordMistake(result, action)) return;
    const item = createMistakeItem({ baseCase, mode: scenario.mode, action, result });
    setMistakes((current) => [item, ...current.filter((old) => old.id !== item.id)].slice(0, 80));
  }

  function buy() {
    if (isBankrupt) {
      setTradeMessage('总资产已经归零，无法继续买入。');
      return;
    }

    const advisorResult = assessScenario(scenario);
    const result = buyShares(portfolio, positionSize, scenario.buyPrice, currentDate, currentTime, baseCase.id, baseCase.stock.symbol);
    if (!result.trade) {
      setAdvisor(advisorResult);
      setUserChoice('buy');
      setTradeMessage('可用资金不足以买入一手（100股），请调整买入比例或推进行情。');
      return;
    }

    const decision: DecisionInput = {
      choice: 'buy',
      positionSize,
      holdPlan: 5,
      stopLossPct: checklist.risk.includes('3') ? 3 : checklist.risk.includes('5') ? 5 : checklist.risk.includes('8') ? 8 : null,
      reasonTags: checklistReasons(checklist),
    };

    setPendingReview(reviewDecision(scenario, decision));
    setAdvisor(advisorResult);
    setUserChoice('buy');
    setReview(null);
    setPortfolio(result.portfolio);
    setTradeMessage(`买入 ${result.trade.quantity} 股，成交金额 ${result.trade.amount.toFixed(2)} 元；该批持仓下一交易日可卖。`);
    persistTrade(result.portfolio, result.trade, equity(result.portfolio, scenario.buyPrice)).catch(() => undefined);
  }

  function skip() {
    if (heldQuantity > 0) {
      setTradeMessage('当前仍有持仓，不能放弃本题。');
      return;
    }

    const result = reviewSkip(scenario);
    setAdvisor(assessScenario(scenario));
    setUserChoice('skip');
    setReview(result);
    addMistakeIfNeeded(result, 'skip');
  }

  function sell() {
    const result = sellShares(portfolio, positionSize, scenario.buyPrice, currentDate, currentTime, baseCase.id, baseCase.stock.symbol);
    if (!result.trade) {
      setTradeMessage(heldQuantity > 0 ? '当前持仓受 T+1 限制，今天买入的股票要到下一交易日才能卖。' : '当前没有可卖持仓。');
      return;
    }

    const cleared = positionQuantity(result.portfolio) === 0;
    setPortfolio(result.portfolio);
    setTradeMessage(`卖出 ${result.trade.quantity} 股，本次实现盈亏 ${result.trade.realizedPnl >= 0 ? '+' : ''}${result.trade.realizedPnl.toFixed(2)} 元。${cleared ? ' 已清仓，生成本题复盘。' : ''}`);

    if (cleared) {
      const finalReview = pendingReview ?? reviewDecision(scenario, {
        choice: 'buy',
        positionSize,
        holdPlan: 5,
        stopLossPct: null,
        reasonTags: checklistReasons(checklist),
      });
      setReview(finalReview);
      addMistakeIfNeeded(finalReview, 'buy');
      setPendingReview(null);
    }

    persistTrade(result.portfolio, result.trade, equity(result.portfolio, scenario.buyPrice)).catch(() => undefined);
  }

  function advanceHour() {
    const points = baseCase.intradayByDate?.[currentDate] ?? [];
    if (!points.length) {
      setTradeMessage('当前交易日没有分钟行情。');
      return;
    }
    if (cursor.pointIndex >= points.length - 1) {
      advanceDay();
      return;
    }

    setCursor((current) => ({ ...current, pointIndex: Math.min(points.length - 1, current.pointIndex + 12) }));
    setReview(null);
    if (heldQuantity === 0) {
      setAdvisor(null);
      setUserChoice(null);
    }
    setTradeMessage('');
  }

  async function advanceDay() {
    const nextOffset = cursor.dayOffset + 1;
    const nextBar = baseCase.daily[baseCase.decisionIndex + nextOffset];
    if (!nextBar) {
      setTradeMessage('已经到达该股票行情数据的最后交易日。');
      return;
    }

    let nextPoints = baseCase.intradayByDate?.[nextBar.date];
    if (!nextPoints?.length) {
      setTradeMessage('正在加载下一交易日真实5分钟行情…');
      try {
        const response = await fetch(`/api/market/intraday?symbol=${baseCase.stock.symbol}&date=${nextBar.date}`);
        const data = await response.json() as { points?: IntradayPoint[] };
        nextPoints = data.points;
      } catch {
        nextPoints = [];
      }
      if (!nextPoints?.length) {
        setTradeMessage('下一交易日真实分钟行情暂时无法获取，请稍后重试。');
        return;
      }
      setBaseCase((current) => ({
        ...current,
        intradayByDate: { ...current.intradayByDate, [nextBar.date]: nextPoints as IntradayPoint[] },
      }));
    }

    setCursor({ dayOffset: nextOffset, pointIndex: 0 });
    setReview(null);
    if (heldQuantity === 0) {
      setAdvisor(null);
      setUserChoice(null);
    }
    setTradeMessage('');
  }

  return {
    scenario,
    dataStatus,
    showStock,
    setShowStock,
    showDate,
    setShowDate,
    positionSize,
    setPositionSize,
    review,
    advisor,
    userChoice,
    tradeMessage,
    trainingPreset,
    setTrainingPreset,
    checklist,
    setChecklist,
    mistakes,
    setMistakes,
    backendSummary,
    portfolio,
    currentTime,
    heldQuantity,
    availableQuantity,
    currentEquity,
    cost,
    isBankrupt,
    intradayHigh,
    intradayLow,
    intradayVolume,
    openChange,
    visibleHigh20,
    visibleLow20,
    visibleHigh60,
    volumeMa20,
    indexChange,
    filteredCount,
    trainingCases,
    resetTraining,
    switchMode,
    buy,
    skip,
    sell,
    advanceHour,
    advanceDay,
  };
}
