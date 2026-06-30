import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './advisor.css';
import './layout-overrides.css';
import './training-phase.css';
import './product-shell.css';
import './mobile-nav.css';
import './mobile-training.css';
import './account-history.css';
import './training-intent.css';
import './mobile-polish.css';
import './mobile-final-polish.css';
import './mobile-screen-refine.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
