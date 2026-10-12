import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, login, setDemoAllowed, track } from './api/client';
import type { Me, PublicConfig } from './api/types';
import { AppProvider, useApp } from './state/app';
import { initTelegram, startParam } from './lib/telegram';
import { Splash } from './screens/Splash';
import { Onboarding } from './screens/Onboarding';
import { Tutorial } from './screens/Tutorial';
import { Paywall } from './screens/Paywall';
import { FirstTask } from './screens/FirstTask';
import { GardenScreen } from './screens/Garden';
import { TasksScreen } from './screens/Tasks';
import { ProfileScreen } from './screens/Profile';
import { JoinChallenge } from './screens/Challenges';
import { BottomNav, type Tab } from './ui/BottomNav';
import { ToastProvider } from './ui/kit';

const FALLBACK: PublicConfig = {
  brand: { appName: 'ROSTOK', slogan: 'Выполняй задания в реальной жизни и выращивай свой сад' },
  onboarding: { slides: [], tutorialIntro: 'Всё начинается с маленького ростка' },
  paywall: { title: '', subtitle: '', bullets: [] }, flags: {}, assets: {}, demoLogin: false, env: '', botUsername: null, supportUsername: null,
};

/** Splash держится до готовности приложения, целевая длительность ~1.5 с, без искусственной задержки сверх неё. */
export function App() {
  const [boot, setBoot] = useState<{ config: PublicConfig; me: Me } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfig>(FALLBACK);
  const [splashDone, setSplashDone] = useState(false);
  const started = useRef(Date.now());

  const run = useCallback(async () => {
    setError(null);
    try {
      initTelegram();
      const cfg = await api<PublicConfig>('GET', '/config/public');
      setConfig(cfg);
      setDemoAllowed(cfg.demoLogin);
      await login(cfg.demoLogin);
      const me = await api<Me>('GET', '/me');
      await api('POST', '/me/open').catch(() => {});
      track('app_open', { access: me.access });
      setBoot({ config: cfg, me });
      const wait = Math.max(0, 1200 - (Date.now() - started.current));
      setTimeout(() => setSplashDone(true), wait);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'open_in_telegram' ? 'Открой приложение в Telegram, чтобы войти' : 'Не получилось загрузить сад. Проверь интернет.');
    }
  }, []);
  useEffect(() => { run(); }, [run]);

  if (!boot || !splashDone) return <Splash appName={config.brand.appName} slogan={config.brand.slogan} error={error} onRetry={run} />;
  return (
    <ToastProvider>
      <AppProvider config={boot.config} initialMe={boot.me}>
        <Flow />
      </AppProvider>
    </ToastProvider>
  );
}

type Stage = 'slides' | 'tutorial' | 'paywall' | 'first_task' | 'main';

function initialStage(me: Me): Stage {
  if (me.access) return me.onboarding.step === 'done' ? 'main' : 'first_task';
  if (!me.onboarding.tutorialCompleted) return me.onboarding.step === 'tutorial' ? 'tutorial' : 'slides';
  return 'paywall';
}

function Flow() {
  const { me, config, refreshMe, refreshAll, reducedMotion } = useApp();
  const [stage, setStage] = useState<Stage>(() => initialStage(me));
  const [tab, setTab] = useState<Tab>(() => (startParam()?.startsWith('go_tasks') ? 'tasks' : 'garden'));
  const [invite, setInvite] = useState<string | null>(() => {
    const p = startParam();
    return p?.startsWith('ch_') ? p.slice(3) : null;
  });

  // Доступ мог закончиться — вернём на paywall; сад сохранён на сервере
  useEffect(() => {
    if (stage === 'main' && !me.access) setStage('paywall');
  }, [me.access, stage]);

  const onPaid = async () => {
    const m = await refreshMe();
    await refreshAll().catch(() => {});
    setStage(m.onboarding.step === 'done' ? 'main' : 'first_task');
  };

  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: reducedMotion ? 0 : 0.25 } };
  return (
    <AnimatePresence mode="wait">
      {stage === 'slides' && (
        <motion.div key="slides" {...fade}><Onboarding config={config} startAt={Math.max(0, me.onboarding.slidesSeen - 1)} onDone={() => setStage('tutorial')} /></motion.div>
      )}
      {stage === 'tutorial' && (
        <motion.div key="tutorial" {...fade}><Tutorial intro={config.onboarding.tutorialIntro} initialSpheres={me.settings.selectedSpheres} reduced={reducedMotion} onDone={async () => { await refreshMe(); setStage('paywall'); }} /></motion.div>
      )}
      {stage === 'paywall' && (
        <motion.div key="paywall" {...fade}><Paywall config={config} returning={me.subscription.status !== 'none' && me.subscription.status !== 'pending' && !!me.subscription.plan} onPaid={onPaid} /></motion.div>
      )}
      {stage === 'first_task' && (
        <motion.div key="first" {...fade}><FirstTask onDone={async () => { await refreshMe(); setStage('main'); }} /></motion.div>
      )}
      {stage === 'main' && (
        <motion.div key="main" {...fade} className="min-h-full bg-white">
          {config.env !== 'production' && me.user.isDemo && (
            <div className="pointer-events-none fixed left-3 z-30 rounded-full bg-blush-soft/95 px-2.5 py-0.5 text-[11px] font-semibold text-blush-ink" style={{ bottom: 'calc(var(--nav-h) + var(--safe-bottom) + 8px)' }}>Демо · песочница</div>
          )}
          <main>
            {tab === 'garden' && <GardenScreen goTasks={() => setTab('tasks')} />}
            {tab === 'tasks' && <TasksScreen />}
            {tab === 'profile' && <ProfileScreen />}
          </main>
          <BottomNav tab={tab} onChange={(t) => { setTab(t); window.scrollTo({ top: 0 }); }} />
          {invite && <JoinChallenge token={invite} onDone={() => { setInvite(null); history.replaceState(null, '', location.pathname); }} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
