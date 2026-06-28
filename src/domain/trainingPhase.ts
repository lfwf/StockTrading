import type { BaseCase } from '../types';
import { caseMatchesAnyPreset, type MistakeItem, type TrainingPreset } from './learning';

export type TrainingPhase = 'history' | 'current';

export const TRAINING_PHASES: Array<{ key: TrainingPhase; title: string; desc: string }> = [
  { key: 'history', title: '随机历史阶段', desc: '随机抽取历史日期，适合盲测和错题训练。' },
  { key: 'current', title: '当前最新阶段', desc: '固定使用每只股票最新交易日，不随机日期。' },
];

export function getTrainingPhaseLabel(phase: TrainingPhase): string {
  return TRAINING_PHASES.find((item) => item.key === phase)?.title ?? '随机历史阶段';
}

export function toLatestCase(base: BaseCase): BaseCase {
  const latestIndex = Math.max(0, base.daily.length - 1);
  const latestBar = base.daily[latestIndex];
  const latestIntraday = base.intradayByDate?.[latestBar.date]
    ?? (base.decisionIndex === latestIndex ? base.fullIntraday : []);
  const sameDecisionDate = base.decisionIndex === latestIndex;

  return {
    ...base,
    id: `${base.stock.symbol}-latest-${latestBar.date}`,
    decisionIndex: latestIndex,
    fullIntraday: latestIntraday,
    indexIntraday: sameDecisionDate ? base.indexIntraday : [],
    intradayByDate: {
      ...base.intradayByDate,
      [latestBar.date]: latestIntraday,
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
