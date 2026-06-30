import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PositionSize, TimeMode } from '../types';
import type { useTradingTrainer } from '../hooks/useTradingTrainer';
import { getModeLabel } from '../lib/market';
import { change, formatVolume, moneyYi, pct } from '../lib/indicators';
import { BUY_REASONS, NO_BUY_REASONS, STOP_LOSS_PLANS } from '../domain/trainingIntent';
import { ChartHeader, Metric, StatusItem } from './common';
import { IntradayChart, KLineChart } from './Charts';
import { DecisionChecklist } from './DecisionChecklist';
import { TrainingPresetDropdown } from './TrainingPanels';
import { ReviewPanel } from './ReviewPanel';

const POSITION_SIZES: PositionSize[] = [25, 50, 100];
const TIME_MODES: TimeMode[] = ['open', 'noon', 'close'];
type MobileChartTab = 'intraday' | 'daily' | 'weekly' | 'monthly' | 'index';

const MOBILE_CHART_TABS: Array<{ key: MobileChartTab; label: string }> = [
  { key: 'intraday', label: '分时' },
  { key: 'daily', label: '日线' },
  { key: 'weekly', label: '周线' },
  { key: 'monthly', label: '月线' },
  { key: 'index', label: '大盘' },
];

function syncMobileActionBarViewport() {
  const fallbackBottom = 10;
  const viewport = window.visualViewport;
  if (!viewport) {
    document.documentElement.style.setProperty('--mobile-action-bottom', `calc(${fallbackBottom}px + env(safe-area-inset-bottom, 0px))`);
    return;
  }

  const browserInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  const bottom = Math.max(fallbackBottom, Math.ceil(browserInset + fallbackBottom));
  document.documentElement.style.setProperty('--mobile-action-bottom', `${bottom}px`);
  document.documentElement.style.setProperty('--mobile-viewport-height', `${Math.round(viewport.height)}px`);
}

export function TrainingWorkspace({ trainer }: { trainer: ReturnType<typeof useTradingTrainer> }) {
  const [mobileChartTab, setMobileChartTab] = useState<MobileChartTab>('daily');
  const [actionBarHidden, setActionBarHidden] = useState(false);
  const {
    scenario,
    showStock,
    setShowStock,
    showDate,
    setShowDate,
    positionSize,
    setPositionSize,
    buyReason,
    setBuyReason,
    noBuyReason,
    setNoBuyReason,
    stopLossPlan,
    setStopLossPlan,
    tradeStateText,
    review,
    advisor,
    userChoice,
    tradeMessage,
    trainingPresets,
    toggleTrainingPreset,
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
    isBootstrapping,
    intradayHigh,
    intradayLow,
    intradayVolume,
    openChange,
    visibleHigh20,
    visibleLow20,
    visibleHigh60,
    volumeMa20,
    indexChange,
    resetTraining,
    switchMode,
    buy,
    sell,
    advanceHour,
    advanceDay,
  } = trainer;

  const sellLockedByT1 = heldQuantity > 0 && availableQuantity === 0;
  const sellButtonClass = sellLockedByT1 ? 'skip-btn sell-btn soft-disabled' : 'skip-btn sell-btn';

  useEffect(() => {
    function realignActionBar() {
      if (window.innerWidth > 760) return;
      syncMobileActionBarViewport();
      setActionBarHidden(false);
    }

    syncMobileActionBarViewport();
    window.addEventListener('resize', syncMobileActionBarViewport);
    window.addEventListener('orientationchange', syncMobileActionBarViewport);
    window.addEventListener('mobile-action-bar-realign', realignActionBar);
    window.visualViewport?.addEventListener('resize', syncMobileActionBarViewport);
    window.visualViewport?.addEventListener('scroll', syncMobileActionBarViewport);

    return () => {
      window.removeEventListener('resize', syncMobileActionBarViewport);
      window.removeEventListener('orientationchange', syncMobileActionBarViewport);
      window.removeEventListener('mobile-action-bar-realign', realignActionBar);
      window.visualViewport?.removeEventListener('resize', syncMobileActionBarViewport);
      window.visualViewport?.removeEventListener('scroll', syncMobileActionBarViewport);
    };
  }, []);

  useEffect(() => {
    if (window.innerWidth > 760) return;
    syncMobileActionBarViewport();
    setActionBarHidden(false);
    const timer = window.setTimeout(() => {
      syncMobileActionBarViewport();
      setActionBarHidden(false);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [scenario.base.id, scenario.mode, currentTime, Boolean(review), heldQuantity]);

  useEffect(() => {
    let showTimer: number | undefined;

    function scheduleShow(delay = 220) {
      if (showTimer) window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => {
        syncMobileActionBarViewport();
        setActionBarHidden(false);
      }, delay);
    }

    function hideWhileScrolling() {
      if (window.innerWidth > 760) return;
      setActionBarHidden(true);
      scheduleShow();
    }

    function showAfterTouchEnd() {
      if (window.innerWidth > 760) return;
      scheduleShow(80);
    }

    window.addEventListener('scroll', hideWhileScrolling, { passive: true });
    window.addEventListener('touchmove', hideWhileScrolling, { passive: true });
    window.addEventListener('wheel', hideWhileScrolling, { passive: true });
    window.addEventListener('touchend', showAfterTouchEnd, { passive: true });
    window.visualViewport?.addEventListener('scroll', hideWhileScrolling);

    return () => {
      if (showTimer) window.clearTimeout(showTimer);
      window.removeEventListener('scroll', hideWhileScrolling);
      window.removeEventListener('touchmove', hideWhileScrolling);
      window.removeEventListener('wheel', hideWhileScrolling);
      window.removeEventListener('touchend', showAfterTouchEnd);
      window.visualViewport?.removeEventListener('scroll', hideWhileScrolling);
    };
  }, []);

  function toggleRevealInfo() {
    const shouldShow = !(showStock && showDate);
    setShowStock(shouldShow);
    setShowDate(shouldShow);
  }

  function runMobileAction(action: () => void | Promise<void>) {
    syncMobileActionBarViewport();
    setActionBarHidden(false);
    const result = action();
    window.setTimeout(() => {
      syncMobileActionBarViewport();
      setActionBarHidden(false);
    }, 120);
    return result;
  }

  function runTimelineAction(action: () => void | Promise<void>) {
    setMobileChartTab('intraday');
    return runMobileAction(action);
  }

  function renderMobileChart() {
    if (mobileChartTab === 'intraday') {
      return (
        <>
          <ChartHeader title="当天分时" subtitle={scenario.mode === 'open' ? '只显示开盘点' : scenario.mode === 'close' ? '显示全天分时' : '显示当前时点前分时'} />
          <IntradayChart points={scenario.visibleIntraday} preClose={scenario.decisionBar.preClose} />
        </>
      );
    }
    if (mobileChartTab === 'daily') {
      return (
        <>
          <ChartHeader title="日线" subtitle={scenario.mode === 'close' ? '包含当前交易日' : '只显示到昨日'} />
          <KLineChart bars={scenario.visibleDaily} showDates={showDate} />
        </>
      );
    }
    if (mobileChartTab === 'weekly') {
      return (
        <>
          <ChartHeader title="周线" subtitle="确认大周期方向" />
          <KLineChart bars={scenario.visibleWeekly} showDates={showDate} />
        </>
      );
    }
    if (mobileChartTab === 'monthly') {
      return (
        <>
          <ChartHeader title="月线" subtitle="观察长期位置" />
          <KLineChart bars={scenario.visibleMonthly} showDates={showDate} />
        </>
      );
    }
    return (
      <>
        <ChartHeader title="市场环境 · 沪深300" subtitle="用于判断个股是否顺应大盘" />
        <KLineChart bars={scenario.visibleIndexDaily} showDates={showDate} />
        <div className="mobile-market-metrics">
          <Metric label="沪深300" value={pct(indexChange)} valueClass={indexChange >= 0 ? 'up-text' : 'down-text'} />
          <Metric label="个股变化" value={pct(openChange)} valueClass={openChange >= 0 ? 'up-text' : 'down-text'} />
        </div>
      </>
    );
  }

  const mobileActionBar = (
    <section className={actionBarHidden ? 'mobile-action-bar hide-while-scroll' : 'mobile-action-bar'}>
      <button className="buy-btn" onClick={() => runMobileAction(buy)} disabled={isBankrupt || isBootstrapping}>买入</button>
      <button className={sellButtonClass} onClick={() => runMobileAction(sell)} disabled={isBootstrapping} title={sellLockedByT1 ? '当天买入受 T+1 限制，下一交易日才可卖' : undefined}>卖出</button>
      <button className="neutral-btn" onClick={() => runTimelineAction(advanceHour)} disabled={scenario.mode === 'close' || isBootstrapping}>下一小时</button>
      <button className="neutral-btn" onClick={() => runTimelineAction(advanceDay)} disabled={isBootstrapping}>下一日</button>
      <button className="primary-btn" onClick={() => runMobileAction(() => resetTraining())} disabled={heldQuantity > 0 || isBankrupt || isBootstrapping}>下一题</button>
    </section>
  );

  return (
    <>
      <div className="training-workspace">
        <section className="status-bar">
          <StatusItem label="当前时间" value={showDate ? scenario.visibleUntil : currentTime} highlight />
          <StatusItem label="总资产" value={`¥${currentEquity.toFixed(2)}`} highlight />
          <StatusItem label="可用现金" value={`¥${portfolio.cash.toFixed(2)}`} />
          <StatusItem label="持仓 / 可卖" value={`${heldQuantity} / ${availableQuantity} 股`} />
          <StatusItem label="状态" value={tradeStateText} highlight />
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
          <button className="status-toggle ghost-btn" onClick={toggleRevealInfo}>显示/隐藏</button>
        </section>

        <section className="mobile-chart-card card chart-card">
          <div className="mobile-chart-tabs">
            {MOBILE_CHART_TABS.map((item) => (
              <button key={item.key} className={mobileChartTab === item.key ? 'active' : ''} onClick={() => setMobileChartTab(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="mobile-chart-body">{renderMobileChart()}</div>
        </section>

        <main className="workspace">
          <section className="chart-grid desktop-chart-grid">
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
            <div className="card chart-card desktop-intraday-card">
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
              <h2>买前计划</h2>
              <DecisionChecklist value={checklist} onChange={setChecklist} />
              <div className="control-block trade-control">
                <label>买入理由</label>
                <div className="intent-options">
                  {BUY_REASONS.map((item) => (
                    <button key={item.key} className={buyReason === item.key ? 'intent active' : 'intent'} onClick={() => setBuyReason(item.key)} title={item.desc}>{item.label}</button>
                  ))}
                </div>
              </div>
              <div className="control-block trade-control">
                <label>未买入理由（点击下一题时记录）</label>
                <div className="intent-options">
                  {NO_BUY_REASONS.map((item) => (
                    <button key={item.key} className={noBuyReason === item.key ? 'intent active' : 'intent'} onClick={() => setNoBuyReason(item.key)} title={item.desc}>{item.label}</button>
                  ))}
                </div>
              </div>
              <div className="control-block trade-control">
                <label>本次使用比例</label>
                <div className="segmented">
                  {POSITION_SIZES.map((item) => (
                    <button key={item} className={positionSize === item ? 'active' : ''} onClick={() => setPositionSize(item)}>{item}%</button>
                  ))}
                </div>
              </div>
              <div className="control-block trade-control">
                <label>计划止损</label>
                <div className="segmented">
                  {STOP_LOSS_PLANS.map((item) => (
                    <button key={item} className={stopLossPlan === item ? 'active' : ''} onClick={() => setStopLossPlan(item)}>{item}%</button>
                  ))}
                </div>
              </div>
              <div className="control-block trade-control">
                <label>持仓状态</label>
                <div className="trade-rule">{tradeStateText} · 100股整数手 · 当日买入次日可卖</div>
              </div>
              <div className="decision-actions compact-actions">
                <button className="buy-btn" onClick={buy} disabled={isBankrupt || isBootstrapping}>模拟买入 {positionSize}%现金</button>
                <button className={sellButtonClass} onClick={sell} disabled={isBootstrapping} title={sellLockedByT1 ? '当天买入受 T+1 限制，下一交易日才可卖' : undefined}>模拟卖出 {positionSize}%可卖</button>
                <button className="neutral-btn" onClick={() => runTimelineAction(advanceHour)} disabled={scenario.mode === 'close' || isBootstrapping}>下一小时</button>
                <button className="neutral-btn" onClick={() => runTimelineAction(advanceDay)} disabled={isBootstrapping}>下一交易日</button>
                <button className="primary-btn" onClick={() => resetTraining()} disabled={heldQuantity > 0 || isBankrupt || isBootstrapping}>下一题</button>
              </div>
              <p className="trade-hint">未买入时点击“下一题”，系统会按你选择的未买入理由记录本题；不会提前显示题目难度或未来标签。</p>
              {sellLockedByT1 && <p className="trade-hint">当前持仓为当天买入，卖出按钮置灰提示；点击后会显示 T+1 限制说明。</p>}
              {tradeMessage && <p className="trade-message">{tradeMessage}</p>}
            </div>
          </aside>
        </main>

        <section className="lower-grid">
          <div className="card market-card desktop-market-card">
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
      {typeof document !== 'undefined' ? createPortal(mobileActionBar, document.body) : null}
    </>
  );
}
