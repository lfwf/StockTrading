import { useEffect, useRef, useState } from 'react';
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

const VALID_PAGES = new Set<ProductPage>(NAV_ITEMS.map((item) => item.key));

function loadLastPage(): ProductPage {
  try {
    const saved = localStorage.getItem('stock-trading-active-page') as ProductPage | null;
    return saved && VALID_PAGES.has(saved) ? saved : 'home';
  } catch {
    return 'home';
  }
}

export default function App() {
  const trainer = useTradingTrainer();
  const { account, signIn, signOut } = useLocalAccount();
  const [activePage, setActivePage] = useState<ProductPage>(() => loadLastPage());
  const [navOpen, setNavOpen] = useState(false);
  const phaseSwitchTimer = useRef<number | null>(null);
  const restoredPhaseRef = useRef(false);
  const activeItem = NAV_ITEMS.find((item) => item.key === activePage) ?? NAV_ITEMS[0];

  useEffect(() => {
    document.body.classList.toggle('nav-open', navOpen);
    document.body.classList.toggle('mobile-menu-open', navOpen);
    return () => {
      document.body.classList.remove('nav-open');
      document.body.classList.remove('mobile-menu-open');
    };
  }, [navOpen]);

  useEffect(() => {
    return () => {
      if (phaseSwitchTimer.current) window.clearTimeout(phaseSwitchTimer.current);
      document.body.classList.remove('mobile-phase-switching');
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('stock-trading-active-page', activePage);
    } catch {
      // ignore unavailable storage
    }
  }, [activePage]);

  useEffect(() => {
    if (restoredPhaseRef.current || trainer.isBootstrapping) return;
    restoredPhaseRef.current = true;
    if (activePage === 'history') trainer.switchTrainingPhase('history');
    if (activePage === 'current') trainer.switchTrainingPhase('current');
  }, [activePage, trainer]);

  function hideActionBarDuringSwitch() {
    if (typeof window === 'undefined' || window.innerWidth > 760) return;
    document.body.classList.add('mobile-phase-switching');
    if (phaseSwitchTimer.current) window.clearTimeout(phaseSwitchTimer.current);
    phaseSwitchTimer.current = window.setTimeout(() => {
      document.body.classList.remove('mobile-phase-switching');
      window.dispatchEvent(new Event('mobile-action-bar-realign'));
    }, 320);
  }

  function navigate(page: ProductPage, phase?: TrainingPhase) {
    if (phase || activePage === 'history' || activePage === 'current') hideActionBarDuringSwitch();
    if (phase) trainer.switchTrainingPhase(phase);
    setActivePage(page);
    setNavOpen(false);
  }

  function renderPage() {
    if (activePage === 'home') return <HomePage trainer={trainer} account={account} onNavigate={navigate} />;
    if (activePage === 'knowledge') return <KnowledgePage onNavigate={navigate} />;
    if (activePage === 'history' || activePage === 'current') return <TrainingWorkspace trainer={trainer} />;
    if (activePage === 'mistakes') return <MistakeProfilePage trainer={trainer} onNavigate={navigate} />;
    return <AccountPage account={account} onSignIn={signIn} onSignOut={signOut} trainer={trainer} />;
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
