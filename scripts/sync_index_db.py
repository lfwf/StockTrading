#!/usr/bin/env python3
"""Sync benchmark index bars required by case generation.

The stock universe sync stores members. Case generation also needs a market
benchmark. We store沪深300 as symbol 000300 in daily_bars so scoring and charts
can use the same local database source.
"""

from __future__ import annotations

import argparse
import os
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from scripts.generate_training_cases import fetch_index_daily


def connect(args: argparse.Namespace) -> psycopg.Connection[Any]:
    if args.database_url:
        return psycopg.connect(args.database_url, row_factory=dict_row)
    return psycopg.connect(dbname=args.db_name, host=args.db_host, user=args.db_user, row_factory=dict_row)


def ensure_schema(conn: psycopg.Connection[Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
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
            CREATE INDEX IF NOT EXISTS idx_daily_symbol_date ON daily_bars(symbol, date);
            """
        )
    conn.commit()


def upsert_index_daily(conn: psycopg.Connection[Any], bars: list[dict[str, Any]]) -> int:
    if not bars:
        return 0
    rows = [
        (
            "000300",
            bar["date"],
            bar["open"],
            bar["high"],
            bar["low"],
            bar["close"],
            bar.get("preClose", bar["close"]),
            int(bar.get("volume", 0)),
            int(bar.get("amount", 0)),
            float(bar.get("turnoverRate", 0)),
        )
        for bar in bars
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO daily_bars(symbol, date, open, high, low, close, pre_close, volume, amount, turnover_rate)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(symbol, date) DO UPDATE SET
              open = excluded.open,
              high = excluded.high,
              low = excluded.low,
              close = excluded.close,
              pre_close = excluded.pre_close,
              volume = excluded.volume,
              amount = excluded.amount,
              turnover_rate = excluded.turnover_rate
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync HS300 benchmark index into daily_bars")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--db-name", default=os.environ.get("PGDATABASE", "stock_trading"))
    parser.add_argument("--db-host", default=os.environ.get("PGHOST", "/var/run/postgresql"))
    parser.add_argument("--db-user", default=os.environ.get("PGUSER", os.environ.get("USER", "root")))
    parser.add_argument("--start-date", default="20200101")
    parser.add_argument("--end-date", default=datetime.now().strftime("%Y%m%d"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    conn = connect(args)
    try:
        ensure_schema(conn)
        bars = fetch_index_daily(args.start_date, args.end_date)
        count = upsert_index_daily(conn, bars)
        print(f"synced benchmark 000300 daily bars={count}", flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
