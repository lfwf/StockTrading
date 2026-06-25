import type { DecisionInput, ReviewResult, ScenarioView } from '../types';
import { change, ma, pct, rollingHigh, slope } from './indicators';

function getReturn(price: number | undefined, entry: number): number | null {
  if (!price) return null;
  return change(entry, price);
}

function describeRet(value: number | null): string {
  if (value === null) return '--';
  return pct(value);
}

export function reviewDecision(scenario: ScenarioView, decision: DecisionInput): ReviewResult {
  const { base, mode, buyPrice, visibleDaily, decisionBar } = scenario;
  const entryIndex = base.decisionIndex;
  const future = base.daily.slice(entryIndex, Math.min(base.daily.length, entryIndex + 21));
  const indexFuture = base.indexDaily.slice(entryIndex, Math.min(base.indexDaily.length, entryIndex + 21));
  const closes = visibleDaily.map((bar) => bar.close);
  const ma20 = ma(closes, 20);
  const ma60 = ma(closes, 60);
  const previousFive = visibleDaily.slice(-5);
  const previousFiveRet = previousFive.length >= 2 ? change(previousFive[0].close, previousFive[previousFive.length - 1].close) : 0;
  const high60 = visibleDaily.length >= 20 ? rollingHigh(visibleDaily, Math.min(60, visibleDaily.length)) : decisionBar.high;
  const drawdownFromHigh = change(high60, buyPrice);

  const dayCloseRet = mode === 'open' || mode === 'noon' ? getReturn(decisionBar.close, buyPrice) : undefined;
  const nextBar = base.daily[entryIndex + 1];
  const retNextOpen = mode === 'close' ? getReturn(nextBar?.open, buyPrice) : undefined;
  const ret1 = getReturn(base.daily[entryIndex + 1]?.close, buyPrice);
  const ret3 = getReturn(base.daily[entryIndex + 3]?.close, buyPrice);
  const ret5 = getReturn(base.daily[entryIndex + 5]?.close, buyPrice);
  const ret10 = getReturn(base.daily[entryIndex + 10]?.close, buyPrice);
  const ret20 = getReturn(base.daily[entryIndex + 20]?.close, buyPrice);

  const maxHigh = Math.max(...future.map((bar) => bar.high));
  const minLow = Math.min(...future.map((bar) => bar.low));
  const maxProfit = change(buyPrice, maxHigh);
  const maxDrawdown = change(buyPrice, minLow);

  const indexEntry = indexFuture[0]?.close;
  const indexRet20 = indexEntry && indexFuture[20] ? change(indexEntry, indexFuture[20].close) : null;
  const relativeRet20 = ret20 !== null && indexRet20 !== null ? ret20 - indexRet20 : null;
  const triggerStopLoss = decision.stopLossPct !== null ? maxDrawdown <= -Math.abs(decision.stopLossPct) / 100 : false;

  const latestMa20 = ma20[ma20.length - 1];
  const latestMa60 = ma60[ma60.length - 1];
  const tags: string[] = [];

  if (previousFiveRet > 0.1 && drawdownFromHigh > -0.05) tags.push('短线追高');
  if (latestMa20 && latestMa60 && buyPrice < latestMa20 && buyPrice < latestMa60) tags.push('大周期逆势');
  if (latestMa20 && buyPrice > latestMa20 && slope(ma20) > 0) tags.push('日线趋势偏强');
  if (mode === 'noon') {
    const points = scenario.visibleIntraday;
    const first = points[0]?.price ?? buyPrice;
    const last = points[points.length - 1]?.price ?? buyPrice;
    const high = Math.max(...points.map((point) => point.price));
    if (change(first, high) > 0.035 && change(high, last) < -0.02) tags.push('上午冲高回落');
    if (change(first, last) > 0.025) tags.push('上午分时转强');
  }
  if (mode === 'open' && change(decisionBar.preClose, decisionBar.open) > 0.03) tags.push('高开决策');
  if (mode === 'open' && change(decisionBar.preClose, decisionBar.open) < -0.03) tags.push('低开决策');
  if (mode === 'close' && decisionBar.close > Math.max(...visibleDaily.slice(-21, -1).map((bar) => bar.high))) tags.push('收盘突破');
  if (maxDrawdown < -0.08) tags.push('买入后回撤偏大');
  if (relativeRet20 !== null && relativeRet20 > 0) tags.push('跑赢沪深300');
  if (relativeRet20 !== null && relativeRet20 < 0) tags.push('弱于沪深300');
  if (triggerStopLoss) tags.push('触发计划止损');
  if (decision.reasonTags.includes('感觉会涨')) tags.push('主观冲动理由');

  const summary = buildSummary(mode, ret5, ret20, maxDrawdown, tags);

  return {
    entryPrice: buyPrice,
    retClose: dayCloseRet,
    retNextOpen,
    ret1,
    ret3,
    ret5,
    ret10,
    ret20,
    maxProfit,
    maxDrawdown,
    relativeRet20,
    triggerStopLoss,
    tags: tags.length ? tags : ['中性样本'],
    summary,
  };
}

function buildSummary(mode: string, ret5: number | null, ret20: number | null, maxDrawdown: number, tags: string[]): string {
  const modeText = mode === 'open' ? '开盘' : mode === 'noon' ? '午间' : '收盘';
  const riskText = maxDrawdown < -0.08 ? '买入后承受了较大回撤，说明入场位置不舒服。' : '买入后回撤相对可控。';
  const performance = ret20 !== null ? `20日结果为 ${describeRet(ret20)}` : `5日结果为 ${describeRet(ret5)}`;
  const tagText = tags.slice(0, 3).join('、') || '无明显异常标签';
  return `${modeText}决策样本，${performance}。主要标签：${tagText}。${riskText}`;
}

export function reviewSkip(scenario: ScenarioView): ReviewResult {
  const { base, buyPrice, mode } = scenario;
  const entryIndex = base.decisionIndex;
  const ret5 = getReturn(base.daily[entryIndex + 5]?.close, buyPrice);
  const ret20 = getReturn(base.daily[entryIndex + 20]?.close, buyPrice);
  const future = base.daily.slice(entryIndex, Math.min(base.daily.length, entryIndex + 21));
  const maxHigh = Math.max(...future.map((bar) => bar.high));
  const minLow = Math.min(...future.map((bar) => bar.low));
  const maxProfit = change(buyPrice, maxHigh);
  const maxDrawdown = change(buyPrice, minLow);
  const tags = ret5 !== null && ret5 > 0.06 ? ['放弃后上涨', '可能错过机会'] : ret5 !== null && ret5 < -0.04 ? ['放弃正确', '规避回撤'] : ['放弃后变化不大'];
  const modeText = mode === 'open' ? '开盘' : mode === 'noon' ? '午间' : '收盘';

  return {
    entryPrice: buyPrice,
    ret1: getReturn(base.daily[entryIndex + 1]?.close, buyPrice),
    ret3: getReturn(base.daily[entryIndex + 3]?.close, buyPrice),
    ret5,
    ret10: getReturn(base.daily[entryIndex + 10]?.close, buyPrice),
    ret20,
    maxProfit,
    maxDrawdown,
    relativeRet20: null,
    triggerStopLoss: false,
    tags,
    summary: `${modeText}选择放弃，后续5日结果为 ${describeRet(ret5)}，20日结果为 ${describeRet(ret20)}。这类样本用于判断你是谨慎，还是错过强势机会。`,
  };
}
