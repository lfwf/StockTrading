import { useState } from 'react';
import type { LocalAccount } from '../hooks/useLocalAccount';
import type { useTradingTrainer } from '../hooks/useTradingTrainer';
import type { SimTrade } from '../types';
import { change, pct } from '../lib/indicators';
import { type TrainingPhase } from '../domain/trainingPhase';

type ProductPage = 'home' | 'knowledge' | 'history' | 'current' | 'mistakes' | 'profile';

type ProductAction = (page: ProductPage, phase?: TrainingPhase) => void;

export function HomePage({ onNavigate, trainer, account }: { onNavigate: ProductAction; trainer: ReturnType<typeof useTradingTrainer>; account: LocalAccount | null }) {
  const equityReturn = pct(change(trainer.portfolio.initialCash, trainer.currentEquity));

  return (
    <section className="product-home">
      <div className="hero-panel card">
        <p className="eyebrow">A股模拟训练 · 非投资建议</p>
        <h1>练一练买入前的判断</h1>
        <p>这里不推荐股票，也不预测涨跌。你可以用历史行情或最新盘面做模拟操作，记录当时的判断，再看后面的结果和复盘。</p>
        <div className="hero-cta">
          <button className="primary-btn" onClick={() => onNavigate('history', 'history')}>开始一组盲盘训练</button>
          <button className="ghost-btn" onClick={() => onNavigate('knowledge')}>先看使用说明</button>
        </div>
        <p className="risk-note">仅用于模拟训练和学习复盘，不构成证券投资建议。请不要把训练结果当作真实交易依据。</p>
      </div>

      <div className="home-stats">
        <StatCard label="当前身份" value={account ? account.name : '游客模式'} desc={account ? '当前记录保存在本机账号下' : '可以先体验，后续再登录保存记录'} />
        <StatCard label="模拟资产" value={`¥${trainer.currentEquity.toFixed(2)}`} desc={`累计变化 ${equityReturn}`} />
        <StatCard label="错题数量" value={`${trainer.mistakes.length}题`} desc="系统会记录回撤较大或明显错过的样本" />
      </div>

      <div className="module-grid">
        <ModuleCard title="历史盲盘训练" desc="随机抽一段历史行情，只看当时能看到的数据，适合练买入前的判断。" action="进入训练" onClick={() => onNavigate('history', 'history')} />
        <ModuleCard title="当前盘面训练" desc="使用最新交易日数据做一次盘面练习。这里只做模拟，不提供买卖建议。" action="进入练习" onClick={() => onNavigate('current', 'current')} />
        <ModuleCard title="基础知识" desc="先了解界面、买点、分时、仓位和常见心理问题，再开始做题。" action="查看说明" onClick={() => onNavigate('knowledge')} />
        <ModuleCard title="错题与记录" desc="查看最近做错或判断偏差较大的样本，后面可以反复练。" action="查看记录" onClick={() => onNavigate('mistakes')} />
      </div>
    </section>
  );
}

function StatCard({ label, value, desc }: { label: string; value: string; desc: string }) {
  return (
    <div className="card stat-card">
      <span>{label}</span>
      <b>{value}</b>
      <p>{desc}</p>
    </div>
  );
}

function ModuleCard({ title, desc, action, onClick }: { title: string; desc: string; action: string; onClick: () => void }) {
  return (
    <button className="card module-card" onClick={onClick}>
      <b>{title}</b>
      <span>{desc}</span>
      <em>{action}</em>
    </button>
  );
}

export function KnowledgePage({ onNavigate }: { onNavigate: ProductAction }) {
  const sections = [
    {
      title: '看懂训练界面',
      items: ['日K看价格位置，周K和月K看更大的方向', '分时图只看当前时点前的走势', '开盘和午间场景不会展示当天完整日K'],
    },
    {
      title: '买点判断',
      items: ['突破要看位置和成交量，不是过了前高就一定好', '回踩要看趋势有没有坏掉，不能只看价格跌了', '低吸前要想好止损，不然很容易变成硬扛'],
    },
    {
      title: '分时陷阱',
      items: ['上午急拉后回落，说明承接可能不够', '尾盘拉升不一定代表第二天会高开', '价格站不回分时均价线时，追入要更谨慎'],
    },
    {
      title: '仓位与止损',
      items: ['模拟买入前先想：如果判断错了怎么办', '看不清的时候，仓位应该小一点', 'A股是T+1，当天买入不能当天卖出'],
    },
    {
      title: '交易心理',
      items: ['怕错过的时候，最容易追高', '觉得“跌多了该反弹”，不等于真的有买点', '亏损后想补仓，先重新判断趋势有没有破坏'],
    },
  ];

  return (
    <section className="content-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">基础知识</p>
          <h1>先熟悉几个常见判断</h1>
          <p>这些内容主要帮助你看懂训练界面，以及理解复盘里出现的提示。看完后再去做几组盲盘题会更顺手。</p>
        </div>
        <button className="primary-btn" onClick={() => onNavigate('history', 'history')}>去历史盲盘训练</button>
      </div>
      <div className="knowledge-grid">
        {sections.map((section) => (
          <article key={section.title} className="card knowledge-card">
            <h2>{section.title}</h2>
            <ul>
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MistakeProfilePage({ trainer, onNavigate }: { trainer: ReturnType<typeof useTradingTrainer>; onNavigate: ProductAction }) {
  const buyTrades = trainer.portfolio.trades.filter((trade) => trade.side === 'buy').length;
  const sellTrades = trainer.portfolio.trades.filter((trade) => trade.side === 'sell').length;
  const realized = trainer.backendSummary?.realized_pnl ?? 0;
  const topTags = trainer.mistakes
    .flatMap((item) => item.tags)
    .reduce<Record<string, number>>((acc, tag) => {
      acc[tag] = (acc[tag] ?? 0) + 1;
      return acc;
    }, {});
  const rankedTags = Object.entries(topTags).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <section className="content-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">错题与记录</p>
          <h1>看看最近哪些判断偏差比较大</h1>
          <p>这里会保存回撤较大、亏损偏多，或者放弃后明显上涨的样本。数量多了以后，可以看出自己更容易在哪些场景出问题。</p>
        </div>
        <button className="primary-btn" onClick={() => onNavigate('history', 'history')}>继续训练</button>
      </div>

      <div className="profile-grid">
        <StatCard label="模拟买入" value={`${buyTrades}笔`} desc="只统计本机训练记录" />
        <StatCard label="模拟卖出" value={`${sellTrades}笔`} desc={`已实现盈亏 ${realized >= 0 ? '+' : ''}${realized.toFixed(2)}`} />
        <StatCard label="错题数量" value={`${trainer.mistakes.length}题`} desc="可作为后续复练样本" />
      </div>

      <div className="card profile-card">
        <h2>出现较多的标签</h2>
        {rankedTags.length ? (
          <div className="tag-rank-list">
            {rankedTags.map(([tag, count]) => <span key={tag}>{tag} · {count}</span>)}
          </div>
        ) : (
          <p className="muted-text">目前错题还不多。多做几组训练后，这里会显示出现频率较高的问题。</p>
        )}
      </div>

      <div className="card profile-card">
        <h2>最近错题</h2>
        {trainer.mistakes.length ? (
          <div className="mistake-list profile-mistakes">
            {trainer.mistakes.slice(0, 8).map((item) => (
              <div key={item.id} className="mistake-item">
                <b>{item.action === 'buy' ? '买入错题' : '放弃错题'} · {item.symbol}</b>
                <span>{item.reason}</span>
                <em>{item.tags.slice(0, 4).join(' / ')}</em>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-text">暂无错题。</p>
        )}
        <div className="training-actions">
          <button className="primary-btn small" onClick={() => onNavigate('history', 'history')}>去历史盲盘训练</button>
          <button className="ghost-btn small" onClick={() => trainer.setMistakes([])}>清空错题</button>
        </div>
      </div>
    </section>
  );
}

function money(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function tradeSideText(side: SimTrade['side']): string {
  return side === 'buy' ? '买入' : '卖出';
}

function buildStockTradeGroups(trades: SimTrade[]) {
  const groups = trades.reduce<Record<string, { symbol: string; trades: SimTrade[]; realized: number; buyAmount: number; sellAmount: number }>>((acc, trade) => {
    const item = acc[trade.symbol] ?? { symbol: trade.symbol, trades: [], realized: 0, buyAmount: 0, sellAmount: 0 };
    item.trades.push(trade);
    item.realized += trade.realizedPnl ?? 0;
    if (trade.side === 'buy') item.buyAmount += trade.amount;
    if (trade.side === 'sell') item.sellAmount += trade.amount;
    acc[trade.symbol] = item;
    return acc;
  }, {});
  return Object.values(groups).sort((a, b) => b.trades.length - a.trades.length || b.realized - a.realized);
}

function TradingHistoryPanel({ trainer }: { trainer: ReturnType<typeof useTradingTrainer> }) {
  const trades = trainer.portfolio.trades;
  const groups = buildStockTradeGroups(trades);
  const realized = trades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0);
  const buyCount = trades.filter((trade) => trade.side === 'buy').length;
  const sellCount = trades.filter((trade) => trade.side === 'sell').length;
  const latestTrades = [...trades].reverse().slice(0, 30);

  return (
    <div className="account-history-grid">
      <div className="card profile-card trade-history-card">
        <h2>交易历史概览</h2>
        <div className="profile-grid compact-history-stats">
          <StatCard label="总操作" value={`${trades.length}笔`} desc={`买入 ${buyCount} · 卖出 ${sellCount}`} />
          <StatCard label="已实现盈亏" value={money(realized)} desc="只统计卖出成交后的已实现收益" />
          <StatCard label="涉及股票" value={`${groups.length}只`} desc="按股票代码聚合操作记录" />
        </div>
        {!trades.length && <p className="muted-text">暂无交易记录。买入或卖出后，这里会按股票展示操作、金额和盈亏。</p>}
      </div>

      {groups.length > 0 && (
        <div className="card profile-card stock-history-card">
          <h2>按股票查看</h2>
          <div className="stock-history-list">
            {groups.slice(0, 12).map((group) => (
              <div key={group.symbol} className="stock-history-item">
                <div className="stock-history-head">
                  <b>{group.symbol}</b>
                  <span className={group.realized >= 0 ? 'up-text' : 'down-text'}>{money(group.realized)}</span>
                </div>
                <div className="stock-history-meta">
                  <span>{group.trades.length} 笔操作</span>
                  <span>买入 ¥{group.buyAmount.toFixed(2)}</span>
                  <span>卖出 ¥{group.sellAmount.toFixed(2)}</span>
                </div>
                <div className="stock-history-trades">
                  {[...group.trades].reverse().slice(0, 6).map((trade) => (
                    <div key={trade.id} className="trade-row">
                      <span>{trade.date} {trade.time}</span>
                      <b className={trade.side === 'buy' ? 'up-text' : 'down-text'}>{tradeSideText(trade.side)}</b>
                      <span>{trade.quantity}股 · ¥{trade.price.toFixed(2)}</span>
                      <em className={trade.realizedPnl >= 0 ? 'up-text' : 'down-text'}>{trade.side === 'sell' ? money(trade.realizedPnl) : '未实现'}</em>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {latestTrades.length > 0 && (
        <div className="card profile-card trade-history-card">
          <h2>最近操作流水</h2>
          <div className="trade-table">
            {latestTrades.map((trade) => (
              <div key={trade.id} className="trade-row full">
                <span>{trade.date} {trade.time}</span>
                <b>{trade.symbol}</b>
                <em className={trade.side === 'buy' ? 'up-text' : 'down-text'}>{tradeSideText(trade.side)}</em>
                <span>{trade.quantity}股</span>
                <span>¥{trade.price.toFixed(2)}</span>
                <span>金额 ¥{trade.amount.toFixed(2)}</span>
                <strong className={trade.realizedPnl >= 0 ? 'up-text' : 'down-text'}>{trade.side === 'sell' ? money(trade.realizedPnl) : '--'}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AccountPage({
  account,
  onSignIn,
  onSignOut,
  trainer,
}: {
  account: LocalAccount | null;
  onSignIn: (email: string, name?: string) => void;
  onSignOut: () => void;
  trainer: ReturnType<typeof useTradingTrainer>;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  if (account) {
    return (
      <section className="content-page account-page">
        <div className="card account-card">
          <p className="eyebrow">账号</p>
          <h1>{account.name}</h1>
          <p>{account.email}</p>
          <p className="muted-text">当前账号只保存在本机浏览器里。后面接入正式登录后，训练记录、错题和统计可以跟账号同步。</p>
          <button className="ghost-btn" onClick={onSignOut}>退出登录</button>
        </div>
        <TradingHistoryPanel trainer={trainer} />
      </section>
    );
  }

  return (
    <section className="content-page account-page">
      <div className="card account-card">
        <p className="eyebrow">登录 / 注册</p>
        <h1>先用本地账号试一下</h1>
        <p>现在先做了一个轻量版本，用来保存本机训练记录。正式上线时可以再接邮箱验证码、手机号或微信登录。</p>
        <label>昵称</label>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：练习用户" />
        <label>邮箱</label>
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
        <button className="primary-btn" onClick={() => onSignIn(email, name)}>创建本地账号</button>
        <p className="risk-note">当前账号信息只保存在本机浏览器。</p>
      </div>
      <TradingHistoryPanel trainer={trainer} />
    </section>
  );
}

export type { ProductPage, ProductAction };
