import type { OhlcvBar } from '../types';

export function pct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
}

export function moneyYi(value: number): string {
  return `${(value / 100_000_000).toFixed(1)}亿`;
}

export function formatVolume(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿手`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万手`;
  return `${Math.round(value)}手`;
}

export function ma(values: number[], windowSize: number): Array<number | null> {
  return values.map((_, index) => {
    if (index + 1 < windowSize) return null;
    const slice = values.slice(index + 1 - windowSize, index + 1);
    return slice.reduce((sum, item) => sum + item, 0) / windowSize;
  });
}

export function rollingHigh(bars: OhlcvBar[], windowSize: number): number {
  const slice = bars.slice(-windowSize);
  return Math.max(...slice.map((bar) => bar.high));
}

export function rollingLow(bars: OhlcvBar[], windowSize: number): number {
  const slice = bars.slice(-windowSize);
  return Math.min(...slice.map((bar) => bar.low));
}

export function change(from: number, to: number): number {
  if (!from) return 0;
  return to / from - 1;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

export function resampleBars(bars: OhlcvBar[], groupSize: number): OhlcvBar[] {
  const result: OhlcvBar[] = [];
  for (let i = 0; i < bars.length; i += groupSize) {
    const group = bars.slice(i, i + groupSize);
    if (group.length === 0) continue;
    result.push({
      date: group[group.length - 1].date,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group[group.length - 1].close,
      preClose: group[0].preClose,
      volume: group.reduce((sum, bar) => sum + bar.volume, 0),
      amount: group.reduce((sum, bar) => sum + bar.amount, 0),
      turnoverRate: average(group.map((bar) => bar.turnoverRate)),
    });
  }
  return result;
}

export function slope(values: Array<number | null>, lookback = 5): number {
  const valid = values.filter((item): item is number => item !== null);
  if (valid.length <= lookback) return 0;
  const latest = valid[valid.length - 1];
  const previous = valid[valid.length - 1 - lookback];
  return change(previous, latest);
}
