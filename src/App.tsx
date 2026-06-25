import { useEffect, useMemo, useState } from 'react';
import type { BaseCase, DecisionInput, HoldPlan, IntradayPoint, OhlcvBar, PositionSize, ReviewResult, TimeMode } from './types';
import { buildScenarioView, createBaseCase, createRandomMode, getModeLabel, nextMode } from './lib/market';
import { average, change, formatVolume, ma, moneyYi, pct, rollingHigh, rollingLow } from './lib/indicators';
import { reviewDecision, reviewSkip } from './lib/review';
import { loadTrainingDataset, pickTrainingCase } from './lib/dataset';

const HOLD_PLANS: HoldPlan[] = [1, 3, 5, 10, 20];
const POSITION_SIZES: PositionSize[] = [25, 50, 100];
const STOP_LOSSES = [3, 5, 8];
const REASON_TAGS = ['突破', '回踩', '低吸', '放量', '趋势确认', '分时转强', '感觉会涨'];
const TIME_MODES: TimeMode[] = ['open', 'noon', 'close'];

export default function App() {
  const [trainingCases, setTrainingCases] = useState<BaseCase[]>([]);
  const [dataStatus, setDataStatus] = useState('正在检查 AKShare 数据');
  const [baseCase, setBaseCase] = useState(() => createBaseCase());
  const [mode, setMode] = useState<TimeMode>(() => createRandomMode());
  const [showName, setShowName] = useState(false);
  const [positionSize, setPositionSize] = useState<PositionSize>(50);
  const [holdPlan, setHoldPlan] = useState<HoldPlan>(5);
  const [stopLossPct, setStopLossPct] = useState<number | null>(5);
  const [reasonTags, setReasonTags] = useState<string[]>([]);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const scenario = useMemo(() => buildScenarioView(baseCase, mode), [baseCase, mode]);

  useEffect(() => {
    let cancelled = false;

    loadTrainingDataset().then((dataset) => {
      if (cancelled) return;
      if (!dataset) {
        setDataStatus('模拟数据 · 运行 AKShare 脚本后自动切换');
        return;
      }

      const seed = Date.now() + Math.floor(Math.random() * 100000);
      const picked = pickTrainingCase(dataset.cases, seed);
      setTrainingCases(dataset.cases);
      setDataStatus(`${dataset.source} · ${dataset.cases.length}题 · ${dataset.generatedAt.slice(0, 10)}`);
      if (picked) {
        setBaseCase(picked);
        setMode(createRandomMode(seed));
        setReview(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

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
    setBaseCase(getNextBaseCase(seed));
    setMode(createRandomMode(seed));
    setReview(null);
    setReasonTags([]);
  }

  function switchMode(next: TimeMode) {
    setMode(next);
    setReview(null);
  }

  function toggleReason(tag: string) {
    setReasonTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  function buy() {
    const decision: DecisionInput = {
      choice: 'buy',
      positionSize,
      holdPlan,
      stopLossPct,
      reasonTags,
    };
    setReview(reviewDecision(scenario, decision));
  }

  function skip() {
    setReview(reviewSkip(scenario));
  }

  function observe() {
    const target = nextMode(mode);
    if (!target) {
      skip();
      return;
    }
    setMode(target);
    setReview(null);
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">盲盘训练 · A股买入决策挑战</p>
          <h1>回到历史某一刻，只看当时能看到的数据。</h1>
          <p className="hero-copy">历史走势看日K、周K、月K；当天走势看分时。系统隐藏未来，用真实的价格波动复盘你的买入冲动。</p>
        </div>
        <div className="hero-actions">
          <button className="ghost-btn" onClick={() => setShowName((value) => !value)}>{showName ? '隐藏股票名称' : '显示股票名称'}</button>
          <button className="primary-btn" onClick={() => resetTraining()}>下一题</button>
        </div>
      </header>

      <section className="status-bar">
        <StatusItem label="训练时间" value={getModeLabel(mode)} highlight />
        <StatusItem label="可见数据截止" value={scenario.visibleUntil} />
        <StatusItem label="股票" value={showName ? `${scenario.base.stock.name} ${scenario.base.stock.symbol}` : `已隐藏 · ${scenario.base.stock.industry}`} />
        <StatusItem label="模拟买入价" value={scenario.buyPrice.toFixed(2)} highlight />
        <StatusItem label="数据源" value={dataStatus} />
        <StatusItem label="未来数据" value="已隐藏" warning />
      </section>

      <section className="mode-row">
        <span>训练场景</span>
        {TIME_MODES.map((item) => (
          <button key={item} className={item === mode ? 'mode-btn active' : 'mode-btn'} onClick={() => switchMode(item)}>
            {getModeLabel(item)}
          </button>
        ))}
        <p>切换场景会重新限定“此刻可见数据”。开盘与午间不会展示当天完整日K。</p>
      </section>

      <main className="workspace">
        <section className="chart-grid">
          <div className="card chart-card large-chart">
            <ChartHeader title="历史日K · 主决策图" subtitle={mode === 'close' ? '收盘场景包含当日完整K线' : '只显示到昨日，避免泄露当天结果'} />
            <KLineChart bars={scenario.visibleDaily} />
          </div>

          <div className="mini-charts">
            <div className="card chart-card">
              <ChartHeader title="周K" subtitle="大周期方向" />
              <KLineChart bars={scenario.visibleWeekly} compact />
            </div>
            <div className="card chart-card">
              <ChartHeader title="月K" subtitle="长期位置" />
              <KLineChart bars={scenario.visibleMonthly} compact />
            </div>
          </div>
        </section>

        <aside className="side-panel">
          <div className="card chart-card">
            <ChartHeader title="当天分时" subtitle={mode === 'open' ? '只显示开盘点' : mode === 'noon' ? '显示上午 9:30-11:30' : '显示全天分时'} />
            <IntradayChart points={scenario.visibleIntraday} preClose={scenario.decisionBar.preClose} />
          </div>

          <div className="card quote-card">
            <h2>交易面板</h2>
            <div className="quote-price">
              <span>{scenario.buyPrice.toFixed(2)}</span>
              <b className={openChange >= 0 ? 'up-text' : 'down-text'}>{pct(openChange)}</b>
            </div>
            <div className="metric-grid">
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
            <h2>你的决策</h2>
            <div className="control-block">
              <label>仓位</label>
              <div className="segmented">
                {POSITION_SIZES.map((item) => (
                  <button key={item} className={positionSize === item ? 'active' : ''} onClick={() => setPositionSize(item)}>{item}%</button>
                ))}
              </div>
            </div>
            <div className="control-block">
              <label>计划持有</label>
              <div className="segmented">
                {HOLD_PLANS.map((item) => (
                  <button key={item} className={holdPlan === item ? 'active' : ''} onClick={() => setHoldPlan(item)}>{item}日</button>
                ))}
              </div>
            </div>
            <div className="control-block">
              <label>计划止损</label>
              <div className="segmented">
                {STOP_LOSSES.map((item) => (
                  <button key={item} className={stopLossPct === item ? 'active' : ''} onClick={() => setStopLossPct(item)}>-{item}%</button>
                ))}
                <button className={stopLossPct === null ? 'active' : ''} onClick={() => setStopLossPct(null)}>不设</button>
              </div>
            </div>
            <div className="control-block">
              <label>买入理由</label>
              <div className="tag-list">
                {REASON_TAGS.map((tag) => (
                  <button key={tag} className={reasonTags.includes(tag) ? 'tag active' : 'tag'} onClick={() => toggleReason(tag)}>{tag}</button>
                ))}
              </div>
            </div>
            <div className="decision-actions">
              <button className="buy-btn" onClick={buy}>买入</button>
              <button className="neutral-btn" onClick={observe}>{nextMode(mode) ? '再观察' : '收盘后放弃'}</button>
              <button className="skip-btn" onClick={skip}>放弃</button>
            </div>
          </div>
        </aside>
      </main>

      <section className="lower-grid">
        <div className="card market-card">
          <ChartHeader title="市场环境 · 沪深300" subtitle="用于判断个股是否顺应大盘" />
          <div className="market-content">
            <KLineChart bars={scenario.visibleIndexDaily} compact />
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

        <ReviewPanel review={review} mode={mode} onNext={() => resetTraining()} />
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

function KLineChart({ bars, compact = false }: { bars: OhlcvBar[]; compact?: boolean }) {
  const width = compact ? 420 : 760;
  const height = compact ? 210 : 370;
  const padding = compact ? 22 : 34;
  const volumeHeight = compact ? 42 : 74;
  const priceHeight = height - padding * 2 - volumeHeight - 18;
  const visibleBars = bars.slice(compact ? -36 : -70);
  const highs = visibleBars.map((bar) => bar.high);
  const lows = visibleBars.map((bar) => bar.low);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceRange = Math.max(maxPrice - minPrice, maxPrice * 0.02, 1);
  const maxVolume = Math.max(...visibleBars.map((bar) => bar.volume), 1);
  const step = (width - padding * 2) / Math.max(visibleBars.length, 1);
  const candleWidth = Math.max(3, Math.min(12, step * 0.58));
  const closes = visibleBars.map((bar) => bar.close);
  const ma5 = ma(closes, 5);
  const ma20 = ma(closes, 20);
  const ma60 = compact ? [] : ma(closes, 60);

  const y = (price: number) => padding + (maxPrice - price) / priceRange * priceHeight;
  const volumeY = (volume: number) => height - padding - (volume / maxVolume) * volumeHeight;
  const x = (index: number) => padding + index * step + step / 2;

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="K线图">
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
        <line key={ratio} className="grid-line" x1={padding} x2={width - padding} y1={padding + ratio * priceHeight} y2={padding + ratio * priceHeight} />
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
            <rect className={isUp ? 'volume up' : 'volume down'} x={x(index) - candleWidth / 2} y={volumeTop} width={candleWidth} height={height - padding - volumeTop} />
          </g>
        );
      })}
      <MaLine values={ma5} x={x} y={y} className="ma ma5" />
      <MaLine values={ma20} x={x} y={y} className="ma ma20" />
      {!compact && <MaLine values={ma60} x={x} y={y} className="ma ma60" />}
      <text className="axis-label" x={padding} y={height - 6}>{visibleBars[0]?.date}</text>
      <text className="axis-label right" x={width - padding} y={height - 6}>{visibleBars.at(-1)?.date}</text>
      <text className="axis-label right" x={width - padding} y={padding + 10}>{maxPrice.toFixed(2)}</text>
      <text className="axis-label right" x={width - padding} y={padding + priceHeight}>{minPrice.toFixed(2)}</text>
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
  const height = 260;
  const padding = 28;
  const prices = [...points.map((point) => point.price), ...points.map((point) => point.avgPrice), preClose];
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const range = Math.max(maxPrice - minPrice, maxPrice * 0.01, 1);
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  const priceHeight = 166;
  const volumeHeight = 44;
  const x = (index: number) => padding + index / Math.max(points.length - 1, 1) * (width - padding * 2);
  const y = (price: number) => padding + (maxPrice - price) / range * priceHeight;
  const volumeY = (volume: number) => height - padding - (volume / maxVolume) * volumeHeight;
  const pricePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(point.price).toFixed(2)}`).join(' ');
  const avgPath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(point.avgPrice).toFixed(2)}`).join(' ');

  return (
    <svg className="chart intraday" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="分时图">
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
        <line key={ratio} className="grid-line" x1={padding} x2={width - padding} y1={padding + ratio * priceHeight} y2={padding + ratio * priceHeight} />
      ))}
      <line className="pre-close-line" x1={padding} x2={width - padding} y1={y(preClose)} y2={y(preClose)} />
      {points.map((point, index) => (
        <rect key={`${point.time}-${index}`} className="volume neutral" x={x(index)} y={volumeY(point.volume)} width={Math.max(1, (width - padding * 2) / Math.max(points.length, 1) * 0.7)} height={height - padding - volumeY(point.volume)} />
      ))}
      {points.length === 1 ? <circle className="intraday-dot" cx={x(0)} cy={y(points[0].price)} r="5" /> : <path className="intraday-price" d={pricePath} fill="none" />}
      {points.length > 1 && <path className="intraday-average" d={avgPath} fill="none" />}
      <text className="axis-label" x={padding} y={height - 7}>{points[0]?.time}</text>
      <text className="axis-label right" x={width - padding} y={height - 7}>{points.at(-1)?.time}</text>
      <text className="axis-label right" x={width - padding} y={padding + 10}>{maxPrice.toFixed(2)}</text>
      <text className="axis-label right" x={width - padding} y={padding + priceHeight}>{minPrice.toFixed(2)}</text>
    </svg>
  );
}

function ReviewPanel({ review, mode, onNext }: { review: ReviewResult | null; mode: TimeMode; onNext: () => void }) {
  if (!review) {
    return (
      <div className="card review-card empty-review">
        <h2>复盘区</h2>
        <p>做出买入、放弃或再观察后，系统会揭晓后续走势。这里重点不是猜涨跌，而是识别你在哪类盘面最容易冲动。</p>
        <ul>
          <li>开盘：重点看当天是否被高开/低开影响。</li>
          <li>午间：重点看上午分时是否诱导追涨。</li>
          <li>收盘：重点看尾盘判断和隔日风险。</li>
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
    </div>
  );
}
