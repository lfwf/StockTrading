import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        database: process.env.PG_DATABASE ?? process.env.PGDATABASE ?? 'stock_trading',
        host: process.env.PGHOST ?? '/var/run/postgresql',
        user: process.env.PGUSER ?? process.env.USER ?? 'root',
      },
);

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      initial_cash REAL NOT NULL,
      current_cash REAL NOT NULL,
      current_equity REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
      trade_date TEXT NOT NULL,
      trade_time TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      amount REAL NOT NULL,
      realized_pnl REAL NOT NULL DEFAULT 0,
      cash_after REAL NOT NULL,
      equity_after REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_session_id_id ON trades(session_id, id DESC);

    CREATE TABLE IF NOT EXISTS training_case_runs (
      id BIGSERIAL PRIMARY KEY,
      generated_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      source TEXT NOT NULL,
      params_json JSONB NOT NULL,
      quality_json JSONB NOT NULL,
      error_text TEXT
    );

    CREATE TABLE IF NOT EXISTS training_cases (
      id TEXT PRIMARY KEY,
      phase TEXT NOT NULL CHECK (phase IN ('history', 'current')),
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      decision_date DATE NOT NULL,
      score DOUBLE PRECISION NOT NULL DEFAULT 0,
      tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      case_json JSONB NOT NULL,
      run_id BIGINT NOT NULL REFERENCES training_case_runs(id),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_training_cases_active_phase
      ON training_cases(active, phase, decision_date DESC);
    CREATE INDEX IF NOT EXISTS idx_training_cases_symbol
      ON training_cases(symbol);
    CREATE INDEX IF NOT EXISTS idx_training_cases_active_phase_score
      ON training_cases(active, phase, score DESC, decision_date DESC);
    CREATE INDEX IF NOT EXISTS idx_training_cases_tags_json
      ON training_cases USING GIN(tags_json);

    CREATE TABLE IF NOT EXISTS members (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      industry TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_bars (
      symbol TEXT NOT NULL,
      date DATE NOT NULL,
      open DOUBLE PRECISION NOT NULL,
      high DOUBLE PRECISION NOT NULL,
      low DOUBLE PRECISION NOT NULL,
      close DOUBLE PRECISION NOT NULL,
      pre_close DOUBLE PRECISION NOT NULL,
      volume BIGINT NOT NULL,
      amount BIGINT NOT NULL,
      turnover_rate DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (symbol, date)
    );

    CREATE TABLE IF NOT EXISTS minute_bars (
      symbol TEXT NOT NULL,
      date DATE NOT NULL,
      time TIME NOT NULL,
      price DOUBLE PRECISION NOT NULL,
      avg_price DOUBLE PRECISION NOT NULL,
      volume BIGINT NOT NULL,
      PRIMARY KEY (symbol, date, time)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_symbol_date ON daily_bars(symbol, date);
    CREATE INDEX IF NOT EXISTS idx_minute_symbol_date ON minute_bars(symbol, date);

    ALTER TABLE training_case_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
    ALTER TABLE training_case_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running';
    ALTER TABLE training_case_runs ADD COLUMN IF NOT EXISTS error_text TEXT;
  `);
}
