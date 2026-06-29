import { useState } from 'react';
import type { LocalAccount } from '../hooks/useLocalAccount';
import type { useTradingTrainer } from '../hooks/useTradingTrainer';
import { change, pct } from '../lib/indicators';
import { type TrainingPhase } from '../domain/trainingPhase';

type ProductPage = 'home' | 'knowledge' | 'history' | 'current' | 'mistakes' | 'profile';

type ProductAction = (page: ProductPage, phase?: TrainingPhase) => void;

export function HomePage({ onNavigate, trainer, account }: { onNavigate: ProductAction; trainer: ReturnType<typeof useTradingTrainer>; account: LocalAccount | null }) {
  const equityReturn = pct(change(trainer.portfolio.initialCash, trainer.currentEquity));

  return (
    <section className="product-home">
      <div className="hero-panel card">
        <p className="eyebrow">A股盲盘训练 · 非投资建议</p>
        <h1>测出你最容易亏钱的买入习惯</h1>
        <p>用历史行情和当前盘面做模拟训练。系统不推荐股票，不预测涨跌，只记录你的判断、复盘你的冲动、沉淀错题和个人画像。</p>
        <div className="hero-cta">
          <button className="primary-btn" onClick={() => onNavigate('history', 'history')}>开始20题交易习惯测试</button>
          <button className="ghost-btn" onClick={() => onNavigate('knowledge')}>先看基础知识</button>
        </div>
        <p className="risk-note">本产品仅用于模拟训练和投资者教育，不构成证券投资建议。不要依据训练结果进行真实交易。</p>
      </div>

      <div className="home-stats">
        <StatCard label="当前身份" value={account ? account.name : '游客模式'} desc={account ? '训练记录保存在本机账号下' : '可先体验，登录后保存长期画像'} />
        <StatCard label="模拟资产" value={`¥${trainer.currentEquity.toFixed(2)}`} desc={`累计收益率 ${equityReturn}`} />
        <StatCard label="错题数量" value={`${trainer.mistakes.length}题`} desc="追高、回撤、放弃后大涨会自动收集" />
      </div>

      <div className="module-grid">
        <ModuleCard title="历史盲盘训练" desc="随机历史阶段，隐藏未来数据，适合真正训练买入纪律。" action="进入训练" onClick={() => onNavigate('history', 'history')} />
        <ModuleCard title="当前盘面训练" desc="使用最新交易日数据做当下盘面演练，强调风险识别，不做荐股。" action="进入演练" onClick={() => onNavigate('current', 'current')} />
        <ModuleCard title="基础知识了解" desc="围绕买点、分时陷阱、仓位止损和交易心理建立训练框架。" action="开始学习" onClick={() => onNavigate('knowledge')} />
        <ModuleCard title="错题本与画像" desc="查看自己最常见的错误类型，进入针对性训练。" action="查看画像" onClick={() => onNavigate('mistakes')} />
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
      items: ['日K看位置，周K/月K看大周期', '当天分时只用于判断当时资金状态', '开盘和午间不会展示当天完整日K'],
    },
    {
      title: '买点判断',
      items: ['突破不等于追高，要看是否放量和是否接近阶段高位', '回踩要确认趋势仍在，不是跌了就便宜', '低吸要有止损位置，否则容易变成死扛'],
    },
    {
      title: '分时陷阱',
      items: ['上午急拉后回落，常见风险是承接不足', '尾盘拉升不一定代表次日溢价', '分时站不回均价线，追入风险会提高'],
    },
    {
      title: '仓位与止损',
      items: ['买入前先想错了怎么办', '不确定时先降低模拟仓位', 'T+1环境下，当天买入无法当天卖出'],
    },
    {
      title: '交易心理',
      items: ['怕错过会提高追高概率', '幻想反弹会让低吸变成抄底', '亏损后补仓前必须重新判断趋势是否破坏'],
    },
  ];

  return (
    <section className="content-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">基础知识</p>
          <h1>不是百科，而是训练前的判断框架</h1>
          <p>每个知识点都对应训练里的一个常见错误。先建立框架，再去做盲盘题。</p>
        </div>
        <button className="primary-btn" onClick={() => onNavigate('history', 'history')}>学完去盲盘训练</button>
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
          <p className="eyebrow">错题本与个人画像</p>
          <h1>看见你重复犯错的地方</h1>
          <p>这里不是评价你会不会炒股，而是把冲动买入、过早买入、错过机会等行为沉淀成训练路径。</p>
        </div>
        <button className="primary-btn" onClick={() => onNavigate('history', 'history')}>继续训练</button>
      </div>

      <div className="profile-grid">
        <StatCard label="模拟买入" value={`${buyTrades}笔`} desc="只统计本机训练记录" />
        <StatCard label="模拟卖出" value={`${sellTrades}笔`} desc={`已实现盈亏 ${realized >= 0 ? '+' : ''}${realized.toFixed(2)}`} />
        <StatCard label="错题数量" value={`${trainer.mistakes.length}题`} desc="可进入错题重练" />
      </div>

      <div className="card profile-card">
        <h2>高频错误标签</h2>
        {rankedTags.length ? (
          <div className="tag-rank-list">
            {rankedTags.map(([tag, count]) => <span key={tag}>{tag} · {count}</span>)}
          </div>
        ) : (
          <p className="muted-text">还没有足够错题。完成训练后，系统会自动生成你的错误画像。</p>
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

export function AccountPage({
  account,
  onSignIn,
  onSignOut,
}: {
  account: LocalAccount | null;
  onSignIn: (email: string, name?: string) => void;
  onSignOut: () => void;
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
          <p className="muted-text">当前是本地账号 MVP。后续接入正式后端后，训练记录、错题本和画像可以跨设备保存。</p>
          <button className="ghost-btn" onClick={onSignOut}>退出登录</button>
        </div>
      </section>
    );
  }

  return (
    <section className="content-page account-page">
      <div className="card account-card">
        <p className="eyebrow">登录 / 注册</p>
        <h1>先用本地账号保存训练记录</h1>
        <p>上线 MVP 先保留轻量登录入口。后续再替换为邮箱验证码、手机号或微信登录。</p>
        <label>昵称</label>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：追高纠偏训练者" />
        <label>邮箱</label>
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
        <button className="primary-btn" onClick={() => onSignIn(email, name)}>创建本地账号</button>
        <p className="risk-note">当前账号仅保存在本机浏览器，不会上传隐私数据。</p>
      </div>
    </section>
  );
}

export type { ProductPage, ProductAction };
