#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p logs data

exec .venv/bin/python -u scripts/sync_market_db.py "$@" >> logs/market-sync.log 2>&1
