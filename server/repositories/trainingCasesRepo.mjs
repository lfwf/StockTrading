function toIso(value) {
  return value instanceof Date ? value.toISOString() : (value ?? new Date().toISOString());
}

function normalizePreset(value) {
  const presets = Array.isArray(value) ? value : String(value || 'random').split(',');
  return presets.map((item) => item.trim()).filter(Boolean);
}

function presetToTags(presets) {
  const active = normalizePreset(presets);
  if (!active.length || active.includes('random')) return [];
  const tagMap = {
    impulse: ['impulse', 'gap', 'chase_high_risk'],
    breakout: ['breakout'],
    'weak-market': ['weak_market'],
    pullback: ['pullback'],
  };
  return active.flatMap((item) => tagMap[item] ?? []);
}

export async function getLatestCaseRun(pool) {
  const result = await pool.query(`
    SELECT id, generated_at, source, quality_json
    FROM training_case_runs
    WHERE status = 'ok'
    ORDER BY id DESC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function getTrainingCaseSummary(pool) {
  const run = await getLatestCaseRun(pool);
  if (!run) return null;
  const counts = await pool.query(`
    SELECT
      phase,
      COUNT(*)::int AS count,
      MAX(decision_date) AS latest_date,
      MIN(decision_date) AS earliest_date
    FROM training_cases
    WHERE active = TRUE AND run_id = $1
    GROUP BY phase
  `, [run.id]);
  const tags = await pool.query(`
    SELECT tag, COUNT(*)::int AS count
    FROM training_cases, jsonb_array_elements_text(tags_json) AS tags(tag)
    WHERE active = TRUE AND run_id = $1
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 30
  `, [run.id]);
  return {
    source: run.source,
    generatedAt: toIso(run.generated_at),
    quality: run.quality_json,
    counts: counts.rows,
    tags: tags.rows,
  };
}

export async function pickNextTrainingCase(pool, params = {}) {
  const run = await getLatestCaseRun(pool);
  if (!run) return null;

  const phase = params.phase === 'current' ? 'current' : 'history';
  const tags = presetToTags(params.presets || params.preset || 'random');
  const excludeId = params.excludeId || '';
  const randomSeed = Number.isFinite(Number(params.seed)) ? Number(params.seed) : Math.random();
  const values = [run.id, phase];
  const filters = ['active = TRUE', 'run_id = $1', 'phase = $2'];

  if (excludeId) {
    values.push(excludeId);
    filters.push(`id <> $${values.length}`);
  }
  if (tags.length) {
    values.push(tags);
    filters.push(`tags_json ?| $${values.length}::text[]`);
  }

  values.push(randomSeed);
  const seedIndex = values.length;

  let result = await pool.query(`
    SELECT case_json
    FROM training_cases
    WHERE ${filters.join(' AND ')}
    ORDER BY md5(id || $${seedIndex}::text)
    LIMIT 1
  `, values);

  if (!result.rows.length && tags.length) {
    result = await pool.query(`
      SELECT case_json
      FROM training_cases
      WHERE active = TRUE AND run_id = $1 AND phase = $2
      ORDER BY md5(id || $3::text)
      LIMIT 1
    `, [run.id, phase, randomSeed]);
  }

  const item = result.rows[0]?.case_json ?? null;
  if (!item) return null;
  return {
    source: run.source,
    generatedAt: toIso(run.generated_at),
    quality: run.quality_json,
    case: item,
  };
}

export async function getTrainingCaseById(pool, id) {
  const run = await getLatestCaseRun(pool);
  if (!run) return null;
  const result = await pool.query(`
    SELECT case_json
    FROM training_cases
    WHERE active = TRUE AND run_id = $1 AND id = $2
    LIMIT 1
  `, [run.id, id]);
  const item = result.rows[0]?.case_json ?? null;
  if (!item) return null;
  return {
    source: run.source,
    generatedAt: toIso(run.generated_at),
    quality: run.quality_json,
    case: item,
  };
}

export async function getInitialCaseBundle(pool) {
  const run = await getLatestCaseRun(pool);
  if (!run) return null;
  const cases = await pool.query(`
    SELECT phase, case_json
    FROM (
      SELECT phase, case_json,
             row_number() OVER (PARTITION BY phase ORDER BY decision_date DESC, score DESC) AS rn
      FROM training_cases
      WHERE active = TRUE AND run_id = $1
    ) ranked
    WHERE rn <= 8
    ORDER BY phase, rn
  `, [run.id]);
  const historyCases = [];
  const currentCases = [];
  for (const row of cases.rows) {
    if (row.phase === 'current') currentCases.push(row.case_json);
    else historyCases.push(row.case_json);
  }
  if (!historyCases.length && !currentCases.length) return null;
  return {
    source: run.source,
    generatedAt: toIso(run.generated_at),
    quality: run.quality_json,
    cases: historyCases,
    historyCases,
    currentCases,
  };
}
