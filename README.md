# 盲盘训练｜A 股买入决策挑战

这是一个面向 A 股交易行为训练的工具。它不是荐股工具，也不是完整回测系统，而是把用户放回历史某个交易时刻，或进入最新盘面演练，在只看到当时可见数据的情况下做模拟买入、放弃或继续观察。

## 产品模块

- 首页：20 题交易习惯测试入口、模块导航、训练状态概览
- 基础知识：买点判断、分时陷阱、仓位止损、交易心理等训练前知识
- 历史盲盘训练：随机历史阶段，隐藏未来数据，适合训练买入纪律
- 当前盘面训练：使用最新交易日数据做当下盘面演练，不作为荐股依据
- 错题画像：查看高频错误标签、最近错题、模拟交易统计
- 账号：MVP 阶段先提供本地账号，后续可接正式后端登录

## 已实现

- 两种训练阶段：随机历史阶段、当前最新阶段
- 历史走势显示日 K、周 K、月 K
- 当天走势显示分时图
- 开盘/午间模式严格隐藏当天完整日 K
- 顶部独立控制：显示/隐藏股票和日期
- 右侧模拟交易面板：买入价、涨跌幅、成交量、PE、PB、市值等
- 决策动作：模拟买入、模拟卖出、放弃、下一小时、下一交易日
- 买前检查清单：大盘、趋势、买点、分时、止损、真实动机
- 专项训练模式：随机盲盘、冲动买入矫正、突破判断、弱势大盘、回踩低吸、只练错题
- 错题本：自动收集买入后大回撤、买入后亏损、放弃后大涨等样本
- 复盘解释卡：根据短线追高、大周期逆势、上午冲高回落等标签给出学习提示
- 10 万元连续模拟账户，按 100 股整数手分批买卖
- 遵守 A 股 T+1：当天买入的持仓下一交易日才可卖出
- 可按下一小时或下一交易日推进真实 5 分钟行情
- PostgreSQL 记录行情库、训练题库、成交、账户权益
- 前端按需请求下一题，不再一次性加载全量题库
- 移动端适配：小屏幕自动切换为单列布局

## 运行前端

```bash
npm install
npm run dev
```

生产运行：

```bash
npm run build
npm run start
```

Node 服务同时提供静态页面和交易记录 API。数据库默认连接本机 PostgreSQL：

```text
database: stock_trading
host: /var/run/postgresql
user: 当前运行用户
```

也可以通过 `DATABASE_URL`、`PGDATABASE`、`PGHOST`、`PGUSER` 覆盖连接配置。

## 数据库优先的数据架构

当前数据流已经调整为数据库优先：

```text
AKShare / BaoStock / 其他行情源
  ↓
scripts/sync_market_db.py
  ↓
PostgreSQL: members / daily_bars / minute_bars
  ↓
scripts/generate_cases_from_db.py
  ↓
PostgreSQL: training_case_runs / training_cases
  ↓
Node API: /api/training-cases/next
  ↓
React 前端按需加载一道题
```

原则：

- 外部行情接口只出现在行情同步阶段。
- 题库生成只读取 PostgreSQL 行情库，不再在线请求 AKShare/BaoStock。
- 前端不再下载全量题库，只拿少量初始样本，点击下一题时请求 `/api/training-cases/next`。
- 分钟线推进从 `minute_bars` 查询，不再每次 HTTP 请求启动 Python 子进程。

## 初始化与每日更新

先安装 Python 依赖：

```bash
pip install -r requirements.txt
```

首次同步行情库：

```bash
bash scripts/run_market_sync.sh \
  --universe csi800 \
  --member-limit 800 \
  --daily-start 19900101 \
  --minute-start 20200101 \
  --end-date 20260629 \
  --minute-frequency 5
```

从数据库生成训练题库：

```bash
python scripts/generate_cases_from_db.py \
  --start-date 2020-01-01 \
  --end-date 2026-06-29 \
  --member-limit 800 \
  --lookback-days 140 \
  --forward-days 20 \
  --candidate-step 5 \
  --max-cases-per-stock 12 \
  --max-history-cases 0 \
  --current-count 0
```

也可以直接执行每日流水线：

```bash
bash scripts/update_training_cases_daily.sh
```

指定截止日期：

```bash
bash scripts/update_training_cases_daily.sh 20260629
```

建议放到服务器定时任务里，在 A 股收盘、数据源完成更新后执行，例如每天 18:30：

```cron
30 18 * * 1-5 cd /path/to/StockTrading && bash scripts/update_training_cases_daily.sh >> logs/daily-pipeline.log 2>&1
```

## 题库生成算法

`generate_cases_from_db.py` 不直接请求行情接口，只读取数据库中的 `members / daily_bars / minute_bars`。

```text
members 股票池
  ↓
读取每只股票 daily_bars
  ↓
扫描多个候选决策日
  ↓
计算趋势、量能、位置、大盘强弱、未来收益和回撤
  ↓
打标签：breakout / pullback / impulse / weak_market / strong_vs_market / chase_high_risk / downtrend_trap 等
  ↓
按训练价值评分
  ↓
同一股票按最小间隔和标签上限去重
  ↓
写入 training_cases(history)
  ↓
取每只股票最新交易日写入 training_cases(current)
```

历史题默认保留：

- 决策日前 `140` 个交易日，用于看日线、周线、月线和大盘环境
- 决策日后 `20` 个交易日，用于复盘买入后的收益和回撤

当前盘面题默认每只股票生成一道，取该股票 `daily_bars` 里的最新交易日。

## 主要 API

```text
GET /api/training-cases/summary
GET /api/training-cases/next?phase=history&presets=breakout
GET /api/training-cases/next?phase=current
GET /api/training-cases/:id
GET /api/market/intraday?symbol=600519&date=2026-06-29
GET /api/market/status
```

兼容接口：

```text
GET /api/training-cases
```

该接口现在只返回每个阶段少量初始样本，不再返回全量题库。

## 数据同步参数

行情同步常用参数：

- `--daily-start`：日线补齐开始日期，格式 `YYYYMMDD`
- `--minute-start`：分钟线补齐开始日期，格式 `YYYYMMDD`
- `--end-date`：同步截止日期，格式 `YYYYMMDD`
- `--universe`：股票池，支持 `hs300/csi500/csi800`
- `--member-limit`：尝试同步多少只股票
- `--minute-frequency`：分钟线周期，支持 `5/15/30/60`
- `--daily-only`：只同步日线
- `--minute-only`：只同步分钟线
- `--symbols`：只同步指定股票，例如 `600519,300750`

题库生成常用参数：

- `--start-date`：题库生成使用的行情开始日期，格式 `YYYY-MM-DD`
- `--end-date`：题库生成使用的行情结束日期，格式 `YYYY-MM-DD`
- `--lookback-days`：每道题保留多少根决策日前日线
- `--forward-days`：历史题保留多少根决策日后日线
- `--candidate-step`：每隔多少个交易日扫描一个候选点
- `--max-cases-per-stock`：每只股票最多生成多少道历史题
- `--max-same-tag-per-stock`：同一股票同一主标签最多保留多少道题
- `--min-gap-days`：同一股票两道题之间最少间隔多少个交易日
- `--min-score`：候选题最低训练价值分
- `--max-history-cases`：历史题库全局上限，`0` 表示不限制
- `--current-count`：当前盘面题库上限，`0` 表示每只成功处理的股票生成一道

## 兼容说明

`scripts/sync_akshare.py` 仍然保留为旧入口，但正式流程应优先使用：

```bash
scripts/run_market_sync.sh
python scripts/generate_cases_from_db.py
```

静态 JSON 文件 `public/data/training-cases.json` 只作为兼容兜底，不再是主要数据来源。

## 后续上线建议

上线前还需要继续补强：

- 把本地账号替换为正式账号系统
- 将错题本和个人画像写入后端数据库
- 增加训练报告分享图
- 增加后台管理模块：数据更新时间、异常行情、用户反馈、训练完成率
- 当前盘面训练明确显示数据更新时间
- 增加正式隐私政策、用户协议和风险提示页面

## 合规定位

核心不是预测股票，而是训练交易行为：

> 回到历史某一刻，只看当时能看到的数据，判断你是否真的应该模拟买入。

本产品仅用于模拟训练、交易行为复盘和投资者教育，不构成任何证券投资建议。
