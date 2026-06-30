import { json } from '../http.mjs';
import {
  getInitialCaseBundle,
  getTrainingCaseById,
  getTrainingCaseSummary,
  pickNextTrainingCase,
} from '../repositories/trainingCasesRepo.mjs';

export async function handleTrainingCaseRoutes(pool, req, res, url) {
  if (req.method !== 'GET') return false;

  if (url.pathname === '/api/training-cases/summary') {
    const summary = await getTrainingCaseSummary(pool);
    if (!summary) return json(res, 404, { error: 'No training cases generated' });
    return json(res, 200, summary);
  }

  if (url.pathname === '/api/training-cases/next') {
    const result = await pickNextTrainingCase(pool, {
      phase: url.searchParams.get('phase'),
      presets: url.searchParams.get('presets') || url.searchParams.get('preset'),
      excludeId: url.searchParams.get('excludeId'),
      seed: url.searchParams.get('seed'),
    });
    if (!result) return json(res, 404, { error: 'No matching training case' });
    return json(res, 200, result);
  }

  const detailMatch = url.pathname.match(/^\/api\/training-cases\/([^/]+)$/);
  if (detailMatch) {
    const result = await getTrainingCaseById(pool, decodeURIComponent(detailMatch[1]));
    if (!result) return json(res, 404, { error: 'Training case not found' });
    return json(res, 200, result);
  }

  if (url.pathname === '/api/training-cases') {
    const bundle = await getInitialCaseBundle(pool);
    if (!bundle) return json(res, 404, { error: 'No training cases generated' });
    return json(res, 200, bundle);
  }

  return false;
}
