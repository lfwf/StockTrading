import { useEffect, useMemo, useState } from 'react';
import type { AdvisorResult, BaseCase, DecisionChoice, DecisionInput, IntradayPoint, MarketCursor, OhlcvBar, PortfolioState, PositionSize, ReviewResult, TimeMode } from './types';
import { buildTradingScenarioView, createBaseCase, createRandomMode, getModeLabel, initialCursorForMode } from './lib/market';
import { average, change, formatVolume, ma, moneyYi, pct, rollingHigh, rollingLow } from './lib/indicators';
import { reviewDecision, reviewSkip } from './lib/review';
import { loadTrainingDataset, pickTrainingCase } from './lib/dataset';
import { assessScenario } from './lib/advisor';
import { averageCost, buyShares, createPortfolio, equity, persistTrade, positionQuantity, sellableQuantity, sellShares } from './lib/trading';

const POSITION_SIZES: PositionSize[] = [25, 50, 100];
const TIME_MODES: TimeMode[] = ['open', 'noon', 'close'];

type TrainingPreset = 'random' | 'impulse' | 'breakout' | 'weak-market' | 'pullback' | 'mistakes';

type DecisionChecklistState = {
  market: string;
  trend: string;
  setup: string;
  intraday: string;
  risk: string;
  motive: string;
};

type MistakeItem = {
  id: string;
  caseId: string;
  symbol: string;
  name: string;
  mode: TimeMode;
  action: DecisionChoice;
  date: string;
  tags: string[];
  ret5: number | null;
  maxDrawdown: number;
  reason: string;
  createdAt: string;
};

const DEFAULT_CHECKLIST: DecisionChecklistState = {
  market: '未判断',
  trend: '未判断',
  setup: '看不懂',
  intraday: '未判断',
  risk: '未设置',
  motive: '未确认',
};

const TRAINING_PRESETS: Array<{ key: TrainingPreset; title: string; desc: string }> = [
  { key: 'random', title: '随机盲盘', desc: '混合所有样本，保持真实随机性。' },
  { key: 'impulse', title: '冲动买入矫正', desc: '高开、急涨、短线涨幅偏大的样本。' },
  { key: 'breakout', title: '突破判断', desc: '接近或突破近20日高点的样本。' },
  { key: 'weak-market', title: '弱势大盘', desc: '沪深300阶段走弱时训练克制。' },
  { key: 'pullback', title: '回踩低吸', desc: '趋势仍在但短线回撤的样本。' },
  { key: 'mistakes', title: '只练错题', desc: '从你的错题本中反复抽题。' },
];

const EDUCATION_BY_TAG: Record<string, { title: string; body: string; check: string }> = {
  短线追高: {
    title: '短线追高',
    body: '价格短期已经上涨较多，再追入时，后续收益空间可能被提前透支。重点不是“它在涨”，而是“它已经涨了多少”。',
    check: '下次先看近5日涨幅、距离20日高点、成交量是否继续放大。',
  },
  大周期逆势: {
    title: '大周期逆势',
    body: '日内反弹不等于趋势反转。若价格仍在中期均线下方，买入本质更接近抢反弹。',
    check: '下次先看周K、月K和60日均线，确认大方向是否允许进场。',
  },
  上午冲高回落: {
    title: '上午冲高回落',
    body: '上午快速拉升后回落，说明追涨资金没有持续承接。午间买入容易被下午反转伤到。',
    check: '下次观察价格是否重新站回分时均价线上方，并确认量能没有衰减。',
  },
  收盘突破: {
    title: '收盘突破',
    body: '收盘突破比盘中冲高更可靠，但也需要成交量和大盘环境配合，否则容易是假突破。',
    check: '下次同时检查成交量、20日高点和沪深300当天表现。',
  },
  买入后回撤偏大: {
    title: '买点不舒服',
    body: '结果赚钱不代表买点好。买入后最大回撤过大，说明入场位置或止损计划不够清晰。',
    check: '下次买入前必须先写出止损位，而不是买完再想。',
  },
  主观冲动理由: {
    title: '主观冲动',
    body: '“感觉会涨”不是交易理由。它无法复盘，也无法改进。训练重点是把感觉拆成可验证条件。',
    check: '下次至少写出趋势、位置、量能、分时四个依据中的两个。',
  },
  可能错过机会: {
    title: '错过强势机会',
    body: '放弃后上涨说明你可能过度谨慎，也可能缺少对强势结构的识别。错过本身不一定错，但要知道错过了什么。',
    check: '下次复查放弃时是否忽略了放量、突破、相对大盘更强。',
  },
  放弃正确: {
    title: '有效规避',
    body: '放弃后下跌说明这次克制有价值。要把这种判断条件保存下来，形成可重复规则。',
    check: '记录当时让你放弃的信号，下次遇到类似结构继续执行。',
  },
};

function loadMistakes(): MistakeItem[] {
  try {
    const raw = localStorage.getItem('stock-trading-mistakes');
    return raw ? JSON.parse(raw) as MistakeItem[] : [];
  } catch {
    return [];
  }
}

function checklistReasons(checklist: DecisionChecklistState): string[] {
  return [checklist.setup, checklist.intraday, checklist.trend, checklist.motive]
    .filter((item) => item && !item.includes('未') && item !== '看不懂');
}

function caseMatchesPreset(item: BaseCase, preset: TrainingPreset, mistakes: MistakeItem[]): boolean {
  if (preset === 'random') return true;
  if (preset === 'mistakes') return mistakes.some((mistake) => mistake.caseId === item.id);

  const index = item.decisionIndex;
  const current = item.daily[index];
  const previous = item.daily.slice(Math.max(0, index - 20), index);
  if (!current || previous.length < 10) return false;

  const last5 = item.daily.slice(Math.max(0, index - 5), index);
  const last5Ret = last5.length >= 2 ? change(last5[0].close, last5.at(-1)?.close ?? last5[0].close) : 0;
  const high20 = Math.max(...previous.map((bar) => bar.high));
  const low20 = Math.min(...previous.map((bar) => bar.low));
  const ma20 = average(previous.map((bar) => bar.close));
  const position20 = (current.open - low20) / Math.max(high20 - low20, current.open * 0.01);
  const indexWindow = item.indexDaily.slice(Math.max(0, index - 20), index);
  const indexRet = indexWindow.length >= 2 ? change(indexWindow[0].close, indexWindow.at(-1)?.close ?? indexWindow[0].close) : 0;

  if (preset === 'impulse') return change(current.preClose, current.open) > 0.025 || last5Ret > 0.08 || position20 > 0.88;
  if (preset === 'breakout') return current.open >= high20 * 0.985 || current.close >= high20 * 0.985;
  if (preset === 'weak-market') return indexRet < -0.045;
  if (preset === 'pullback') return current.open > ma20 && change(high20, current.open) < -0.035 && position20 > 0.35;
  return true;
}

function shouldRecordMistake(result: ReviewResult, action: DecisionChoice): boolean {
  if (action === 'buy') {
    return result.maxDrawdown <= -0.06 || (result.ret5 ?? 0) <= -0.04 || result.tags.includes('买入后回撤偏大') || result.tags.includes('主观冲动理由');
  }
  return (result.ret5 ?? 0) >= 0.06 || result.tags.includes('可能错过机会');
}

export default function App() {
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
  const [backendSummary, setBackendSummary] = useState<{ trade_count: number; buy_count: number; sell_count: number; realized_pnl: number; winning_sells: number } | null>(null);
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
    const item: MistakeItem = {
      id: `${baseCase.id}-${scenario.mode}-${action}`,
      caseId: baseCase.id,
      symbol: baseCase.stock.symbol,
      name: baseCase.stock.name,
      mode: scenario.mode,
      action,
      date: scenario.decisionBar.date,
      tags: result.tags,
      ret5: result.ret5,
      maxDrawdown: result.maxDrawdown,
      reason: action === 'buy' ? '买入后回撤或亏损偏大' : '放弃后上涨，可能错过机会',
      createdAt: new Date().toISOString(),
    };
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

  return (
    <div className="app-shell">
      <header className="top-toolbar">
        <div>
          <p className="eyebrow">盲盘训练 · A股买入决策挑战</p>
          <h1>只看当时数据，训练买入纪律</h1>
          <p className="hero-copy">买前记录判断，买后复盘原因；错题会自动进入专项训练。</p>
        </div>
        <div className="toolbar-actions">
          <button className="ghost-btn" onClick={() => setShowStock((value) => !value)}>{showStock ? '隐藏股票' : '显示股票'}</button>
          <button className="ghost-btn" onClick={() => setShowDate((value) => !value)}>{showDate ? '隐藏日期' : '显示日期'}</button>
          <button className="primary-btn" onClick={() => resetTraining()} disabled={heldQuantity > 0 || isBankrupt}>下一题</button>
        </div>
      </header>

      <section className="status-bar">
        <StatusItem label="当前时间" value={showDate ? scenario.visibleUntil : `${currentTime} · 第${cursor.dayOffset + 1}日`} highlight />
        <StatusItem label="总资产" value={`¥${currentEquity.toFixed(2)}`} highlight />
        <StatusItem label="可用现金" value={`¥${portfolio.cash.toFixed(2)}`} />
        <StatusItem label="持仓 / 可卖" value={`${heldQuantity} / ${availableQuantity} 股`} />
        <StatusItem label="股票" value={showStock ? `${scenario.base.stock.name} ${scenario.base.stock.symbol}` : `已隐藏 · ${scenario.base.stock.industry}`} />
        <StatusItem label="日期" value={showDate ? scenario.visibleUntil : '已隐藏'} />
      </section>

      <section className="mode-row">
        <span>训练场景</span>
        {TIME_MODES.map((item) => (
          <button key={item} className={item === scenario.mode ? 'mode-btn active' : 'mode-btn'} onClick={() => switchMode(item)}>
            {getModeLabel(item)}
          </button>
        ))}
        <p>{dataStatus} · 当前专项：{TRAINING_PRESETS.find((item) => item.key === trainingPreset)?.title} · 匹配 {filteredCount || trainingCases.length} 题</p>
      </section>

      <section className="training-grid">
        <TrainingPresetPanel value={trainingPreset} onChange={setTrainingPreset} mistakes={mistakes.length} />
        <MistakeBookPanel mistakes={mistakes} onTrain={() => setTrainingPreset('mistakes')} onClear={() => setMistakes([])} />
      </section>

      <main className="workspace">
        <section className="chart-grid">
          <div className="card chart-card large-chart">
            <ChartHeader title="历史日K · 主决策图" subtitle={scenario.mode === 'close' ? '收盘场景包含当日完整K线' : '只显示到昨日，避免泄露当天结果'} />
            <KLineChart bars={scenario.visibleDaily} showDates={showDate} />
          </div>

          <div className="mini-charts">
            <div className="card chart-card">
              <ChartHeader title="周K" subtitle="大周期方向" />
              <KLineChart bars={scenario.visibleWeekly} compact showDates={showDate} />
            </div>
            <div className="card chart-card">
              <ChartHeader title="月K" subtitle="长期位置" />
              <KLineChart bars={scenario.visibleMonthly} compact showDates={showDate} />
            </div>
          </div>
        </section>

        <aside className="side-panel">
          <div className="card chart-card">
            <ChartHeader title="当天分时" subtitle={scenario.mode === 'open' ? '只显示开盘点' : scenario.mode === 'close' ? '显示全天分时' : '显示当前时点前分时'} />
            <IntradayChart points={scenario.visibleIntraday} preClose={scenario.decisionBar.preClose} />
          </div>

          <div className="card quote-card">
            <h2>交易面板</h2>
            <div className="quote-price">
              <span>{scenario.buyPrice.toFixed(2)}</span>
              <b className={openChange >= 0 ? 'up-text' : 'down-text'}>{pct(openChange)}</b>
            </div>
            <div className="metric-grid">
              <Metric label="持仓成本" value={heldQuantity ? cost.toFixed(2) : '--'} />
              <Metric label="持仓浮盈亏" value={heldQuantity ? `${(scenario.buyPrice - cost) * heldQuantity >= 0 ? '+' : ''}${((scenario.buyPrice - cost) * heldQuantity).toFixed(2)}` : '--'} valueClass={scenario.buyPrice >= cost ? 'up-text' : 'down-text'} />
              <Metric label="昨收" value={scenario.decisionBar.preClose.toFixed(2)} />
              <Metric label="今开" value={scenario.decisionBar.open.toFixed(2)} />
              <Metric label="截至当前最高" value={intradayHigh.toFixed(2)} />
              <Metric label="截至当前最低" value={intradayLow.toFixed(2)} />
              <Metric label="截至当前成交量" value={formatVolume(intradayVolume)} />
              <Metric label="可见日成交量" value={formatVolume(scenario.visibleDaily.at(-1)?.volume ?? 0)} />
              <Metric label="20日量比" value={`${(intradayVolume / Math.max(volumeMa20, 1)).toFixed(2)}x`} />
              <Metric label="换手率" value={`${scenario.decisionBar.turnoverRate.toFixed(2)}%`} />
              <Metric label="PE" value={scenario.base.stock.pe.toFixed(1)} />
              <Metric label="PB" value={scenario.base.stock.pb.toFixed(1)} />
              <Metric label="总市值" value={moneyYi(scenario.base.stock.totalMarketCap)} />
              <Metric label="流通市值" value={moneyYi(scenario.base.stock.floatMarketCap)} />
            </div>
          </div>

          <div className="card decision-card">
            <h2>买前检查清单</h2>
            <DecisionChecklist value={checklist} onChange={setChecklist} />
            <div className="control-block trade-control">
              <label>本次使用比例</label>
              <div className="segmented">
                {POSITION_SIZES.map((item) => (
                  <button key={item} className={positionSize === item ? 'active' : ''} onClick={() => setPositionSize(item)}>{item}%</button>
                ))}
              </div>
            </div>
            <div className="control-block trade-control">
              <label>成交规则</label>
              <div className="trade-rule">100股整数手 · 当日买入次日可卖</div>
            </div>
            <div className="decision-actions">
              <button className="buy-btn" onClick={buy} disabled={isBankrupt}>买入 {positionSize}%现金</button>
              <button className="skip-btn" onClick={sell}>卖出 {positionSize}%可卖</button>
              <button className="neutral-btn" onClick={advanceHour} disabled={scenario.mode === 'close'}>下一小时</button>
              <button className="neutral-btn" onClick={advanceDay}>下一交易日</button>
              <button className="skip-btn" onClick={skip} disabled={heldQuantity > 0}>放弃本题</button>
              <button className="primary-btn" onClick={() => resetTraining()} disabled={heldQuantity > 0 || isBankrupt}>下一题</button>
            </div>
            {tradeMessage && <p className="trade-message">{tradeMessage}</p>}
          </div>
        </aside>
      </main>

      <section className="lower-grid">
        <div className="card market-card">
          <ChartHeader title="市场环境 · 沪深300" subtitle="用于判断个股是否顺应大盘" />
          <div className="market-content">
            <KLineChart bars={scenario.visibleIndexDaily} compact showDates={showDate} />
            <div className="metric-grid market-metrics">
              <Metric label="沪深300当前变化" value={pct(indexChange)} valueClass={indexChange >= 0 ? 'up-text' : 'down-text'} />
              <Metric label="个股当前变化" value={pct(openChange)} valueClass={openChange >= 0 ? 'up-text' : 'down-text'} />
              <Metric label="近20日高点" value={visibleHigh20.toFixed(2)} />
              <Metric label="近20日低点" value={visibleLow20.toFixed(2)} />
              <Metric label="距60日高点" value={pct(change(visibleHigh60, scenario.buyPrice))} />
              <Metric label="可见样本数" value={`${scenario.visibleDaily.length} 日`} />
            </div>
          </div>
        </div>

        <ReviewPanel
          review={review}
          advisor={advisor}
          userChoice={userChoice}
          mode={scenario.mode}
          onNext={() => resetTraining()}
          portfolio={portfolio}
          currentEquity={currentEquity}
          backendSummary={backendSummary}
          checklist={checklist}
        />
      </section>
    </div>
  );
}

function TrainingPresetPanel({ value, onChange, mistakes }: { value: TrainingPreset; onChange: (value: TrainingPreset) => void; mistakes: number }) {
  return (
    <div className="card training-card">
      <div className="chart-header">
        <h2>专项训练</h2>
        <span>让训练更像刷题，而不是随机娱乐</span>
      </div>
      <div className="preset-list">
        {TRAINING_PRESETS.map((item) => (
          <button key={item.key} className={value === item.key ? 'preset active' : 'preset'} onClick={() => onChange(item.key)}>
            <b>{item.title}{item.key === 'mistakes' ? ` · ${mistakes}` : ''}</b>
            <span>{item.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MistakeBookPanel({ mistakes, onTrain, onClear }: { mistakes: MistakeItem[]; onTrain: () => void; onClear: () => void }) {
  return (
    <div className="card training-card mistake-card">
      <div className="chart-header">
        <h2>错题本</h2>
        <span>自动收集追高、放弃后大涨、回撤过大的样本</span>
      </div>
      {mistakes.length === 0 ? (
        <p className="muted-text">还没有错题。买入后大回撤、放弃后大涨，都会自动进入这里。</p>
      ) : (
        <>
          <div className="mistake-list">
            {mistakes.slice(0, 4).map((item) => (
              <div key={item.id} className="mistake-item">
                <b>{item.action === 'buy' ? '买入错题' : '放弃错题'} · {getModeLabel(item.mode)}</b>
                <span>{item.symbol} · {item.reason}</span>
                <em>{item.tags.slice(0, 3).join(' / ')}</em>
              </div>
            ))}
          </div>
          <div className="training-actions">
            <button className="primary-btn small" onClick={onTrain}>只练错题</button>
            <button className="ghost-btn small" onClick={onClear}>清空</button>
          </div>
        </>
      )}
    </div>
  );
}

function DecisionChecklist({ value, onChange }: { value: DecisionChecklistState; onChange: (value: DecisionChecklistState) => void }) {
  const groups: Array<{ key: keyof DecisionChecklistState; label: string; options: string[] }> = [
    { key: 'market', label: '大盘环境', options: ['强', '震荡', '弱', '未判断'] },
    { key: 'trend', label: '个股趋势', options: ['上升', '横盘', '下降', '未判断'] },
    { key: 'setup', label: '当前买点', options: ['突破', '回踩', '低吸', '追高', '看不懂'] },
    { key: 'intraday', label: '分时状态', options: ['走强', '冲高回落', '横盘', '跳水', '未判断'] },
    { key: 'risk', label: '止损计划', options: ['-3%', '-5%', '-8%', '未设置'] },
    { key: 'motive', label: '真实动机', options: ['技术确认', '怕错过', '情绪冲动', '未确认'] },
  ];

  return (
    <div className="checklist-grid">
      {groups.map((group) => (
        <div key={group.key} className="checklist-group">
          <label>{group.label}</label>
          <div className="segmented compact">
            {group.options.map((option) => (
              <button key={option} className={value[group.key] === option ? 'active' : ''} onClick={() => onChange({ ...value, [group.key]: option })}>{option}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusItem({ label, value, highlight = false, warning = false }: { label: string; value: string; highlight?: boolean; warning?: boolean }) {
  return (
    <div className={highlight ? 'status-item highlight' : warning ? 'status-item warning' : 'status-item'}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function ChartHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="chart-header">
      <h2>{title}</h2>
      <span>{subtitle}</span>
    </div>
  );
}

function Metric({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b className={valueClass}>{value}</b>
    </div>
  );
}

function buildPriceScale(values: number[], reference: number, tickCount = 4) {
  if (!values.length) {
    return { min: reference * 0.98, max: reference * 1.02, range: Math.max(reference * 0.04, 1), ticks: [reference], decimals: 2 };
  }
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const minimumRange = Math.max(Math.abs(reference) * 0.006, 0.002);
  const paddedRange = Math.max(dataMax - dataMin, minimumRange) * 1.12;
  const roughStep = paddedRange / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = niceFactor * magnitude;
  const midpoint = (dataMin + dataMax) / 2;
  let min = Math.floor((midpoint - paddedRange / 2) / step) * step;
  let max = Math.ceil((midpoint + paddedRange / 2) / step) * step;

  if (min > dataMin) min -= step;
  if (max < dataMax) max += step;

  const ticks: number[] = [];
  for (let item = min; item <= max + step * 0.1; item += step) ticks.push(Number(item.toFixed(10)));
  const decimals = step >= 1 ? 2 : Math.min(4, Math.max(2, Math.ceil(-Math.log10(step)) + 1));
  return { min, max, range: Math.max(max - min, step), ticks, decimals };
}

function KLineChart({ bars, compact = false, showDates = false }: { bars: OhlcvBar[]; compact?: boolean; showDates?: boolean }) {
  const width = compact ? 420 : 760;
  const height = compact ? 150 : 280;
  const topPadding = compact ? 14 : 22;
  const bottomPadding = compact ? 18 : 24;
  const leftPadding = compact ? 12 : 20;
  const rightPadding = compact ? 48 : 58;
  const volumeHeight = compact ? 30 : 54;
  const priceHeight = height - topPadding - bottomPadding - volumeHeight - 14;
  const visibleBars = bars.slice(compact ? -36 : -70);
  const highs = visibleBars.map((bar) => bar.high);
  const lows = visibleBars.map((bar) => bar.low);
  const scale = buildPriceScale([...highs, ...lows], visibleBars.at(-1)?.close ?? 1);
  const maxVolume = Math.max(...visibleBars.map((bar) => bar.volume), 1);
  const step = (width - leftPadding - rightPadding) / Math.max(visibleBars.length, 1);
  const candleWidth = Math.max(3, Math.min(12, step * 0.58));
  const closes = visibleBars.map((bar) => bar.close);
  const ma5 = ma(closes, 5);
  const ma20 = ma(closes, 20);
  const ma60 = compact ? [] : ma(closes, 60);

  const y = (price: number) => topPadding + (scale.max - price) / scale.range * priceHeight;
  const volumeY = (volume: number) => height - bottomPadding - (volume / maxVolume) * volumeHeight;
  const x = (index: number) => leftPadding + index * step + step / 2;

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="K线图">
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line className="grid-line" x1={leftPadding} x2={width - rightPadding} y1={y(tick)} y2={y(tick)} />
          <text className="axis-label right price-tick" x={width - 4} y={y(tick) + 3}>{tick.toFixed(scale.decimals)}</text>
        </g>
      ))}
      {visibleBars.map((bar, index) => {
        const isUp = bar.close >= bar.open;
        const candleTop = y(Math.max(bar.open, bar.close));
        const candleBottom = y(Math.min(bar.open, bar.close));
        const candleHeight = Math.max(1, candleBottom - candleTop);
        const volumeTop = volumeY(bar.volume);
        return (
          <g key={`${bar.date}-${index}`}>
            <line className={isUp ? 'candle up' : 'candle down'} x1={x(index)} x2={x(index)} y1={y(bar.high)} y2={y(bar.low)} />
            <rect className={isUp ? 'candle-body up' : 'candle-body down'} x={x(index) - candleWidth / 2} y={candleTop} width={candleWidth} height={candleHeight} rx="1" />
            <rect className={isUp ? 'volume up' : 'volume down'} x={x(index) - candleWidth / 2} y={volumeTop} width={candleWidth} height={height - bottomPadding - volumeTop} />
          </g>
        );
      })}
      <MaLine values={ma5} x={x} y={y} className="ma ma5" />
      <MaLine values={ma20} x={x} y={y} className="ma ma20" />
      {!compact && <MaLine values={ma60} x={x} y={y} className="ma ma60" />}
      {showDates && (
        <>
          <text className="axis-label" x={leftPadding} y={height - 4}>{visibleBars[0]?.date}</text>
          <text className="axis-label right" x={width - rightPadding} y={height - 4}>{visibleBars.at(-1)?.date}</text>
        </>
      )}
    </svg>
  );
}

function MaLine({ values, x, y, className }: { values: Array<number | null>; x: (index: number) => number; y: (value: number) => number; className: string }) {
  const firstValid = values.findIndex((item) => item !== null);
  const path = values
    .map((value, index) => (value === null ? null : `${index === firstValid ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`))
    .filter(Boolean)
    .join(' ');
  if (!path) return null;
  return <path className={className} d={path} fill="none" />;
}

function IntradayChart({ points, preClose }: { points: IntradayPoint[]; preClose: number }) {
  const width = 520;
  const height = 310;
  const topPadding = 16;
  const bottomPadding = 20;
  const leftPadding = 14;
  const rightPadding = 88;
  const prices = [...points.map((point) => point.price), ...points.map((point) => point.avgPrice), preClose];
  const scale = buildPriceScale(prices, preClose);
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  const priceHeight = 216;
  const volumeHeight = 46;
  const plotWidth = width - leftPadding - rightPadding;
  const x = (index: number) => leftPadding + index / Math.max(points.length - 1, 1) * plotWidth;
  const y = (price: number) => topPadding + (scale.max - price) / scale.range * priceHeight;
  const volumeY = (volume: number) => height - bottomPadding - (volume / maxVolume) * volumeHeight;
  const pricePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(point.price).toFixed(2)}`).join(' ');
  const avgPath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(point.avgPrice).toFixed(2)}`).join(' ');

  return (
    <svg className="chart intraday" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="分时图">
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line className="grid-line" x1={leftPadding} x2={width - rightPadding} y1={y(tick)} y2={y(tick)} />
          <text className="axis-label right price-tick" x={width - 4} y={y(tick) + 3}>{tick.toFixed(scale.decimals)} / {pct(change(preClose, tick))}</text>
        </g>
      ))}
      <line className="pre-close-line" x1={leftPadding} x2={width - rightPadding} y1={y(preClose)} y2={y(preClose)} />
      {points.map((point, index) => (
        <rect key={`${point.time}-${index}`} className="volume neutral" x={x(index)} y={volumeY(point.volume)} width={Math.max(1, plotWidth / Math.max(points.length, 1) * 0.7)} height={height - bottomPadding - volumeY(point.volume)} />
      ))}
      {points.length === 1 ? <circle className="intraday-dot" cx={x(0)} cy={y(points[0].price)} r="5" /> : <path className="intraday-price" d={pricePath} fill="none" />}
      {points.length > 1 && <path className="intraday-average" d={avgPath} fill="none" />}
      <text className="axis-label" x={leftPadding} y={height - 4}>{points[0]?.time}</text>
      <text className="axis-label right" x={width - rightPadding} y={height - 4}>{points.at(-1)?.time}</text>
    </svg>
  );
}

function ReviewPanel({
  review,
  advisor,
  userChoice,
  mode,
  onNext,
  portfolio,
  currentEquity,
  backendSummary,
  checklist,
}: {
  review: ReviewResult | null;
  advisor: AdvisorResult | null;
  userChoice: DecisionChoice | null;
  mode: TimeMode;
  onNext: () => void;
  portfolio: PortfolioState;
  currentEquity: number;
  backendSummary: { trade_count: number; buy_count: number; sell_count: number; realized_pnl: number; winning_sells: number } | null;
  checklist: DecisionChecklistState;
}) {
  if (!review) {
    return (
      <div className="card review-card empty-review">
        <h2>交易记录与判断</h2>
        <div className="advisor-plan">
          <Metric label="累计收益率" value={pct(change(portfolio.initialCash, currentEquity))} valueClass={currentEquity >= portfolio.initialCash ? 'up-text' : 'down-text'} />
          <Metric label="已实现盈亏" value={`${(backendSummary?.realized_pnl ?? 0) >= 0 ? '+' : ''}${(backendSummary?.realized_pnl ?? 0).toFixed(2)}`} valueClass={(backendSummary?.realized_pnl ?? 0) >= 0 ? 'up-text' : 'down-text'} />
          <Metric label="后台成交记录" value={`${backendSummary?.trade_count ?? portfolio.trades.length} 笔`} />
        </div>
        {advisor && <AdvisorPanel advisor={advisor} userChoice={userChoice} />}
        <ChecklistSnapshot checklist={checklist} />
        <p>买入后系统只展示当时判断，不会提前揭晓未来。请通过“下一小时”或“下一交易日”推进行情。</p>
      </div>
    );
  }

  return (
    <div className="card review-card">
      <div className="review-head">
        <div>
          <h2>结果复盘</h2>
          <p>{getModeLabel(mode)} · 买入价参考 {review.entryPrice.toFixed(2)}</p>
        </div>
        <button className="primary-btn small" onClick={onNext}>下一题</button>
      </div>
      <div className="result-grid">
        {review.retClose !== undefined && <Metric label="当日收盘" value={pct(review.retClose)} valueClass={review.retClose >= 0 ? 'up-text' : 'down-text'} />}
        {review.retNextOpen !== undefined && <Metric label="次日开盘" value={pct(review.retNextOpen)} valueClass={review.retNextOpen >= 0 ? 'up-text' : 'down-text'} />}
        <Metric label="1日" value={review.ret1 === null ? '--' : pct(review.ret1)} valueClass={(review.ret1 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="3日" value={review.ret3 === null ? '--' : pct(review.ret3)} valueClass={(review.ret3 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="5日" value={review.ret5 === null ? '--' : pct(review.ret5)} valueClass={(review.ret5 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="10日" value={review.ret10 === null ? '--' : pct(review.ret10)} valueClass={(review.ret10 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="20日" value={review.ret20 === null ? '--' : pct(review.ret20)} valueClass={(review.ret20 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="最大浮盈" value={pct(review.maxProfit)} valueClass="up-text" />
        <Metric label="最大回撤" value={pct(review.maxDrawdown)} valueClass="down-text" />
        <Metric label="相对沪深300" value={review.relativeRet20 === null ? '--' : pct(review.relativeRet20)} valueClass={(review.relativeRet20 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
      </div>
      <div className="review-tags">
        {review.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <p className="review-summary">{review.summary}</p>
      <LearningCards tags={review.tags} />
      <ChecklistSnapshot checklist={checklist} />
      {advisor && <AdvisorPanel advisor={advisor} userChoice={userChoice} />}
    </div>
  );
}

function ChecklistSnapshot({ checklist }: { checklist: DecisionChecklistState }) {
  return (
    <div className="checklist-snapshot">
      <b>你的买前判断</b>
      <span>大盘：{checklist.market}</span>
      <span>趋势：{checklist.trend}</span>
      <span>买点：{checklist.setup}</span>
      <span>分时：{checklist.intraday}</span>
      <span>风险：{checklist.risk}</span>
      <span>动机：{checklist.motive}</span>
    </div>
  );
}

function LearningCards({ tags }: { tags: string[] }) {
  const cards = tags.map((tag) => EDUCATION_BY_TAG[tag]).filter(Boolean).slice(0, 3);
  if (!cards.length) return null;
  return (
    <div className="learning-cards">
      {cards.map((card) => (
        <article key={card.title} className="learning-card">
          <b>{card.title}</b>
          <p>{card.body}</p>
          <span>{card.check}</span>
        </article>
      ))}
    </div>
  );
}

function AdvisorPanel({ advisor, userChoice }: { advisor: AdvisorResult; userChoice: DecisionChoice | null }) {
  const actionLabel = advisor.action === 'buy' ? '考虑买入' : advisor.action === 'observe' ? '继续观察' : '放弃';
  const agrees = userChoice === 'buy' ? advisor.action === 'buy' : userChoice === 'skip' ? advisor.action === 'skip' : false;

  return (
    <section className="advisor-panel">
      <div className="advisor-head">
        <div>
          <span>规则系统判断 · 仅使用当时可见数据</span>
          <h3>{actionLabel}</h3>
        </div>
        <div className="advisor-badges">
          <b>置信度 {advisor.confidence}</b>
          <b className={agrees ? 'agreement' : 'difference'}>{agrees ? '与你一致' : '与你不同'}</b>
        </div>
      </div>
      <div className="advisor-plan">
        <Metric label="建议仓位" value={advisor.suggestedPosition ? `${advisor.suggestedPosition}%` : '暂不建仓'} />
        <Metric label="建议止损" value={advisor.suggestedStopLossPct ? `-${advisor.suggestedStopLossPct}%` : '--'} />
        <Metric label="综合评分" value={`${advisor.score > 0 ? '+' : ''}${advisor.score}`} valueClass={advisor.score > 0 ? 'up-text' : advisor.score < 0 ? 'down-text' : ''} />
      </div>
      <div className="advisor-evidence">
        {advisor.evidence.map((item) => (
          <div key={item.category} className={`advisor-evidence-item ${item.tone}`}>
            <b>{item.category}</b>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
      <p><b>触发条件：</b>{advisor.trigger}</p>
      <p><b>主要风险：</b>{advisor.risk}</p>
    </section>
  );
}
