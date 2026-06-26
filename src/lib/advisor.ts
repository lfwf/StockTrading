import type { AdvisorEvidence, AdvisorResult, ScenarioView } from '../types';
import { average, change, ma, pct, rollingHigh, rollingLow, slope } from './indicators';

function latest(values: Array<number | null>): number | null {
  return values.at(-1) ?? null;
}

export function assessScenario(scenario: ScenarioView): AdvisorResult {
  const { visibleDaily, visibleIndexDaily, visibleIntraday, buyPrice, mode } = scenario;
  const closes = visibleDaily.map((bar) => bar.close);
  const ma20Values = ma(closes, 20);
  const ma60Values = ma(closes, 60);
  const ma20 = latest(ma20Values);
  const ma60 = latest(ma60Values);
  const high20 = rollingHigh(visibleDaily, Math.min(20, visibleDaily.length));
  const low20 = rollingLow(visibleDaily, Math.min(20, visibleDaily.length));
  const position20 = (buyPrice - low20) / Math.max(high20 - low20, buyPrice * 0.01);
  const intradayLast = visibleIntraday.at(-1);
  const intradayAverage = intradayLast?.avgPrice ?? buyPrice;
  const stockChange = change(scenario.decisionBar.preClose, buyPrice);
  const indexLast = scenario.visibleIndexIntraday.at(-1)?.price ?? visibleIndexDaily.at(-1)?.close ?? 0;
  const indexPreClose = mode === 'close'
    ? visibleIndexDaily.at(-1)?.preClose ?? 1
    : visibleIndexDaily.at(-1)?.close ?? 1;
  const indexChange = change(indexPreClose, indexLast);
  const priorVolumes = (mode === 'close' ? visibleDaily.slice(-21, -1) : visibleDaily.slice(-20)).map((bar) => bar.volume);
  const volumeAverage = average(priorVolumes);
  const currentVolume = mode === 'close'
    ? scenario.decisionBar.volume
    : visibleIntraday.reduce((sum, point) => sum + point.volume, 0);
  const expectedProgress = mode === 'open' ? 0.04 : mode === 'noon' ? 0.5 : 1;
  const volumeRatio = currentVolume / Math.max(volumeAverage * expectedProgress, 1);
  const dailyRanges = visibleDaily.slice(-20).map((bar) => (bar.high - bar.low) / Math.max(bar.preClose, 1));
  const averageRange = average(dailyRanges);

  let score = 0;
  const evidence: AdvisorEvidence[] = [];

  if (ma20 !== null && buyPrice > ma20 && slope(ma20Values) > 0) {
    score += 2;
    evidence.push({ category: '趋势', text: `价格位于20日均线上方，且均线向上（领先约 ${pct(change(ma20, buyPrice))}）`, tone: 'positive' });
  } else if (ma20 !== null && buyPrice < ma20 && slope(ma20Values) < 0) {
    score -= 2;
    evidence.push({ category: '趋势', text: `价格位于下行20日均线下方（落后约 ${pct(change(ma20, buyPrice))}）`, tone: 'negative' });
  } else {
    evidence.push({ category: '趋势', text: '价格与20日均线方向不一致，趋势信号不明确', tone: 'neutral' });
  }

  if (ma60 !== null && buyPrice > ma60) {
    score += 1;
    evidence.push({ category: '周期', text: '价格位于60日均线上方，中期结构偏强', tone: 'positive' });
  } else if (ma60 !== null) {
    score -= 1;
    evidence.push({ category: '周期', text: '价格位于60日均线下方，中期结构偏弱', tone: 'negative' });
  }

  if (position20 >= 0.92 && stockChange > 0.025) {
    score -= 1;
    evidence.push({ category: '位置', text: `接近20日高点且当下已上涨 ${pct(stockChange)}，追高风险增加`, tone: 'negative' });
  } else if (position20 >= 0.7) {
    score += 1;
    evidence.push({ category: '位置', text: '处于近20日区间上部，强势特征仍在', tone: 'positive' });
  } else if (position20 <= 0.25) {
    score -= 1;
    evidence.push({ category: '位置', text: '处于近20日区间下部，尚未确认止跌', tone: 'negative' });
  } else {
    evidence.push({ category: '位置', text: '处于近20日区间中部，位置优势有限', tone: 'neutral' });
  }

  if (mode !== 'open' && buyPrice > intradayAverage * 1.002) {
    score += 1;
    evidence.push({ category: '分时', text: `价格运行在分时均价线上方（约 ${pct(change(intradayAverage, buyPrice))}）`, tone: 'positive' });
  } else if (mode !== 'open' && buyPrice < intradayAverage * 0.998) {
    score -= 1;
    evidence.push({ category: '分时', text: `价格运行在分时均价线下方（约 ${pct(change(intradayAverage, buyPrice))}）`, tone: 'negative' });
  } else {
    evidence.push({ category: '分时', text: mode === 'open' ? '开盘信息较少，分时方向尚未形成' : '价格贴近分时均价，日内多空暂未拉开', tone: 'neutral' });
  }

  if (volumeRatio >= 1.35) {
    const positive = stockChange >= 0;
    score += positive ? 1 : -1;
    evidence.push({
      category: '量价',
      text: `成交进度约为常态的 ${volumeRatio.toFixed(2)} 倍，${positive ? '放量上涨' : '放量走弱'}`,
      tone: positive ? 'positive' : 'negative',
    });
  } else if (volumeRatio <= 0.7 && stockChange > 0.02) {
    score -= 1;
    evidence.push({ category: '量价', text: `上涨但成交进度仅约常态的 ${volumeRatio.toFixed(2)} 倍，跟进不足`, tone: 'negative' });
  } else {
    evidence.push({ category: '量价', text: `成交进度约为常态的 ${volumeRatio.toFixed(2)} 倍，量能未形成极端信号`, tone: 'neutral' });
  }

  const relativeStrength = stockChange - indexChange;
  if (relativeStrength > 0.012) {
    score += 1;
    evidence.push({ category: '大盘', text: `个股相对沪深300强约 ${pct(relativeStrength)}`, tone: 'positive' });
  } else if (relativeStrength < -0.012) {
    score -= 1;
    evidence.push({ category: '大盘', text: `个股相对沪深300弱约 ${pct(relativeStrength)}`, tone: 'negative' });
  } else {
    evidence.push({ category: '大盘', text: '个股与沪深300表现接近，暂无明显相对强弱', tone: 'neutral' });
  }

  const action = score >= 3 ? 'buy' : score >= 0 ? 'observe' : 'skip';
  const confidence = Math.abs(score) >= 5 ? '高' : Math.abs(score) >= 3 ? '中' : '低';
  const suggestedPosition = action === 'buy' ? (score >= 5 ? 50 : 25) : 0;
  const suggestedStopLossPct = action === 'buy'
    ? Math.round(Math.min(8, Math.max(3, averageRange * 100 * 1.4)) * 10) / 10
    : null;
  const trigger = action === 'buy'
    ? `若跌破分时均价并失守 ${Math.max(low20, buyPrice * (1 - (suggestedStopLossPct ?? 5) / 100)).toFixed(2)}，应停止或退出。`
    : `重新站上分时均价并突破近20日高点 ${high20.toFixed(2)}，同时成交量放大后再评估。`;
  const risk = position20 >= 0.85
    ? '当前靠近阶段高位，错误突破可能带来较快回撤。'
    : ma60 !== null && buyPrice < ma60
      ? '中期趋势尚未转强，反弹失败概率仍需重视。'
      : '当前没有单一压倒性信号，应严格控制仓位并执行止损。';

  return {
    action,
    confidence,
    score,
    suggestedPosition,
    suggestedStopLossPct,
    evidence,
    trigger,
    risk,
  };
}
