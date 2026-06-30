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

export interface TrainingCaseResponse {
  source: string;
  generatedAt: string;
  quality?: TrainingDataset['quality'];
  case: BaseCase;
}

export interface TrainingCaseSummary {
  source: string;
  generatedAt: string;
  quality?: TrainingDataset['quality'];
  counts?: Array<{ phase: string; count: number; latest_date?: string; earliest_date?: string }>;
  tags?: Array<{ tag: string; count: number }>;
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
    const response = await fetch('/api/training-cases', { cache: 'no-store' });
    if (!response.ok) return null;

    const dataset = (await response.json()) as TrainingDataset;
    return normalizeDataset(dataset);
  } catch {
    return null;
  }
}

export async function loadTrainingCaseSummary(): Promise<TrainingCaseSummary | null> {
  try {
    const response = await fetch('/api/training-cases/summary', { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json() as TrainingCaseSummary;
  } catch {
    return null;
  }
}

export async function loadNextTrainingCase(params: {
  phase: 'history' | 'current';
  presets?: string[];
  excludeId?: string;
  seed?: number;
}): Promise<TrainingCaseResponse | null> {
  const query = new URLSearchParams();
  query.set('phase', params.phase);
  query.set('seed', String(params.seed ?? Date.now()));
  if (params.presets?.length) query.set('presets', params.presets.join(','));
  if (params.excludeId) query.set('excludeId', params.excludeId);
  try {
    const response = await fetch(`/api/training-cases/next?${query.toString()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json() as TrainingCaseResponse;
  } catch {
    return null;
  }
}

export function pickTrainingCase(cases: BaseCase[], seed: number): BaseCase | null {
  if (cases.length === 0) return null;
  return cases[Math.abs(seed) % cases.length];
}
