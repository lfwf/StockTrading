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
  { key: 'random', title: '随机盲盘', desc: '混合所有样本，保持真实随机性。' },
  { key: 'impulse', title: '冲动买入矫正', desc: '高开、急涨、短线涨幅偏大的样本。' },
  { key: 'breakout', title: '突破判断', desc: '接近或突破近20日高点的样本。' },
  { key: 'weak-market', title: '弱势大盘', desc: '沪深300阶段走弱时训练克制。' },
  { key: 'pullback', title: '回踩低吸', desc: '趋势仍在但短线回撤的样本。' },
  { key: 'mistakes', title: '只练错题', desc: '从你的错题本中反复抽题。' },
];

export const EDUCATION_BY_TAG: Record<string, { title: string; body: string; check: string }> = {
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
}): MistakeItem {
  const { baseCase, mode, action, result } = params;
  return {
    id: `${baseCase.id}-${mode}-${action}`,
    caseId: baseCase.id,
    symbol: baseCase.stock.symbol,
    name: baseCase.stock.name,
    mode,
    action,
    date: baseCase.daily[baseCase.decisionIndex]?.date ?? '',
    tags: result.tags,
    ret5: result.ret5,
    maxDrawdown: result.maxDrawdown,
    reason: action === 'buy' ? '买入后回撤或亏损偏大' : '放弃后上涨，可能错过机会',
    createdAt: new Date().toISOString(),
  };
}
