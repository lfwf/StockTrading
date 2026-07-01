import { useEffect, useRef, useState } from 'react';
import { TrainingWorkspace } from './components/TrainingWorkspace';
import { AccountPage, HomePage, KnowledgePage, LandingPage, MistakeProfilePage, type LandingPageKey, type ProductPage } from './components/ProductPages';
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

const LANDING_PAGE_KEYS: LandingPageKey[] = ['blind-trading', 'buy-decision-training', 'trading-discipline', 'intraday-trap', 'faq'];
const ALL_PAGES = new Set<ProductPage>([...NAV_ITEMS.map((item) => item.key), ...LANDING_PAGE_KEYS]);
const LANDING_PAGES = new Set<ProductPage>(LANDING_PAGE_KEYS);

const PAGE_PATHS: Record<ProductPage, string> = {
  home: '/',
  knowledge: '/knowledge',
  history: '/history',
  current: '/current',
  mistakes: '/mistakes',
  profile: '/profile',
  'blind-trading': '/blind-trading',
  'buy-decision-training': '/buy-decision-training',
  'trading-discipline': '/trading-discipline',
  'intraday-trap': '/intraday-trap',
  faq: '/faq',
};

const PAGE_META: Record<ProductPage, { title: string; description: string }> = {
  home: {
    title: 'A股盲盘训练工具｜交易纪律与买点判断模拟训练',
    description: 'A股盲盘训练工具，用历史盘面和当前盘面模拟买入决策，训练买点判断、分时陷阱识别、仓位止损和交易纪律。',
  },
  knowledge: {
    title: '股票买点判断基础知识｜A股盲盘训练工具',
    description: '了解日K、周K、月K、分时图、仓位止损和交易心理，开始进行A股盲盘训练。',
  },
  history: {
    title: '历史盲盘训练｜A股买入决策模拟训练',
    description: '回到历史某个交易时刻，只看当时可见数据，训练模拟买入、放弃或继续观察的判断。',
  },
  current: {
    title: '当前盘面训练｜A股模拟买入练习',
    description: '使用最新盘面数据进行模拟训练，练习买入判断和交易纪律，不构成投资建议。',
  },
  mistakes: {
    title: '股票交易错题记录｜买入判断复盘工具',
    description: '查看模拟训练中的高频错误标签、最近错题和交易行为偏差。',
  },
  profile: {
    title: '训练账号与模拟交易记录｜A股盲盘训练工具',
    description: '查看本机训练账号、模拟交易流水和历史训练记录。',
  },
  'blind-trading': {
    title: '什么是A股盲盘训练？｜交易行为训练方法',
    description: '盲盘训练通过隐藏未来走势，还原历史交易时刻，帮助训练买点判断和交易纪律。',
  },
  'buy-decision-training': {
    title: '如何训练股票买入决策？｜买点判断训练',
    description: '把股票买入决策拆成趋势、位置、量能、分时、止损、仓位和买入动机等检查项。',
  },
  'trading-discipline': {
    title: '交易纪律训练｜为什么纪律比预测涨跌更重要',
    description: '通过模拟训练降低追高、逆势、硬扛和情绪化买入等错误行为。',
  },
  'intraday-trap': {
    title: '分时图冲高回落陷阱｜A股分时训练',
    description: '识别分时急拉、冲高回落、站不回均价线和尾盘拉升等常见误导。',
  },
  faq: {
    title: 'A股盲盘训练工具常见问题｜是否荐股与使用边界',
    description: '说明A股盲盘训练工具是否荐股、是否真实交易、适合谁使用以及和回测系统的区别。',
  },
};

const PATH_PAGES = Object.entries(PAGE_PATHS).reduce<Record<string, ProductPage>>((acc, [page, path]) => {
  acc[path] = page as ProductPage;
  return acc;
}, {});

function pageFromLocation(): ProductPage | null {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  return PATH_PAGES[path] ?? null;
}

function loadLastPage(): ProductPage {
  const routePage = pageFromLocation();
  if (routePage) return routePage;
  try {
    const saved = localStorage.getItem('stock-trading-active-page') as ProductPage | null;
    return saved && ALL_PAGES.has(saved) ? saved : 'home';
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
    const meta = PAGE_META[activePage] ?? PAGE_META.home;
    document.title = meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
  }, [activePage]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', navOpen);
    document.body.classList.toggle('mobile-menu-open', navOpen);
    return () => {
      document.body.classList.remove('nav-open');
      document.body.classList.remove('mobile-menu-open');
    };
  }, [navOpen]);

  useEffect(() => {
    function handlePopState() {
      const routePage = pageFromLocation();
      if (routePage) setActivePage(routePage);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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

    if (typeof window !== 'undefined') {
      const nextPath = PAGE_PATHS[page] ?? '/';
      if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath);
    }
  }

  function renderPage() {
    if (activePage === 'home') return <HomePage trainer={trainer} account={account} onNavigate={navigate} />;
    if (activePage === 'knowledge') return <KnowledgePage onNavigate={navigate} />;
    if (activePage === 'history' || activePage === 'current') return <TrainingWorkspace trainer={trainer} />;
    if (activePage === 'mistakes') return <MistakeProfilePage trainer={trainer} onNavigate={navigate} />;
    if (LANDING_PAGES.has(activePage)) return <LandingPage page={activePage as LandingPageKey} onNavigate={navigate} />;
    return <AccountPage account={account} onSignIn={signIn} onSignOut={signOut} trainer={trainer} />;
  }

  return (
    <div className="app-shell product-shell">
      <header className="product-topbar">
        <button className="brand-button" onClick={() => navigate('home')}>
          <img src="/logo.svg" alt="" aria-hidden="true" />
          <span className="brand-copy">
            <span>盲盘训练</span>
            <b>{activeItem.label}</b>
          </span>
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
        风险提示：本产品仅用于模拟训练、交易行为复盘和投资者教育，不提供个股推荐、买卖建议或收益承诺。市场有风险，投资需谨慎。
      </footer>
    </div>
  );
}
