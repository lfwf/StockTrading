#!/usr/bin/env python3
"""Sync HS300 market data into SQLite.

This script is intentionally separate from the front-end training-case
generator. It keeps a reusable local market database that can be refreshed by
cron:

    - all current HS300 members
    - adjusted daily bars from listing date when available
    - BaoStock 5-minute bars from the free historical minute coverage window

The sync is incremental. For existing symbols, it re-fetches from the last
stored date so delayed or partial latest bars are replaced on the next run.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import sqlite3
import sys
import time
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import baostock as bs

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.sync_akshare import (  # noqa: E402
    BAOSTOCK_LOGGED_IN,
    baostock_code,
    fetch_hs300_members,
    fetch_stock_daily,
    number,
)


DATE_FMT = "%Y%m%d"
SQLITE_PRAGMAS = (
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA temp_store=MEMORY",
    "PRAGMA busy_timeout=30000",
)


def compact_date(value: str) -> str:
    return value.replace("-", "")


def dashed_date(value: str) -> str:
    if "-" in value:
        return value
    return f"{value[0:4]}-{value[4:6]}-{value[6:8]}"


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


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    for pragma in SQLITE_PRAGMAS:
        conn.execute(pragma)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS members (
            symbol TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            market TEXT NOT NULL,
            industry TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_bars (
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            pre_close REAL NOT NULL,
            volume INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            turnover_rate REAL NOT NULL,
            PRIMARY KEY (symbol, date)
        );

        CREATE TABLE IF NOT EXISTS minute_bars (
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            price REAL NOT NULL,
            avg_price REAL NOT NULL,
            volume INTEGER NOT NULL,
            PRIMARY KEY (symbol, date, time)
        );

        CREATE TABLE IF NOT EXISTS sync_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            status TEXT NOT NULL,
            members_total INTEGER NOT NULL DEFAULT 0,
            daily_rows INTEGER NOT NULL DEFAULT 0,
            minute_rows INTEGER NOT NULL DEFAULT 0,
            errors_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE INDEX IF NOT EXISTS idx_daily_symbol_date
            ON daily_bars(symbol, date);
        CREATE INDEX IF NOT EXISTS idx_minute_symbol_date
            ON minute_bars(symbol, date);
        """
    )
    conn.commit()


def begin_run(conn: sqlite3.Connection) -> int:
    conn.execute(
        """
        UPDATE sync_runs
           SET finished_at = COALESCE(finished_at, ?),
               status = 'interrupted'
         WHERE status = 'running'
        """,
        (now_text(),),
    )
    cursor = conn.execute(
        "INSERT INTO sync_runs(started_at, status) VALUES (?, ?)",
        (now_text(), "running"),
    )
    conn.commit()
    return int(cursor.lastrowid)


def finish_run(
    conn: sqlite3.Connection,
    run_id: int,
    status: str,
    members_total: int,
    daily_rows: int,
    minute_rows: int,
    errors: list[dict[str, Any]],
) -> None:
    conn.execute(
        """
        UPDATE sync_runs
           SET finished_at = ?,
               status = ?,
               members_total = ?,
               daily_rows = ?,
               minute_rows = ?,
               errors_json = ?
         WHERE id = ?
        """,
        (
            now_text(),
            status,
            members_total,
            daily_rows,
            minute_rows,
            json.dumps(errors[-200:], ensure_ascii=False),
            run_id,
        ),
    )
    conn.commit()


def max_date(conn: sqlite3.Connection, table: str, symbol: str) -> str | None:
    row = conn.execute(f"SELECT MAX(date) AS value FROM {table} WHERE symbol = ?", (symbol,)).fetchone()
    return str(row["value"]) if row and row["value"] else None


def upsert_members(conn: sqlite3.Connection, members: list[Any]) -> None:
    stamp = now_text()
    conn.execute("UPDATE members SET active = 0")
    conn.executemany(
        """
        INSERT INTO members(symbol, name, market, industry, active, updated_at)
        VALUES (:symbol, :name, :market, :industry, 1, :updated_at)
        ON CONFLICT(symbol) DO UPDATE SET
            name = excluded.name,
            market = excluded.market,
            industry = excluded.industry,
            active = 1,
            updated_at = excluded.updated_at
        """,
        [{**asdict(member), "updated_at": stamp} for member in members],
    )
    conn.commit()


def upsert_daily(conn: sqlite3.Connection, symbol: str, bars: list[dict[str, Any]]) -> int:
    if not bars:
        return 0
    conn.executemany(
        """
        INSERT INTO daily_bars(
            symbol, date, open, high, low, close, pre_close, volume, amount, turnover_rate
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        [
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
        ],
    )
    conn.commit()
    return len(bars)


def ensure_baostock_login() -> bool:
    # Importing BAOSTOCK_LOGGED_IN gives us the initial module value only, but
    # bs.login() itself is idempotent enough for this batch job.
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
        date = str(item.get("date", ""))
        raw_time = str(item.get("time", ""))
        price = number(item.get("close"))
        volume = number(item.get("volume"))
        if date != current_date:
            current_date = date
            weighted_sum = 0.0
            volume_sum = 0.0
        weighted_sum += price * volume
        volume_sum += volume
        avg_price = weighted_sum / volume_sum if volume_sum else price
        rows.append(
            (
                symbol,
                date,
                f"{raw_time[8:10]}:{raw_time[10:12]}",
                round(price, 3),
                round(avg_price, 3),
                int(volume),
            )
        )
    return rows


def upsert_minutes(conn: sqlite3.Connection, rows: list[tuple[Any, ...]]) -> int:
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO minute_bars(symbol, date, time, price, avg_price, volume)
        VALUES (?, ?, ?, ?, ?, ?)
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
    parser = argparse.ArgumentParser(description="Sync HS300 daily and 5-minute bars into SQLite")
    parser.add_argument("--db", default="data/market.db", help="SQLite database path")
    parser.add_argument("--daily-start", default="19900101", help="daily backfill start, YYYYMMDD")
    parser.add_argument("--minute-start", default="20200101", help="BaoStock minute backfill start, YYYYMMDD")
    parser.add_argument("--end-date", default=datetime.now().strftime(DATE_FMT), help="sync end date, YYYYMMDD")
    parser.add_argument("--member-limit", type=int, default=500, help="HS300 member fetch limit")
    parser.add_argument("--minute-frequency", default="5", choices=["5", "15", "30", "60"], help="BaoStock period")
    parser.add_argument("--sleep", type=float, default=0.15, help="sleep between symbols")
    parser.add_argument("--symbols", default="", help="optional comma-separated symbol allowlist")
    parser.add_argument("--daily-only", action="store_true", help="skip minute sync")
    parser.add_argument("--minute-only", action="store_true", help="skip daily sync")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    db_path = ROOT / args.db if not Path(args.db).is_absolute() else Path(args.db)
    lock_path = db_path.with_suffix(".lock")
    allowed_symbols = parse_symbols(args.symbols) if args.symbols else set()

    with process_lock(lock_path):
        conn = connect(db_path)
        ensure_schema(conn)
        run_id = begin_run(conn)
        members_total = 0
        total_daily = 0
        total_minutes = 0
        errors: list[dict[str, Any]] = []
        minute_logged_in = False

        try:
            members = fetch_hs300_members(args.member_limit)
            if allowed_symbols:
                members = [member for member in members if member.symbol in allowed_symbols]
            members_total = len(members)
            upsert_members(conn, members)
            print(f"[{now_text()}] members={members_total} db={db_path}", flush=True)

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
