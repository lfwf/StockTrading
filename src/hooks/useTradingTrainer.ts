import { useMemo, useState } from 'react';
import type { AdvisorResult, BaseCase, DecisionChoice, DecisionInput, IntradayPoint, MarketCursor, PortfolioState, PositionSize, ReviewResult, TimeMode } from '../types';
import { buildTradingScenarioView, createBaseCase, createRandomMode, initialCursorForMode } from '../lib/market';
import { reviewDecision, reviewSkip } from '../lib/review';
import { pickTrainingCase } from '../lib/dataset';
import { assessScenario } from '../lib/advisor';
import { buyShares, createPortfolio, equity, normalizePortfolio, persistTrade, positionQuantity, sellShares } from '../lib/trading';
import { computeTrainerMetrics } from '../domain/trainerMetrics';
import {
  DEFAULT_CHECKLIST,
  checklistReasons,
  createMistakeItem,
  loadMistakes,
  shouldRecordMistake,
  type DecisionChecklistState,
  type MistakeItem,
  type TrainingPreset,
} from '../domain/learning';
import { getCasesForPhase, type TrainingPhase } from '../domain/trainingPhase';
import { useDatasetBootstrap } from './useDatasetBootstrap';
import { useTrainerPersistence, type BackendSummary } from './useTrainerPersistence';

export function useTradingTrainer() {
  const [trainingCases, setTrainingCases] = useState<BaseCase[]>([]);
  const [currentCases, setCurrentCases] = useState<BaseCase[]>([]);
  const [dataStatus, setDataStatus] = useState('正在检查 AKShare 数据');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
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
  const [trainingPresets, setTrainingPresets] = useState<TrainingPreset[]>(['random']);
  const [trainingPhase, setTrainingPhase] = useState<TrainingPhase>('history');
  const [checklist, setChecklist] = useState<DecisionChecklistState>(DEFAULT_CHECKLIST);
  const [mistakes, setMistakes] = useState<MistakeItem[]>(() => loadMistakes());
  const [backendSummary, setBackendSummary] = useState<BackendSummary | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioState>(() => {
    try {
      const saved = localStorage.getItem('stock-trading-portfolio');
      return saved ? normalizePortfolio(JSON.parse(saved)) : createPortfolio();
    } catch {
      localStorage.removeItem('stock-trading-portfolio');
      return createPortfolio();
    }
  });

  const scenario = useMemo(() => buildTradingScenarioView(baseCase, cursor), [baseCase, cursor]);
  const metrics = useMemo(() => computeTrainerMetrics({ scenario, portfolio, trainingCases, trainingPresets, trainingPhase, mistakes }), [scenario, portfolio, trainingCases, trainingPresets, trainingPhase, mistakes]);
  const {
    currentDate,
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
  } = metrics;

  useDatasetBootstrap({
    portfolio,
    onTrainingCases: setTrainingCases,
    onCurrentCases: setCurrentCases,
    onDataStatus: setDataStatus,
    onBaseCase: setBaseCase,
    onMode: setMode,
    onCursor: setCursor,
    onReview: setReview,
    onAdvisor: (value) => setAdvisor(value),
    onUserChoice: (value) => setUserChoice(value),
    onReady: () => setIsBootstrapping(false),
  });

  useTrainerPersistence({
    enabled: !isBootstrapping,
    portfolio,
    currentEquity,
    mistakes,
    baseCaseId: baseCase.id,
    cursor,
    mode,
    onBackendSummary: setBackendSummary,
  });

  function getNextBaseCase(seed: number, phase = trainingPhase): BaseCase {
    if (phase === 'current') {
      const source = currentCases.length ? currentCases : getCasesForPhase({ cases: trainingCases, phase, presets: ['random'], mistakes });
      return pickTrainingCase(source, seed) ?? createBaseCase(seed);
    }
    const filtered = getCasesForPhase({ cases: trainingCases, phase: 'history', presets: trainingPresets, mistakes });
    const source = filtered.length > 0 ? filtered : trainingCases;
    return pickTrainingCase(source, seed) ?? createBaseCase(seed);
  }

  function clearCurrentDecisionState() {
    setReview(null);
    setPendingReview(null);
    setAdvisor(null);
    setUserChoice(null);
    setChecklist(DEFAULT_CHECKLIST);
    setTradeMessage('');
  }

  function toggleTrainingPreset(preset: TrainingPreset) {
    setTrainingPresets((current) => {
      if (preset === 'random') return ['random'];
      const withoutRandom = current.filter((item) => item !== 'random');
      const next = withoutRandom.includes(preset)
        ? withoutRandom.filter((item) => item !== preset)
        : [...withoutRandom, preset];
      return next.length ? next : ['random'];
    });
  }

  function switchTrainingPhase(next: TrainingPhase) {
    if (heldQuantity > 0 || portfolio.trades.some((trade) => trade.caseId === baseCase.id)) {
      setTradeMessage('开始交易后已锁定训练阶段，必须清仓并进入下一题后再切换。');
      return;
    }
    const seed = Date.now() + Math.floor(Math.random() * 100000);
    const nextBase = getNextBaseCase(seed, next);
    const nextMode: TimeMode = next === 'current' ? 'open' : mode;
    setTrainingPhase(next);
    setBaseCase(nextBase);
    setMode(nextMode);
    setCursor(initialCursorForMode(nextBase, nextMode));
    clearCurrentDecisionState();
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
    const nextMode: TimeMode = trainingPhase === 'current' ? 'open' : mode;
    setBaseCase(nextBase);
    setMode(nextMode);
    setCursor(initialCursorForMode(nextBase, nextMode));
    clearCurrentDecisionState();
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
    if (isBootstrapping) {
      setTradeMessage('正在恢复上次训练，请稍后再操作。');
      return;
    }
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
    if (isBootstrapping) {
      setTradeMessage('正在恢复上次训练，请稍后再操作。');
      return;
    }
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
    if (isBootstrapping) {
      setTradeMessage('正在恢复上次训练，请稍后再操作。');
      return;
    }
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
      setTradeMessage(trainingPhase === 'current' ? '当前最新阶段没有未来交易日，只能在最新盘面做当下演练。' : '已经到达该股票行情数据的最后交易日。');
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
    setMode('open');
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
    isBootstrapping,
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
    trainingPresets,
    toggleTrainingPreset,
    trainingPhase,
    switchTrainingPhase,
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
    currentCases,
    resetTraining,
    switchMode,
    buy,
    skip,
    sell,
    advanceHour,
    advanceDay,
  };
}
