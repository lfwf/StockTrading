import type { BaseCase, IntradayPoint, MarketCursor, OhlcvBar, ScenarioView, StockMeta, TimeMode } from '../types';
import { resampleBars } from './indicators';

const STOCKS: StockMeta[] = [
  { symbol: '600519', name: '贵州茅台', market: '沪市', industry: '白酒', pe: 27.6, pb: 8.4, totalMarketCap: 1_900_000_000_000, floatMarketCap: 1_900_000_000_000 },
  { symbol: '300750', name: '宁德时代', market: '深市', industry: '电力设备', pe: 21.8, pb: 4.7, totalMarketCap: 780_000_000_000, floatMarketCap: 650_000_000_000 },
  { symbol: '600036', name: '招商银行', market: '沪市', industry: '银行', pe: 6.5, pb: 0.9, totalMarketCap: 900_000_000_000, floatMarketCap: 740_000_000_000 },
  { symbol: '000858', name: '五粮液', market: '深市', industry: '白酒', pe: 19.2, pb: 3.1, totalMarketCap: 500_000_000_000, floatMarketCap: 500_000_000_000 },
  { symbol: '601318', name: '中国平安', market: '沪市', industry: '非银金融', pe: 7.9, pb: 0.8, totalMarketCap: 820_000_000_000, floatMarketCap: 510_000_000_000 },
  { symbol: '600276', name: '恒瑞医药', market: '沪市', industry: '医药生物', pe: 42.3, pb: 5.5, totalMarketCap: 300_000_000_000, floatMarketCap: 300_000_000_000 },
];

const MODES: TimeMode[] = ['open', 'noon', 'close'];

function seededRandom(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function nextTradingDate(date: Date): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function generateDailyBars(seed: number, startPrice: number, count: number, startDate = new Date('2020-01-02')): OhlcvBar[] {
  const random = seededRandom(seed);
  const bars: OhlcvBar[] = [];
  let date = new Date(startDate);
  let preClose = startPrice;
  let trend = random() * 0.004 - 0.0015;

  for (let i = 0; i < count; i += 1) {
    if (i > 0) date = nextTradingDate(date);
    if (i % 55 === 0) trend = random() * 0.006 - 0.002;

    const eventPulse = i % 41 === 0 ? (random() - 0.45) * 0.09 : 0;
    const gap = clamp((random() - 0.5) * 0.035 + eventPulse * 0.25, -0.08, 0.08);
    const intradayMove = clamp(trend + (random() - 0.48) * 0.045 + eventPulse * 0.35, -0.095, 0.095);
    const open = round2(preClose * (1 + gap));
    const close = round2(Math.max(1, open * (1 + intradayMove)));
    const range = Math.abs(intradayMove) + 0.012 + random() * 0.035;
    const high = round2(Math.max(open, close) * (1 + range * (0.35 + random() * 0.65)));
    const low = round2(Math.min(open, close) * (1 - range * (0.35 + random() * 0.65)));
    const volume = Math.round((20_000_000 + random() * 90_000_000) * (1 + Math.abs(intradayMove) * 7));
    const amount = Math.round(volume * close * 100);
    const turnoverRate = round2(clamp(0.25 + random() * 3.8 + Math.abs(intradayMove) * 18, 0.1, 9.5));

    bars.push({
      date: formatDate(date),
      open,
      high,
      low,
      close,
      preClose: round2(preClose),
      volume,
      amount,
      turnoverRate,
    });
    preClose = close;
  }

  return bars;
}

function tradingMinutes(): string[] {
  const result: string[] = [];
  const appendRange = (hourStart: number, minuteStart: number, hourEnd: number, minuteEnd: number) => {
    const start = new Date(`2020-01-01T${String(hourStart).padStart(2, '0')}:${String(minuteStart).padStart(2, '0')}:00`);
    const end = new Date(`2020-01-01T${String(hourEnd).padStart(2, '0')}:${String(minuteEnd).padStart(2, '0')}:00`);
    for (let t = new Date(start); t <= end; t.setMinutes(t.getMinutes() + 1)) {
      result.push(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`);
    }
  };
  appendRange(9, 30, 11, 30);
  appendRange(13, 0, 15, 0);
  return result;
}

function generateIntraday(day: OhlcvBar, seed: number): IntradayPoint[] {
  const random = seededRandom(seed);
  const times = tradingMinutes();
  const points: IntradayPoint[] = [];
  let price = day.open;
  let amountSum = 0;
  let volumeSum = 0;

  times.forEach((time, index) => {
    const progress = index / Math.max(times.length - 1, 1);
    const target = day.open + (day.close - day.open) * progress;
    const wave = Math.sin(progress * Math.PI * 2.4 + random() * 0.8) * (day.high - day.low) * 0.06;
    const noise = (random() - 0.5) * Math.max(day.high - day.low, day.close * 0.015) * 0.12;
    price = clamp(price * 0.72 + (target + wave + noise) * 0.28, day.low, day.high);
    if (index === 0) price = day.open;
    if (index === times.length - 1) price = day.close;

    const volume = Math.round((day.volume / times.length) * (0.5 + random() * 1.7) * (index < 15 || index > times.length - 15 ? 1.8 : 1));
    volumeSum += volume;
    amountSum += volume * price;
    const avgPrice = amountSum / Math.max(volumeSum, 1);
    points.push({ time, price: round2(price), avgPrice: round2(avgPrice), volume });
  });

  return points;
}

function sliceIntraday(points: IntradayPoint[], mode: TimeMode): IntradayPoint[] {
  if (mode === 'open') return points.slice(0, 1);
  if (mode === 'noon') return points.filter((point) => point.time <= '11:30');
  return points;
}

function timeLabel(mode: TimeMode): string {
  if (mode === 'open') return '09:30';
  if (mode === 'noon') return '11:30';
  return '15:00';
}

export function getModeLabel(mode: TimeMode): string {
  if (mode === 'open') return '开盘 9:30';
  if (mode === 'noon') return '午间 11:30';
  return '收盘 15:00';
}

export function nextMode(mode: TimeMode): TimeMode | null {
  if (mode === 'open') return 'noon';
  if (mode === 'noon') return 'close';
  return null;
}

export function createBaseCase(seed = Date.now()): BaseCase {
  const random = seededRandom(seed);
  const stock = STOCKS[Math.floor(random() * STOCKS.length)];
  const startPrice = 18 + random() * 145;
  const daily = generateDailyBars(seed + stock.symbol.charCodeAt(0), startPrice, 190);
  const indexDaily = generateDailyBars(seed + 300300, 3800 + random() * 800, 190);
  const decisionIndex = 95 + Math.floor(random() * 55);
  const decisionBar = daily[decisionIndex];
  const indexDecisionBar = indexDaily[decisionIndex];
  return {
    id: `${stock.symbol}-${decisionBar.date}-${seed}`,
    stock,
    daily,
    indexDaily,
    decisionIndex,
    fullIntraday: generateIntraday(decisionBar, seed + 9000),
    indexIntraday: generateIntraday(indexDecisionBar, seed + 12000),
  };
}

export function createRandomMode(seed = Date.now()): TimeMode {
  const random = seededRandom(seed + 77);
  return MODES[Math.floor(random() * MODES.length)];
}

export function buildScenarioView(base: BaseCase, mode: TimeMode): ScenarioView {
  const decisionBar = base.daily[base.decisionIndex];
  const cutoffInclusive = mode === 'close' ? base.decisionIndex + 1 : base.decisionIndex;
  const visibleDaily = base.daily.slice(Math.max(0, cutoffInclusive - 70), cutoffInclusive);
  const visibleIndexDaily = base.indexDaily.slice(Math.max(0, cutoffInclusive - 70), cutoffInclusive);
  const visibleWeekly = resampleBars(base.daily.slice(0, cutoffInclusive), 5).slice(-52);
  const visibleMonthly = resampleBars(base.daily.slice(0, cutoffInclusive), 21).slice(-36);
  const visibleIntraday = sliceIntraday(base.fullIntraday, mode);
  const visibleIndexIntraday = sliceIntraday(base.indexIntraday, mode);
  const lastPoint = visibleIntraday[visibleIntraday.length - 1];
  const buyPrice = mode === 'open' ? decisionBar.open : mode === 'close' ? decisionBar.close : lastPoint.price;

  return {
    base,
    mode,
    visibleDaily,
    visibleWeekly,
    visibleMonthly,
    visibleIndexDaily,
    visibleIntraday,
    visibleIndexIntraday,
    decisionBar,
    buyPrice,
    visibleUntil: `${decisionBar.date} ${timeLabel(mode)}`,
  };
}

export function initialCursorForMode(base: BaseCase, mode: TimeMode): MarketCursor {
  const points = base.intradayByDate?.[base.daily[base.decisionIndex].date] ?? base.fullIntraday;
  if (mode === 'open') return { dayOffset: 0, pointIndex: 0 };
  if (mode === 'noon') {
    let noonIndex = 0;
    points.forEach((point, index) => {
      if (point.time <= '11:30') noonIndex = index;
    });
    return { dayOffset: 0, pointIndex: Math.max(0, noonIndex) };
  }
  return { dayOffset: 0, pointIndex: Math.max(0, points.length - 1) };
}

export function buildTradingScenarioView(base: BaseCase, cursor: MarketCursor): ScenarioView {
  const dailyIndex = Math.min(base.decisionIndex + cursor.dayOffset, base.daily.length - 1);
  const decisionBar = base.daily[dailyIndex];
  const points = base.intradayByDate?.[decisionBar.date]
    ?? (cursor.dayOffset === 0 ? base.fullIntraday : []);
  const pointIndex = Math.min(cursor.pointIndex, Math.max(points.length - 1, 0));
  const visibleIntraday = points.slice(0, pointIndex + 1);
  const safeVisibleIntraday = visibleIntraday.length
    ? visibleIntraday
    : [{ time: '09:30', price: decisionBar.open, avgPrice: decisionBar.open, volume: 0 }];
  const isClose = pointIndex >= points.length - 1 && points.length > 0;
  const cutoffInclusive = isClose ? dailyIndex + 1 : dailyIndex;
  const visibleDaily = base.daily.slice(Math.max(0, cutoffInclusive - 70), cutoffInclusive);
  const visibleIndexDaily = base.indexDaily.slice(Math.max(0, cutoffInclusive - 70), cutoffInclusive);
  const visibleWeekly = resampleBars(base.daily.slice(0, cutoffInclusive), 5).slice(-52);
  const visibleMonthly = resampleBars(base.daily.slice(0, cutoffInclusive), 21).slice(-36);
  const currentPoint = safeVisibleIntraday.at(-1);
  const buyPrice = currentPoint?.price ?? decisionBar.open;
  const mode: TimeMode = pointIndex === 0 ? 'open' : isClose ? 'close' : 'noon';

  return {
    base,
    mode,
    visibleDaily,
    visibleWeekly,
    visibleMonthly,
    visibleIndexDaily,
    visibleIntraday: safeVisibleIntraday,
    visibleIndexIntraday: cursor.dayOffset === 0
      ? sliceIntraday(base.indexIntraday, mode)
      : [],
    decisionBar,
    buyPrice,
    visibleUntil: `${decisionBar.date} ${currentPoint?.time ?? '09:30'}`,
  };
}
