import type { AdvisorResult, DecisionChoice, PortfolioState, ReviewResult, TimeMode } from '../types';
import type { DecisionChecklistState } from '../domain/learning';
import { EDUCATION_BY_TAG } from '../domain/learning';
import { change, pct } from '../lib/indicators';
import { getModeLabel } from '../lib/market';
import { ChecklistSnapshot } from './DecisionChecklist';
import { Metric } from './common';

export function ReviewPanel({
  review,
  advisor,
  userChoice,
  mode,
  onNext,
  portfolio,
  currentEquity,
  backendSummary,
  checklist,
}: {
  review: ReviewResult | null;
  advisor: AdvisorResult | null;
  userChoice: DecisionChoice | null;
  mode: TimeMode;
  onNext: () => void;
  portfolio: PortfolioState;
  currentEquity: number;
  backendSummary: { trade_count: number; buy_count: number; sell_count: number; realized_pnl: number; winning_sells: number } | null;
  checklist: DecisionChecklistState;
}) {
  if (!review) {
    return (
      <div className="card review-card empty-review">
        <h2>交易记录</h2>
        <div className="advisor-plan">
          <Metric label="累计收益率" value={pct(change(portfolio.initialCash, currentEquity))} valueClass={currentEquity >= portfolio.initialCash ? 'up-text' : 'down-text'} />
          <Metric label="已实现盈亏" value={`${(backendSummary?.realized_pnl ?? 0) >= 0 ? '+' : ''}${(backendSummary?.realized_pnl ?? 0).toFixed(2)}`} valueClass={(backendSummary?.realized_pnl ?? 0) >= 0 ? 'up-text' : 'down-text'} />
          <Metric label="成交记录" value={`${backendSummary?.trade_count ?? portfolio.trades.length} 笔`} />
        </div>
        {advisor && <AdvisorPanel advisor={advisor} userChoice={userChoice} />}
        <ChecklistSnapshot checklist={checklist} />
        <p>模拟买入后，先继续推进行情；清仓后查看这道题的结果。未买入时直接点“下一题”，系统会记录本题的未买入理由。</p>
      </div>
    );
  }

  return (
    <div className="card review-card">
      <div className="review-head">
        <div>
          <h2>结果复盘</h2>
          <p>{getModeLabel(mode)} · 参考价 {review.entryPrice.toFixed(2)}</p>
        </div>
        <button className="primary-btn small" onClick={onNext}>下一题</button>
      </div>
      <div className="result-grid">
        {review.retClose !== undefined && <Metric label="当日收盘" value={pct(review.retClose)} valueClass={review.retClose >= 0 ? 'up-text' : 'down-text'} />}
        {review.retNextOpen !== undefined && <Metric label="次日开盘" value={pct(review.retNextOpen)} valueClass={review.retNextOpen >= 0 ? 'up-text' : 'down-text'} />}
        <Metric label="1日" value={review.ret1 === null ? '--' : pct(review.ret1)} valueClass={(review.ret1 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="3日" value={review.ret3 === null ? '--' : pct(review.ret3)} valueClass={(review.ret3 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="5日" value={review.ret5 === null ? '--' : pct(review.ret5)} valueClass={(review.ret5 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="10日" value={review.ret10 === null ? '--' : pct(review.ret10)} valueClass={(review.ret10 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="20日" value={review.ret20 === null ? '--' : pct(review.ret20)} valueClass={(review.ret20 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
        <Metric label="最大浮盈" value={pct(review.maxProfit)} valueClass="up-text" />
        <Metric label="最大回撤" value={pct(review.maxDrawdown)} valueClass="down-text" />
        <Metric label="相对沪深300" value={review.relativeRet20 === null ? '--' : pct(review.relativeRet20)} valueClass={(review.relativeRet20 ?? 0) >= 0 ? 'up-text' : 'down-text'} />
      </div>
      <div className="review-tags">
        {review.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <p className="review-summary">{review.summary}</p>
      <LearningCards tags={review.tags} />
      <ChecklistSnapshot checklist={checklist} />
      {advisor && <AdvisorPanel advisor={advisor} userChoice={userChoice} />}
    </div>
  );
}

function LearningCards({ tags }: { tags: string[] }) {
  const cards = tags.map((tag) => EDUCATION_BY_TAG[tag]).filter(Boolean).slice(0, 3);
  if (!cards.length) return null;

  return (
    <div className="learning-cards">
      {cards.map((card) => (
        <article key={card.title} className="learning-card">
          <b>{card.title}</b>
          <p>{card.body}</p>
          <span>{card.check}</span>
        </article>
      ))}
    </div>
  );
}

function AdvisorPanel({ advisor, userChoice }: { advisor: AdvisorResult; userChoice: DecisionChoice | null }) {
  const actionLabel = advisor.action === 'buy' ? '条件较好' : advisor.action === 'observe' ? '可以再看' : '风险偏高';
  const agrees = userChoice === 'buy' ? advisor.action === 'buy' : userChoice === 'skip' ? advisor.action === 'skip' : false;

  return (
    <section className="advisor-panel">
      <div className="advisor-head">
        <div>
          <span>参考判断 · 只使用当时数据</span>
          <h3>{actionLabel}</h3>
        </div>
        <div className="advisor-badges">
          <b>把握度 {advisor.confidence}</b>
          <b className={agrees ? 'agreement' : 'difference'}>{agrees ? '与你一致' : '与你不同'}</b>
        </div>
      </div>
      <div className="advisor-plan">
        <Metric label="模拟仓位" value={advisor.suggestedPosition ? `${advisor.suggestedPosition}%` : '先不买'} />
        <Metric label="参考止损" value={advisor.suggestedStopLossPct ? `-${advisor.suggestedStopLossPct}%` : '--'} />
        <Metric label="评分" value={`${advisor.score > 0 ? '+' : ''}${advisor.score}`} valueClass={advisor.score > 0 ? 'up-text' : advisor.score < 0 ? 'down-text' : ''} />
      </div>
      <div className="advisor-evidence">
        {advisor.evidence.map((item) => (
          <div key={item.category} className={`advisor-evidence-item ${item.tone}`}>
            <b>{item.category}</b>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
      <p><b>主要依据：</b>{advisor.trigger}</p>
      <p><b>需要留意：</b>{advisor.risk}</p>
    </section>
  );
}
