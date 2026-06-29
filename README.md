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
- 清仓后进入下一题，资金与累计收益跨题保留
- PostgreSQL 后台记录每笔成交、已实现盈亏与账户权益
- AKShare + BaoStock 数据同步脚本：生成历史题库和当前盘面题库
- 前端自动加载同步数据；如果数据文件不存在，自动回退到模拟数据
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

## 使用 AKShare + BaoStock 生成训练数据

先安装 Python 依赖：

```bash
pip install -r requirements.txt
```

然后生成数据：

```bash
python scripts/sync_akshare.py \
  --start-date 20200101 \
  --end-date 20260629 \
  --adjust qfq \
  --minute-period 5 \
  --universe csi800 \
  --member-limit 300 \
  --lookback-days 140 \
  --forward-days 20 \
  --candidate-step 5 \
  --max-cases-per-stock 12 \
  --max-history-cases 0 \
  --current-count 0
```

生成结果会写入：

```text
public/data/training-cases.json
public/data/history-cases.json
public/data/current-cases.json
```

前端启动后会读取 `public/data/training-cases.json`。其中：

- `historyCases`：历史盲盘题库。一只股票会扫描多个候选日期，按场景特征评分、去重后生成多道题。
- `currentCases`：当前盘面题库。每只股票取最新交易日生成一道当前盘面题。
- `cases`：兼容旧前端字段，等同于 `historyCases`。

页面顶部“数据源”显示 `AKShare + BaoStock` 时，说明已经使用真实行情生成训练题；如果显示“模拟数据”，说明还没有生成数据文件或文件读取失败。

## 题库生成算法

当前脚本不再是一只股票只随机生成一道题，而是按下面的方式生成：

```text
股票池
  ↓
逐只股票拉取完整日线
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
生成历史题库 historyCases
  ↓
取每只股票最新交易日生成 currentCases
```

历史题库每道题只保留决策日前后的必要窗口，默认保留：

- 决策日前 `140` 个交易日，用于看日线、周线、月线和大盘环境
- 决策日后 `20` 个交易日，用于复盘买入后的收益和回撤

这样既能尽量利用每只股票的长期数据，又避免每道题重复塞入整段多年日线导致 JSON 过大。

## 数据同步参数

常用参数：

- `--start-date`：行情开始日期，格式 `YYYYMMDD`
- `--end-date`：行情结束日期，格式 `YYYYMMDD`
- `--adjust`：复权方式，默认 `qfq`，即前复权
- `--minute-period`：分钟线周期，支持 `1/5/15/30/60`
- `--universe`：股票池，支持 `hs300/csi500/csi800`
- `--member-limit`：尝试拉取多少只股票
- `--lookback-days`：每道题保留多少根决策日前日线
- `--forward-days`：历史题保留多少根决策日后日线
- `--candidate-step`：每隔多少个交易日扫描一个候选点
- `--max-cases-per-stock`：每只股票最多生成多少道历史题
- `--max-same-tag-per-stock`：同一股票同一主标签最多保留多少道题
- `--min-gap-days`：同一股票两道题之间最少间隔多少个交易日
- `--min-score`：候选题最低训练价值分
- `--max-history-cases`：历史题库全局上限，`0` 表示不限制
- `--current-count`：当前盘面题库上限，`0` 表示每只成功处理的股票生成一道

## 每日更新当前盘面题库

已经提供脚本：

```bash
scripts/update_training_cases_daily.sh
```

可以手动执行：

```bash
bash scripts/update_training_cases_daily.sh
```

也可以指定截止日期：

```bash
bash scripts/update_training_cases_daily.sh 20260629
```

建议放到服务器定时任务里，在 A 股收盘、数据源完成更新后执行，例如每天 18:30：

```cron
30 18 * * 1-5 cd /path/to/StockTrading && bash scripts/update_training_cases_daily.sh >> logs/case-sync.log 2>&1
```

执行后会覆盖 `public/data/training-cases.json`，其中 `currentCases` 会刷新为每只股票最新交易日。

## 当前数据策略

数据流：

```text
AKShare / 新浪（日线）+ BaoStock（5分钟线）
  ↓
scripts/sync_akshare.py
  ↓
public/data/training-cases.json
  ↓
React 前端盲盘训练
```

脚本会尝试获取：

- 沪深300 / 中证500 / 中证800 股票池
- 个股日线
- 沪深300指数日线
- 个股历史分钟线
- 沪深300指数分钟线
- 个股基础信息，例如 PE、PB、市值

注意：BaoStock 免费接口支持 5/15/30/60 分钟线，不支持 1 分钟线。实测 5 分钟数据从 2020 年开始有覆盖，但不同股票的实际覆盖可能不同。如果历史日期取不到真实分钟线，脚本会用当天 OHLC 生成分时兜底曲线，并在数据质量字段中标记为 `synthetic`。

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
