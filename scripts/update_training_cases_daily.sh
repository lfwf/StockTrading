#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

END_DATE="${1:-$(date +%Y%m%d)}"
PYTHON="${PYTHON:-.venv/bin/python}"

"$PYTHON" scripts/sync_akshare.py \
  --market-source postgres \
  --start-date 20200101 \
  --end-date "$END_DATE" \
  --adjust qfq \
  --minute-period 5 \
  --universe csi800 \
  --member-limit 300 \
  --lookback-days 140 \
  --forward-days 20 \
  --candidate-step 5 \
  --max-cases-per-stock 12 \
  --max-history-cases 0 \
  --current-count 0 \
  --sleep 0
