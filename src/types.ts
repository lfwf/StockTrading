export type TimeMode = 'open' | 'noon' | 'close';
export type DecisionChoice = 'buy' | 'skip';
export type HoldPlan = 1 | 3 | 5 | 10 | 20;
export type PositionSize = 25 | 50 | 100;

export interface StockMeta {
  symbol: string;
  name: string;
  market: '沪市' | '深市';
  industry: string;
  pe: number;
  pb: number;
  totalMarketCap: number;
  floatMarketCap: number;
}

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  preClose: number;
  volume: number;
  amount: number;
  turnoverRate: number;
}

export interface IntradayPoint {
  time: string;
  price: number;
  avgPrice: number;
  volume: number;
}

export interface BaseCase {
  id: string;
  stock: StockMeta;
  daily: OhlcvBar[];
  indexDaily: OhlcvBar[];
  decisionIndex: number;
  fullIntraday: IntradayPoint[];
  indexIntraday: IntradayPoint[];
  intradayByDate?: Record<string, IntradayPoint[]>;
}

export interface ScenarioView {
  base: BaseCase;
  mode: TimeMode;
  visibleDaily: OhlcvBar[];
  visibleWeekly: OhlcvBar[];
  visibleMonthly: OhlcvBar[];
  visibleIndexDaily: OhlcvBar[];
  visibleIntraday: IntradayPoint[];
  visibleIndexIntraday: IntradayPoint[];
  decisionBar: OhlcvBar;
  buyPrice: number;
  visibleUntil: string;
}

export interface DecisionInput {
  choice: DecisionChoice;
  positionSize: PositionSize;
  holdPlan: HoldPlan;
  stopLossPct: number | null;
  reasonTags: string[];
}

export interface ReviewResult {
  entryPrice: number;
  retClose?: number;
  retNextOpen?: number;
  ret1: number | null;
  ret3: number | null;
  ret5: number | null;
  ret10: number | null;
  ret20: number | null;
  maxProfit: number;
  maxDrawdown: number;
  relativeRet20: number | null;
  triggerStopLoss: boolean;
  tags: string[];
  summary: string;
}

export type AdvisorAction = 'buy' | 'observe' | 'skip';
export type AdvisorConfidence = '低' | '中' | '高';

export interface AdvisorEvidence {
  category: string;
  text: string;
  tone: 'positive' | 'neutral' | 'negative';
}

export interface AdvisorResult {
  action: AdvisorAction;
  confidence: AdvisorConfidence;
  score: number;
  suggestedPosition: 0 | 25 | 50;
  suggestedStopLossPct: number | null;
  evidence: AdvisorEvidence[];
  trigger: string;
  risk: string;
}

export interface MarketCursor {
  dayOffset: number;
  pointIndex: number;
}

export interface PositionLot {
  id: string;
  quantity: number;
  price: number;
  date: string;
  time: string;
}

export interface SimTrade {
  id: string;
  caseId: string;
  symbol: string;
  side: 'buy' | 'sell';
  date: string;
  time: string;
  price: number;
  quantity: number;
  amount: number;
  realizedPnl: number;
}

export interface PortfolioState {
  sessionId: string;
  initialCash: number;
  cash: number;
  lots: PositionLot[];
  trades: SimTrade[];
}
