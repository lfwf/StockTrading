import { useEffect, useMemo, useState } from 'react';
import type { AdvisorResult, BaseCase, DecisionChoice, IntradayPoint, MarketCursor, OhlcvBar, PortfolioState, PositionSize, ReviewResult, TimeMode } from './types';
import { buildTradingScenarioView, createBaseCase, createRandomMode, getModeLabel, initialCursorForMode } from './lib/market';
import { average, change, formatVolume, ma, moneyYi, pct, rollingHigh, rollingLow } from './lib/indicators';
import { reviewSkip } from './lib/review';
import { loadTrainingDataset, pickTrainingCase } from './lib/dataset';
import { assessScenario } from './lib/advisor';
import { averageCost, buyShares, createPortfolio, equity, persistTrade, positionQuantity, sellableQuantity, sellShares } from './lib/trading';

const POSITION_SIZES: PositionSize[] = [25, 50, 100];
const TIME_MODES: TimeMode[] = ['open', 'noon', 'close'];

export default function App() {
  const [trainingCases, setTrainingCases] = useState<BaseCase[]>([]);
  const [dataStatus, setDataStatus] = useState('正在检查 AKShare 数据');
  const [baseCase, setBaseCase] = useState(() => createBaseCase());
  const [mode, setMode] = useState<TimeMode>(() => createRandomMode());
  const [cursor, setCursor] = useState<MarketCursor>(() => ({ dayOffset: 0, pointIndex: 0 }));
  const [showName, setShowName] = useState(false);
  const [positionSize, setPositionSize] = useState<PositionSize>(50);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [advisor, setAdvisor] = useState<AdvisorResult | null>(null);
  const [userChoice, setUserChoice] = useState<DecisionChoice | null>(null);
  const [tradeMessage, setTradeMessage] = useState('');
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

  function getNextBaseCase(seed: number): BaseCase {
    return pickTrainingCase(trainingCases, seed) ?? createBaseCase(seed);
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
    setAdvisor(null);
    setUserChoice(null);
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
    setAdvisor(null);
    setUserChoice(null);
  }

  function buy() {
    if (isBankrupt) {
      setTradeMessage('总资产已经归零，无法继续买入。');
      return;
    }
    setAdvisor(assessScenario(scenario));
    setUserChoice('buy');
    setReview(null);
    const result = buyShares(portfolio, positionSize, scenario.buyPrice, currentDate, currentTime, baseCase.id, baseCase.stock.symbol);
    if (!result.trade) {
      setTradeMessage('可用资金不足以买入一手（100股），请调整买入比例或推进行情。');
      return;
    }
    setPortfolio(result.portfolio);
    setTradeMessage(`买入 ${result.trade.quantity} 股，成交金额 ${result.trade.amount.toFixed(2)} 元；该批持仓下一交易日可卖。`);
    persistTrade(result.portfolio, result.trade, equity(result.portfolio, scenario.buyPrice)).catch(() => undefined);
  }

  function skip() {
    if (heldQuantity > 0) {
      setTradeMessage('当前仍有持仓，不能放弃本题。');
      return;
    }
    setAdvisor(assessScenario(scenario));
    setUserChoice('skip');
    setReview(reviewSkip(scenario));
  }

  function sell() {
    const result = sellShares(portfolio, positionSize, scenario.buyPrice, currentDate, currentTime, baseCase.id, baseCase.stock.symbol);
    if (!result.trade) {
      setTradeMessage(heldQuantity > 0 ? '当前持仓受 T+1 限制，今天买入的股票要到下一交易日才能卖。' : '当前没有可卖持仓。');
      return;
    }
    setPortfolio(result.portfolio);
    setTradeMessage(`卖出 ${result.trade.quantity} 股，本次实现盈亏 ${result.trade.realizedPnl >= 0 ? '+' : ''}${result.trade.realizedPnl.toFixed(2)} 元。`);
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
    setAdvisor(null);
    setUserChoice(null);
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
    setAdvisor(null);
    setUserChoice(null);
    setTradeMessage('');
  }

  return (
    <div className="app-shell">
      <section className="status-bar">
        <StatusItem label="当前时间" value={showName ? scenario.visibleUntil : `${currentTime} · 第${cursor.dayOffset + 1}日`} highlight />
        <StatusItem label="总资产" value={`¥${currentEquity.toFixed(2)}`} highlight />
        <StatusItem label="可用现金" value={`¥${portfolio.cash.toFixed(2)}`} />
        <StatusItem label="持仓 / 可卖" value={`${heldQuantity} / ${availableQuantity} 股`} />
        <StatusItem label="可见数据截止" value={showName ? scenario.visibleUntil : '日期已隐藏'} />
        <StatusItem label="股票" value={showName ? `${scenario.base.stock.name} ${scenario.base.stock.symbol}` : `已隐藏 · ${scenario.base.stock.industry}`} />
      </section>

      <section className="mode-row">
        <span>训练场景</span>
        {TIME_MODES.map((item) => (
          <button key={item} className={item === scenario.mode ? 'mode-btn active' : 'mode-btn'} onClick={() => switchMode(item)}>
            {getModeLabel(item)}
          </button>
        ))}
        <p>{dataStatus} · 买入后锁定股票，遵守 T+1。</p>
        <button className="reveal-btn" onClick={() => setShowName((value) => !value)}>{showName ? '隐藏名称和日期' : '显示名称和日期'}</button>
      </section>

      <main className="workspace">
        <section className="chart-grid">
          <div className="card chart-card large-chart">
            <ChartHeader title="历史日K · 主决策图" subtitle={scenario.mode === 'close' ? '收盘场景包含当日完整K线' : '只显示到昨日，避免泄露当天结果'} />
            <KLineChart bars={scenario.visibleDaily} showDates={showName} />
          </div>

          <div className="mini-charts">
            <div className="card chart-card">
              <ChartHeader title="周K" subtitle="大周期方向" />
              <KLineChart bars={scenario.visibleWeekly} compact showDates={showName} />
            </div>
            <div className="card chart-card">
              <ChartHeader title="月K" subtitle="长期位置" />
              <KLineChart bars={scenario.visibleMonthly} compact showDates={showName} />
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
            <h2>模拟交易</h2>
            <div className="control-block">
              <label>本次使用比例</label>
              <div className="segmented">
                {POSITION_SIZES.map((item) => (
                  <button key={item} className={positionSize === item ? 'active' : ''} onClick={() => setPositionSize(item)}>{item}%</button>
                ))}
              </div>
            </div>
            <div className="control-block">
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
            <KLineChart bars={scenario.visibleIndexDaily} compact showDates={showName} />
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
        />
      </section>
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
  for (let value = min; value <= max + step * 0.1; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }

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
          <text className="axis-label right price-tick" x={width - 4} y={y(tick) + 3}>
            {tick.toFixed(scale.decimals)} / {pct(change(preClose, tick))}
          </text>
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
}: {
  review: ReviewResult | null;
  advisor: AdvisorResult | null;
  userChoice: DecisionChoice | null;
  mode: TimeMode;
  onNext: () => void;
  portfolio: PortfolioState;
  currentEquity: number;
  backendSummary: { trade_count: number; buy_count: number; sell_count: number; realized_pnl: number; winning_sells: number } | null;
}) {
  if (!review) {
    if (advisor) {
      return (
        <div className="card review-card">
          <AdvisorPanel advisor={advisor} userChoice={userChoice} />
        </div>
      );
    }
    return (
      <div className="card review-card empty-review">
        <h2>交易记录与判断</h2>
        <div className="advisor-plan">
          <Metric label="累计收益率" value={pct(change(portfolio.initialCash, currentEquity))} valueClass={currentEquity >= portfolio.initialCash ? 'up-text' : 'down-text'} />
          <Metric label="已实现盈亏" value={`${(backendSummary?.realized_pnl ?? 0) >= 0 ? '+' : ''}${(backendSummary?.realized_pnl ?? 0).toFixed(2)}`} valueClass={(backendSummary?.realized_pnl ?? 0) >= 0 ? 'up-text' : 'down-text'} />
          <Metric label="后台成交记录" value={`${backendSummary?.trade_count ?? portfolio.trades.length} 笔`} />
        </div>
        <p>买入后系统只展示当时判断，不会提前揭晓未来。请通过“下一小时”或“下一交易日”推进行情。</p>
        <ul>
          <li>初始资金10万元，资金跨题连续。</li>
          <li>同一股票可多次买入，按100股成交。</li>
          <li>遵守T+1，清仓后才能进入下一题。</li>
        </ul>
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
      {advisor && <AdvisorPanel advisor={advisor} userChoice={userChoice} />}
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
