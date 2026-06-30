export type BuyReasonKey = 'breakout' | 'pullback' | 'relative-strength' | 'intraday-strength' | 'small-test' | 'other';
export type NoBuyReasonKey = 'unclear' | 'market-weak' | 'position-high' | 'volume-weak' | 'intraday-weak' | 'outside-plan';
export type StopLossPlan = 3 | 5 | 8;

export const BUY_REASONS: Array<{ key: BuyReasonKey; label: string; desc: string }> = [
  { key: 'breakout', label: '突破买入', desc: '价格接近或突破关键高点' },
  { key: 'pullback', label: '回踩买入', desc: '趋势未坏，短线回落后观察承接' },
  { key: 'relative-strength', label: '相对强势', desc: '个股明显强于大盘或板块' },
  { key: 'intraday-strength', label: '分时转强', desc: '分时承接较好，站回均价线' },
  { key: 'small-test', label: '小仓试错', desc: '信号不完整，只做轻仓验证' },
  { key: 'other', label: '其他理由', desc: '暂时无法归类，但愿意记录下来复盘' },
];

export const NO_BUY_REASONS: Array<{ key: NoBuyReasonKey; label: string; desc: string }> = [
  { key: 'unclear', label: '看不懂', desc: '信号不够清晰，先跳过' },
  { key: 'market-weak', label: '大盘偏弱', desc: '市场环境不支持主动买入' },
  { key: 'position-high', label: '位置太高', desc: '担心追高或盈亏比不足' },
  { key: 'volume-weak', label: '量能不配合', desc: '成交量没有验证价格动作' },
  { key: 'intraday-weak', label: '分时偏弱', desc: '分时承接不够，容易冲高回落' },
  { key: 'outside-plan', label: '不符合模式', desc: '不在自己的交易计划内' },
];

export const STOP_LOSS_PLANS: StopLossPlan[] = [3, 5, 8];

export function buyReasonLabel(key: BuyReasonKey): string {
  return BUY_REASONS.find((item) => item.key === key)?.label ?? '其他理由';
}

export function noBuyReasonLabel(key: NoBuyReasonKey): string {
  return NO_BUY_REASONS.find((item) => item.key === key)?.label ?? '看不懂';
}
