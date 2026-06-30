#!/usr/bin/env python3
"""Sync benchmark index bars required by case generation.

The stock universe sync stores members. Case generation also needs a market
benchmark. We store沪深300 as symbol 000300 in daily_bars so scoring and charts
can use the same local database source.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import baostock as bs
import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.generate_training_cases import fetch_index_daily
from scripts.sync_market_db import date_chunks, fetch_baostock_minutes, upsert_minutes


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

            CREATE TABLE IF NOT EXISTS minute_bars (
                symbol TEXT NOT NULL,
                date DATE NOT NULL,
                time TIME NOT NULL,
                price DOUBLE PRECISION NOT NULL,
                avg_price DOUBLE PRECISION NOT NULL,
                volume BIGINT NOT NULL,
                PRIMARY KEY (symbol, date, time)
            );
            CREATE INDEX IF NOT EXISTS idx_minute_symbol_date ON minute_bars(symbol, date);
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
    parser.add_argument("--minute-start", default="20200101")
    parser.add_argument("--end-date", default=datetime.now().strftime("%Y%m%d"))
    parser.add_argument("--sync-minutes", action="store_true", help="also sync HS300 minute bars into minute_bars")
    parser.add_argument("--minute-frequency", default="5", choices=["5", "15", "30", "60"])
    parser.add_argument("--request-timeout", type=int, default=45, help="seconds before skipping a stuck BaoStock minute request; 0 disables")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    conn = connect(args)
    try:
        ensure_schema(conn)
        bars = fetch_index_daily(args.start_date, args.end_date)
        count = upsert_index_daily(conn, bars)
        print(f"synced benchmark 000300 daily bars={count}", flush=True)
        if args.sync_minutes:
            login = bs.login()
            if login.error_code != "0":
                raise RuntimeError(login.error_msg)
            try:
                minute_count = 0
                for chunk_start, chunk_end in date_chunks(args.minute_start, args.end_date):
                    rows = fetch_baostock_minutes("000300", chunk_start, chunk_end, args.minute_frequency, args.request_timeout)
                    minute_count += upsert_minutes(conn, rows)
                    print(f"synced benchmark 000300 minutes {chunk_start}-{chunk_end} rows={len(rows)}", flush=True)
                print(f"synced benchmark 000300 minute rows={minute_count}", flush=True)
            finally:
                bs.logout()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
