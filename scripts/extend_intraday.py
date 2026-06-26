#!/usr/bin/env python3
"""Add future trading-day intraday bars to an existing training dataset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import sync_akshare as sync


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="public/data/training-cases.json")
    parser.add_argument("--days", type=int, default=20)
    parser.add_argument("--period", default="5", choices=["5", "15", "30", "60"])
    args = parser.parse_args()

    path = Path(args.input)
    dataset = json.loads(path.read_text(encoding="utf-8"))

    try:
        for case_index, case in enumerate(dataset["cases"], 1):
            start = case["decisionIndex"]
            bars = case["daily"][start:start + args.days + 1]
            intraday_by_date = {}
            for day_index, bar in enumerate(bars, 1):
                points, source = sync.fetch_intraday(case["stock"]["symbol"], bar["date"], bar, args.period)
                intraday_by_date[bar["date"]] = points
                print(
                    f"case {case_index}/{len(dataset['cases'])} "
                    f"day {day_index}/{len(bars)} {case['stock']['symbol']} "
                    f"{bar['date']} {source} {len(points)}"
                )
            case["intradayByDate"] = intraday_by_date
            case["fullIntraday"] = intraday_by_date[bars[0]["date"]]
            path.write_text(
                json.dumps(dataset, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
    finally:
        if sync.BAOSTOCK_LOGGED_IN:
            sync.bs.logout()


if __name__ == "__main__":
    main()
