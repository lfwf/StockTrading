import type { BaseCase, DecisionChoice, ReviewResult, TimeMode } from '../types';
import { average, change } from '../lib/indicators';

export type TrainingPreset = 'random' | 'impulse' | 'breakout' | 'weak-market' | 'pullback' | 'mistakes';

export type DecisionChecklistState = {
  market: string;
  trend: string;
  setup: string;
  intraday: string;
  risk: string;
  motive: string;
};

export type MistakeItem = {
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

export const DEFAULT_CHECKLIST: DecisionChecklistState = {
  market: '未判断',
  trend: '未判断',
  setup: '看不懂',
  intraday: '未判断',
  risk: '未设置',
  motive: '未确认',
};

export const TRAINING_PRESETS: Array<{ key: TrainingPreset; title: string; desc: string }> = [
  { key: 'random', title: '随机训练', desc: '随机抽取样本，适合日常练习。' },
  { key: 'impulse', title: '追涨练习', desc: '高开、急涨、短线涨幅偏大的样本。' },
  { key: 'breakout', title: '突破判断', desc: '接近或突破近20日高点的样本。' },
  { key: 'weak-market', title: '弱势大盘', desc: '大盘走弱时的个股样本。' },
  { key: 'pullback', title: '回踩低吸', desc: '趋势仍在、但短线有回撤的样本。' },
  { key: 'mistakes', title: '错题复练', desc: '复看之前判断偏差较大的样本。' },
];

export const EDUCATION_BY_TAG: Record<string, { title: string; body: string; check: string }> = {
  短线追高: {
    title: '短线追高',
    body: '价格短期已经涨了一段，再追进去，后面的空间可能已经少了一截。先看它涨了多少，再决定要不要动手。',
    check: '下次先看近5日涨幅、距离20日高点的位置，以及成交量有没有继续放大。',
  },
  大周期逆势: {
    title: '大周期逆势',
    body: '日内反弹不一定代表趋势变好了。如果价格还在中期均线下方，这笔操作更像抢反弹。',
    check: '下次先看周K、月K和60日均线，确认大方向有没有配合。',
  },
  上午冲高回落: {
    title: '上午冲高回落',
    body: '上午快速拉升后又回落，说明高位承接可能不够。午间追进去，下午容易被反向波动影响。',
    check: '下次看价格能不能重新站回分时均价线，也要看成交量有没有跟上。',
  },
  收盘突破: {
    title: '收盘突破',
    body: '收盘突破通常比盘中一瞬间冲高更稳一些，但仍然要看成交量和大盘环境。',
    check: '下次同时看成交量、20日高点和沪深300当天表现。',
  },
  买入后回撤偏大: {
    title: '买入后回撤偏大',
    body: '就算后面赚钱，如果买入后先出现较大回撤，也说明入场位置可能不够舒服。',
    check: '下次模拟买入前，先写清楚大概错到哪里就不等了。',
  },
  主观冲动理由: {
    title: '理由太主观',
    body: '“感觉会涨”很难复盘。最好把感觉拆成几个能看到的条件，比如趋势、位置、量能、分时。',
    check: '下次至少写出两个具体依据，再考虑模拟买入。',
  },
  可能错过机会: {
    title: '可能错过机会',
    body: '未买入后上涨，不一定代表你错了，但说明这道题值得再看一次。重点是当时有没有漏掉明显信号。',
    check: '下次复查未买入时，有没有忽略放量、突破、相对大盘更强这些线索。',
  },
  放弃正确: {
    title: '这次未买入有效',
    body: '未买入后下跌，说明这次没有被盘面波动带着走。可以把当时让你跳过的信号记下来。',
    check: '下次遇到类似结构，可以对照这次的判断。',
  },
};

export function loadMistakes(): MistakeItem[] {
  try {
    const raw = localStorage.getItem('stock-trading-mistakes');
    return raw ? JSON.parse(raw) as MistakeItem[] : [];
  } catch {
    return [];
  }
}

export function checklistReasons(checklist: DecisionChecklistState): string[] {
  return [checklist.setup, checklist.intraday, checklist.trend, checklist.motive]
    .filter((item) => item && !item.includes('未') && item !== '看不懂');
}

export function caseMatchesPreset(item: BaseCase, preset: TrainingPreset, mistakes: MistakeItem[]): boolean {
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

export function caseMatchesAnyPreset(item: BaseCase, presets: TrainingPreset[], mistakes: MistakeItem[]): boolean {
  const active: TrainingPreset[] = presets.length ? presets : ['random'];
  if (active.includes('random')) return true;
  return active.some((preset) => caseMatchesPreset(item, preset, mistakes));
}

export function shouldRecordMistake(result: ReviewResult, action: DecisionChoice): boolean {
  if (action === 'buy') {
    return result.maxDrawdown <= -0.06 || (result.ret5 ?? 0) <= -0.04 || result.tags.includes('买入后回撤偏大') || result.tags.includes('主观冲动理由');
  }
  return (result.ret5 ?? 0) >= 0.06 || result.tags.includes('可能错过机会');
}

export function createMistakeItem(params: {
  baseCase: BaseCase;
  mode: TimeMode;
  action: DecisionChoice;
  result: ReviewResult;
  reason?: string;
  extraTags?: string[];
}): MistakeItem {
  const { baseCase, mode, action, result, reason, extraTags = [] } = params;
  return {
    id: `${baseCase.id}-${mode}-${action}`,
    caseId: baseCase.id,
    symbol: baseCase.stock.symbol,
    name: baseCase.stock.name,
    mode,
    action,
    date: baseCase.daily[baseCase.decisionIndex]?.date ?? '',
    tags: [...new Set([...result.tags, ...extraTags])],
    ret5: result.ret5,
    maxDrawdown: result.maxDrawdown,
    reason: reason ?? (action === 'buy' ? '买入后回撤或亏损偏大' : '未买入后上涨较多'),
    createdAt: new Date().toISOString(),
  };
}
