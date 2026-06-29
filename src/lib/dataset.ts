import type { BaseCase } from '../types';

export interface TrainingDataset {
  source: string;
  generatedAt: string;
  quality?: {
    daily: 'real';
    totalCases: number;
    historyCases?: number;
    currentCases?: number;
    realStockIntradayCases: number;
    realIndexIntradayCases: number;
  };
  cases: BaseCase[];
  historyCases?: BaseCase[];
  currentCases?: BaseCase[];
}

function normalizeDataset(dataset: TrainingDataset): TrainingDataset | null {
  const historyCases = Array.isArray(dataset.historyCases) ? dataset.historyCases : dataset.cases;
  const currentCases = Array.isArray(dataset.currentCases) ? dataset.currentCases : [];
  const cases = historyCases.length ? historyCases : dataset.cases;
  if (!Array.isArray(cases) || cases.length === 0) return null;
  return {
    ...dataset,
    cases,
    historyCases: cases,
    currentCases,
  };
}

export async function loadTrainingDataset(): Promise<TrainingDataset | null> {
  try {
    const response = await fetch('/data/training-cases.json', { cache: 'no-store' });
    if (!response.ok) return null;

    const dataset = (await response.json()) as TrainingDataset;
    return normalizeDataset(dataset);
  } catch {
    return null;
  }
}

export function pickTrainingCase(cases: BaseCase[], seed: number): BaseCase | null {
  if (cases.length === 0) return null;
  return cases[Math.abs(seed) % cases.length];
}
