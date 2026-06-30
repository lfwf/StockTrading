#!/usr/bin/env python3
"""Generate training cases from the local PostgreSQL market database.

This is the production generator. It does not call AKShare or BaoStock. Run
scripts/run_market_sync.sh first, then run this script to build training_cases
from members, daily_bars and minute_bars.
"""

from __future__ import annotations

import argparse
import json
import os
import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row


@dataclass
class Candidate:
    index: int
    score: float
    tags: list[str]
    future_stats: dict[str, float | None]


def connect(args: argparse.Namespace) -> psycopg.Connection[Any]:
    if args.database_url:
        return psycopg.connect(args.database_url, row_factory=dict_row)
    return psycopg.connect(dbname=args.db_name, host=args.db_host, user=args.db_user, row_factory=dict_row)


def ensure_case_schema(conn: psycopg.Connection[Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
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
            """
        )
    conn.commit()


def as_date_text(value: Any) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def row_to_bar(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "date": as_date_text(row["date"]),
        "open": round(float(row["open"]), 3),
        "high": round(float(row["high"]), 3),
        "low": round(float(row["low"]), 3),
        "close": round(float(row["close"]), 3),
        "preClose": round(float(row["pre_close"]), 3),
        "volume": int(row["volume"]),
        "amount": int(row["amount"]),
        "turnoverRate": round(float(row["turnover_rate"]), 3),
    }


def pct_change(a: float, b: float) -> float:
    return (b - a) / a if a else 0.0


def avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def fetch_members(conn: psycopg.Connection[Any], limit: int, symbols: set[str]) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        if symbols:
            cur.execute(
                """
                SELECT symbol, name, market, industry
                FROM members
                WHERE active = TRUE AND symbol = ANY(%s)
                ORDER BY symbol
                """,
                (list(symbols),),
            )
        else:
            cur.execute(
                """
                SELECT symbol, name, market, industry
                FROM members
                WHERE active = TRUE
                ORDER BY symbol
                LIMIT %s
                """,
                (limit,),
            )
        return list(cur.fetchall())


def fetch_daily(conn: psycopg.Connection[Any], symbol: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT date, open, high, low, close, pre_close, volume, amount, turnover_rate
            FROM daily_bars
            WHERE symbol = %s AND date BETWEEN %s AND %s
            ORDER BY date
            """,
            (symbol, start_date, end_date),
        )
        return [row_to_bar(row) for row in cur.fetchall()]


def fetch_intraday(conn: psycopg.Connection[Any], symbol: str, target_date: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT to_char(time, 'HH24:MI') AS time, price, avg_price, volume
            FROM minute_bars
            WHERE symbol = %s AND date = %s
            ORDER BY time
            """,
            (symbol, target_date),
        )
        return [
            {"time": row["time"], "price": round(float(row["price"]), 3), "avgPrice": round(float(row["avg_price"]), 3), "volume": int(row["volume"])}
            for row in cur.fetchall()
        ]


def synthetic_intraday(day: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"time": "09:30", "price": day["open"], "avgPrice": day["open"], "volume": 0},
        {"time": "11:30", "price": round((day["high"] + day["low"]) / 2, 3), "avgPrice": round((day["high"] + day["low"]) / 2, 3), "volume": 0},
        {"time": "15:00", "price": day["close"], "avgPrice": day["close"], "volume": 0},
    ]


def build_future_stats(daily: list[dict[str, Any]], index: int, forward_days: int) -> dict[str, float | None]:
    entry = float(daily[index]["open"])
    future = daily[index + 1:index + forward_days + 1]

    def ret_after(days: int) -> float | None:
        if len(future) < days:
            return None
        return round(pct_change(entry, float(future[days - 1]["close"])), 4)

    if not future:
        return {"return1d": None, "return3d": None, "return5d": None, "return10d": None, "return20d": None, "maxGain20d": None, "maxDrawdown20d": None}
    return {
        "return1d": ret_after(1),
        "return3d": ret_after(3),
        "return5d": ret_after(5),
        "return10d": ret_after(10),
        "return20d": ret_after(20),
        "maxGain20d": round(pct_change(entry, max(float(bar["high"]) for bar in future)), 4),
        "maxDrawdown20d": round(pct_change(entry, min(float(bar["low"]) for bar in future)), 4),
    }


def classify_context(daily: list[dict[str, Any]], index_daily_by_date: dict[str, dict[str, Any]], index: int, forward_days: int) -> Candidate | None:
    if index < 120 or index >= len(daily):
        return None
    prev20 = daily[index - 20:index]
    prev60 = daily[index - 60:index]
    current = daily[index]
    if len(prev20) < 20 or len(prev60) < 60:
        return None

    open_price = float(current["open"])
    close = float(current["close"])
    high = float(current["high"])
    low = float(current["low"])
    pre_close = float(current.get("preClose") or prev20[-1]["close"])
    high20 = max(float(bar["high"]) for bar in prev20)
    low60 = min(float(bar["low"]) for bar in prev60)
    high60 = max(float(bar["high"]) for bar in prev60)
    ma20 = avg([float(bar["close"]) for bar in prev20])
    ma60 = avg([float(bar["close"]) for bar in prev60])
    volume_ma20 = avg([float(bar.get("volume", 0)) for bar in prev20])
    volume_ratio = float(current.get("volume", 0)) / max(volume_ma20, 1)
    trend20 = pct_change(float(prev20[0]["close"]), float(prev20[-1]["close"]))
    trend60 = pct_change(float(prev60[0]["close"]), float(prev60[-1]["close"]))
    last5_ret = pct_change(float(daily[index - 5]["close"]), float(prev20[-1]["close"]))
    gap = pct_change(pre_close, open_price)
    position60 = (open_price - low60) / max(high60 - low60, open_price * 0.01)
    body_ret = pct_change(open_price, close)
    upper_shadow = (high - max(open_price, close)) / max(high - low, close * 0.01)
    lower_shadow = (min(open_price, close) - low) / max(high - low, close * 0.01)
    index_bars = [index_daily_by_date.get(bar["date"]) for bar in prev20]
    index_bars = [bar for bar in index_bars if bar]
    index_ret20 = pct_change(float(index_bars[0]["close"]), float(index_bars[-1]["close"])) if len(index_bars) >= 2 else 0.0
    relative_strength = trend20 - index_ret20
    future_stats = build_future_stats(daily, index, forward_days)

    tags: list[str] = []
    score = 0.0
    if open_price >= high20 * 0.985 or close >= high20 * 0.985:
        tags.append("breakout")
        score += 2.0
    if trend60 > 0.08 and open_price > ma20 and body_ret < 0.01 and lower_shadow > 0.28:
        tags.append("pullback")
        score += 1.8
    if gap > 0.025 or last5_ret > 0.08 or position60 > 0.86:
        tags.append("impulse")
        score += 1.4
    if index_ret20 < -0.045:
        tags.append("weak_market")
        score += 1.2
    if relative_strength > 0.06:
        tags.append("strong_vs_market")
        score += 1.2
    if upper_shadow > 0.35 and volume_ratio > 1.25:
        tags.append("chase_high_risk")
        score += 1.6
    if trend60 < -0.08 and open_price < ma60:
        tags.append("downtrend_trap")
        score += 1.4
    if abs(gap) > 0.025:
        tags.append("gap")
        score += 0.7
    if volume_ratio > 1.5:
        tags.append("volume_expand")
        score += 0.8

    max_gain = future_stats.get("maxGain20d") or 0
    max_drawdown = future_stats.get("maxDrawdown20d") or 0
    ret5 = future_stats.get("return5d") or 0
    ret10 = future_stats.get("return10d") or 0
    if max_gain >= 0.08 and max_drawdown > -0.08:
        tags.append("good_entry")
        score += 1.6
    if ret5 <= -0.04 or max_drawdown <= -0.08:
        tags.append("bad_entry")
        score += 1.4
    if ret10 >= 0.06:
        score += 0.8
    if abs(trend20) < 0.015 and volume_ratio < 1.15 and abs(ret5) < 0.025:
        score -= 1.4
    if not tags:
        tags.append("random_context")
    return Candidate(index=index, score=round(score, 4), tags=tags, future_stats=future_stats)


def scan_candidates(daily: list[dict[str, Any]], index_daily_by_date: dict[str, dict[str, Any]], args: argparse.Namespace) -> list[Candidate]:
    result: list[Candidate] = []
    start = max(args.lookback_days, 120)
    end = len(daily) - args.forward_days - 1
    for index in range(start, max(start, end), args.candidate_step):
        item = classify_context(daily, index_daily_by_date, index, args.forward_days)
        if item and item.score >= args.min_score:
            result.append(item)
    return result


def diversify_candidates(candidates: list[Candidate], args: argparse.Namespace) -> list[Candidate]:
    selected: list[Candidate] = []
    tag_counts: dict[str, int] = defaultdict(int)
    for item in sorted(candidates, key=lambda x: x.score, reverse=True):
        if any(abs(item.index - old.index) < args.min_gap_days for old in selected):
            continue
        main_tag = item.tags[0]
        if tag_counts[main_tag] >= args.max_same_tag_per_stock:
            continue
        selected.append(item)
        tag_counts[main_tag] += 1
        if len(selected) >= args.max_cases_per_stock:
            break
    return sorted(selected, key=lambda x: x.index)


def build_case(conn: psycopg.Connection[Any], member: dict[str, Any], daily: list[dict[str, Any]], index_daily_by_date: dict[str, dict[str, Any]], index_daily: list[dict[str, Any]], candidate: Candidate, phase: str, args: argparse.Namespace) -> tuple[dict[str, Any], bool, bool]:
    start = max(0, candidate.index - args.lookback_days)
    end = min(len(daily), candidate.index + args.forward_days + 1)
    sliced_daily = daily[start:end]
    decision_index = candidate.index - start
    decision_bar = daily[candidate.index]
    decision_date = decision_bar["date"]
    dates = {bar["date"] for bar in sliced_daily}
    sliced_index_daily = [bar for bar in index_daily if bar["date"] in dates]

    full_intraday = fetch_intraday(conn, member["symbol"], decision_date)
    stock_real = bool(full_intraday)
    if not full_intraday:
        full_intraday = synthetic_intraday(decision_bar)

    index_intraday = fetch_intraday(conn, "000300", decision_date)
    index_real = bool(index_intraday)
    if not index_intraday:
        index_bar = index_daily_by_date.get(decision_date, decision_bar)
        index_intraday = synthetic_intraday(index_bar)

    intraday_by_date = {decision_date: full_intraday}
    if phase == "history":
        for bar in daily[candidate.index + 1:candidate.index + args.forward_days + 1]:
            points = fetch_intraday(conn, member["symbol"], bar["date"])
            intraday_by_date[bar["date"]] = points if points else synthetic_intraday(bar)

    case = {
        "id": f"{member['symbol']}-{phase}-{decision_date}-{candidate.index}",
        "phase": phase,
        "stock": {
            "symbol": member["symbol"],
            "name": member["name"],
            "market": member["market"],
            "industry": member["industry"],
            "pe": 0,
            "pb": 0,
            "totalMarketCap": 0,
            "floatMarketCap": 0,
        },
        "daily": sliced_daily,
        "indexDaily": sliced_index_daily,
        "decisionIndex": decision_index,
        "fullIntraday": full_intraday,
        "indexIntraday": index_intraday,
        "intradayByDate": intraday_by_date,
        "sceneTags": candidate.tags,
        "score": candidate.score,
        "futureStats": candidate.future_stats,
        "dataQuality": {
            "daily": "real",
            "indexDaily": "real" if sliced_index_daily else "missing",
            "stockIntraday": "postgresql" if stock_real else "synthetic",
            "indexIntraday": "postgresql" if index_real else "synthetic",
        },
    }
    return case, stock_real, index_real


def begin_case_run(conn: psycopg.Connection[Any], params: dict[str, Any]) -> int:
    with conn.cursor() as cur:
        cur.execute("UPDATE training_case_runs SET status = 'interrupted', finished_at = now() WHERE status = 'running'")
        cur.execute(
            """
            INSERT INTO training_case_runs(generated_at, status, source, params_json, quality_json)
            VALUES (now(), 'running', 'PostgreSQL market database', %s::jsonb, '{}'::jsonb)
            RETURNING id
            """,
            (json.dumps(params, ensure_ascii=False),),
        )
        run_id = int(cur.fetchone()["id"])
    conn.commit()
    return run_id


def finish_case_run(conn: psycopg.Connection[Any], run_id: int, status: str, quality: dict[str, Any], error_text: str = "") -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE training_case_runs
               SET finished_at = now(), status = %s, quality_json = %s::jsonb, error_text = NULLIF(%s, '')
             WHERE id = %s
            """,
            (status, json.dumps(quality, ensure_ascii=False), error_text, run_id),
        )
        if status == "ok":
            cur.execute("UPDATE training_cases SET active = FALSE WHERE run_id <> %s", (run_id,))
    conn.commit()


def insert_case(conn: psycopg.Connection[Any], run_id: int, case: dict[str, Any], phase: str, candidate: Candidate) -> None:
    decision_bar = case["daily"][case["decisionIndex"]]
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO training_cases(id, phase, symbol, name, decision_date, score, tags_json, case_json, run_id, active, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, TRUE, now())
            ON CONFLICT(id) DO UPDATE SET
              phase = excluded.phase,
              symbol = excluded.symbol,
              name = excluded.name,
              decision_date = excluded.decision_date,
              score = excluded.score,
              tags_json = excluded.tags_json,
              case_json = excluded.case_json,
              run_id = excluded.run_id,
              active = TRUE,
              created_at = excluded.created_at
            """,
            (
                case["id"],
                phase,
                case["stock"]["symbol"],
                case["stock"]["name"],
                decision_bar["date"],
                candidate.score,
                json.dumps(candidate.tags, ensure_ascii=False),
                json.dumps(case, ensure_ascii=False),
                run_id,
            ),
        )
    conn.commit()


def parse_symbols(value: str) -> set[str]:
    return {item.strip().zfill(6) for item in value.split(",") if item.strip()}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate trainer cases from PostgreSQL market tables")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--db-name", default=os.environ.get("PGDATABASE", "stock_trading"))
    parser.add_argument("--db-host", default=os.environ.get("PGHOST", "/var/run/postgresql"))
    parser.add_argument("--db-user", default=os.environ.get("PGUSER", os.environ.get("USER", "root")))
    parser.add_argument("--start-date", default="2020-01-01")
    parser.add_argument("--end-date", default=datetime.now().date().isoformat())
    parser.add_argument("--member-limit", type=int, default=800)
    parser.add_argument("--symbols", default="")
    parser.add_argument("--lookback-days", type=int, default=140)
    parser.add_argument("--forward-days", type=int, default=20)
    parser.add_argument("--candidate-step", type=int, default=5)
    parser.add_argument("--max-cases-per-stock", type=int, default=12)
    parser.add_argument("--max-same-tag-per-stock", type=int, default=3)
    parser.add_argument("--min-gap-days", type=int, default=30)
    parser.add_argument("--min-score", type=float, default=1.8)
    parser.add_argument("--max-history-cases", type=int, default=0)
    parser.add_argument("--current-count", type=int, default=0)
    parser.add_argument("--seed", type=int, default=20260630)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    params = vars(args).copy()
    conn = connect(args)
    ensure_case_schema(conn)
    run_id = begin_case_run(conn, params)
    history_count = 0
    current_count = 0
    real_stock_intraday = 0
    real_index_intraday = 0
    errors: list[dict[str, str]] = []
    try:
        members = fetch_members(conn, args.member_limit, parse_symbols(args.symbols))
        random.shuffle(members)
        index_daily = fetch_daily(conn, "000300", args.start_date, args.end_date)
        index_daily_by_date = {bar["date"]: bar for bar in index_daily}

        for idx, member in enumerate(members, start=1):
            try:
                daily = fetch_daily(conn, member["symbol"], args.start_date, args.end_date)
                if len(daily) < args.lookback_days + args.forward_days + 10:
                    print(f"skip {member['symbol']}: daily bars not enough")
                    continue

                selected = diversify_candidates(scan_candidates(daily, index_daily_by_date, args), args)
                for candidate in selected:
                    case, stock_real, index_real = build_case(conn, member, daily, index_daily_by_date, index_daily, candidate, "history", args)
                    insert_case(conn, run_id, case, "history", candidate)
                    history_count += 1
                    real_stock_intraday += int(stock_real)
                    real_index_intraday += int(index_real)
                    print(f"history {history_count}: {member['symbol']} {member['name']} {case['daily'][case['decisionIndex']]['date']} score={candidate.score}", flush=True)
                    if args.max_history_cases and history_count >= args.max_history_cases:
                        break

                latest_index = len(daily) - 1
                current_candidate = classify_context(daily, index_daily_by_date, latest_index, 0) or Candidate(latest_index, 0, ["current"], {})
                current_candidate = Candidate(latest_index, current_candidate.score, ["current", *current_candidate.tags], {})
                if not args.current_count or current_count < args.current_count:
                    case, stock_real, index_real = build_case(conn, member, daily, index_daily_by_date, index_daily, current_candidate, "current", args)
                    insert_case(conn, run_id, case, "current", current_candidate)
                    current_count += 1
                    real_stock_intraday += int(stock_real)
                    real_index_intraday += int(index_real)
                    print(f"current {current_count}: {member['symbol']} {member['name']} {case['daily'][case['decisionIndex']]['date']}", flush=True)

                if args.max_history_cases and history_count >= args.max_history_cases:
                    break
                if idx % 20 == 0:
                    print(f"progress {idx}/{len(members)} history={history_count} current={current_count}", flush=True)
            except Exception as exc:
                errors.append({"symbol": member["symbol"], "error": str(exc)})
                print(f"ERROR {member['symbol']} {member['name']}: {exc}", flush=True)

        if not history_count and not current_count:
            raise RuntimeError("no cases generated from database")
        quality = {
            "daily": "real",
            "totalCases": history_count + current_count,
            "historyCases": history_count,
            "currentCases": current_count,
            "realStockIntradayCases": real_stock_intraday,
            "realIndexIntradayCases": real_index_intraday,
            "errors": errors[-200:],
        }
        finish_case_run(conn, run_id, "ok", quality)
        print(f"done run={run_id} history={history_count} current={current_count} errors={len(errors)}", flush=True)
    except Exception as exc:
        finish_case_run(conn, run_id, "failed", {"daily": "real", "totalCases": 0, "errors": errors[-200:]}, str(exc))
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
