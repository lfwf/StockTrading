#!/usr/bin/env python3
"""Sync A-share index-universe market data into PostgreSQL.

The job keeps a reusable local market database:

    - current index-universe members
    - adjusted daily bars from listing date when available
    - BaoStock 5-minute bars from the free historical minute coverage window

The sync is incremental. For existing symbols, it re-fetches from the last
stored date so delayed or partial latest bars are replaced on the next run.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import time
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

import baostock as bs
import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.sync_akshare import (  # noqa: E402
    BAOSTOCK_LOGGED_IN,
    baostock_code,
    fetch_stock_daily,
    fetch_universe_members,
    number,
)


DATE_FMT = "%Y%m%d"


def compact_date(value: str | date) -> str:
    return str(value).replace("-", "")


def dashed_date(value: str | date) -> str:
    text = str(value)
    if "-" in text:
        return text
    return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"


def now_text() -> str:
    return datetime.now().isoformat(timespec="seconds")


@contextmanager
def process_lock(path: Path) -> Iterable[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise SystemExit(f"market sync already running, lock={path}") from exc
        yield


def connect(args: argparse.Namespace) -> psycopg.Connection[Any]:
    if args.database_url:
        return psycopg.connect(args.database_url, row_factory=dict_row)
    return psycopg.connect(
        dbname=args.db_name,
        host=args.db_host,
        user=args.db_user,
        row_factory=dict_row,
    )


def ensure_schema(conn: psycopg.Connection[Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
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

            CREATE TABLE IF NOT EXISTS sync_runs (
                id BIGSERIAL PRIMARY KEY,
                started_at TIMESTAMPTZ NOT NULL,
                finished_at TIMESTAMPTZ,
                status TEXT NOT NULL,
                members_total INTEGER NOT NULL DEFAULT 0,
                daily_rows BIGINT NOT NULL DEFAULT 0,
                minute_rows BIGINT NOT NULL DEFAULT 0,
                errors_json JSONB NOT NULL DEFAULT '[]'::jsonb
            );

            CREATE INDEX IF NOT EXISTS idx_daily_symbol_date
                ON daily_bars(symbol, date);
            CREATE INDEX IF NOT EXISTS idx_minute_symbol_date
                ON minute_bars(symbol, date);
            """
        )
    conn.commit()


def begin_run(conn: psycopg.Connection[Any]) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sync_runs
               SET finished_at = COALESCE(finished_at, now()),
                   status = 'interrupted'
             WHERE status = 'running'
            """
        )
        cur.execute(
            "INSERT INTO sync_runs(started_at, status) VALUES (now(), %s) RETURNING id",
            ("running",),
        )
        run_id = int(cur.fetchone()["id"])
    conn.commit()
    return run_id


def finish_run(
    conn: psycopg.Connection[Any],
    run_id: int,
    status: str,
    members_total: int,
    daily_rows: int,
    minute_rows: int,
    errors: list[dict[str, Any]],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sync_runs
               SET finished_at = now(),
                   status = %s,
                   members_total = %s,
                   daily_rows = %s,
                   minute_rows = %s,
                   errors_json = %s::jsonb
             WHERE id = %s
            """,
            (
                status,
                members_total,
                daily_rows,
                minute_rows,
                json.dumps(errors[-200:], ensure_ascii=False),
                run_id,
            ),
        )
    conn.commit()


def max_date(conn: psycopg.Connection[Any], table: str, symbol: str) -> date | None:
    if table not in {"daily_bars", "minute_bars"}:
        raise ValueError(f"invalid table: {table}")
    with conn.cursor() as cur:
        cur.execute(f"SELECT MAX(date) AS value FROM {table} WHERE symbol = %s", (symbol,))
        row = cur.fetchone()
    return row["value"] if row and row["value"] else None


def upsert_members(conn: psycopg.Connection[Any], members: list[Any], replace_active: bool) -> None:
    rows = [
        (member.symbol, member.name, member.market, member.industry)
        for member in members
    ]
    with conn.cursor() as cur:
        if replace_active:
            cur.execute("UPDATE members SET active = FALSE")
        cur.executemany(
            """
            INSERT INTO members(symbol, name, market, industry, active, updated_at)
            VALUES (%s, %s, %s, %s, TRUE, now())
            ON CONFLICT(symbol) DO UPDATE SET
                name = excluded.name,
                market = excluded.market,
                industry = excluded.industry,
                active = TRUE,
                updated_at = excluded.updated_at
            """,
            rows,
        )
    conn.commit()


def upsert_daily(conn: psycopg.Connection[Any], symbol: str, bars: list[dict[str, Any]]) -> int:
    if not bars:
        return 0
    rows = [
        (
            symbol,
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
            INSERT INTO daily_bars(
                symbol, date, open, high, low, close, pre_close, volume, amount, turnover_rate
            )
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


def ensure_baostock_login() -> bool:
    _ = BAOSTOCK_LOGGED_IN
    result = bs.login()
    return result.error_code == "0"


def fetch_baostock_minutes(symbol: str, start_date: str, end_date: str, frequency: str) -> list[tuple[Any, ...]]:
    result = bs.query_history_k_data_plus(
        baostock_code(symbol),
        "date,time,open,high,low,close,volume,amount",
        start_date=dashed_date(start_date),
        end_date=dashed_date(end_date),
        frequency=frequency,
        adjustflag="2",
    )
    if result.error_code != "0":
        raise RuntimeError(result.error_msg)

    rows: list[tuple[Any, ...]] = []
    current_date = ""
    weighted_sum = 0.0
    volume_sum = 0.0
    while result.next():
        item = dict(zip(result.fields, result.get_row_data()))
        row_date = str(item.get("date", ""))
        raw_time = str(item.get("time", ""))
        price = number(item.get("close"))
        volume = number(item.get("volume"))
        if row_date != current_date:
            current_date = row_date
            weighted_sum = 0.0
            volume_sum = 0.0
        weighted_sum += price * volume
        volume_sum += volume
        avg_price = weighted_sum / volume_sum if volume_sum else price
        rows.append(
            (
                symbol,
                row_date,
                f"{raw_time[8:10]}:{raw_time[10:12]}",
                round(price, 3),
                round(avg_price, 3),
                int(volume),
            )
        )
    return rows


def upsert_minutes(conn: psycopg.Connection[Any], rows: list[tuple[Any, ...]]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO minute_bars(symbol, date, time, price, avg_price, volume)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT(symbol, date, time) DO UPDATE SET
                price = excluded.price,
                avg_price = excluded.avg_price,
                volume = excluded.volume
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def parse_symbols(value: str) -> set[str]:
    return {item.strip().zfill(6) for item in value.split(",") if item.strip()}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync A-share index universe daily and 5-minute bars into PostgreSQL")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""), help="PostgreSQL connection string")
    parser.add_argument("--db-name", default=os.environ.get("PGDATABASE", "stock_trading"), help="PostgreSQL database")
    parser.add_argument("--db-host", default=os.environ.get("PGHOST", "/var/run/postgresql"), help="PostgreSQL host/socket")
    parser.add_argument("--db-user", default=os.environ.get("PGUSER", os.environ.get("USER", "root")), help="PostgreSQL user")
    parser.add_argument("--lock-file", default="data/market-sync.lock", help="local process lock file")
    parser.add_argument("--daily-start", default="19900101", help="daily backfill start, YYYYMMDD")
    parser.add_argument("--minute-start", default="20200101", help="BaoStock minute backfill start, YYYYMMDD")
    parser.add_argument("--end-date", default=datetime.now().strftime(DATE_FMT), help="sync end date, YYYYMMDD")
    parser.add_argument("--universe", default="csi800", choices=["hs300", "csi500", "csi800"], help="stock universe to sync")
    parser.add_argument("--member-limit", type=int, default=800, help="member fetch limit")
    parser.add_argument("--minute-frequency", default="5", choices=["5", "15", "30", "60"], help="BaoStock period")
    parser.add_argument("--sleep", type=float, default=0.15, help="sleep between symbols")
    parser.add_argument("--symbols", default="", help="optional comma-separated symbol allowlist")
    parser.add_argument("--daily-only", action="store_true", help="skip minute sync")
    parser.add_argument("--minute-only", action="store_true", help="skip daily sync")
    parser.add_argument("--members-only", action="store_true", help="refresh universe members only")
    parser.add_argument("--missing-only", action="store_true", help="sync only symbols missing requested data")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    lock_path = ROOT / args.lock_file if not Path(args.lock_file).is_absolute() else Path(args.lock_file)
    allowed_symbols = parse_symbols(args.symbols) if args.symbols else set()

    with process_lock(lock_path):
        conn = connect(args)
        ensure_schema(conn)
        run_id = begin_run(conn)
        members_total = 0
        total_daily = 0
        total_minutes = 0
        errors: list[dict[str, Any]] = []
        minute_logged_in = False

        try:
            members = fetch_universe_members(args.universe, args.member_limit)
            if allowed_symbols:
                members = [member for member in members if member.symbol in allowed_symbols]
            members_total = len(members)
            upsert_members(conn, members, replace_active=not bool(allowed_symbols))
            print(f"[{now_text()}] universe={args.universe} members={members_total} db=postgresql/{args.db_name}", flush=True)

            if args.members_only:
                finish_run(conn, run_id, "ok", members_total, 0, 0, errors)
                print(f"[{now_text()}] finished status=ok members={members_total} daily=0 minute=0 errors=0", flush=True)
                return

            if args.missing_only:
                missing_members = []
                for member in members:
                    needs_daily = not args.minute_only and max_date(conn, "daily_bars", member.symbol) is None
                    needs_minute = not args.daily_only and max_date(conn, "minute_bars", member.symbol) is None
                    if needs_daily or needs_minute:
                        missing_members.append(member)
                members = missing_members
                members_total = len(members)
                print(f"[{now_text()}] missing_only members={members_total}", flush=True)

            if not args.daily_only:
                minute_logged_in = ensure_baostock_login()
                if not minute_logged_in:
                    raise RuntimeError("BaoStock login failed")

            for index, member in enumerate(members, start=1):
                daily_count = 0
                minute_count = 0
                try:
                    if not args.minute_only:
                        existing_daily = max_date(conn, "daily_bars", member.symbol)
                        daily_start = compact_date(existing_daily) if existing_daily else args.daily_start
                        bars = fetch_stock_daily(member.symbol, daily_start, args.end_date, "qfq")
                        daily_count = upsert_daily(conn, member.symbol, bars)
                        total_daily += daily_count

                    if not args.daily_only:
                        existing_minute = max_date(conn, "minute_bars", member.symbol)
                        minute_start = compact_date(existing_minute) if existing_minute else args.minute_start
                        rows = fetch_baostock_minutes(
                            member.symbol,
                            minute_start,
                            args.end_date,
                            args.minute_frequency,
                        )
                        minute_count = upsert_minutes(conn, rows)
                        total_minutes += minute_count

                    print(
                        f"[{now_text()}] {index}/{members_total} "
                        f"{member.symbol} {member.name} daily={daily_count} minute={minute_count}",
                        flush=True,
                    )
                except Exception as exc:
                    message = str(exc)
                    errors.append({"symbol": member.symbol, "name": member.name, "error": message})
                    print(f"[{now_text()}] ERROR {member.symbol} {member.name}: {message}", flush=True)
                time.sleep(args.sleep)

            status = "ok" if not errors else "partial"
            finish_run(conn, run_id, status, members_total, total_daily, total_minutes, errors)
            print(
                f"[{now_text()}] finished status={status} members={members_total} "
                f"daily={total_daily} minute={total_minutes} errors={len(errors)}",
                flush=True,
            )
        except BaseException as exc:
            errors.append({"symbol": "*", "name": "sync", "error": str(exc)})
            finish_run(conn, run_id, "failed", members_total, total_daily, total_minutes, errors)
            raise
        finally:
            if minute_logged_in:
                bs.logout()
            conn.close()


if __name__ == "__main__":
    main()
