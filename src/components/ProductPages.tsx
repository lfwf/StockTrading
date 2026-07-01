import { useState } from 'react';
import type { LocalAccount } from '../hooks/useLocalAccount';
import type { useTradingTrainer } from '../hooks/useTradingTrainer';
import type { SimTrade } from '../types';
import { change, pct } from '../lib/indicators';
import { type TrainingPhase } from '../domain/trainingPhase';

type ProductPage =
  | 'home'
  | 'knowledge'
  | 'history'
  | 'current'
  | 'mistakes'
  | 'profile'
  | 'blind-trading'
  | 'buy-decision-training'
  | 'trading-discipline'
  | 'intraday-trap'
  | 'faq';

type ProductAction = (page: ProductPage, phase?: TrainingPhase) => void;

export function HomePage({ onNavigate, trainer, account }: { onNavigate: ProductAction; trainer: ReturnType<typeof useTradingTrainer>; account: LocalAccount | null }) {
  const equityReturn = pct(change(trainer.portfolio.initialCash, trainer.currentEquity));
  const phaseLabel = trainer.trainingPhase === 'current' ? '当前盘面' : '历史盲盘';

  return (
    <section className="product-home">
      <div className="hero-panel card">
        <p className="eyebrow">A股盲盘训练 · 交易纪律训练 · 非投资建议</p>
        <h1>A股盲盘训练工具：练习买点判断，而不是预测涨跌</h1>
        <p>本工具会把你放回历史某个交易时刻，只展示当时可见的K线、分时、量能和市场环境，让你练习是否模拟买入、是否放弃、是否继续观察。它适合用于交易纪律训练、买点判断训练和投资者教育，不提供任何股票推荐或投资建议。</p>
        <div className="hero-cta">
          <button className="primary-btn" onClick={() => onNavigate('history', 'history')}>开始一组盲盘训练</button>
          <button className="ghost-btn" onClick={() => onNavigate('blind-trading')}>了解训练方法</button>
        </div>
        <p className="risk-note">风险提示：本工具仅用于模拟训练、交易行为复盘和投资者教育，不提供个股推荐、买卖建议、收益承诺或任何形式的证券投资咨询。市场有风险，投资需谨慎。</p>
      </div>

      <div className="home-stats">
        <StatCard label="当前身份" value={account ? account.name : '游客模式'} desc={account ? '当前记录保存在本机账号下' : '可以先体验，后续再登录保存记录'} />
        <StatCard label={`${phaseLabel}资产`} value={`¥${trainer.currentEquity.toFixed(2)}`} desc={`累计变化 ${equityReturn}`} />
        <StatCard label="错题数量" value={`${trainer.mistakes.length}题`} desc="系统会记录回撤较大或明显错过的样本" />
      </div>

      <div className="module-grid">
        <ModuleCard title="历史盲盘训练" desc="随机抽一段历史行情，只看当时能看到的数据，适合练买入前的判断。" action="进入训练" onClick={() => onNavigate('history', 'history')} />
        <ModuleCard title="当前盘面训练" desc="使用最新交易日数据做一次盘面练习。这里只做模拟，不提供买卖建议。" action="进入练习" onClick={() => onNavigate('current', 'current')} />
        <ModuleCard title="什么是盲盘训练" desc="理解为什么要隐藏未来走势，以及它和普通事后复盘的区别。" action="查看方法" onClick={() => onNavigate('blind-trading')} />
        <ModuleCard title="买入决策训练" desc="把追高、犹豫、硬扛等行为拆成可检查的买前判断。" action="查看说明" onClick={() => onNavigate('buy-decision-training')} />
        <ModuleCard title="交易纪律" desc="训练先想风险、再看机会，而不是被分时波动牵着走。" action="查看原则" onClick={() => onNavigate('trading-discipline')} />
        <ModuleCard title="分时陷阱" desc="识别冲高回落、站不回均价线和尾盘拉升等常见误导。" action="查看案例" onClick={() => onNavigate('intraday-trap')} />
        <ModuleCard title="基础知识" desc="先了解界面、买点、分时、仓位和常见心理问题，再开始做题。" action="查看说明" onClick={() => onNavigate('knowledge')} />
        <ModuleCard title="常见问题" desc="说明工具边界、适合人群、是否荐股、是否真实交易等问题。" action="查看FAQ" onClick={() => onNavigate('faq')} />
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

type LandingPageKey = 'blind-trading' | 'buy-decision-training' | 'trading-discipline' | 'intraday-trap' | 'faq';

const LANDING_PAGES: Record<LandingPageKey, { eyebrow: string; title: string; intro: string; sections: Array<{ title: string; body: string }> }> = {
  'blind-trading': {
    eyebrow: '训练方法',
    title: '什么是A股盲盘训练？',
    intro: '盲盘训练的核心是回到历史某一刻，只看当时能够看到的信息，再做模拟买入、放弃或继续观察的判断。它不关心事后涨了多少，而是训练你在不确定条件下是否能按规则决策。',
    sections: [
      { title: '为什么要隐藏未来走势', body: '普通复盘很容易变成事后诸葛亮。你已经知道后面涨跌，自然会觉得当时的买点很明显。盲盘训练把未来信息拿掉，保留当时的K线、分时、量能和市场环境，让判断重新回到真实交易场景。' },
      { title: '它训练的不是预测能力', body: '这个工具不试图告诉你哪只股票会涨，而是帮助你检查买入前的行为：位置是否过高，趋势是否清晰，分时是否诱多，止损是否提前想好，买入动机是否只是怕错过。' },
      { title: '适合什么人', body: '如果你经常追高、冲动买入、亏损后硬扛，或者复盘时总觉得自己“本来应该知道”，盲盘训练可以把这些问题变成一道道可复练的样本。' },
    ],
  },
  'buy-decision-training': {
    eyebrow: '买入决策',
    title: '如何训练股票买入决策？',
    intro: '买入决策不是看到上涨就追，也不是看到下跌就低吸，而是在有限信息下判断风险收益是否匹配。训练的关键是把模糊感觉拆成可检查的问题。',
    sections: [
      { title: '先问风险，再看机会', body: '买入前先判断如果错了会亏在哪里，而不是先幻想能赚多少。趋势、位置、量能、分时承接、止损位置和仓位大小，都是买前必须检查的基本项。' },
      { title: '把冲动买入拆成标签', body: '很多错误并不是技术不会，而是行为失控。比如短线追高、大周期逆势、上午冲高回落、弱势大盘硬做强势股，都可以被标记下来，后续反复复练。' },
      { title: '用错题反馈修正规则', body: '一次训练的盈亏不重要，重要的是你在同类场景里是否反复犯同一种错误。错题记录可以帮助你看见自己的交易习惯，而不是只盯着单次结果。' },
    ],
  },
  'trading-discipline': {
    eyebrow: '交易纪律',
    title: '为什么交易纪律比预测涨跌更重要？',
    intro: '在真实市场里，没有人能稳定知道下一根K线怎么走。交易纪律的价值，是在不确定环境下限制错误动作，避免一次情绪化决策破坏整个账户。',
    sections: [
      { title: '纪律的本质是边界', body: '买之前知道为什么买，错了在哪里止损，仓位为什么是这个比例，这就是边界。没有边界的交易，本质上不是计划，而是情绪反应。' },
      { title: '训练比道理更有效', body: '很多人知道不要追高、不要逆势、不要满仓，但看到分时急拉时仍然会动手。盲盘训练把这些场景重复摆到你面前，让规则通过练习变成习惯。' },
      { title: '先稳定行为，再讨论收益', body: '如果买入动作本身不稳定，后面的收益统计就没有意义。先把错误频率降下来，再观察策略是否有效，这比追逐单次高收益更重要。' },
    ],
  },
  'intraday-trap': {
    eyebrow: '分时图训练',
    title: '分时图冲高回落为什么容易诱导追高？',
    intro: '分时图最容易放大人的即时情绪。价格快速上冲时，人会产生怕错过的感觉；但如果承接不足，冲高很快可能变成回落。',
    sections: [
      { title: '急拉不等于强势', body: '真正的强势需要位置、量能、趋势和承接共同验证。单纯几分钟急拉，可能只是短线资金拉高，也可能是诱导追高。' },
      { title: '均价线和承接要一起看', body: '如果冲高后价格反复站不回分时均价线，或者回落时成交放大，就要警惕买入后的短线回撤风险。' },
      { title: '训练目标是降低条件反射', body: '看到拉升就想买，是很多新手的条件反射。通过盲盘训练，你可以反复练习在冲动出现时先检查趋势、位置、量能和止损。' },
    ],
  },
  faq: {
    eyebrow: '常见问题',
    title: 'A股盲盘训练工具常见问题',
    intro: '这里说明工具边界、使用方式和风险提示，避免把模拟训练误解成投资建议或荐股工具。',
    sections: [
      { title: '这个工具会推荐股票吗？', body: '不会。它只提供模拟训练和交易行为复盘，不提供个股推荐、买卖建议、收益承诺或任何形式的证券投资咨询。' },
      { title: '当前盘面训练可以作为真实交易依据吗？', body: '不可以。当前盘面训练只是用最新数据做模拟练习，目的仍然是训练判断流程，而不是给出真实买卖信号。' },
      { title: '适合新手使用吗？', body: '适合，但建议先看基础知识和训练方法。新手更应该把重点放在识别冲动买入、理解止损和仓位，而不是追求短期收益。' },
      { title: '和回测系统有什么区别？', body: '回测通常验证一套规则在历史数据上的收益表现；盲盘训练更关注人在单个盘面下的判断动作、错误习惯和复盘反馈。' },
    ],
  },
};

export function LandingPage({ page, onNavigate }: { page: LandingPageKey; onNavigate: ProductAction }) {
  const config = LANDING_PAGES[page];
  return (
    <section className="content-page seo-page">
      <div className="page-head seo-page-head">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h1>{config.title}</h1>
          <p>{config.intro}</p>
          <p className="risk-note">风险提示：本工具仅用于模拟训练、交易行为复盘和投资者教育，不构成任何证券投资建议。</p>
        </div>
        <button className="primary-btn" onClick={() => onNavigate('history', 'history')}>开始盲盘训练</button>
      </div>
      <div className="seo-article-grid">
        {config.sections.map((section) => (
          <article key={section.title} className="card seo-article-card">
            <h2>{section.title}</h2>
            <p>{section.body}</p>
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
          <p>这里会保存回撤较大、亏损偏多，或者未买入后明显上涨的样本。数量多了以后，可以看出自己更容易在哪些场景出问题。</p>
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
                <b>{item.action === 'buy' ? '买入错题' : '未买入错题'} · {item.symbol}</b>
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

function AccountStat({ label, value, desc, tone }: { label: string; value: string; desc: string; tone?: 'up' | 'down' }) {
  return (
    <div className="account-stat-card">
      <span>{label}</span>
      <b className={tone === 'down' ? 'down-text' : tone === 'up' ? 'up-text' : ''}>{value}</b>
      <p>{desc}</p>
    </div>
  );
}

function TradingHistoryPanel({ trainer }: { trainer: ReturnType<typeof useTradingTrainer> }) {
  const phases: Array<{ key: TrainingPhase; label: string }> = [
    { key: 'history', label: '历史盲盘' },
    { key: 'current', label: '当前盘面' },
  ];

  return (
    <div className="account-history-grid">
      {phases.map((phase) => (
        <TradeHistorySection key={phase.key} label={phase.label} trades={trainer.phasePortfolios[phase.key].trades} />
      ))}
    </div>
  );
}

function TradeHistorySection({ label, trades }: { label: string; trades: SimTrade[] }) {
  const groups = buildStockTradeGroups(trades);
  const realized = trades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0);
  const buyCount = trades.filter((trade) => trade.side === 'buy').length;
  const sellCount = trades.filter((trade) => trade.side === 'sell').length;
  const latestTrades = [...trades].reverse().slice(0, 40);

  return (
    <div className="account-history-grid account-history-redesign">
      <div className="account-panel-head phase-history-head">
        <h2>{label}交易历史</h2>
        <span>{trades.length} 笔</span>
      </div>
      <div className="account-stats-row">
        <AccountStat label="总操作" value={`${trades.length}笔`} desc={`买入 ${buyCount} · 卖出 ${sellCount}`} />
        <AccountStat label="已实现盈亏" value={money(realized)} desc="只统计卖出成交后的收益" tone={realized >= 0 ? 'up' : 'down'} />
        <AccountStat label="涉及股票" value={`${groups.length}只`} desc="按股票代码聚合记录" />
      </div>

      {!trades.length && (
        <div className="card profile-card empty-account-history">
          <h2>暂无交易记录</h2>
          <p className="muted-text">买入或卖出后，这里会自动生成按股票汇总和最近操作流水。</p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="account-history-columns">
          <div className="card profile-card stock-history-card stock-summary-panel">
            <div className="account-panel-head">
              <h2>按股票汇总</h2>
              <span>{groups.length} 只</span>
            </div>
            <div className="stock-history-list">
              {groups.slice(0, 18).map((group) => (
                <div key={group.symbol} className="stock-history-item compact-stock-item">
                  <div className="stock-history-head">
                    <b>{group.symbol}</b>
                    <span className={group.realized >= 0 ? 'up-text' : 'down-text'}>{money(group.realized)}</span>
                  </div>
                  <div className="stock-history-meta">
                    <span>{group.trades.length} 笔</span>
                    <span>买 ¥{group.buyAmount.toFixed(0)}</span>
                    <span>卖 ¥{group.sellAmount.toFixed(0)}</span>
                  </div>
                  <div className="stock-history-trades compact-stock-trades">
                    {[...group.trades].reverse().slice(0, 3).map((trade) => (
                      <div key={trade.id} className="trade-row">
                        <span>{trade.date}</span>
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

          <div className="card profile-card trade-history-card latest-trades-panel">
            <div className="account-panel-head">
              <h2>最近操作流水</h2>
              <span>{latestTrades.length} 笔</span>
            </div>
            <div className="trade-table compact-trade-table">
              {latestTrades.map((trade) => (
                <div key={trade.id} className="trade-row full">
                  <span>{trade.date} {trade.time}</span>
                  <b>{trade.symbol}</b>
                  <em className={trade.side === 'buy' ? 'up-text' : 'down-text'}>{tradeSideText(trade.side)}</em>
                  <span>{trade.quantity}股</span>
                  <span>¥{trade.price.toFixed(2)}</span>
                  <span>¥{trade.amount.toFixed(0)}</span>
                  <strong className={trade.realizedPnl >= 0 ? 'up-text' : 'down-text'}>{trade.side === 'sell' ? money(trade.realizedPnl) : '--'}</strong>
                </div>
              ))}
            </div>
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
      <section className="content-page account-page account-page-redesign">
        <div className="card account-card account-hero-card">
          <div>
            <p className="eyebrow">账号</p>
            <h1>{account.name}</h1>
            <p>{account.email}</p>
            <p className="muted-text">当前账号只保存在本机浏览器里。后面接入正式登录后，训练记录、错题和统计可以跟账号同步。</p>
          </div>
          <button className="ghost-btn" onClick={onSignOut}>退出登录</button>
        </div>
        <TradingHistoryPanel trainer={trainer} />
      </section>
    );
  }

  return (
    <section className="content-page account-page account-page-redesign">
      <div className="card account-card account-hero-card account-login-card">
        <div>
          <p className="eyebrow">登录 / 注册</p>
          <h1>先用本地账号试一下</h1>
          <p>现在先做了一个轻量版本，用来保存本机训练记录。正式上线时可以再接邮箱验证码、手机号或微信登录。</p>
        </div>
        <div className="account-login-form">
          <label>昵称</label>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：练习用户" />
          <label>邮箱</label>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          <button className="primary-btn" onClick={() => onSignIn(email, name)}>创建本地账号</button>
          <p className="risk-note">当前账号信息只保存在本机浏览器。</p>
        </div>
      </div>
      <TradingHistoryPanel trainer={trainer} />
    </section>
  );
}

export type { ProductPage, ProductAction, LandingPageKey };
