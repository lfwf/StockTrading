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
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import akshare as ak
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


def fetch_hs300_members(limit: int) -> list[Member]:
    frames: list[pd.DataFrame] = []

    # Common AKShare path for CSI index constituents.
    for call in (
        lambda: ak.index_stock_cons(symbol="000300"),
        lambda: ak.index_stock_cons_csindex(symbol="000300"),
    ):
        try:
            frame = call()
            if isinstance(frame, pd.DataFrame) and not frame.empty:
                frames.append(frame)
                break
        except Exception:
            continue

    if not frames:
        return [Member(**item) for item in FALLBACK_MEMBERS[:limit]]

    df = frames[0].copy()
    members: list[Member] = []
    for _, row in df.iterrows():
        symbol = normalize_symbol(first_existing(row, ["品种代码", "成分券代码", "证券代码", "代码", "stock_code", "code"]))
        if not symbol or len(symbol) != 6:
            continue
        name = str(first_existing(row, ["品种名称", "成分券名称", "证券简称", "名称", "stock_name", "name"], symbol)).strip()
        industry = str(first_existing(row, ["行业", "所属行业", "中证行业", "industry"], "沪深300")).strip() or "沪深300"
        members.append(Member(symbol=symbol, name=name, industry=industry, market=infer_market(symbol)))

    return members[:limit] if members else [Member(**item) for item in FALLBACK_MEMBERS[:limit]]


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


def fetch_stock_daily(symbol: str, start_date: str, end_date: str, adjust: str) -> list[dict[str, Any]]:
    df = ak.stock_zh_a_hist(symbol=symbol, period="daily", start_date=start_date, end_date=end_date, adjust=adjust)
    return normalize_daily_frame(df)


def fetch_index_daily(start_date: str, end_date: str) -> list[dict[str, Any]]:
    attempts = [
        lambda: ak.stock_zh_index_daily_em(symbol="sh000300"),
        lambda: ak.index_zh_a_hist(symbol="000300", period="daily", start_date=start_date, end_date=end_date),
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


def fetch_intraday(symbol: str, date: str, daily_bar: dict[str, Any], period: str) -> list[dict[str, Any]]:
    start = f"{date} 09:30:00"
    end = f"{date} 15:00:00"
    try:
        df = ak.stock_zh_a_hist_min_em(symbol=symbol, start_date=start, end_date=end, period=period, adjust="")
        points = normalize_minute_frame(df)
        if len(points) >= 20:
            return points
    except Exception:
        pass
    return synthetic_intraday(daily_bar, seed=sum(ord(ch) for ch in f"{symbol}-{date}"))


def fetch_index_intraday(date: str, daily_bar: dict[str, Any], period: str) -> list[dict[str, Any]]:
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
                return points
        except Exception:
            continue
    return synthetic_intraday(daily_bar, seed=300300 + int(date.replace("-", "")))


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

    cases: list[dict[str, Any]] = []
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
            index_bar = index_daily[decision_index] if decision_index < len(index_daily) else index_daily[-1]
            case = {
                "id": f"{member.symbol}-{date}-{len(cases)}",
                "stock": fetch_basic_info(member),
                "daily": daily,
                "indexDaily": index_daily,
                "decisionIndex": decision_index,
                "fullIntraday": fetch_intraday(member.symbol, date, decision_bar, args.minute_period),
                "indexIntraday": fetch_index_intraday(date, index_bar, args.minute_period),
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
        "source": "AKShare",
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
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
    args = parse_args()
    dataset = build_cases(args)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {output} with {len(dataset['cases'])} cases")


if __name__ == "__main__":
    main()
