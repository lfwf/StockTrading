import type { BaseCase, IntradayPoint, OhlcvBar } from '../types';
import { caseMatchesAnyPreset, type MistakeItem, type TrainingPreset } from './learning';

export type TrainingPhase = 'history' | 'current';

export const TRAINING_PHASES: Array<{ key: TrainingPhase; title: string; desc: string }> = [
  { key: 'history', title: '随机历史阶段', desc: '随机抽取历史日期，适合盲测和错题训练。' },
  { key: 'current', title: '当前最新阶段', desc: '固定使用每只股票最新交易日，不随机日期。' },
];

export function getTrainingPhaseLabel(phase: TrainingPhase): string {
  return TRAINING_PHASES.find((item) => item.key === phase)?.title ?? '随机历史阶段';
}

function buildDailyFallbackIntraday(bar: OhlcvBar): IntradayPoint[] {
  const average1 = bar.open;
  const average2 = (bar.open + bar.high + bar.low) / 3;
  const average3 = (bar.open + bar.high + bar.low + bar.close) / 4;
  const baseVolume = Math.max(0, Math.round(bar.volume / 3));

  return [
    { time: '09:30', price: bar.open, avgPrice: average1, volume: baseVolume },
    { time: '11:30', price: (bar.high + bar.low) / 2, avgPrice: average2, volume: baseVolume },
    { time: '15:00', price: bar.close, avgPrice: average3, volume: Math.max(0, bar.volume - baseVolume * 2) },
  ];
}

export function toLatestCase(base: BaseCase): BaseCase {
  const latestIndex = Math.max(0, base.daily.length - 1);
  const latestBar = base.daily[latestIndex];
  const latestIntraday = base.intradayByDate?.[latestBar.date]
    ?? (base.decisionIndex === latestIndex ? base.fullIntraday : [])
    ?? [];
  const safeLatestIntraday = latestIntraday.length ? latestIntraday : buildDailyFallbackIntraday(latestBar);
  const sameDecisionDate = base.decisionIndex === latestIndex;

  return {
    ...base,
    id: `${base.stock.symbol}-latest-${latestBar.date}`,
    decisionIndex: latestIndex,
    fullIntraday: safeLatestIntraday,
    indexIntraday: sameDecisionDate ? base.indexIntraday : [],
    intradayByDate: {
      ...base.intradayByDate,
      [latestBar.date]: safeLatestIntraday,
    },
  };
}

export function getCasesForPhase(params: {
  cases: BaseCase[];
  phase: TrainingPhase;
  presets: TrainingPreset[];
  mistakes: MistakeItem[];
}): BaseCase[] {
  const { cases, phase, presets, mistakes } = params;
  const source = phase === 'current' ? cases.map(toLatestCase) : cases;
  return source.filter((item) => caseMatchesAnyPreset(item, presets, mistakes));
}
