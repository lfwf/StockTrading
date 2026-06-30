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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
