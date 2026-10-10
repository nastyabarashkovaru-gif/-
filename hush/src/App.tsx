import { useEffect } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DevMenu } from '@/components/dev/DevMenu';
import { ToastProvider } from '@/components/ui';
import { HomeScreen } from '@/screens/HomeScreen';
import { PaywallScreen } from '@/screens/PaywallScreen';
import { QuestionSelectScreen } from '@/screens/QuestionSelectScreen';
import { UpcomingScreen } from '@/screens/UpcomingScreen';
import { WelcomeScreen } from '@/screens/WelcomeScreen';
import { AppStateProvider } from '@/state/AppState';

function AnimatedRoutes() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<WelcomeScreen />} />
        <Route path="/questions" element={<QuestionSelectScreen />} />
        <Route path="/home" element={<HomeScreen />} />
        <Route path="/paywall" element={<PaywallScreen />} />
        <Route path="/soon/:id" element={<UpcomingScreen />} />
        <Route path="/answer/:surveyId" element={<Navigate to="/soon/answer" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AppStateProvider>
          <ToastProvider>
            {/* Мобильный контейнер: на широких экранах центрируется с тонкими границами */}
            <div className="relative mx-auto min-h-dvh w-full max-w-app overflow-x-clip min-[460px]:border-x min-[460px]:border-border/60">
              <AnimatedRoutes />
            </div>
            <DevMenu />
          </ToastProvider>
        </AppStateProvider>
      </BrowserRouter>
    </MotionConfig>
  );
}
