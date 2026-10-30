import { useCallback, useEffect, useRef, useState } from 'react';
import { DemoPanel } from './ui/DemoPanel';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import { ctx, track } from './lib/analytics';
import { inTelegram, startParam } from './lib/telegram';
import { MeContext, type Me } from './state';
import { ErrorState, Loading, ToastHost, errorText, toast } from './ui';
import { Welcome, OnboardingStep, AboutScreen } from './screens/onboarding/Onboarding';
import { Materials } from './screens/onboarding/Materials';
import { DocScreen } from './screens/onboarding/Docs';
import { RestoreDiscount } from './screens/onboarding/Restore';
import { Tariffs } from './screens/onboarding/Tariffs';
import { Checkout, PaymentWait } from './screens/onboarding/Checkout';
import { RegProfile, RegFlow, RegTasks, RegBefore, RegBuddy, RegChats, RegWaiting } from './screens/reg/Registration';
import { AboutStep, GoalsStep, PointsStep, PlanStep, ConfirmStep, ReadyScreen } from './screens/reg/Questionnaire';
import { Notifications } from './screens/app/Notifications';
import { Home } from './screens/app/Home';
import { GoalScreen } from './screens/app/Goal';
import { ReportScreen, ReportHistory, ReportView } from './screens/app/Report';
import { Feed, ParticipantScreen } from './screens/app/Feed';
import { Club, MeetingScreen } from './screens/app/Club';
import { BuddyScreen } from './screens/app/Buddy';
import { Profile, CancelFlow, Archive, Upsells, MySubscription, MyQuestionnaire } from './screens/app/Profile';
import { CardScreen, ReviewScreen } from './screens/app/Finale';
import { ComebackScreen, FeedbackScreen, FinaleScreen, ResultCardScreen, TrackersScreen } from './screens/app/Journey';

/** Экран по параметру кнопки бота: m_<log>_<screen> */
const SCREEN_ROUTES: Record<string, string> = {
  welcome: '/welcome', resume: '/', tariffs: '/tariffs', restore: '/restore', checkout: '/tariffs', reg_profile: '/reg/about', reg_goals: '/reg/goals', reg_buddy: '/reg/buddy',
  home: '/', report: '/report', card: '/cards', review: '/review', buddy: '/buddy', meeting: '/club', final: '/finale', finale: '/finale', feedback: '/feedback', trackers: '/trackers', comeback: '/comeback', profile: '/profile', support: '/profile',
};

/** Каждый новый месяц участия — свой цвет приложения: фиолетовый, красный, оранжевый, зелёный, синий, розовый, дальше по кругу */
export const THEME_COUNT = 6;
function applyTheme(month: number) {
  document.documentElement.dataset.theme = String(((Math.max(1, month) - 1) % THEME_COUNT) + 1);
}

function initialRoute(me: Me): string {
  const sp = startParam();
  if (sp?.startsWith('pay_')) return `/checkout/wait/${sp.slice(4)}`;
  if (sp?.startsWith('bd_')) {
    sessionStorage.setItem('thirty.buddyToken', sp.slice(3));
    if (me.membership) return '/buddy';
  }
  const m = sp?.match(/^m_[0-9a-f]{32}_([a-z_]+)$/);
  const fromBot = m ? SCREEN_ROUTES[m[1]] : null;
  if (me.membership) {
    if (me.membership.status === 'reserved') return fromBot && fromBot.startsWith('/reg') ? fromBot : '/reg/about';
    if (fromBot && fromBot !== '/') return fromBot;
    return '/';
  }
  if (fromBot === '/tariffs' || fromBot === '/restore') return fromBot;
  if (me.user.onboardingStage === 'checkout' || me.user.onboardingStage === 'tariffs') return '/tariffs';
  if (me.user.onboardingStage === 'onboarding' && me.user.lastScreen?.startsWith('/onboarding')) return me.user.lastScreen;
  return '/welcome';
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [start, setStart] = useState<string | null>(null);
  const nav = useNavigate();

  const refresh = useCallback(async () => {
    const m = await api<Me>('/api/me');
    setMe(m);
    applyTheme(m.month ?? 1);
    ctx.flowId = m.membership?.flow.id;
    return m;
  }, []);

  useEffect(() => {
    // Ссылка для оплативших до запуска приложения: сначала активируем месяц участия, потом грузим профиль (сразу в анкету)
    const sp = startParam();
    const claim = sp?.startsWith('legacy_')
      ? api<{ ok: boolean; flow?: string; already?: boolean }>('/api/legacy/claim', { body: { code: sp.slice(7) } })
          .then((r) => { if (r.flow) toast(`Готово! Ты в потоке «${r.flow}» — заполни анкету 💜`); })
          .catch((e) => toast(errorText(e)))
      : Promise.resolve();
    claim.then(refresh)
      .then(async (m) => {
        track('app_open', { metadata: { startParam: startParam() ?? undefined } });
        try {
          const { variants } = await api<{ variants: Record<string, string> }>('/api/experiments');
          ctx.variants = variants;
          ctx.variant = Object.entries(variants).map(([k, v]) => `${k}:${v}`).join(',') || undefined;
        } catch {
          /* эксперименты не критичны */
        }
        setStart(initialRoute(m));
      })
      .catch(setError);
  }, [refresh]);

  // Стартовый маршрут применяется один раз: useNavigate меняется при каждой навигации
  const redirected = useRef(false);
  useEffect(() => {
    if (start && !redirected.current) {
      redirected.current = true;
      // Прямой адрес (перезагрузка, ссылка) сохраняем; стартовый маршрут — только для корня или параметра запуска
      const keep = location.pathname !== '/' && !startParam() && (me?.membership || !/^\/(reg|goal|report|feed|rating|club|buddy|profile|cards|final|archive|feedback|trackers|comeback)/.test(location.pathname));
      if (!keep) nav(start, { replace: true });
    }
  }, [start, nav]);

  if (error && (error as { status?: number }).status === 401 && !inTelegram) {
    return (
      <div className="screen" style={{ justifyContent: 'center' }}>
        <div className="state" style={{ color: 'var(--ink)' }}>
          <span className="brand"><b>30</b>дней</span>
          <p>Приложение работает внутри Telegram. Откройте его через бота.</p>
          <a className="btn btn-primary" href="https://t.me/Dney30_bot">Открыть в Telegram</a>
        </div>
      </div>
    );
  }
  if (error) return <div className="screen"><ErrorState error={error} retry={() => location.reload()} /></div>;
  if (!me || !start) return <div className="screen"><Loading /></div>;

  return (
    <MeContext.Provider value={{ me, refresh }}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/onboarding/:n" element={<OnboardingStep />} />
        <Route path="/about/:topic/:i" element={<AboutScreen />} />
        <Route path="/materials" element={<Materials />} />
        <Route path="/docs/:kind" element={<DocScreen />} />
        <Route path="/restore" element={<RestoreDiscount />} />
        <Route path="/tariffs" element={<Tariffs />} />
        <Route path="/checkout/:tariff" element={<Checkout />} />
        <Route path="/checkout/wait/:paymentId" element={<PaymentWait />} />
        <Route path="/reg/profile" element={<RegProfile />} />
        <Route path="/reg/flow" element={<RegFlow />} />
        <Route path="/reg/about" element={<AboutStep />} />
        <Route path="/reg/goals" element={<GoalsStep />} />
        <Route path="/reg/points/:i" element={<PointsStep />} />
        <Route path="/reg/plan/:i" element={<PlanStep />} />
        <Route path="/reg/confirm" element={<ConfirmStep />} />
        <Route path="/ready" element={<ReadyScreen />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/reg/tasks/:goalId" element={<RegTasks />} />
        <Route path="/reg/before" element={<RegBefore />} />
        <Route path="/reg/buddy" element={<RegBuddy />} />
        <Route path="/reg/chats" element={<RegChats />} />
        <Route path="/reg/waiting" element={<RegWaiting />} />
        <Route path="/" element={me.membership ? <Home /> : <Navigate to="/welcome" replace />} />
        <Route path="/goal/:id" element={<GoalScreen />} />
        <Route path="/report" element={<ReportScreen />} />
        <Route path="/reports" element={<ReportHistory />} />
        <Route path="/report/:id" element={<ReportView />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/u/:id" element={<ParticipantScreen />} />
        <Route path="/rating" element={<Navigate to="/feed" replace />} />
        <Route path="/club" element={<Club />} />
        <Route path="/meeting/:id" element={<MeetingScreen />} />
        <Route path="/buddy" element={<BuddyScreen />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/subscription" element={<MySubscription />} />
        <Route path="/profile/questionnaire" element={<MyQuestionnaire />} />
        <Route path="/cancel" element={<CancelFlow />} />
        <Route path="/archive" element={<Archive />} />
        <Route path="/upsells" element={<Upsells />} />
        <Route path="/cards" element={<CardScreen />} />
        <Route path="/review" element={<ReviewScreen />} />
        <Route path="/final" element={<FinaleScreen />} />
        <Route path="/finale" element={<FinaleScreen />} />
        <Route path="/finale/card" element={<ResultCardScreen />} />
        <Route path="/feedback" element={<FeedbackScreen />} />
        <Route path="/comeback" element={<ComebackScreen />} />
        <Route path="/trackers" element={<TrackersScreen />} />
        <Route path="*" element={<Navigate to={start} replace />} />
      </Routes>
      <DemoPanel />
      <ToastHost />
    </MeContext.Provider>
  );
}
