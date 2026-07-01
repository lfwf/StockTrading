import type { BaseCase, PortfolioState, ScenarioView } from '../types';
import { average, change, rollingHigh, rollingLow } from '../lib/indicators';
import { averageCost, equity, positionQuantity, sellableQuantity } from '../lib/trading';
import { type MistakeItem, type TrainingPreset } from './learning';
import { getCasesForPhase, type TrainingPhase } from './trainingPhase';

function getBootstrapEquity(portfolio: PortfolioState, trainingPhase: TrainingPhase): number | null {
  try {
    const saved = Number(localStorage.getItem(`stock-trading-last-equity-${trainingPhase}`));
    if (Number.isFinite(saved) && saved > 0) return saved;
  } catch {
    // localStorage can be unavailable in non-browser runtimes.
  }

  if (!portfolio.lots.length) return portfolio.cash;
  const costValue = portfolio.lots.reduce((sum, lot) => sum + lot.price * lot.quantity, 0);
  return portfolio.cash + costValue;
}

export function computeTrainerMetrics(params: {
  scenario: ScenarioView;
  portfolio: PortfolioState;
  trainingCases: BaseCase[];
  trainingPresets: TrainingPreset[];
  trainingPhase: TrainingPhase;
  mistakes: MistakeItem[];
}) {
  const { scenario, portfolio, trainingCases, trainingPresets, trainingPhase, mistakes } = params;
  const currentDate = scenario.decisionBar.date;
  const currentTime = scenario.visibleIntraday.at(-1)?.time ?? '09:30';
  const heldQuantity = positionQuantity(portfolio);
  const availableQuantity = sellableQuantity(portfolio, currentDate);
  const calculatedEquity = equity(portfolio, scenario.buyPrice);
  const currentEquity = trainingCases.length === 0 ? getBootstrapEquity(portfolio, trainingPhase) ?? calculatedEquity : calculatedEquity;
  const cost = averageCost(portfolio);
  const isBankrupt = currentEquity <= 0.01;
  const intradayPrices = scenario.visibleIntraday.map((point) => point.price);
  const intradayHigh = intradayPrices.length ? Math.max(...intradayPrices) : scenario.buyPrice;
  const intradayLow = intradayPrices.length ? Math.min(...intradayPrices) : scenario.buyPrice;
  const intradayVolume = scenario.visibleIntraday.reduce((sum, point) => sum + point.volume, 0);
  const openChange = change(scenario.decisionBar.preClose, scenario.buyPrice);
  const visibleHigh20 = rollingHigh(scenario.visibleDaily, Math.min(20, scenario.visibleDaily.length));
  const visibleLow20 = rollingLow(scenario.visibleDaily, Math.min(20, scenario.visibleDaily.length));
  const visibleHigh60 = rollingHigh(scenario.visibleDaily, Math.min(60, scenario.visibleDaily.length));
  const volumeMa20 = average(scenario.visibleDaily.slice(-20).map((bar) => bar.volume));
  const indexLast = scenario.visibleIndexIntraday.at(-1)?.price ?? scenario.visibleIndexDaily.at(-1)?.close ?? 0;
  const indexPreClose = scenario.visibleIndexDaily.at(-1)?.preClose ?? scenario.visibleIndexDaily.at(-1)?.close ?? 1;
  const indexChange = change(indexPreClose, indexLast);
  const filteredCount = getCasesForPhase({ cases: trainingCases, phase: trainingPhase, presets: trainingPresets, mistakes }).length;

  return {
    currentDate,
    currentTime,
    heldQuantity,
    availableQuantity,
    currentEquity,
    cost,
    isBankrupt,
    intradayHigh,
    intradayLow,
    intradayVolume,
    openChange,
    visibleHigh20,
    visibleLow20,
    visibleHigh60,
    volumeMa20,
    indexChange,
    filteredCount,
  };
}

export type TrainerMetrics = ReturnType<typeof computeTrainerMetrics>;
