import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { usingMock } from '@/api';
import { config } from '@/config';
import { DemoPanel } from '@/demo/DemoPanel';
import { getStartParam } from '@/lib/telegram';
import { NavigatorProvider, useNav } from '@/nav/Navigator';
import { routeKey, type Route } from '@/nav/routes';
import { AnswerScreen } from '@/screens/Answer';
import { DashboardScreen } from '@/screens/Dashboard';
import { PremiumScreen } from '@/screens/Premium';
import { RevealScreen } from '@/screens/Reveal';
import { SelectQuestionsScreen } from '@/screens/SelectQuestions';
import { MyQuestionnairesScreen, SettingsScreen, SubscriptionScreen } from '@/screens/Settings';
import { ShareScreen } from '@/screens/Share';
import { SuccessScreen } from '@/screens/Success';
import { WelcomeScreen } from '@/screens/Welcome';
import { AppStateProvider, useAppState } from '@/state/AppState';
import { LoadingScreen, MessageScreen, ToastProvider } from '@/ui';

function renderRoute(route: Route) {
  switch (route.name) {
    case 'loading':
      return <LoadingScreen />;
    case 'welcome':
      return <WelcomeScreen />;
    case 'questions':
      return <SelectQuestionsScreen />;
    case 'share':
      return <ShareScreen qid={route.qid} />;
    case 'dashboard':
      return <DashboardScreen qid={route.qid} />;
    case 'premium':
      return <PremiumScreen />;
    case 'reveal':
      return <RevealScreen qid={route.qid} respondentId={route.respondentId} />;
    case 'answer':
      return <AnswerScreen qid={route.qid} />;
    case 'success':
      return <SuccessScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'subscription':
      return <SubscriptionScreen />;
    case 'myQuestionnaires':
      return <MyQuestionnairesScreen />;
  }
}

const pageVariants = {
  initial: (dir: number) => ({ opacity: 0, x: dir * 24 }),
  animate: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -24 }),
};

function Router() {
  const { route, direction } = useNav();
  const key = routeKey(route);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [key]);

  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.main
        key={key}
        custom={direction}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {renderRoute(route)}
      </motion.main>
    </AnimatePresence>
  );
}

function Root() {
  const { questionnaires } = useAppState();
  // Стартовый экран: ссылка друга → ответы; есть анкета → её статус; иначе приветствие
  const initial = useMemo<Route>(() => {
    const startParam = getStartParam();
    if (startParam) return { name: 'answer', qid: startParam };
    if (questionnaires[0]) return { name: 'dashboard', qid: questionnaires[0].id };
    return { name: 'welcome' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <NavigatorProvider initial={initial}>
      <Router />
      {config.demo && usingMock && <DemoPanel />}
    </NavigatorProvider>
  );
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <div className="relative mx-auto w-full max-w-app overflow-x-clip bg-black min-[470px]:border-x min-[470px]:border-[#1c1a21]">
          <AppStateProvider
            fallback={<LoadingScreen />}
            error={(retry) => (
              <MessageScreen
                icon={<span className="text-[28px]">!</span>}
                title="Не удалось загрузить"
                text="Проверь соединение и попробуй ещё раз."
                action="Повторить"
                onAction={retry}
              />
            )}
          >
            <Root />
          </AppStateProvider>
        </div>
      </ToastProvider>
    </MotionConfig>
  );
}
