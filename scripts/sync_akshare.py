#!/usr/bin/env python3
"""Generate blind trading training cases from AKShare.

The React app reads public/data/training-cases.json. This script fetches a small,
front-end friendly dataset and writes it in the same shape as the app domain type.

Usage:
    python scripts/sync_akshare.py --case-count 40 --member-limit 80

Notes:
    - AKShare interfaces can change. The script intentionally uses column and
      function fallbacks instead of assuming one rigid schema.
    - Historical intraday availability depends on the upstream data source. If
      minute data for a historical date is unavailable, the script builds a
      deterministic intraday curve from the daily OHLC bar so the product can
      still run. Replace that fallback after you confirm a stable minute source.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import signal
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import akshare as ak
import baostock as bs
import pandas as pd


FALLBACK_MEMBERS = [
    {"symbol": "600519", "name": "贵州茅台", "industry": "白酒", "market": "沪市"},
    {"symbol": "300750", "name": "宁德时代", "industry": "电力设备", "market": "深市"},
    {"symbol": "600036", "name": "招商银行", "industry": "银行", "market": "沪市"},
    {"symbol": "000858", "name": "五粮液", "industry": "白酒", "market": "深市"},
    {"symbol": "601318", "name": "中国平安", "industry": "非银金融", "market": "沪市"},
    {"symbol": "600276", "name": "恒瑞医药", "industry": "医药生物", "market": "沪市"},
    {"symbol": "000333", "name": "美的集团", "industry": "家用电器", "market": "深市"},
    {"symbol": "002415", "name": "海康威视", "industry": "计算机", "market": "深市"},
]

BAOSTOCK_LOGGED_IN = False


@dataclass
class Member:
    symbol: str
    name: str
    industry: str = "沪深300"
    market: str = "沪市"


def first_existing(row: pd.Series, candidates: list[str], default: Any = "") -> Any:
    for key in candidates:
        if key in row and pd.notna(row[key]):
            return row[key]
    return default


def first_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for key in candidates:
        if key in df.columns:
            return key
    return None


def normalize_symbol(value: Any) -> str:
    text = str(value).strip()
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) >= 6:
        return digits[-6:]
    return text.zfill(6)


def infer_market(symbol: str) -> str:
    return "沪市" if symbol.startswith("6") else "深市"


def fetch_index_members(index_symbol: str, label: str, limit: int, fallback: list[dict[str, str]] | None = None) -> list[Member]:
    candidates: list[list[Member]] = []

    # Use multiple free AKShare constituent sources. Some upstream endpoints can
    # occasionally return an incomplete list, so we normalize each result and
    # choose the most complete one instead of trusting the first response.
    for call in (
        lambda: ak.index_stock_cons(symbol=index_symbol),
        lambda: ak.index_stock_cons_weight_csindex(symbol=index_symbol),
        lambda: ak.index_stock_cons_sina(symbol=index_symbol),
    ):
        try:
            frame = call_with_timeout(call, seconds=12)
            if isinstance(frame, pd.DataFrame) and not frame.empty:
                members = normalize_member_frame(frame, default_industry=label)
                if members:
                    candidates.append(members)
        except Exception:
            continue

    if not candidates:
        return [Member(**item) for item in (fallback or [])[:limit]]

    candidates.sort(key=len, reverse=True)
    members = candidates[0]
    return members[:limit]


def merge_members(groups: list[list[Member]], limit: int) -> list[Member]:
    merged: list[Member] = []
    seen: set[str] = set()
    for group in groups:
        for member in group:
            if member.symbol in seen:
                continue
            seen.add(member.symbol)
            merged.append(member)
            if len(merged) >= limit:
                return merged
    return merged


def fetch_hs300_members(limit: int) -> list[Member]:
    return fetch_index_members("000300", "沪深300", limit, FALLBACK_MEMBERS)


def fetch_csi500_members(limit: int) -> list[Member]:
    return fetch_index_members("000905", "中证500", limit)


def fetch_universe_members(universe: str, limit: int) -> list[Member]:
    if universe == "hs300":
        return fetch_hs300_members(limit)
    if universe == "csi500":
        return fetch_csi500_members(limit)
    if universe == "csi800":
        return merge_members([fetch_hs300_members(300), fetch_csi500_members(500)], limit)
    raise ValueError(f"unsupported universe: {universe}")


def call_with_timeout(call: Any, seconds: int) -> Any:
    def raise_timeout(_signum: int, _frame: Any) -> None:
        raise TimeoutError(f"AKShare call timed out after {seconds}s")

    previous_handler = signal.signal(signal.SIGALRM, raise_timeout)
    signal.alarm(seconds)
    try:
        return call()
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)


def normalize_member_frame(df: pd.DataFrame, default_industry: str = "沪深300") -> list[Member]:
    frame = df.copy()
    members: list[Member] = []
    seen: set[str] = set()
    for _, row in frame.iterrows():
        symbol = normalize_symbol(first_existing(row, ["品种代码", "成分券代码", "证券代码", "代码", "stock_code", "code"]))
        if not symbol or len(symbol) != 6 or symbol in seen:
            continue
        seen.add(symbol)
        name = str(first_existing(row, ["品种名称", "成分券名称", "证券简称", "名称", "stock_name", "name"], symbol)).strip()
        industry = str(first_existing(row, ["行业", "所属行业", "中证行业", "industry"], default_industry)).strip() or default_industry
        members.append(Member(symbol=symbol, name=name, industry=industry, market=infer_market(symbol)))
    return members


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


def ensure_baostock_login() -> bool:
    global BAOSTOCK_LOGGED_IN
    if BAOSTOCK_LOGGED_IN:
        return True
    result = bs.login()
    BAOSTOCK_LOGGED_IN = result.error_code == "0"
    return BAOSTOCK_LOGGED_IN


def baostock_code(symbol: str) -> str:
    return f"sh.{symbol}" if symbol == "000300" or symbol.startswith("6") else f"sz.{symbol}"


def fetch_baostock_intraday(symbol: str, date: str, period: str) -> list[dict[str, Any]]:
    if period not in {"5", "15", "30", "60"} or not ensure_baostock_login():
        return []
    result = bs.query_history_k_data_plus(
        baostock_code(symbol),
        "date,time,open,high,low,close,volume,amount",
        start_date=date,
        end_date=date,
        frequency=period,
        adjustflag="2",
    )
    if result.error_code != "0":
        return []

    points: list[dict[str, Any]] = []
    amount_sum = 0.0
    volume_sum = 0.0
    while result.next():
        row = dict(zip(result.fields, result.get_row_data()))
        price = number(row.get("close"))
        volume = number(row.get("volume"))
        volume_sum += volume
        amount_sum += price * volume
        raw_time = str(row.get("time", ""))
        points.append({
            "time": f"{raw_time[8:10]}:{raw_time[10:12]}",
            "price": round(price, 3),
            "avgPrice": round(amount_sum / volume_sum, 3) if volume_sum else round(price, 3),
            "volume": int(volume),
        })
    return points


def fetch_stock_daily(symbol: str, start_date: str, end_date: str, adjust: str) -> list[dict[str, Any]]:
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            df = call_with_timeout(
                lambda: ak.stock_zh_a_hist(symbol=symbol, period="daily", start_date=start_date, end_date=end_date, adjust=adjust),
                seconds=20,
            )
            bars = normalize_daily_frame(df)
            if bars:
                return bars
        except Exception as exc:
            last_error = exc
            time.sleep(0.8 * (attempt + 1))

    # Sina is an independent real-market-data source and avoids making the
    # entire sync depend on Eastmoney's availability or throttling behavior.
    try:
        market_symbol = f"sh{symbol}" if symbol.startswith("6") else f"sz{symbol}"
        df = call_with_timeout(
            lambda: ak.stock_zh_a_daily(
                symbol=market_symbol,
                start_date=start_date,
                end_date=end_date,
                adjust=adjust,
            ),
            seconds=20,
        )
        if "turnover" in df.columns:
            df = df.copy()
            df["turnover"] = df["turnover"].map(lambda value: number(value) * 100)
        bars = normalize_daily_frame(df)
        if bars:
            return bars
    except Exception as exc:
        last_error = exc

    raise RuntimeError(f"无法获取 {symbol} 真实日线: {last_error}")


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
            df = call()
            bars = normalize_daily_frame(df)
            return [bar for bar in bars if start_date <= bar["date"].replace("-", "") <= end_date]
        except Exception as exc:
            last_error = exc
            continue
    raise RuntimeError(f"无法获取沪深300指数日线: {last_error}")


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
        bar = {
            "date": pd.to_datetime(row[date_col]).strftime("%Y-%m-%d"),
            "open": round(number(row[open_col]), 3),
            "high": round(number(row[high_col]), 3),
            "low": round(number(row[low_col]), 3),
            "close": round(close, 3),
            "preClose": round(pre_close or close, 3),
            "volume": int(number(row[volume_col], 0)) if volume_col else 0,
            "amount": int(number(row[amount_col], 0)) if amount_col else 0,
            "turnoverRate": round(number(row[turnover_col], 0), 3) if turnover_col else 0,
        }
        bars.append(bar)
        pre_close = close
    return bars


def fetch_intraday(symbol: str, date: str, daily_bar: dict[str, Any], period: str) -> tuple[list[dict[str, Any]], str]:
    points = fetch_baostock_intraday(symbol, date, period)
    if len(points) >= 20:
        return points, "baostock"

    start = f"{date} 09:30:00"
    end = f"{date} 15:00:00"
    try:
        df = ak.stock_zh_a_hist_min_em(symbol=symbol, start_date=start, end_date=end, period=period, adjust="")
        points = normalize_minute_frame(df)
        if len(points) >= 20:
            return points, "real"
    except Exception:
        pass
    return synthetic_intraday(daily_bar, seed=sum(ord(ch) for ch in f"{symbol}-{date}")), "synthetic"


def fetch_index_intraday(date: str, daily_bar: dict[str, Any], period: str) -> tuple[list[dict[str, Any]], str]:
    start = f"{date} 09:30:00"
    end = f"{date} 15:00:00"
    for call in (
        lambda: ak.index_zh_a_hist_min_em(symbol="000300", start_date=start, end_date=end, period=period),
        lambda: ak.stock_zh_index_hist_min_em(symbol="sh000300", start_date=start, end_date=end, period=period),
    ):
        try:
            df = call()
            points = normalize_minute_frame(df)
            if len(points) >= 20:
                return points, "real"
        except Exception:
            continue
    points = fetch_baostock_intraday("000300", date, period)
    if len(points) >= 20:
        return points, "baostock"
    return synthetic_intraday(daily_bar, seed=300300 + int(date.replace("-", ""))), "synthetic"


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
        amount = number(row[amount_col], 0) if amount_col else price * volume
        volume_sum += volume
        amount_sum += amount
        avg_price = amount_sum / volume_sum if volume_sum else price
        points.append({
            "time": dt.strftime("%H:%M"),
            "price": round(price, 3),
            "avgPrice": round(avg_price, 3),
            "volume": int(volume),
        })
    return points


def trading_minutes(step: int = 1) -> list[str]:
    result: list[str] = []
    windows = [(9, 30, 11, 30), (13, 0, 15, 0)]
    for sh, sm, eh, em in windows:
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
    points: list[dict[str, Any]] = []
    amount_sum = 0.0
    volume_sum = 0
    price = open_price

    for index, text in enumerate(times):
        progress = index / max(len(times) - 1, 1)
        target = open_price + (close_price - open_price) * progress
        wave = math.sin(progress * math.pi * 2.4 + random.random() * 0.8) * (high - low) * 0.06
        noise = (random.random() - 0.5) * max(high - low, close_price * 0.015) * 0.12
        price = max(low, min(high, price * 0.72 + (target + wave + noise) * 0.28))
        if index == 0:
            price = open_price
        if index == len(times) - 1:
            price = close_price
        volume = int(total_volume / len(times) * (0.5 + random.random() * 1.7))
        volume_sum += volume
        amount_sum += volume * price
        points.append({
            "time": text,
            "price": round(price, 3),
            "avgPrice": round(amount_sum / max(volume_sum, 1), 3),
            "volume": volume,
        })
    return points


def fetch_basic_info(member: Member) -> dict[str, Any]:
    info = {
        "symbol": member.symbol,
        "name": member.name,
        "market": member.market,
        "industry": member.industry,
        "pe": 0,
        "pb": 0,
        "totalMarketCap": 0,
        "floatMarketCap": 0,
    }
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


def choose_decision_index(daily: list[dict[str, Any]]) -> int | None:
    if len(daily) < 130:
        return None
    min_index = 75
    max_index = len(daily) - 25
    if max_index <= min_index:
        return None
    return random.randint(min_index, max_index)


def build_cases(args: argparse.Namespace) -> dict[str, Any]:
    random.seed(args.seed)
    members = fetch_hs300_members(args.member_limit)
    random.shuffle(members)
    index_daily = fetch_index_daily(args.start_date, args.end_date)
    if len(index_daily) < 130:
        raise RuntimeError("沪深300指数日线不足，无法生成训练题")
    index_daily_by_date = {bar["date"]: bar for bar in index_daily}

    cases: list[dict[str, Any]] = []
    real_stock_intraday = 0
    real_index_intraday = 0
    for member in members:
        if len(cases) >= args.case_count:
            break
        try:
            daily = fetch_stock_daily(member.symbol, args.start_date, args.end_date, args.adjust)
            decision_index = choose_decision_index(daily)
            if decision_index is None:
                print(f"skip {member.symbol}: daily bars not enough")
                continue

            decision_bar = daily[decision_index]
            date = decision_bar["date"]
            index_bar = index_daily_by_date.get(date)
            if index_bar is None:
                print(f"skip {member.symbol}: no HS300 index bar for {date}")
                continue
            stock_intraday, stock_intraday_source = fetch_intraday(member.symbol, date, decision_bar, args.minute_period)
            index_intraday, index_intraday_source = fetch_index_intraday(date, index_bar, args.minute_period)
            intraday_by_date = {date: stock_intraday}
            for future_bar in daily[decision_index + 1:decision_index + 21]:
                future_points, _ = fetch_intraday(member.symbol, future_bar["date"], future_bar, args.minute_period)
                intraday_by_date[future_bar["date"]] = future_points
            real_stock_intraday += stock_intraday_source != "synthetic"
            real_index_intraday += index_intraday_source != "synthetic"
            case = {
                "id": f"{member.symbol}-{date}-{len(cases)}",
                "stock": fetch_basic_info(member),
                "daily": daily,
                "indexDaily": index_daily,
                "decisionIndex": decision_index,
                "fullIntraday": stock_intraday,
                "indexIntraday": index_intraday,
                "intradayByDate": intraday_by_date,
                "dataQuality": {
                    "daily": "real",
                    "indexDaily": "real",
                    "stockIntraday": stock_intraday_source,
                    "indexIntraday": index_intraday_source,
                },
            }
            cases.append(case)
            print(f"case {len(cases)}/{args.case_count}: {member.symbol} {member.name} {date}")
            time.sleep(args.sleep)
        except Exception as exc:
            print(f"skip {member.symbol} {member.name}: {exc}")
            continue

    if not cases:
        raise RuntimeError("没有生成任何训练题；请检查 AKShare 网络、接口或降低筛选条件")

    return {
        "source": "AKShare + BaoStock",
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "quality": {
            "daily": "real",
            "totalCases": len(cases),
            "realStockIntradayCases": real_stock_intraday,
            "realIndexIntradayCases": real_index_intraday,
        },
        "cases": cases,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync AKShare data for blind trading trainer")
    parser.add_argument("--start-date", default="20220101", help="AKShare start date, e.g. 20220101")
    parser.add_argument("--end-date", default=datetime.now().strftime("%Y%m%d"), help="AKShare end date, e.g. 20260625")
    parser.add_argument("--adjust", default="qfq", choices=["", "qfq", "hfq"], help="stock price adjustment")
    parser.add_argument("--minute-period", default="5", choices=["1", "5", "15", "30", "60"], help="minute period")
    parser.add_argument("--member-limit", type=int, default=80, help="number of HS300 members to try")
    parser.add_argument("--case-count", type=int, default=40, help="number of training cases to generate")
    parser.add_argument("--sleep", type=float, default=0.25, help="sleep seconds between stock requests")
    parser.add_argument("--seed", type=int, default=20260625)
    parser.add_argument("--output", default="public/data/training-cases.json")
    return parser.parse_args()


def main() -> None:
    try:
        args = parse_args()
        dataset = build_cases(args)
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {output} with {len(dataset['cases'])} cases")
    finally:
        if BAOSTOCK_LOGGED_IN:
            bs.logout()


if __name__ == "__main__":
    main()
