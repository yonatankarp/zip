import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

/*
 * Offline and installable, in the deployed build only -- a worker sitting in
 * front of the dev server or the test bundle would serve stale code.
 *
 * MODE, not PROD: `vite build` sets NODE_ENV=production whatever --mode says,
 * so PROD is true for the test build too. MODE is the one that distinguishes
 * them, and it is the same flag that strips the ?test hook.
 */
if (import.meta.env.MODE === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* not fatal */ });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
