import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

const AdminApp = lazy(() => import('./admin/AdminApp'));
const ArtPreview = lazy(() => import('./art/ArtPreview'));
const isAdmin = location.pathname.startsWith('/admin');
const isArt = location.pathname === '/art';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <Suspense fallback={null}><AdminApp /></Suspense> : isArt ? <Suspense fallback={null}><ArtPreview /></Suspense> : <App />}
  </StrictMode>,
);
