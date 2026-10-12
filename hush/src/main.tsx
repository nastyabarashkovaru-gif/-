import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTelegram } from './lib/telegram';
import { installErrorReporting } from './lib/errorReport';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { CrashScreen } from './ui/CrashScreen';
import './index.css';

initTelegram();
installErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="root" fallback={<CrashScreen />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
