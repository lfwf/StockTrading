import type { PositionSize, TimeMode } from '../types';
import type { useTradingTrainer } from '../hooks/useTradingTrainer';
import { getModeLabel } from '../lib/market';
import { change, formatVolume, moneyYi, pct } from '../lib/indicators';
import { ChartHeader, Metric, StatusItem } from './common';
import { IntradayChart, KLineChart } from './Charts';
import { DecisionChecklist } from './DecisionChecklist';
import { TrainingPresetDropdown } from './TrainingPanels';
import { ReviewPanel } from './ReviewPanel';
import { TRAINING_PHASES } from '../domain/trainingPhase';

const POSITION_SIZES: PositionSize[] = [25, 50, 100];
const TIME_MODES: TimeMode[] = ['open', 'noon', 'close'];

export function TrainingWorkspace({ trainer }: { trainer: ReturnType<typeof useTradingTrainer> }) {
  const {
    scenario,
    dataStatus,
    showStock,
    setShowStock,
    showDate,
    setShowDate,
    positionSize,
    setPositionSize,
    review,
    advisor,
    userChoice,
    tradeMessage,
    trainingPresets,
    toggleTrainingPreset,
    trainingPhase,
    switchTrainingPhase,
    checklist,
    setChecklist,
    mistakes,
    backendSummary,
    portfolio,
    currentTime,
    heldQuantity,
    availableQuantity,
    currentEquity,
    cost,
    isBankrupt,
    intradayHigh,
    intradayLow,
    intradayVolume,
    openChange,
    visibleHigh20,
    visibleLow20,
    visibleHigh60,
    volumeMa20,
    indexChange,
    filteredCount,
    trainingCases,
    resetTraining,
    switchMode,
    buy,
    skip,
    sell,
    advanceHour,
    advanceDay,
  } = trainer;

  return (
    <div className="training-workspace">
      <section className="status-bar">
        <StatusItem label="当前时间" value={showDate ? scenario.visibleUntil : currentTime} highlight />
        <StatusItem label="总资产" value={`¥${currentEquity.toFixed(2)}`} highlight />
        <StatusItem label="可用现金" value={`¥${portfolio.cash.toFixed(2)}`} />
        <StatusItem label="持仓 / 可卖" value={`${heldQuantity} / ${availableQuantity} 股`} />
        <StatusItem label="股票" value={showStock ? `${scenario.base.stock.name} ${scenario.base.stock.symbol}` : `已隐藏 · ${scenario.base.stock.industry}`} />
        <StatusItem label="日期" value={showDate ? scenario.visibleUntil : '已隐藏'} />
        <div className="status-mode">
          <span>训练场景</span>
          <div>
            {TIME_MODES.map((item) => (
              <button key={item} className={item === scenario.mode ? 'mode-btn active' : 'mode-btn'} onClick={() => switchMode(item)}>
                {getModeLabel(item).replace(' ', '')}
              </button>
            ))}
          </div>
        </div>
        <TrainingPresetDropdown value={trainingPresets} onToggle={toggleTrainingPreset} mistakes={mistakes.length} />
        <button className="status-toggle ghost-btn" onClick={() => setShowStock((value) => !value)}>{showStock ? '隐藏股票' : '显示股票'}</button>
        <button className="status-toggle ghost-btn" onClick={() => setShowDate((value) => !value)}>{showDate ? '隐藏日期' : '显示日期'}</button>
      </section>

      <section className="data-row phase-row">
        <span>{dataStatus} · 匹配 {filteredCount || trainingCases.length} 题</span>
        <div className="phase-switch">
          {TRAINING_PHASES.map((item) => (
            <button key={item.key} className={trainingPhase === item.key ? 'mode-btn active' : 'mode-btn'} onClick={() => switchTrainingPhase(item.key)} title={item.desc}>
              {item.title}
            </button>
          ))}
        </div>
      </section>

      <main className="workspace">
        <section className="chart-grid">
          <div className="card chart-card large-chart">
            <ChartHeader title="历史日K · 主决策图" subtitle={scenario.mode === 'close' ? '收盘场景包含当日完整K线' : '只显示到昨日，避免泄露当天结果'} />
            <KLineChart bars={scenario.visibleDaily} showDates={showDate} />
          </div>

          <div className="mini-charts">
            <div className="card chart-card">
              <ChartHeader title="周K" subtitle="大周期方向" />
              <KLineChart bars={scenario.visibleWeekly} compact showDates={showDate} />
            </div>
            <div className="card chart-card">
              <ChartHeader title="月K" subtitle="长期位置" />
              <KLineChart bars={scenario.visibleMonthly} compact showDates={showDate} />
            </div>
          </div>
        </section>

        <aside className="side-panel">
          <div className="card chart-card">
            <ChartHeader title="当天分时" subtitle={scenario.mode === 'open' ? '只显示开盘点' : scenario.mode === 'close' ? '显示全天分时' : '显示当前时点前分时'} />
            <IntradayChart points={scenario.visibleIntraday} preClose={scenario.decisionBar.preClose} />
          </div>

          <div className="card quote-card">
            <h2>交易面板</h2>
            <div className="quote-price">
              <span>{scenario.buyPrice.toFixed(2)}</span>
              <b className={openChange >= 0 ? 'up-text' : 'down-text'}>{pct(openChange)}</b>
            </div>
            <div className="metric-grid">
              <Metric label="持仓成本" value={heldQuantity ? cost.toFixed(2) : '--'} />
              <Metric label="持仓浮盈亏" value={heldQuantity ? `${(scenario.buyPrice - cost) * heldQuantity >= 0 ? '+' : ''}${((scenario.buyPrice - cost) * heldQuantity).toFixed(2)}` : '--'} valueClass={scenario.buyPrice >= cost ? 'up-text' : 'down-text'} />
              <Metric label="昨收" value={scenario.decisionBar.preClose.toFixed(2)} />
              <Metric label="今开" value={scenario.decisionBar.open.toFixed(2)} />
              <Metric label="截至当前最高" value={intradayHigh.toFixed(2)} />
              <Metric label="截至当前最低" value={intradayLow.toFixed(2)} />
              <Metric label="截至当前成交量" value={formatVolume(intradayVolume)} />
              <Metric label="可见日成交量" value={formatVolume(scenario.visibleDaily.at(-1)?.volume ?? 0)} />
              <Metric label="20日量比" value={`${(intradayVolume / Math.max(volumeMa20, 1)).toFixed(2)}x`} />
              <Metric label="换手率" value={`${scenario.decisionBar.turnoverRate.toFixed(2)}%`} />
              <Metric label="PE" value={scenario.base.stock.pe.toFixed(1)} />
              <Metric label="PB" value={scenario.base.stock.pb.toFixed(1)} />
              <Metric label="总市值" value={moneyYi(scenario.base.stock.totalMarketCap)} />
              <Metric label="流通市值" value={moneyYi(scenario.base.stock.floatMarketCap)} />
            </div>
          </div>

          <div className="card decision-card">
            <h2>买前检查清单</h2>
            <DecisionChecklist value={checklist} onChange={setChecklist} />
            <div className="control-block trade-control">
              <label>本次使用比例</label>
              <div className="segmented">
                {POSITION_SIZES.map((item) => (
                  <button key={item} className={positionSize === item ? 'active' : ''} onClick={() => setPositionSize(item)}>{item}%</button>
                ))}
              </div>
            </div>
            <div className="control-block trade-control">
              <label>成交规则</label>
              <div className="trade-rule">100股整数手 · 当日买入次日可卖</div>
            </div>
            <div className="decision-actions">
              <button className="buy-btn" onClick={buy} disabled={isBankrupt}>模拟买入 {positionSize}%现金</button>
              <button className="skip-btn" onClick={sell}>模拟卖出 {positionSize}%可卖</button>
              <button className="neutral-btn" onClick={advanceHour} disabled={scenario.mode === 'close'}>下一小时</button>
              <button className="neutral-btn" onClick={advanceDay}>下一交易日</button>
              <button className="skip-btn" onClick={skip} disabled={heldQuantity > 0}>放弃本题</button>
              <button className="primary-btn" onClick={() => resetTraining()} disabled={heldQuantity > 0 || isBankrupt}>下一题</button>
            </div>
            {tradeMessage && <p className="trade-message">{tradeMessage}</p>}
          </div>
        </aside>
      </main>

      <section className="lower-grid">
        <div className="card market-card">
          <ChartHeader title="市场环境 · 沪深300" subtitle="用于判断个股是否顺应大盘" />
          <div className="market-content">
            <KLineChart bars={scenario.visibleIndexDaily} compact showDates={showDate} />
            <div className="metric-grid market-metrics">
              <Metric label="沪深300当前变化" value={pct(indexChange)} valueClass={indexChange >= 0 ? 'up-text' : 'down-text'} />
              <Metric label="个股当前变化" value={pct(openChange)} valueClass={openChange >= 0 ? 'up-text' : 'down-text'} />
              <Metric label="近20日高点" value={visibleHigh20.toFixed(2)} />
              <Metric label="近20日低点" value={visibleLow20.toFixed(2)} />
              <Metric label="距60日高点" value={pct(change(visibleHigh60, scenario.buyPrice))} />
              <Metric label="可见样本数" value={`${scenario.visibleDaily.length} 日`} />
            </div>
          </div>
        </div>

        <ReviewPanel
          review={review}
          advisor={advisor}
          userChoice={userChoice}
          mode={scenario.mode}
          onNext={() => resetTraining()}
          portfolio={portfolio}
          currentEquity={currentEquity}
          backendSummary={backendSummary}
          checklist={checklist}
        />
      </section>
    </div>
  );
}
