#!/usr/bin/env python3
"""Migrate existing local SQLite data into PostgreSQL.

This is a one-time bridge for deployments that started with SQLite. It imports
market data from data/market.db and trading records from data/trading.db if the
files exist. Inserts are idempotent through primary-key conflict handling.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.sync_market_db import ensure_schema  # noqa: E402


def connect(args: argparse.Namespace) -> psycopg.Connection[Any]:
    if args.database_url:
        return psycopg.connect(args.database_url, row_factory=dict_row)
    return psycopg.connect(
        dbname=args.db_name,
        host=args.db_host,
        user=args.db_user,
        row_factory=dict_row,
    )


def ensure_trading_schema(conn: psycopg.Connection[Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
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
            """
        )
    conn.commit()


def sqlite_table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
    return row is not None


def migrate_market(sqlite_path: Path, pg_conn: psycopg.Connection[Any], batch_size: int) -> None:
    if not sqlite_path.exists():
        print(f"skip market: {sqlite_path} not found")
        return

    src = sqlite3.connect(sqlite_path)
    src.row_factory = sqlite3.Row
    try:
        if sqlite_table_exists(src, "members"):
            rows = src.execute("SELECT symbol, name, market, industry, active, updated_at FROM members").fetchall()
            with pg_conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO members(symbol, name, market, industry, active, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT(symbol) DO UPDATE SET
                        name = excluded.name,
                        market = excluded.market,
                        industry = excluded.industry,
                        active = excluded.active,
                        updated_at = excluded.updated_at
                    """,
                    [(r["symbol"], r["name"], r["market"], r["industry"], bool(r["active"]), r["updated_at"]) for r in rows],
                )
            pg_conn.commit()
            print(f"migrated members={len(rows)}")

        if sqlite_table_exists(src, "daily_bars"):
            total = 0
            offset = 0
            while True:
                rows = src.execute(
                    """
                    SELECT symbol, date, open, high, low, close, pre_close, volume, amount, turnover_rate
                    FROM daily_bars ORDER BY symbol, date LIMIT ? OFFSET ?
                    """,
                    (batch_size, offset),
                ).fetchall()
                if not rows:
                    break
                with pg_conn.cursor() as cur:
                    cur.executemany(
                        """
                        INSERT INTO daily_bars(
                            symbol, date, open, high, low, close, pre_close, volume, amount, turnover_rate
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT(symbol, date) DO NOTHING
                        """,
                        [tuple(row) for row in rows],
                    )
                pg_conn.commit()
                total += len(rows)
                offset += len(rows)
                print(f"migrated daily_bars={total}", flush=True)

        if sqlite_table_exists(src, "minute_bars"):
            total = 0
            offset = 0
            while True:
                rows = src.execute(
                    """
                    SELECT symbol, date, time, price, avg_price, volume
                    FROM minute_bars ORDER BY symbol, date, time LIMIT ? OFFSET ?
                    """,
                    (batch_size, offset),
                ).fetchall()
                if not rows:
                    break
                with pg_conn.cursor() as cur:
                    cur.executemany(
                        """
                        INSERT INTO minute_bars(symbol, date, time, price, avg_price, volume)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT(symbol, date, time) DO NOTHING
                        """,
                        [tuple(row) for row in rows],
                    )
                pg_conn.commit()
                total += len(rows)
                offset += len(rows)
                print(f"migrated minute_bars={total}", flush=True)
    finally:
        src.close()


def migrate_trading(sqlite_path: Path, pg_conn: psycopg.Connection[Any], batch_size: int) -> None:
    if not sqlite_path.exists():
        print(f"skip trading: {sqlite_path} not found")
        return

    src = sqlite3.connect(sqlite_path)
    src.row_factory = sqlite3.Row
    try:
        if sqlite_table_exists(src, "sessions"):
            rows = src.execute(
                "SELECT id, initial_cash, current_cash, current_equity, created_at, updated_at FROM sessions"
            ).fetchall()
            with pg_conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO sessions(id, initial_cash, current_cash, current_equity, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT(id) DO UPDATE SET
                        current_cash = excluded.current_cash,
                        current_equity = excluded.current_equity,
                        updated_at = excluded.updated_at
                    """,
                    [tuple(row) for row in rows],
                )
            pg_conn.commit()
            print(f"migrated sessions={len(rows)}")

        if sqlite_table_exists(src, "trades"):
            total = 0
            offset = 0
            while True:
                rows = src.execute(
                    """
                    SELECT id, session_id, case_id, symbol, side, trade_date, trade_time,
                           price, quantity, amount, realized_pnl, cash_after, equity_after, created_at
                    FROM trades ORDER BY id LIMIT ? OFFSET ?
                    """,
                    (batch_size, offset),
                ).fetchall()
                if not rows:
                    break
                with pg_conn.cursor() as cur:
                    cur.executemany(
                        """
                        INSERT INTO trades(
                            id, session_id, case_id, symbol, side, trade_date, trade_time,
                            price, quantity, amount, realized_pnl, cash_after, equity_after, created_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT(id) DO NOTHING
                        """,
                        [tuple(row) for row in rows],
                    )
                pg_conn.commit()
                total += len(rows)
                offset += len(rows)
            with pg_conn.cursor() as cur:
                cur.execute("SELECT setval(pg_get_serial_sequence('trades', 'id'), COALESCE(MAX(id), 1), TRUE) FROM trades")
            pg_conn.commit()
            print(f"migrated trades={total}")
    finally:
        src.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate StockTrading SQLite data to PostgreSQL")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--db-name", default=os.environ.get("PGDATABASE", "stock_trading"))
    parser.add_argument("--db-host", default=os.environ.get("PGHOST", "/var/run/postgresql"))
    parser.add_argument("--db-user", default=os.environ.get("PGUSER", os.environ.get("USER", "root")))
    parser.add_argument("--market-sqlite", default="data/market.db")
    parser.add_argument("--trading-sqlite", default="data/trading.db")
    parser.add_argument("--batch-size", type=int, default=10000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    conn = connect(args)
    try:
        ensure_schema(conn)
        ensure_trading_schema(conn)
        migrate_market(ROOT / args.market_sqlite, conn, args.batch_size)
        migrate_trading(ROOT / args.trading_sqlite, conn, args.batch_size)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
