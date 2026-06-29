import { useState } from 'react';
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
  { key: 'mistakes', label: '错题画像' },
  { key: 'profile', label: '账号' },
];

export default function App() {
  const trainer = useTradingTrainer();
  const { account, signIn, signOut } = useLocalAccount();
  const [activePage, setActivePage] = useState<ProductPage>('home');

  function navigate(page: ProductPage, phase?: TrainingPhase) {
    if (phase) trainer.switchTrainingPhase(phase);
    setActivePage(page);
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
          <b>A股交易行为测试</b>
        </button>
        <nav className="product-nav">
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
