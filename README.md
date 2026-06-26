# 盲盘训练｜A 股买入决策挑战

这是一个面向 A 股沪深 300 的买入决策训练器初版。它不是荐股工具，也不是完整回测系统，而是把用户放回历史某个交易时刻，在只看到当时可见数据的情况下做买入、放弃或再观察决策。

## 已实现

- 三个训练时间段：开盘 9:30、午间 11:30、收盘 15:00
- 历史走势显示日 K、周 K、月 K
- 当天走势显示分时图
- 开盘/午间模式严格隐藏当天完整日 K
- 右侧模拟交易面板：买入价、涨跌幅、成交量、PE、PB、市值等
- 决策动作：买入、放弃、再观察
- 10万元连续模拟账户，按100股整数手分批买卖
- 遵守A股 T+1：当天买入的持仓下一交易日才可卖出
- 可按下一小时或下一交易日推进真实5分钟行情
- 清仓后进入下一题，资金与累计收益跨题保留
- SQLite 后台记录每笔成交、已实现盈亏与账户权益
- 结果复盘：1/3/5/10/20 日收益、最大浮盈、最大回撤、相对沪深 300 表现
- 规则化复盘标签：短线追高、大周期逆势、上午冲高回落、收盘突破等
- AKShare + BaoStock 数据同步脚本：生成 `public/data/training-cases.json`
- AKShare/新浪提供真实日线，BaoStock 提供免费的真实 5 分钟个股行情
- 前端自动加载同步数据；如果数据文件不存在，自动回退到模拟数据

## 运行前端

```bash
npm install
npm run dev
```

浏览器打开 Vite 输出的本地地址即可。

生产运行：

```bash
npm run build
npm run start
```

Node 服务同时提供静态页面、交易记录 API 和 SQLite 数据库。数据库默认写入 `data/trading.db`。

## 使用 AKShare + BaoStock 生成训练数据

先安装 Python 依赖：

```bash
pip install -r requirements.txt
```

然后生成数据：

```bash
python scripts/sync_akshare.py --case-count 40 --member-limit 80
```

生成结果会写入：

```text
public/data/training-cases.json
```

前端启动后会自动读取这个文件。页面顶部“数据源”显示 `AKShare + BaoStock` 时，说明已经使用真实行情生成训练题；如果显示“模拟数据”，说明还没有生成数据文件或文件读取失败。

## 数据同步参数

常用参数：

```bash
python scripts/sync_akshare.py \
  --start-date 20220101 \
  --end-date 20260625 \
  --adjust qfq \
  --minute-period 5 \
  --member-limit 80 \
  --case-count 40
```

参数说明：

- `--start-date`：行情开始日期，格式 `YYYYMMDD`
- `--end-date`：行情结束日期，格式 `YYYYMMDD`
- `--adjust`：复权方式，默认 `qfq`，即前复权
- `--minute-period`：分钟线周期，支持 `1/5/15/30/60`
- `--member-limit`：尝试拉取多少只沪深300成分股
- `--case-count`：生成多少道训练题

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

- 沪深300成分股
- 个股日线
- 沪深300指数日线
- 个股历史分钟线
- 沪深300指数分钟线
- 个股基础信息，例如 PE、PB、市值

注意：BaoStock 免费接口支持 5/15/30/60 分钟线，不支持 1 分钟线。实测 5 分钟数据从 2020 年开始有覆盖，但不同股票的实际覆盖可能不同。如果历史日期取不到真实分钟线，脚本会用当天 OHLC 生成分时兜底曲线，并在数据质量字段中标记为 `synthetic`。

## 全量行情数据库与定时同步

后端行情库写入 `data/market.db`，用于保存沪深300成分股、前复权日线和 BaoStock 5 分钟线。

手动执行一次：

```bash
scripts/run_market_sync.sh
```

单只或少量股票验证：

```bash
scripts/run_market_sync.sh --symbols 600519,300750
```

定时任务建议每天凌晨 1 点运行：

```cron
0 1 * * * cd /opt/StockTrading && /opt/StockTrading/scripts/run_market_sync.sh
```

增量规则：

- 没有历史数据的股票：日线从 `19900101` 开始补齐；5 分钟线从 `20200101` 开始补齐。
- 已有历史数据的股票：从数据库里最后一个日期重新拉取并覆盖，保证最近一个交易日可以被修正。
- BaoStock 免费分钟线支持 5/15/30/60 分钟，不支持 1 分钟。

## 后续建议

第一阶段：把 `training-cases.json` 改成后端数据库读取，避免前端加载过大的 JSON。

第二阶段：把训练记录写入数据库，统计用户画像。

第三阶段：增加题目抽样标签，例如放量突破、缩量回踩、高开低走、低开高走、均线多头、均线空头。

第四阶段：增加个人报告：

- 开盘买入胜率
- 午间追涨失败率
- 收盘隔日溢价表现
- 再观察是否优于直接买入
- 哪些买入理由最容易亏损

## 产品定位

核心不是预测股票，而是训练交易行为：

> 回到历史某一刻，只看当时能看到的数据，判断你是否真的应该买。
