#!/usr/bin/env python3
"""Dense training case generator for the blind stock trading trainer.

Output files:
- public/data/training-cases.json: combined dataset. `cases` is kept as history cases for compatibility.
- public/data/history-cases.json: historical blind-test cases.
- public/data/current-cases.json: latest-day current-market cases.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import signal
import sqlite3
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import akshare as ak
import baostock as bs
import pandas as pd
import psycopg
from psycopg.rows import dict_row

BAOSTOCK_LOGGED_IN = False

FALLBACK_MEMBERS = [
    {"symbol": "600519", "name": "贵州茅台", "industry": "白酒", "market": "沪市"},
    {"symbol": "300750", "name": "宁德时代", "industry": "电力设备", "market": "深市"},
    {"symbol": "600036", "name": "招商银行", "industry": "银行", "market": "沪市"},
    {"symbol": "000858", "name": "五粮液", "industry": "白酒", "market": "深市"},
    {"symbol": "601318", "name": "中国平安", "industry": "非银金融", "market": "沪市"},
    {"symbol": "600276", "name": "恒瑞医药", "industry": "医药生物", "market": "沪市"},
]


@dataclass
class Member:
    symbol: str
    name: str
    industry: str = "沪深300"
    market: str = "沪市"


@dataclass
class Candidate:
    index: int
    score: float
    tags: list[str]
    future_stats: dict[str, float | None]


class MarketStore:
    def __init__(self, kind: str, conn: Any):
        self.kind = kind
        self.conn = conn

    def close(self) -> None:
        self.conn.close()

    def members(self, universe: str, limit: int) -> list[Member]:
        if self.kind == "postgres":
            with self.conn.cursor() as cur:
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
                rows = cur.fetchall()
        else:
            rows = self.conn.execute(
                """
                SELECT symbol, name, market, industry
                  FROM members
                 WHERE active = 1
                 ORDER BY symbol
                 LIMIT ?
                """,
                (limit,),
            ).fetchall()
        if not rows:
            return []
        if universe == "hs300":
            labels = {"沪深300"}
        elif universe == "csi500":
            labels = {"中证500"}
        else:
            labels = {"沪深300", "中证500"}
        members = [
            Member(symbol=row["symbol"], name=row["name"], market=row["market"], industry=row["industry"])
            for row in rows
            if not labels or str(row["industry"]) in labels
        ]
        return members[:limit]

    def daily(self, symbol: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
        start = dashed_date(start_date)
        end = dashed_date(end_date)
        if self.kind == "postgres":
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT date, open, high, low, close, pre_close, volume, amount, turnover_rate
                      FROM daily_bars
                     WHERE symbol = %s AND date >= %s AND date <= %s
                     ORDER BY date
                    """,
                    (symbol, start, end),
                )
                rows = cur.fetchall()
        else:
            rows = self.conn.execute(
                """
                SELECT date, open, high, low, close, pre_close, volume, amount, turnover_rate
                  FROM daily_bars
                 WHERE symbol = ? AND date >= ? AND date <= ?
                 ORDER BY date
                """,
                (symbol, start, end),
            ).fetchall()
        return [
            {
                "date": str(row["date"]),
                "open": round(number(row["open"]), 3),
                "high": round(number(row["high"]), 3),
                "low": round(number(row["low"]), 3),
                "close": round(number(row["close"]), 3),
                "preClose": round(number(row["pre_close"]), 3),
                "volume": int(number(row["volume"], 0)),
                "amount": int(number(row["amount"], 0)),
                "turnoverRate": round(number(row["turnover_rate"], 0), 3),
            }
            for row in rows
        ]

    def minute(self, symbol: str, date: str) -> list[dict[str, Any]]:
        if self.kind == "postgres":
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT time, price, avg_price, volume
                      FROM minute_bars
                     WHERE symbol = %s AND date = %s
                     ORDER BY time
                    """,
                    (symbol, date),
                )
                rows = cur.fetchall()
        else:
            rows = self.conn.execute(
                """
                SELECT time, price, avg_price, volume
                  FROM minute_bars
                 WHERE symbol = ? AND date = ?
                 ORDER BY time
                """,
                (symbol, date),
            ).fetchall()
        return [
            {
                "time": str(row["time"])[:5],
                "price": round(number(row["price"]), 3),
                "avgPrice": round(number(row["avg_price"]), 3),
                "volume": int(number(row["volume"], 0)),
            }
            for row in rows
        ]

    def index_daily_proxy(self, start_date: str, end_date: str) -> list[dict[str, Any]]:
        start = dashed_date(start_date)
        end = dashed_date(end_date)
        if self.kind == "postgres":
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT date,
                           AVG(open) AS open,
                           AVG(high) AS high,
                           AVG(low) AS low,
                           AVG(close) AS close,
                           SUM(volume) AS volume,
                           SUM(amount) AS amount,
                           AVG(turnover_rate) AS turnover_rate
                      FROM daily_bars
                     WHERE date >= %s AND date <= %s
                     GROUP BY date
                     ORDER BY date
                    """,
                    (start, end),
                )
                rows = cur.fetchall()
        else:
            rows = self.conn.execute(
                """
                SELECT date,
                       AVG(open) AS open,
                       AVG(high) AS high,
                       AVG(low) AS low,
                       AVG(close) AS close,
                       SUM(volume) AS volume,
                       SUM(amount) AS amount,
                       AVG(turnover_rate) AS turnover_rate
                  FROM daily_bars
                 WHERE date >= ? AND date <= ?
                 GROUP BY date
                 ORDER BY date
                """,
                (start, end),
            ).fetchall()
        bars: list[dict[str, Any]] = []
        pre_close = 0.0
        for row in rows:
            close = number(row["close"])
            bars.append({
                "date": str(row["date"]),
                "open": round(number(row["open"]), 3),
                "high": round(number(row["high"]), 3),
                "low": round(number(row["low"]), 3),
                "close": round(close, 3),
                "preClose": round(pre_close or close, 3),
                "volume": int(number(row["volume"], 0)),
                "amount": int(number(row["amount"], 0)),
                "turnoverRate": round(number(row["turnover_rate"], 0), 3),
            })
            pre_close = close
        return bars


def call_with_timeout(call: Any, seconds: int) -> Any:
    def raise_timeout(_signum: int, _frame: Any) -> None:
        raise TimeoutError(f"data call timed out after {seconds}s")

    previous = signal.signal(signal.SIGALRM, raise_timeout)
    signal.alarm(seconds)
    try:
        return call()
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def connect_market_store(args: argparse.Namespace) -> MarketStore | None:
    if args.market_source in {"postgres", "auto"}:
        try:
            conn = psycopg.connect(
                args.database_url,
                row_factory=dict_row,
            ) if args.database_url else psycopg.connect(
                dbname=args.db_name,
                host=args.db_host,
                user=args.db_user,
                row_factory=dict_row,
            )
            store = MarketStore("postgres", conn)
            if store.members(args.universe, args.member_limit):
                print(f"using local market store: postgresql/{args.db_name}", flush=True)
                return store
            store.close()
        except Exception as exc:
            if args.market_source == "postgres":
                raise
            print(f"local postgres unavailable: {exc}", flush=True)

    if args.market_source in {"sqlite", "auto"}:
        path = Path(args.market_sqlite)
        if path.exists():
            conn = sqlite3.connect(path)
            conn.row_factory = sqlite3.Row
            store = MarketStore("sqlite", conn)
            if store.members(args.universe, args.member_limit):
                print(f"using local market store: sqlite/{path}", flush=True)
                return store
            store.close()
        elif args.market_source == "sqlite":
            raise FileNotFoundError(path)

    if args.market_source == "external":
        return None
    if args.market_source != "auto":
        raise RuntimeError(f"no usable local market store for source={args.market_source}")
    print("local market store unavailable, falling back to AKShare/BaoStock", flush=True)
    return None


def dashed_date(value: str) -> str:
    text = str(value)
    if "-" in text:
        return text
    return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"


def number(value: Any, default: float = 0.0) -> float:
    if value is None or pd.isna(value):
        return default
    if isinstance(value, str):
        value = value.replace(",", "").replace("--", "").strip()
    try:
        result = float(value)
    except Exception:
        return default
    if math.isnan(result) or math.isinf(result):
        return default
    return result


def first_existing(row: pd.Series, keys: list[str], default: Any = "") -> Any:
    for key in keys:
        if key in row and pd.notna(row[key]):
            return row[key]
    return default


def first_column(df: pd.DataFrame, keys: list[str]) -> str | None:
    for key in keys:
        if key in df.columns:
            return key
    return None


def normalize_symbol(value: Any) -> str:
    text = str(value).strip()
    digits = "".join(ch for ch in text if ch.isdigit())
    return digits[-6:] if len(digits) >= 6 else text.zfill(6)


def infer_market(symbol: str) -> str:
    return "沪市" if symbol.startswith("6") else "深市"


def normalize_member_frame(df: pd.DataFrame, default_industry: str) -> list[Member]:
    members: list[Member] = []
    seen: set[str] = set()
    for _, row in df.iterrows():
        symbol = normalize_symbol(first_existing(row, ["品种代码", "成分券代码", "证券代码", "代码", "stock_code", "code"]))
        if not symbol or len(symbol) != 6 or symbol in seen:
            continue
        seen.add(symbol)
        name = str(first_existing(row, ["品种名称", "成分券名称", "证券简称", "名称", "stock_name", "name"], symbol)).strip()
        industry = str(first_existing(row, ["行业", "所属行业", "中证行业", "industry"], default_industry)).strip() or default_industry
        members.append(Member(symbol=symbol, name=name, industry=industry, market=infer_market(symbol)))
    return members


def fetch_index_members(index_symbol: str, label: str, limit: int, fallback: list[dict[str, str]] | None = None) -> list[Member]:
    groups: list[list[Member]] = []
    for call in (
        lambda: ak.index_stock_cons(symbol=index_symbol),
        lambda: ak.index_stock_cons_weight_csindex(symbol=index_symbol),
        lambda: ak.index_stock_cons_sina(symbol=index_symbol),
    ):
        try:
            df = call_with_timeout(call, 12)
            if isinstance(df, pd.DataFrame) and not df.empty:
                items = normalize_member_frame(df, label)
                if items:
                    groups.append(items)
        except Exception:
            continue
    if not groups:
        return [Member(**item) for item in (fallback or [])[:limit]]
    groups.sort(key=len, reverse=True)
    return groups[0][:limit]


def merge_members(groups: list[list[Member]], limit: int) -> list[Member]:
    result: list[Member] = []
    seen: set[str] = set()
    for group in groups:
        for item in group:
            if item.symbol in seen:
                continue
            seen.add(item.symbol)
            result.append(item)
            if len(result) >= limit:
                return result
    return result


def fetch_universe_members(universe: str, limit: int) -> list[Member]:
    if universe == "hs300":
        return fetch_index_members("000300", "沪深300", limit, FALLBACK_MEMBERS)
    if universe == "csi500":
        return fetch_index_members("000905", "中证500", limit)
    if universe == "csi800":
        return merge_members([
            fetch_index_members("000300", "沪深300", 300, FALLBACK_MEMBERS),
            fetch_index_members("000905", "中证500", 500),
        ], limit)
    raise ValueError(f"unsupported universe: {universe}")


def normalize_daily_frame(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    frame = df.copy()
    date_col = first_column(frame, ["日期", "date", "时间"])
    open_col = first_column(frame, ["开盘", "open"])
    high_col = first_column(frame, ["最高", "high"])
    low_col = first_column(frame, ["最低", "low"])
    close_col = first_column(frame, ["收盘", "close"])
    volume_col = first_column(frame, ["成交量", "volume"])
    amount_col = first_column(frame, ["成交额", "amount"])
    turnover_col = first_column(frame, ["换手率", "turnover", "turnoverRate"])
    if not all([date_col, open_col, high_col, low_col, close_col]):
        return []

    frame = frame.sort_values(date_col)
    bars: list[dict[str, Any]] = []
    pre_close = 0.0
    for _, row in frame.iterrows():
        close = number(row[close_col])
        bars.append({
            "date": pd.to_datetime(row[date_col]).strftime("%Y-%m-%d"),
            "open": round(number(row[open_col]), 3),
            "high": round(number(row[high_col]), 3),
            "low": round(number(row[low_col]), 3),
            "close": round(close, 3),
            "preClose": round(pre_close or close, 3),
            "volume": int(number(row[volume_col], 0)) if volume_col else 0,
            "amount": int(number(row[amount_col], 0)) if amount_col else 0,
            "turnoverRate": round(number(row[turnover_col], 0), 3) if turnover_col else 0,
        })
        pre_close = close
    return bars


def fetch_stock_daily(symbol: str, start_date: str, end_date: str, adjust: str) -> list[dict[str, Any]]:
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            df = call_with_timeout(lambda: ak.stock_zh_a_hist(symbol=symbol, period="daily", start_date=start_date, end_date=end_date, adjust=adjust), 20)
            bars = normalize_daily_frame(df)
            if bars:
                return bars
        except Exception as exc:
            last_error = exc
            time.sleep(0.8 * (attempt + 1))

    try:
        market_symbol = f"sh{symbol}" if symbol.startswith("6") else f"sz{symbol}"
        df = call_with_timeout(lambda: ak.stock_zh_a_daily(symbol=market_symbol, start_date=start_date, end_date=end_date, adjust=adjust), 20)
        if "turnover" in df.columns:
            df = df.copy()
            df["turnover"] = df["turnover"].map(lambda value: number(value) * 100)
        bars = normalize_daily_frame(df)
        if bars:
            return bars
    except Exception as exc:
        last_error = exc
    raise RuntimeError(f"无法获取 {symbol} 日线: {last_error}")


def load_stock_daily(symbol: str, start_date: str, end_date: str, adjust: str, store: MarketStore | None) -> tuple[list[dict[str, Any]], str]:
    if store:
        bars = store.daily(symbol, start_date, end_date)
        if bars:
            return bars, store.kind
    return fetch_stock_daily(symbol, start_date, end_date, adjust), "external"


def fetch_index_daily(start_date: str, end_date: str) -> list[dict[str, Any]]:
    attempts = [
        lambda: ak.stock_zh_index_daily_em(symbol="sh000300"),
        lambda: ak.index_zh_a_hist(symbol="000300", period="daily", start_date=start_date, end_date=end_date),
        lambda: ak.stock_zh_index_daily(symbol="sh000300"),
        lambda: ak.stock_zh_index_daily_tx(symbol="sh000300"),
    ]
    last_error: Exception | None = None
    for call in attempts:
        try:
            bars = normalize_daily_frame(call())
            bars = [bar for bar in bars if start_date <= bar["date"].replace("-", "") <= end_date]
            if bars:
                return bars
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"无法获取沪深300指数日线: {last_error}")


def load_index_daily(start_date: str, end_date: str, store: MarketStore | None) -> tuple[list[dict[str, Any]], str]:
    if store:
        bars = store.daily("000300", start_date, end_date)
        if bars:
            return bars, store.kind
        proxy = store.index_daily_proxy(start_date, end_date)
        if proxy:
            return proxy, f"{store.kind}-proxy"
    return fetch_index_daily(start_date, end_date), "external"


def ensure_baostock_login() -> bool:
    global BAOSTOCK_LOGGED_IN
    if BAOSTOCK_LOGGED_IN:
        return True
    result = bs.login()
    BAOSTOCK_LOGGED_IN = result.error_code == "0"
    return BAOSTOCK_LOGGED_IN


def baostock_code(symbol: str) -> str:
    return f"sh.{symbol}" if symbol == "000300" or symbol.startswith("6") else f"sz.{symbol}"


def normalize_minute_frame(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    frame = df.copy()
    time_col = first_column(frame, ["时间", "日期时间", "datetime", "date", "day"])
    close_col = first_column(frame, ["收盘", "close", "最新价", "price"])
    volume_col = first_column(frame, ["成交量", "volume"])
    amount_col = first_column(frame, ["成交额", "amount"])
    if not time_col or not close_col:
        return []
    frame = frame.sort_values(time_col)
    points: list[dict[str, Any]] = []
    amount_sum = 0.0
    volume_sum = 0.0
    for _, row in frame.iterrows():
        dt = pd.to_datetime(row[time_col])
        price = number(row[close_col])
        volume = number(row[volume_col], 0) if volume_col else 0
        amount = number(row[amount_col], price * volume) if amount_col else price * volume
        volume_sum += volume
        amount_sum += amount
        points.append({
            "time": dt.strftime("%H:%M"),
            "price": round(price, 3),
            "avgPrice": round(amount_sum / volume_sum, 3) if volume_sum else round(price, 3),
            "volume": int(volume),
        })
    return points


def fetch_baostock_intraday(symbol: str, date: str, period: str) -> list[dict[str, Any]]:
    if period not in {"5", "15", "30", "60"} or not ensure_baostock_login():
        return []
    rs = bs.query_history_k_data_plus(baostock_code(symbol), "date,time,open,high,low,close,volume,amount", start_date=date, end_date=date, frequency=period, adjustflag="2")
    if rs.error_code != "0":
        return []
    points: list[dict[str, Any]] = []
    amount_sum = 0.0
    volume_sum = 0.0
    while rs.next():
        row = dict(zip(rs.fields, rs.get_row_data()))
        price = number(row.get("close"))
        volume = number(row.get("volume"))
        amount = number(row.get("amount"), price * volume)
        raw_time = str(row.get("time", ""))
        volume_sum += volume
        amount_sum += amount
        points.append({
            "time": f"{raw_time[8:10]}:{raw_time[10:12]}",
            "price": round(price, 3),
            "avgPrice": round(amount_sum / volume_sum, 3) if volume_sum else round(price, 3),
            "volume": int(volume),
        })
    return points


def trading_minutes(step: int = 1) -> list[str]:
    result: list[str] = []
    for sh, sm, eh, em in [(9, 30, 11, 30), (13, 0, 15, 0)]:
        current = datetime(2020, 1, 1, sh, sm)
        end = datetime(2020, 1, 1, eh, em)
        while current <= end:
            result.append(current.strftime("%H:%M"))
            current += timedelta(minutes=step)
    return result


def synthetic_intraday(day: dict[str, Any], seed: int) -> list[dict[str, Any]]:
    random.seed(seed)
    times = trading_minutes(1)
    open_price = float(day["open"])
    close_price = float(day["close"])
    high = float(day["high"])
    low = float(day["low"])
    total_volume = max(int(day.get("volume", 0)), 1)
    price = open_price
    amount_sum = 0.0
    volume_sum = 0
    points: list[dict[str, Any]] = []
    for idx, text in enumerate(times):
        progress = idx / max(len(times) - 1, 1)
        target = open_price + (close_price - open_price) * progress
        wave = math.sin(progress * math.pi * 2.4 + random.random() * 0.8) * (high - low) * 0.06
        noise = (random.random() - 0.5) * max(high - low, close_price * 0.015) * 0.12
        price = max(low, min(high, price * 0.72 + (target + wave + noise) * 0.28))
        if idx == 0:
            price = open_price
        if idx == len(times) - 1:
            price = close_price
        volume = int(total_volume / len(times) * (0.5 + random.random() * 1.7))
        volume_sum += volume
        amount_sum += volume * price
        points.append({"time": text, "price": round(price, 3), "avgPrice": round(amount_sum / max(volume_sum, 1), 3), "volume": volume})
    return points


def fetch_intraday(symbol: str, date: str, daily_bar: dict[str, Any], period: str) -> tuple[list[dict[str, Any]], str]:
    points = fetch_baostock_intraday(symbol, date, period)
    if len(points) >= 20:
        return points, "baostock"
    try:
        df = ak.stock_zh_a_hist_min_em(symbol=symbol, start_date=f"{date} 09:30:00", end_date=f"{date} 15:00:00", period=period, adjust="")
        points = normalize_minute_frame(df)
        if len(points) >= 20:
            return points, "real"
    except Exception:
        pass
    return synthetic_intraday(daily_bar, seed=sum(ord(ch) for ch in f"{symbol}-{date}")), "synthetic"


def load_intraday(symbol: str, date: str, daily_bar: dict[str, Any], period: str, store: MarketStore | None) -> tuple[list[dict[str, Any]], str]:
    if store:
        points = store.minute(symbol, date)
        if len(points) >= 20:
            return points, store.kind
        return synthetic_intraday(daily_bar, seed=sum(ord(ch) for ch in f"{symbol}-{date}")), "synthetic"
    return fetch_intraday(symbol, date, daily_bar, period)


def fetch_index_intraday(date: str, daily_bar: dict[str, Any], period: str) -> tuple[list[dict[str, Any]], str]:
    for call in (
        lambda: ak.index_zh_a_hist_min_em(symbol="000300", start_date=f"{date} 09:30:00", end_date=f"{date} 15:00:00", period=period),
        lambda: ak.stock_zh_index_hist_min_em(symbol="sh000300", start_date=f"{date} 09:30:00", end_date=f"{date} 15:00:00", period=period),
    ):
        try:
            points = normalize_minute_frame(call())
            if len(points) >= 20:
                return points, "real"
        except Exception:
            continue
    points = fetch_baostock_intraday("000300", date, period)
    if len(points) >= 20:
        return points, "baostock"
    return synthetic_intraday(daily_bar, seed=300300 + int(date.replace("-", ""))), "synthetic"


def load_index_intraday(date: str, daily_bar: dict[str, Any], period: str, store: MarketStore | None) -> tuple[list[dict[str, Any]], str]:
    if store:
        points = store.minute("000300", date)
        if len(points) >= 20:
            return points, store.kind
        return synthetic_intraday(daily_bar, seed=300300 + int(date.replace("-", ""))), "synthetic"
    return fetch_index_intraday(date, daily_bar, period)


def pct_change(a: float, b: float) -> float:
    return (b - a) / a if a else 0.0


def avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def build_future_stats(daily: list[dict[str, Any]], index: int, forward_days: int) -> dict[str, float | None]:
    current = daily[index]
    entry = float(current["open"])
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
    current = daily[index]
    prev20 = daily[index - 20:index]
    prev60 = daily[index - 60:index]
    prev120 = daily[index - 120:index]
    if len(prev20) < 20 or len(prev60) < 60 or len(prev120) < 120:
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


def fetch_basic_info(member: Member) -> dict[str, Any]:
    info = {"symbol": member.symbol, "name": member.name, "market": member.market, "industry": member.industry, "pe": 0, "pb": 0, "totalMarketCap": 0, "floatMarketCap": 0}
    try:
        df = ak.stock_individual_info_em(symbol=member.symbol)
        if not isinstance(df, pd.DataFrame) or df.empty:
            return info
        for _, row in df.iterrows():
            key = str(first_existing(row, ["item", "项目", "指标"], ""))
            value = first_existing(row, ["value", "值", "数据"], None)
            if "市盈率" in key or key.upper() == "PE":
                info["pe"] = number(value, 0)
            elif "市净率" in key or key.upper() == "PB":
                info["pb"] = number(value, 0)
            elif "总市值" in key:
                info["totalMarketCap"] = int(number(value, 0))
            elif "流通市值" in key:
                info["floatMarketCap"] = int(number(value, 0))
    except Exception:
        pass
    return info


def build_case(member: Member, stock_info: dict[str, Any], daily: list[dict[str, Any]], index_daily_by_date: dict[str, dict[str, Any]], candidate: Candidate, phase: str, args: argparse.Namespace, stock_cache: dict[str, tuple[list[dict[str, Any]], str]], index_cache: dict[str, tuple[list[dict[str, Any]], str]], store: MarketStore | None) -> tuple[dict[str, Any], bool, bool]:
    start = max(0, candidate.index - args.lookback_days)
    end = min(len(daily), candidate.index + args.forward_days + 1)
    sliced_daily = daily[start:end]
    decision_index = candidate.index - start
    decision_bar = daily[candidate.index]
    decision_date = decision_bar["date"]
    dates = [bar["date"] for bar in sliced_daily]
    index_daily = [index_daily_by_date[date] for date in dates if date in index_daily_by_date]

    def stock_points(bar: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
        date = bar["date"]
        if date not in stock_cache:
            stock_cache[date] = load_intraday(member.symbol, date, bar, args.minute_period, store)
            if stock_cache[date][1] not in {"postgres", "sqlite", "synthetic"}:
                time.sleep(args.sleep)
        return stock_cache[date]

    def index_points(bar: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
        date = bar["date"]
        index_bar = index_daily_by_date.get(date)
        if not index_bar:
            return synthetic_intraday(bar, 300300 + int(date.replace("-", ""))), "synthetic"
        if date not in index_cache:
            index_cache[date] = load_index_intraday(date, index_bar, args.minute_period, store)
            if index_cache[date][1] not in {"postgres", "sqlite", "synthetic"}:
                time.sleep(args.sleep)
        return index_cache[date]

    full_intraday, stock_source = stock_points(decision_bar)
    index_intraday, index_source = index_points(decision_bar)
    intraday_by_date = {decision_date: full_intraday}
    if phase == "history":
        for future_bar in daily[candidate.index + 1:candidate.index + args.forward_days + 1]:
            points, _ = stock_points(future_bar)
            intraday_by_date[future_bar["date"]] = points

    return {
        "id": f"{member.symbol}-{phase}-{decision_date}-{candidate.index}",
        "phase": phase,
        "stock": stock_info,
        "daily": sliced_daily,
        "indexDaily": index_daily,
        "decisionIndex": decision_index,
        "fullIntraday": full_intraday,
        "indexIntraday": index_intraday,
        "intradayByDate": intraday_by_date,
        "sceneTags": candidate.tags,
        "score": candidate.score,
        "futureStats": candidate.future_stats,
        "dataQuality": {"daily": "real", "indexDaily": "real" if index_daily else "missing", "stockIntraday": stock_source, "indexIntraday": index_source},
    }, stock_source != "synthetic", index_source != "synthetic"


def build_cases(args: argparse.Namespace) -> dict[str, Any]:
    random.seed(args.seed)
    store = connect_market_store(args)
    try:
        members = store.members(args.universe, args.member_limit) if store else fetch_universe_members(args.universe, args.member_limit)
        random.shuffle(members)
        index_daily, index_source = load_index_daily(args.start_date, args.end_date, store)
        index_daily_by_date = {bar["date"]: bar for bar in index_daily}
        history_cases: list[dict[str, Any]] = []
        current_cases: list[dict[str, Any]] = []
        real_stock_intraday = 0
        real_index_intraday = 0
        local_daily_cases = 0

        for member_no, member in enumerate(members, start=1):
            try:
                daily, daily_source = load_stock_daily(member.symbol, args.start_date, args.end_date, args.adjust, store)
                if len(daily) < args.lookback_days + args.forward_days + 10:
                    print(f"skip {member.symbol}: daily bars not enough")
                    continue
                stock_info = fetch_basic_info(member) if args.fetch_basic_info else {"symbol": member.symbol, "name": member.name, "market": member.market, "industry": member.industry, "pe": 0, "pb": 0, "totalMarketCap": 0, "floatMarketCap": 0}
                stock_cache: dict[str, tuple[list[dict[str, Any]], str]] = {}
                index_cache: dict[str, tuple[list[dict[str, Any]], str]] = {}

                selected = diversify_candidates(scan_candidates(daily, index_daily_by_date, args), args)
                for item in selected:
                    case, stock_real, index_real = build_case(member, stock_info, daily, index_daily_by_date, item, "history", args, stock_cache, index_cache, store)
                    case["dataQuality"]["daily"] = daily_source
                    case["dataQuality"]["indexDaily"] = index_source if index_daily else "missing"
                    history_cases.append(case)
                    local_daily_cases += int(daily_source in {"postgres", "sqlite"})
                    real_stock_intraday += int(stock_real)
                    real_index_intraday += int(index_real)
                    print(f"history {len(history_cases)}: {member.symbol} {member.name} {case['daily'][case['decisionIndex']]['date']} score={item.score} tags={','.join(item.tags[:3])}")
                    if args.max_history_cases and len(history_cases) >= args.max_history_cases:
                        break

                latest_index = len(daily) - 1
                current_candidate = classify_context(daily, index_daily_by_date, latest_index, 0) or Candidate(latest_index, 0, ["current"], {})
                current_candidate = Candidate(latest_index, current_candidate.score, ["current", *current_candidate.tags], {})
                if not args.current_count or len(current_cases) < args.current_count:
                    current_case, stock_real, index_real = build_case(member, stock_info, daily, index_daily_by_date, current_candidate, "current", args, stock_cache, index_cache, store)
                    current_case["dataQuality"]["daily"] = daily_source
                    current_case["dataQuality"]["indexDaily"] = index_source if index_daily else "missing"
                    current_cases.append(current_case)
                    local_daily_cases += int(daily_source in {"postgres", "sqlite"})
                    real_stock_intraday += int(stock_real)
                    real_index_intraday += int(index_real)
                    print(f"current {len(current_cases)}: {member.symbol} {member.name} {current_case['daily'][current_case['decisionIndex']]['date']}")

                if args.max_history_cases and len(history_cases) >= args.max_history_cases:
                    print("max history case count reached")
                    break
                if member_no % 20 == 0:
                    print(f"progress {member_no}/{len(members)} history={len(history_cases)} current={len(current_cases)}")
                time.sleep(args.sleep)
            except Exception as exc:
                print(f"skip {member.symbol} {member.name}: {exc}")
                continue
    finally:
        if store:
            store.close()

    if not history_cases and not current_cases:
        raise RuntimeError("没有生成任何训练题，请检查行情接口或降低筛选条件")

    return {
        "source": f"local {store.kind if store else 'external'} + AKShare/BaoStock fallback",
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "strategy": {"universe": args.universe, "lookbackDays": args.lookback_days, "forwardDays": args.forward_days, "candidateStep": args.candidate_step, "maxCasesPerStock": args.max_cases_per_stock, "minGapDays": args.min_gap_days, "minScore": args.min_score},
        "quality": {"daily": "real", "totalCases": len(history_cases) + len(current_cases), "historyCases": len(history_cases), "currentCases": len(current_cases), "localDailyCases": local_daily_cases, "realStockIntradayCases": real_stock_intraday, "realIndexIntradayCases": real_index_intraday},
        "cases": history_cases,
        "historyCases": history_cases,
        "currentCases": current_cases,
    }


def write_json(path: str, data: Any) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {output}")


def connect_case_db(args: argparse.Namespace) -> psycopg.Connection[Any]:
    return psycopg.connect(
        args.database_url,
        row_factory=dict_row,
    ) if args.database_url else psycopg.connect(
        dbname=args.db_name,
        host=args.db_host,
        user=args.db_user,
        row_factory=dict_row,
    )


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
            """
        )
        cur.execute("ALTER TABLE training_case_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ")
        cur.execute("ALTER TABLE training_case_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running'")
        cur.execute("ALTER TABLE training_case_runs ADD COLUMN IF NOT EXISTS error_text TEXT")
    conn.commit()


def write_cases_db(args: argparse.Namespace, dataset: dict[str, Any]) -> None:
    conn = connect_case_db(args)
    try:
        ensure_case_schema(conn)
        params = {
            "universe": args.universe,
            "startDate": args.start_date,
            "endDate": args.end_date,
            "lookbackDays": args.lookback_days,
            "forwardDays": args.forward_days,
            "candidateStep": args.candidate_step,
            "maxCasesPerStock": args.max_cases_per_stock,
            "maxHistoryCases": args.max_history_cases,
            "currentCount": args.current_count,
            "marketSource": args.market_source,
        }
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO training_case_runs(generated_at, source, params_json, quality_json)
                VALUES (now(), %s, %s::jsonb, %s::jsonb)
                RETURNING id
                """,
                (
                    dataset["source"],
                    json.dumps(params, ensure_ascii=False),
                    json.dumps(dataset["quality"], ensure_ascii=False),
                ),
            )
            run_id = int(cur.fetchone()["id"])
            cur.execute("UPDATE training_cases SET active = FALSE")
            rows = []
            for case in [*dataset["historyCases"], *dataset["currentCases"]]:
                decision_bar = case["daily"][case["decisionIndex"]]
                rows.append((
                    case["id"],
                    case.get("phase", "history"),
                    case["stock"]["symbol"],
                    case["stock"]["name"],
                    decision_bar["date"],
                    float(case.get("score", 0)),
                    json.dumps(case.get("sceneTags", []), ensure_ascii=False),
                    json.dumps(case, ensure_ascii=False),
                    run_id,
                ))
            cur.executemany(
                """
                INSERT INTO training_cases(
                    id, phase, symbol, name, decision_date, score, tags_json,
                    case_json, run_id, active, created_at
                )
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
                rows,
            )
        conn.commit()
        print(f"wrote database training_cases={len(dataset['historyCases']) + len(dataset['currentCases'])}")
    finally:
        conn.close()


def generation_params(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "universe": args.universe,
        "startDate": args.start_date,
        "endDate": args.end_date,
        "lookbackDays": args.lookback_days,
        "forwardDays": args.forward_days,
        "candidateStep": args.candidate_step,
        "maxCasesPerStock": args.max_cases_per_stock,
        "maxHistoryCases": args.max_history_cases,
        "currentCount": args.current_count,
        "marketSource": args.market_source,
    }


def insert_case_row(conn: psycopg.Connection[Any], run_id: int, case: dict[str, Any]) -> None:
    decision_bar = case["daily"][case["decisionIndex"]]
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO training_cases(
                id, phase, symbol, name, decision_date, score, tags_json,
                case_json, run_id, active, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, FALSE, now())
            ON CONFLICT(id) DO UPDATE SET
                phase = excluded.phase,
                symbol = excluded.symbol,
                name = excluded.name,
                decision_date = excluded.decision_date,
                score = excluded.score,
                tags_json = excluded.tags_json,
                case_json = excluded.case_json,
                run_id = excluded.run_id,
                active = FALSE,
                created_at = excluded.created_at
            """,
            (
                case["id"],
                case.get("phase", "history"),
                case["stock"]["symbol"],
                case["stock"]["name"],
                decision_bar["date"],
                float(case.get("score", 0)),
                json.dumps(case.get("sceneTags", []), ensure_ascii=False),
                json.dumps(case, ensure_ascii=False),
                run_id,
            ),
        )
    conn.commit()


def finish_stream_run(conn: psycopg.Connection[Any], run_id: int, status: str, quality: dict[str, Any], error: str = "") -> None:
    with conn.cursor() as cur:
        if status == "ok":
            cur.execute("UPDATE training_cases SET active = FALSE WHERE run_id <> %s", (run_id,))
            cur.execute("UPDATE training_cases SET active = TRUE WHERE run_id = %s", (run_id,))
        cur.execute(
            """
            UPDATE training_case_runs
               SET finished_at = now(),
                   status = %s,
                   quality_json = %s::jsonb,
                   error_text = NULLIF(%s, '')
             WHERE id = %s
            """,
            (status, json.dumps(quality, ensure_ascii=False), error, run_id),
        )
    conn.commit()


def stream_cases_to_db(args: argparse.Namespace) -> dict[str, Any]:
    random.seed(args.seed)
    store = connect_market_store(args)
    conn = connect_case_db(args)
    ensure_case_schema(conn)
    source = f"local {store.kind if store else 'external'} + AKShare/BaoStock fallback"
    empty_quality = {"daily": "real", "totalCases": 0, "historyCases": 0, "currentCases": 0, "localDailyCases": 0, "realStockIntradayCases": 0, "realIndexIntradayCases": 0}
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO training_case_runs(generated_at, status, source, params_json, quality_json)
            VALUES (now(), 'running', %s, %s::jsonb, %s::jsonb)
            RETURNING id
            """,
            (source, json.dumps(generation_params(args), ensure_ascii=False), json.dumps(empty_quality, ensure_ascii=False)),
        )
        run_id = int(cur.fetchone()["id"])
    conn.commit()

    history_count = 0
    current_count = 0
    local_daily_cases = 0
    real_stock_intraday = 0
    real_index_intraday = 0
    try:
        members = store.members(args.universe, args.member_limit) if store else fetch_universe_members(args.universe, args.member_limit)
        random.shuffle(members)
        index_daily, index_source = load_index_daily(args.start_date, args.end_date, store)
        index_daily_by_date = {bar["date"]: bar for bar in index_daily}

        for member_no, member in enumerate(members, start=1):
            try:
                daily, daily_source = load_stock_daily(member.symbol, args.start_date, args.end_date, args.adjust, store)
                if len(daily) < args.lookback_days + args.forward_days + 10:
                    print(f"skip {member.symbol}: daily bars not enough", flush=True)
                    continue
                stock_info = fetch_basic_info(member) if args.fetch_basic_info else {"symbol": member.symbol, "name": member.name, "market": member.market, "industry": member.industry, "pe": 0, "pb": 0, "totalMarketCap": 0, "floatMarketCap": 0}
                stock_cache: dict[str, tuple[list[dict[str, Any]], str]] = {}
                index_cache: dict[str, tuple[list[dict[str, Any]], str]] = {}

                selected = diversify_candidates(scan_candidates(daily, index_daily_by_date, args), args)
                for item in selected:
                    case, stock_real, index_real = build_case(member, stock_info, daily, index_daily_by_date, item, "history", args, stock_cache, index_cache, store)
                    case["dataQuality"]["daily"] = daily_source
                    case["dataQuality"]["indexDaily"] = index_source if index_daily else "missing"
                    insert_case_row(conn, run_id, case)
                    history_count += 1
                    local_daily_cases += int(daily_source in {"postgres", "sqlite"})
                    real_stock_intraday += int(stock_real)
                    real_index_intraday += int(index_real)
                    print(f"history {history_count}: {member.symbol} {member.name} {case['daily'][case['decisionIndex']]['date']} score={item.score} tags={','.join(item.tags[:3])}", flush=True)
                    if args.max_history_cases and history_count >= args.max_history_cases:
                        break

                latest_index = len(daily) - 1
                current_candidate = classify_context(daily, index_daily_by_date, latest_index, 0) or Candidate(latest_index, 0, ["current"], {})
                current_candidate = Candidate(latest_index, current_candidate.score, ["current", *current_candidate.tags], {})
                if not args.current_count or current_count < args.current_count:
                    current_case, stock_real, index_real = build_case(member, stock_info, daily, index_daily_by_date, current_candidate, "current", args, stock_cache, index_cache, store)
                    current_case["dataQuality"]["daily"] = daily_source
                    current_case["dataQuality"]["indexDaily"] = index_source if index_daily else "missing"
                    insert_case_row(conn, run_id, current_case)
                    current_count += 1
                    local_daily_cases += int(daily_source in {"postgres", "sqlite"})
                    real_stock_intraday += int(stock_real)
                    real_index_intraday += int(index_real)
                    print(f"current {current_count}: {member.symbol} {member.name} {current_case['daily'][current_case['decisionIndex']]['date']}", flush=True)

                if args.max_history_cases and history_count >= args.max_history_cases:
                    print("max history case count reached", flush=True)
                    break
                if member_no % 20 == 0:
                    print(f"progress {member_no}/{len(members)} history={history_count} current={current_count}", flush=True)
                if not store:
                    time.sleep(args.sleep)
            except Exception as exc:
                print(f"skip {member.symbol} {member.name}: {exc}", flush=True)
                continue

        if not history_count and not current_count:
            raise RuntimeError("没有生成任何训练题，请检查行情数据或降低筛选条件")

        quality = {"daily": "real", "totalCases": history_count + current_count, "historyCases": history_count, "currentCases": current_count, "localDailyCases": local_daily_cases, "realStockIntradayCases": real_stock_intraday, "realIndexIntradayCases": real_index_intraday}
        finish_stream_run(conn, run_id, "ok", quality)
        return {"source": source, "generatedAt": datetime.now().isoformat(timespec="seconds"), "quality": quality, "historyCases": history_count, "currentCases": current_count}
    except BaseException as exc:
        quality = {"daily": "real", "totalCases": history_count + current_count, "historyCases": history_count, "currentCases": current_count, "localDailyCases": local_daily_cases, "realStockIntradayCases": real_stock_intraday, "realIndexIntradayCases": real_index_intraday}
        finish_stream_run(conn, run_id, "failed", quality, str(exc))
        raise
    finally:
        if store:
            store.close()
        conn.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate dense trading trainer cases")
    parser.add_argument("--market-source", default="auto", choices=["auto", "postgres", "sqlite", "external"], help="prefer local market database before external APIs")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--db-name", default=os.environ.get("PGDATABASE", "stock_trading"))
    parser.add_argument("--db-host", default=os.environ.get("PGHOST", "/var/run/postgresql"))
    parser.add_argument("--db-user", default=os.environ.get("PGUSER", os.environ.get("USER", "root")))
    parser.add_argument("--market-sqlite", default="data/market.db")
    parser.add_argument("--start-date", default="20200101")
    parser.add_argument("--end-date", default=datetime.now().strftime("%Y%m%d"))
    parser.add_argument("--adjust", default="qfq", choices=["", "qfq", "hfq"])
    parser.add_argument("--minute-period", default="5", choices=["1", "5", "15", "30", "60"])
    parser.add_argument("--universe", default="csi800", choices=["hs300", "csi500", "csi800"])
    parser.add_argument("--member-limit", type=int, default=300)
    parser.add_argument("--lookback-days", type=int, default=140)
    parser.add_argument("--forward-days", type=int, default=20)
    parser.add_argument("--candidate-step", type=int, default=5)
    parser.add_argument("--max-cases-per-stock", type=int, default=12)
    parser.add_argument("--max-same-tag-per-stock", type=int, default=3)
    parser.add_argument("--min-gap-days", type=int, default=30)
    parser.add_argument("--min-score", type=float, default=1.8)
    parser.add_argument("--max-history-cases", type=int, default=0, help="0 means no global cap")
    parser.add_argument("--current-count", type=int, default=0, help="0 means one latest case per processed stock")
    parser.add_argument("--sleep", type=float, default=0.18)
    parser.add_argument("--seed", type=int, default=20260629)
    parser.add_argument("--fetch-basic-info", action="store_true", help="call AKShare for PE/PB/market-cap enrichment")
    parser.add_argument("--write-json", action="store_true", help="also write public JSON files for static fallback")
    parser.add_argument("--skip-db", action="store_true", help="do not write generated cases into PostgreSQL")
    parser.add_argument("--output", default="public/data/training-cases.json")
    parser.add_argument("--history-output", default="public/data/history-cases.json")
    parser.add_argument("--current-output", default="public/data/current-cases.json")
    return parser.parse_args()


def main() -> None:
    try:
        args = parse_args()
        if not args.skip_db and not args.write_json:
            result = stream_cases_to_db(args)
            print(f"done: history={result['historyCases']}, current={result['currentCases']}")
            return

        dataset = build_cases(args)
        if not args.skip_db:
            write_cases_db(args, dataset)
        if args.write_json or args.skip_db:
            write_json(args.output, dataset)
            write_json(args.history_output, {"source": dataset["source"], "generatedAt": dataset["generatedAt"], "strategy": dataset["strategy"], "quality": dataset["quality"], "cases": dataset["historyCases"]})
            write_json(args.current_output, {"source": dataset["source"], "generatedAt": dataset["generatedAt"], "strategy": dataset["strategy"], "quality": dataset["quality"], "cases": dataset["currentCases"]})
        print(f"done: history={len(dataset['historyCases'])}, current={len(dataset['currentCases'])}")
    finally:
        if BAOSTOCK_LOGGED_IN:
            bs.logout()


if __name__ == "__main__":
    main()
