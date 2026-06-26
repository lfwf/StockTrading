import type { BaseCase } from '../types';

export interface TrainingDataset {
  source: string;
  generatedAt: string;
  quality?: {
    daily: 'real';
    totalCases: number;
    realStockIntradayCases: number;
    realIndexIntradayCases: number;
  };
  cases: BaseCase[];
}

export async function loadTrainingDataset(): Promise<TrainingDataset | null> {
  try {
    const response = await fetch('/data/training-cases.json', { cache: 'no-store' });
    if (!response.ok) return null;

    const dataset = (await response.json()) as TrainingDataset;
    if (!Array.isArray(dataset.cases) || dataset.cases.length === 0) return null;

    return dataset;
  } catch {
    return null;
  }
}

export function pickTrainingCase(cases: BaseCase[], seed: number): BaseCase | null {
  if (cases.length === 0) return null;
  return cases[Math.abs(seed) % cases.length];
}
