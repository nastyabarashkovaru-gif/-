import { lazy, Suspense, useEffect, useMemo } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { Send, WifiOff } from 'lucide-react';
import { usingMock } from '@/api';
import { config } from '@/config';
import { getStartParam } from '@/lib/telegram';
import { NavigatorProvider, useNav } from '@/nav/Navigator';
import { routeKey, TAB_ROUTES, type Route } from '@/nav/routes';
import { AdminScreen } from '@/screens/Admin';
import { AskDetailScreen, AskReplyScreen, AsksScreen, CreateAskScreen } from '@/screens/qa/Asks';
import { TabBar } from '@/screens/qa/common';
import { AskMeScreen, MyLinkScreen, SentScreen, StartScreen } from '@/screens/qa/Entry';
import { AnswerInboxScreen, InboxScreen } from '@/screens/qa/Inbox';
import { ProfileScreen } from '@/screens/qa/Profile';
import { track } from '@/lib/analytics';
import { AnswerScreen } from '@/screens/Answer';
import { DashboardScreen } from '@/screens/Dashboard';
import { PremiumScreen } from '@/screens/Premium';
import { PremiumSuccessScreen } from '@/screens/PremiumSuccess';
import { RevealScreen } from '@/screens/Reveal';
import { SelectQuestionsScreen } from '@/screens/SelectQuestions';
import { MyQuestionnairesScreen, SettingsScreen, SubscriptionScreen } from '@/screens/Settings';
import { ShareScreen } from '@/screens/Share';
import { AppStateProvider, useAppState } from '@/state/AppState';
import { LoadingScreen, MessageScreen, ToastProvider } from '@/ui';

// Демо-панель грузится отдельно и не попадает в production-сборку
const DemoPanel = /* @__PURE__ */ lazy(() => import('@/demo/DemoPanel').then((m) => ({ default: m.DemoPanel })));

function renderRoute(route: Route) {
  switch (route.name) {
    case 'loading':
      return <LoadingScreen />;
    case 'welcome':
      // HUSH 2.0: прежний приветственный экран анкет заменён выбором из двух механик
      return <StartScreen />;
    case 'questions':
      return <SelectQuestionsScreen />;
    case 'share':
      return <ShareScreen qid={route.qid} />;
    case 'dashboard':
      return <DashboardScreen qid={route.qid} />;
    case 'premium':
      return <PremiumScreen source={route.source} />;
    case 'reveal':
      return <RevealScreen qid={route.qid} respondentId={route.respondentId} />;
    case 'answer':
      return <AnswerScreen qid={route.qid} />;
    case 'premiumSuccess':
      return <PremiumSuccessScreen pending={route.pending} />;
    case 'success':
      // Ответил на старую анкету — тот же вирусный экран HUSH 2.0
      return <SentScreen kind="answer" />;
    case 'settings':
      return <SettingsScreen />;
    case 'subscription':
      return <SubscriptionScreen />;
    case 'myQuestionnaires':
      return <MyQuestionnairesScreen />;
    case 'admin':
      return <AdminScreen />;
    case 'start':
      return <StartScreen />;
    case 'inbox':
      return <InboxScreen />;
    case 'asks':
      return <AsksScreen />;
    case 'profile':
      return <ProfileScreen />;
    case 'myLink':
      return <MyLinkScreen />;
    case 'askMe':
      return <AskMeScreen slug={route.slug} />;
    case 'sent':
      return <SentScreen kind={route.kind} slug={route.slug} />;
    case 'answerInbox':
      return <AnswerInboxScreen id={route.id} />;
    case 'createAsk':
      return <CreateAskScreen />;
    case 'askDetail':
      return <AskDetailScreen id={route.id} fresh={route.fresh} />;
    case 'askReply':
      return <AskReplyScreen id={route.id} />;
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

  const tab = (TAB_ROUTES as readonly string[]).includes(route.name) ? route.name : null;

  return (
    <>
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
    {/* Нижняя панель — только на вкладках, вне анимации переходов */}
    {tab && <TabBar active={tab} />}
    </>
  );
}

function Root() {
  const { questionnaires, me, qa } = useAppState();
  /**
   * Стартовый экран HUSH 2.0:
   * u_<slug> — форма вопроса получателю (без приветствия), a_<id> — ответ на чужой вопрос,
   * admin — статистика, ref_* — рекламная метка, прочее — старая ссылка на анкету.
   * Без ссылки: уже пользовался HUSH → «Входящие», иначе — выбор из двух механик.
   */
  const initial = useMemo<Route>(() => {
    // startapp=demo обрабатывает эффект ниже (переход в демо-версию), как маршрут его не используем
    const startParam = getStartParam() === 'demo' ? null : getStartParam();
    if (startParam === 'admin' && me.isAdmin) return { name: 'admin' };
    if (startParam?.startsWith('u_')) return { name: 'askMe', slug: startParam.slice(2) };
    if (startParam?.startsWith('a_')) return { name: 'askReply', id: startParam.slice(2) };
    // Пуш «Тебе ответили» ведёт сразу в «Я спросил(а)»
    if (startParam === 'tab_asks') return { name: 'asks' };
    if (startParam && startParam !== 'admin' && !startParam.startsWith('ref_')) return { name: 'answer', qid: startParam };
    if (qa?.askSlug || (qa?.asks ?? 0) > 0 || questionnaires.length) return { name: 'inbox' };
    // Только задавал вопросы другим — сразу к их ответам
    if ((qa?.sent ?? 0) > 0) return { name: 'asks' };
    return { name: 'start' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // startapp=demo: демо-версия на выдуманных данных (только для DEMO_IDS)
  useEffect(() => {
    if (!usingMock && getStartParam() === 'demo' && me.demoAccess) window.location.replace('/demo/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Аналитика: открытие приложения и по какой ссылке
  useEffect(() => {
    const p = getStartParam();
    track('app_open', !p ? 'direct' : p.startsWith('u_') ? 'personal_link' : p.startsWith('a_') ? 'ask_link' : p.startsWith('ref_') ? p.slice(0, 40) : p === 'admin' ? 'admin' : 'questionnaire');
  }, []);

  return (
    <NavigatorProvider initial={initial}>
      <Router />
      {usingMock && (
        <Suspense fallback={null}>
          <DemoPanel />
        </Suspense>
      )}
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
            error={(retry, code) =>
              code === 'unauthorized' ? (
                <MessageScreen
                  icon={<Send size={26} strokeWidth={1.8} />}
                  title="Открой hush. в Telegram"
                  text="Приложение работает внутри Telegram — так мы узнаём, что это именно ты."
                  action="Открыть в Telegram"
                  onAction={() => window.location.assign(`https://t.me/${config.botUsername}/${config.appShortName}`)}
                />
              ) : (
                <MessageScreen
                  icon={<WifiOff size={26} strokeWidth={1.8} />}
                  title="Не удалось загрузить"
                  text="Проверь соединение и попробуй ещё раз."
                  action="Повторить"
                  onAction={retry}
                />
              )
            }
          >
            <Root />
          </AppStateProvider>
        </div>
      </ToastProvider>
    </MotionConfig>
  );
}
