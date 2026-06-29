import { useEffect, useState } from 'react';
import { TrainingWorkspace } from './components/TrainingWorkspace';
import { AccountPage, HomePage, KnowledgePage, MistakeProfilePage, type ProductPage } from './components/ProductPages';
import { useLocalAccount } from './hooks/useLocalAccount';
import { useTradingTrainer } from './hooks/useTradingTrainer';
import type { TrainingPhase } from './domain/trainingPhase';

const NAV_ITEMS: Array<{ key: ProductPage; label: string; phase?: TrainingPhase }> = [
  { key: 'home', label: '首页' },
  { key: 'knowledge', label: '基础知识' },
  { key: 'history', label: '历史盲盘', phase: 'history' },
  { key: 'current', label: '当前盘面', phase: 'current' },
  { key: 'mistakes', label: '错题记录' },
  { key: 'profile', label: '账号' },
];

export default function App() {
  const trainer = useTradingTrainer();
  const { account, signIn, signOut } = useLocalAccount();
  const [activePage, setActivePage] = useState<ProductPage>('home');
  const [navOpen, setNavOpen] = useState(false);
  const activeItem = NAV_ITEMS.find((item) => item.key === activePage) ?? NAV_ITEMS[0];

  useEffect(() => {
    document.body.classList.toggle('nav-open', navOpen);
    return () => document.body.classList.remove('nav-open');
  }, [navOpen]);

  function navigate(page: ProductPage, phase?: TrainingPhase) {
    if (phase) trainer.switchTrainingPhase(phase);
    setActivePage(page);
    setNavOpen(false);
  }

  function renderPage() {
    if (activePage === 'home') return <HomePage trainer={trainer} account={account} onNavigate={navigate} />;
    if (activePage === 'knowledge') return <KnowledgePage onNavigate={navigate} />;
    if (activePage === 'history' || activePage === 'current') return <TrainingWorkspace trainer={trainer} />;
    if (activePage === 'mistakes') return <MistakeProfilePage trainer={trainer} onNavigate={navigate} />;
    return <AccountPage account={account} onSignIn={signIn} onSignOut={signOut} />;
  }

  return (
    <div className="app-shell product-shell">
      <header className="product-topbar">
        <button className="brand-button" onClick={() => navigate('home')}>
          <span>盲盘训练</span>
          <b>{activeItem.label}</b>
        </button>
        <button className="mobile-menu-button" onClick={() => setNavOpen(true)} aria-expanded={navOpen} aria-label="打开菜单">菜单</button>
        <nav className={navOpen ? 'product-nav open' : 'product-nav'}>
          <div className="mobile-nav-head">
            <b>功能菜单</b>
            <button onClick={() => setNavOpen(false)} aria-label="关闭菜单">关闭</button>
          </div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={activePage === item.key ? 'active' : ''}
              onClick={() => navigate(item.key, item.phase)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {navOpen && <button className="nav-backdrop" onClick={() => setNavOpen(false)} aria-label="关闭菜单" />}
        <button className="account-pill" onClick={() => navigate('profile')}>
          {account ? account.name : '游客模式'}
        </button>
      </header>

      {renderPage()}

      <footer className="compliance-footer">
        本产品仅用于模拟训练、交易行为复盘和投资者教育，不构成任何证券投资建议。所有训练结果不代表未来收益，用户不应据此作出真实交易决策。
      </footer>
    </div>
  );
}
