import { useMemo, useState } from 'react';
import type { AdvisorResult, BaseCase, DecisionChoice, DecisionInput, IntradayPoint, MarketCursor, PortfolioState, PositionSize, ReviewResult, TimeMode } from '../types';
import { buildTradingScenarioView, createRandomMode, initialCursorForMode } from '../lib/market';
import { reviewDecision, reviewSkip } from '../lib/review';
import { loadNextTrainingCase, pickTrainingCase } from '../lib/dataset';
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
import { buyReasonLabel, noBuyReasonLabel, type BuyReasonKey, type NoBuyReasonKey, type StopLossPlan } from '../domain/trainingIntent';
import { getCasesForPhase, type TrainingPhase } from '../domain/trainingPhase';
import { useDatasetBootstrap } from './useDatasetBootstrap';
import { useTrainerPersistence, type BackendSummary } from './useTrainerPersistence';

export type TrainerTradeState = 'idle' | 'holding-t1' | 'holding-sellable' | 'cleared' | 'reviewed' | 'ended';

function tradeStateLabel(state: TrainerTradeState): string {
  if (state === 'idle') return '未操作';
  if (state === 'holding-t1') return 'T+1锁定';
  if (state === 'holding-sellable') return '可卖出';
  if (state === 'cleared') return '已清仓';
  if (state === 'reviewed') return '已复盘';
  return '已结束';
}

function persistNoBuyRecord(params: {
  caseId: string;
  symbol: string;
  name: string;
  date: string;
  mode: TimeMode;
  reason: string;
  ret5: number | null;
  maxDrawdown: number;
}) {
  try {
    const raw = localStorage.getItem('stock-trading-no-buy-records');
    const list = raw ? JSON.parse(raw) as unknown[] : [];
    const next = [{ ...params, createdAt: new Date().toISOString() }, ...list].slice(0, 300);
    localStorage.setItem('stock-trading-no-buy-records', JSON.stringify(next));
  } catch {
    // ignore unavailable storage
  }
}

const LOADING_CASE: BaseCase = {
  id: 'loading-real-data',
  stock: {
    symbol: '000000',
    name: '加载中',
    market: '沪市',
    industry: '',
    pe: 0,
    pb: 0,
    totalMarketCap: 0,
    floatMarketCap: 0,
  },
  daily: [{
    date: '1970-01-01',
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    preClose: 0,
    volume: 0,
    amount: 0,
    turnoverRate: 0,
  }],
  indexDaily: [{
    date: '1970-01-01',
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    preClose: 0,
    volume: 0,
    amount: 0,
    turnoverRate: 0,
  }],
  decisionIndex: 0,
  fullIntraday: [{ time: '09:30', price: 0, avgPrice: 0, volume: 0 }],
  indexIntraday: [],
  intradayByDate: { '1970-01-01': [{ time: '09:30', price: 0, avgPrice: 0, volume: 0 }] },
};

export function useTradingTrainer() {
  const [trainingCases, setTrainingCases] = useState<BaseCase[]>([]);
  const [currentCases, setCurrentCases] = useState<BaseCase[]>([]);
  const [dataStatus, setDataStatus] = useState('正在加载真实题库');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isCaseLoading, setIsCaseLoading] = useState(false);
  const [baseCase, setBaseCase] = useState<BaseCase>(() => LOADING_CASE);
  const [mode, setMode] = useState<TimeMode>(() => createRandomMode());
  const [cursor, setCursor] = useState<MarketCursor>(() => ({ dayOffset: 0, pointIndex: 0 }));
  const [showStock, setShowStock] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [positionSize, setPositionSize] = useState<PositionSize>(50);
  const [buyReason, setBuyReason] = useState<BuyReasonKey>('breakout');
  const [noBuyReason, setNoBuyReason] = useState<NoBuyReasonKey>('unclear');
  const [stopLossPlan, setStopLossPlan] = useState<StopLossPlan>(5);
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
  const currentCaseTrades = portfolio.trades.filter((trade) => trade.caseId === baseCase.id);
  const hasCurrentCaseTrades = currentCaseTrades.length > 0;
  const tradeState: TrainerTradeState = isBankrupt
    ? 'ended'
    : review
      ? 'reviewed'
      : heldQuantity > 0 && availableQuantity === 0
        ? 'holding-t1'
        : heldQuantity > 0
          ? 'holding-sellable'
          : hasCurrentCaseTrades
            ? 'cleared'
            : 'idle';
  const tradeStateText = tradeStateLabel(tradeState);

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
      return pickTrainingCase(source, seed) ?? baseCase;
    }
    const filtered = getCasesForPhase({ cases: trainingCases, phase: 'history', presets: trainingPresets, mistakes });
    const source = filtered.length > 0 ? filtered : trainingCases;
    return pickTrainingCase(source, seed) ?? baseCase;
  }

  function rememberCase(item: BaseCase, phase: TrainingPhase) {
    if (phase === 'current') {
      setCurrentCases((items) => [item, ...items.filter((old) => old.id !== item.id)].slice(0, 40));
    } else {
      setTrainingCases((items) => [item, ...items.filter((old) => old.id !== item.id)].slice(0, 80));
    }
  }

  function clearCurrentDecisionState() {
    setReview(null);
    setPendingReview(null);
    setAdvisor(null);
    setUserChoice(null);
    setChecklist(DEFAULT_CHECKLIST);
    setBuyReason('breakout');
    setNoBuyReason('unclear');
    setStopLossPlan(5);
    setTradeMessage('');
  }

  function applyBaseCase(nextBase: BaseCase, nextPhase: TrainingPhase, nextMode: TimeMode) {
    setBaseCase(nextBase);
    setMode(nextMode);
    setCursor(initialCursorForMode(nextBase, nextMode));
    clearCurrentDecisionState();
    rememberCase(nextBase, nextPhase);
  }

  async function loadAndApplyNextCase(nextPhase: TrainingPhase, seed = Date.now() + Math.floor(Math.random() * 100000)) {
    setIsCaseLoading(true);
    setTradeMessage('正在加载下一题…');
    try {
      const remote = await loadNextTrainingCase({
        phase: nextPhase,
        presets: nextPhase === 'history' ? trainingPresets : ['random'],
        excludeId: baseCase.id,
        seed,
      });
      const nextBase = remote?.case ?? getNextBaseCase(seed, nextPhase);
      if (nextBase.id === baseCase.id && !remote?.case) {
        setTradeMessage('没有可用的完整真实题库，请先补全数据或重新生成题库。');
        return;
      }
      const nextMode: TimeMode = nextPhase === 'current' ? 'open' : mode;
      applyBaseCase(nextBase, nextPhase, nextMode);
    } finally {
      setIsCaseLoading(false);
    }
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
    if (heldQuantity > 0 || hasCurrentCaseTrades) {
      setTradeMessage('开始交易后已锁定训练阶段，必须清仓并进入下一题后再切换。');
      return;
    }
    setTrainingPhase(next);
    void loadAndApplyNextCase(next);
  }

  function recordNoBuyDecisionIfNeeded() {
    if (hasCurrentCaseTrades || heldQuantity > 0) return;
    const result = reviewSkip(scenario);
    const reasonText = `未买入原因：${noBuyReasonLabel(noBuyReason)}`;
    setUserChoice('skip');
    persistNoBuyRecord({
      caseId: baseCase.id,
      symbol: baseCase.stock.symbol,
      name: baseCase.stock.name,
      date: baseCase.daily[baseCase.decisionIndex]?.date ?? '',
      mode: scenario.mode,
      reason: reasonText,
      ret5: result.ret5,
      maxDrawdown: result.maxDrawdown,
    });
    if (shouldRecordMistake(result, 'skip')) {
      const item = createMistakeItem({
        baseCase,
        mode: scenario.mode,
        action: 'skip',
        result,
        reason: reasonText,
        extraTags: [noBuyReasonLabel(noBuyReason)],
      });
      setMistakes((current) => [item, ...current.filter((old) => old.id !== item.id)].slice(0, 80));
    }
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
    recordNoBuyDecisionIfNeeded();
    void loadAndApplyNextCase(trainingPhase, seed);
  }

  function switchMode(next: TimeMode) {
    if (heldQuantity > 0 || hasCurrentCaseTrades) {
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

  function addMistakeIfNeeded(result: ReviewResult, action: DecisionChoice, reason?: string, extraTags: string[] = []) {
    if (!shouldRecordMistake(result, action)) return;
    const item = createMistakeItem({ baseCase, mode: scenario.mode, action, result, reason, extraTags });
    setMistakes((current) => [item, ...current.filter((old) => old.id !== item.id)].slice(0, 80));
  }

  function buy(size: PositionSize = positionSize) {
    if (isBootstrapping || isCaseLoading) {
      setTradeMessage('正在加载训练数据，请稍后再操作。');
      return;
    }
    if (isBankrupt) {
      setTradeMessage('总资产已经归零，无法继续买入。');
      return;
    }

    const advisorResult = assessScenario(scenario);
    const result = buyShares(portfolio, size, scenario.buyPrice, currentDate, currentTime, baseCase.id, baseCase.stock.symbol);
    setPositionSize(size);
    if (!result.trade) {
      setAdvisor(advisorResult);
      setUserChoice('buy');
      setTradeMessage('可用资金不足以买入一手（100股），请调整买入比例或推进行情。');
      return;
    }

    const reasonLabel = buyReasonLabel(buyReason);
    const decision: DecisionInput = {
      choice: 'buy',
      positionSize: size,
      holdPlan: 5,
      stopLossPct: stopLossPlan,
      reasonTags: [...checklistReasons(checklist), reasonLabel],
    };

    setPendingReview(reviewDecision(scenario, decision));
    setAdvisor(advisorResult);
    setUserChoice('buy');
    setReview(null);
    setPortfolio(result.portfolio);
    setTradeMessage(`买入 ${result.trade.quantity} 股，成交金额 ${result.trade.amount.toFixed(2)} 元；理由：${reasonLabel}；计划止损 ${stopLossPlan}%；该批持仓下一交易日可卖。`);
    persistTrade(result.portfolio, result.trade, equity(result.portfolio, scenario.buyPrice)).catch(() => undefined);
  }

  function sell(size: PositionSize = positionSize) {
    if (isBootstrapping || isCaseLoading) {
      setTradeMessage('正在加载训练数据，请稍后再操作。');
      return;
    }
    const result = sellShares(portfolio, size, scenario.buyPrice, currentDate, currentTime, baseCase.id, baseCase.stock.symbol);
    setPositionSize(size);
    if (!result.trade) {
      if (heldQuantity > 0 && availableQuantity === 0) {
        setTradeMessage('当前持仓受 T+1 限制，今天买入的股票要到下一交易日才能卖。');
      } else if (availableQuantity > 0) {
        setTradeMessage('当前卖出比例对应的可卖数量不足一手（100股），请调高卖出比例或继续持有。');
      } else {
        setTradeMessage('当前没有可卖持仓。');
      }
      return;
    }

    const cleared = positionQuantity(result.portfolio) === 0;
    setPortfolio(result.portfolio);
    setTradeMessage(`卖出 ${result.trade.quantity} 股，本次实现盈亏 ${result.trade.realizedPnl >= 0 ? '+' : ''}${result.trade.realizedPnl.toFixed(2)} 元。${cleared ? ' 已清仓，生成本题复盘。' : ''}`);

    if (cleared) {
      const finalReview = pendingReview ?? reviewDecision(scenario, {
        choice: 'buy',
        positionSize: size,
        holdPlan: 5,
        stopLossPct: stopLossPlan,
        reasonTags: [...checklistReasons(checklist), buyReasonLabel(buyReason)],
      });
      setReview(finalReview);
      addMistakeIfNeeded(finalReview, 'buy', `买入理由：${buyReasonLabel(buyReason)}`, [buyReasonLabel(buyReason)]);
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
      void advanceDay();
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
      setTradeMessage('正在从数据库加载下一交易日5分钟行情…');
      try {
        const response = await fetch(`/api/market/intraday?symbol=${baseCase.stock.symbol}&date=${nextBar.date}`);
        const data = await response.json() as { points?: IntradayPoint[] };
        nextPoints = data.points;
      } catch {
        nextPoints = [];
      }
      if (!nextPoints?.length) {
        setTradeMessage('下一交易日分钟行情暂时无法获取，请先确认 minute_bars 是否已同步。');
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
    isBootstrapping: isBootstrapping || isCaseLoading,
    buyReason,
    setBuyReason,
    noBuyReason,
    setNoBuyReason,
    stopLossPlan,
    setStopLossPlan,
    tradeState,
    tradeStateText,
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
    sell,
    advanceHour,
    advanceDay,
  };
}
