#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p logs data

END_DATE="${1:-$(date +%Y%m%d)}"
PYTHON="${PYTHON:-.venv/bin/python}"

# 1) 先更新本地股票行情库。外部行情接口只允许出现在这个阶段。
scripts/run_market_sync.sh \
  --end-date "$END_DATE" \
  --universe csi800 \
  --member-limit 800 \
  --minute-frequency 5

# 2) 同步沪深300基准指数日线，供题库评分和大盘图使用。
"$PYTHON" -u scripts/sync_index_db.py \
  --start-date 20200101 \
  --end-date "$END_DATE" \
  >> logs/index-sync.log 2>&1

# 3) 再从 PostgreSQL 行情库生成训练题库。这里不再请求 AKShare/BaoStock。
"$PYTHON" -u scripts/generate_cases_from_db.py \
  --start-date 2020-01-01 \
  --end-date "${END_DATE:0:4}-${END_DATE:4:2}-${END_DATE:6:2}" \
  --member-limit 800 \
  --lookback-days 140 \
  --forward-days 20 \
  --candidate-step 5 \
  --max-cases-per-stock 12 \
  --max-history-cases 0 \
  --current-count 0 \
  >> logs/case-generate.log 2>&1
