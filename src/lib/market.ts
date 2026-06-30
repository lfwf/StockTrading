import type { BaseCase, IntradayPoint, MarketCursor, ScenarioView, TimeMode } from '../types';
import { resampleBars } from './indicators';

const MODES: TimeMode[] = ['open', 'noon', 'close'];

function seededRandom(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
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
