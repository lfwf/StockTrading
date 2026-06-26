#!/usr/bin/env python3
"""Fetch one real BaoStock intraday trading day and print JSON."""

from __future__ import annotations

import json
import sys

import sync_akshare as sync


def main() -> None:
    symbol, date = sys.argv[1], sys.argv[2]
    try:
        points = sync.fetch_baostock_intraday(symbol, date, "5")
        print(json.dumps({"source": "baostock", "points": points}, ensure_ascii=False))
    finally:
        if sync.BAOSTOCK_LOGGED_IN:
            sync.bs.logout()


if __name__ == "__main__":
    main()
