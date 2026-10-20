import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { demoControls } from '@/api/mock';
import { DEMO_FRIEND_SLUG, QA_SCENARIOS, qaDemoControls, type QaDemoScenario } from '@/api/mockQa';
import type { PlanId } from '@/data/plans';
import { cn } from '@/lib/cn';
import { useNav } from '@/nav/Navigator';
import type { Route } from '@/nav/routes';
import { useAppState } from '@/state/AppState';

const PLAN_OPTIONS: Array<[PlanId | null, string]> = [
  [null, 'Без подписки'],
  ['week', '1 неделя'],
  ['month', '1 месяц'],
  ['year', '1 год'],
];

/** Демо открыто из настоящего приложения (сборка с base /demo/) — можно вернуться обратно */
const INSIDE_APP = import.meta.env.BASE_URL === '/demo/';

/**
 * Панель демо-режима HUSH 2.0 (только mock API): сценарии, подписка, события и переход на любой экран.
 * Все данные демонстрационные, оплата не подключена.
 */
export function DemoPanel() {
  const [open, setOpen] = useState(false);
  const nav = useNav();
  const { entitlement, refresh } = useAppState();

  const go = (route: Route) => {
    nav.reset(route);
    setOpen(false);
  };
  /** Экран внутри вкладки — с вкладкой под ним, чтобы «назад» работал */
  const goStack = (stack: Route[]) => {
    nav.setStack(stack);
    setOpen(false);
  };

  const scenario = async (s: QaDemoScenario) => {
    qaDemoControls.setScenario(s);
    await refresh();
    go(s === 'new' ? { name: 'start' } : { name: 'inbox' });
  };

  const inboxId = qaDemoControls.firstInboxId();
  const askId = qaDemoControls.firstAskId();
  const slug = qaDemoControls.slug;

  const screens: Array<[string, () => void, boolean?]> = [
    ['Старт', () => go({ name: 'start' })],
    ['Твоя ссылка готова', () => goStack([{ name: 'inbox' }, { name: 'myLink' }])],
    ['Мне задали', () => go({ name: 'inbox' })],
    ['Ответить лично', () => inboxId && goStack([{ name: 'inbox' }, { name: 'answerInbox', id: inboxId }]), !inboxId],
    ['Я спросил(а)', () => go({ name: 'asks' })],
    ['Новый вопрос подписчикам', () => goStack([{ name: 'asks' }, { name: 'createAsk' }])],
    ['Мой вопрос и ответы', () => askId && goStack([{ name: 'asks' }, { name: 'askDetail', id: askId }]), !askId],
    ['Гость: задать вопрос', () => go({ name: 'askMe', slug: DEMO_FRIEND_SLUG })],
    ['Своя ссылка глазами гостя', () => slug && go({ name: 'askMe', slug }), !slug],
    ['Гость: вопрос отправлен', () => go({ name: 'sent', kind: 'question', slug: DEMO_FRIEND_SLUG })],
    ['Подписчик: ответить на вопрос', () => go({ name: 'askReply', id: 'DEMOASK' })],
    ['Подписчик: ответ отправлен', () => go({ name: 'sent', kind: 'answer' })],
    ['Профиль', () => go({ name: 'profile' })],
    ['Тарифы', () => go({ name: 'premium' })],
    ['Оплата прошла', () => go({ name: 'premiumSuccess' })],
    ['Ждём подтверждение', () => go({ name: 'premiumSuccess', pending: true })],
    ['Настройки', () => go({ name: 'settings' })],
    ['Подписка', () => go({ name: 'subscription' })],
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Демо-панель"
        className="fixed left-0 top-[46%] z-30 rounded-r-[8px] border border-l-0 border-[#3a3442] bg-[#17101f]/90 px-[3px] py-[8px] text-[9px] font-bold tracking-[1.5px] text-[#b987ff] [writing-mode:vertical-rl] min-[470px]:left-[calc(50%-215px)]"
      >
        DEMO
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div
              role="dialog"
              aria-label="Демо-режим"
              className="absolute inset-x-0 bottom-0 mx-auto max-h-[85dvh] max-w-app overflow-y-auto rounded-t-[20px] border border-b-0 border-line bg-[#121216] px-[20px] pt-[18px]"
              style={{ paddingBottom: 'calc(24px + var(--safe-bottom))' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-[6px] flex items-center justify-between">
                <b className="text-[17px]">Демо-режим</b>
                <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="-mr-2 p-2">
                  <X size={18} color="#aaa" />
                </button>
              </div>
              <p className="small mb-[16px]">
                Все вопросы, ответы, имена и подписки — демонстрационные, ничего не уходит на сервер. Оплата не подключена.
              </p>

              <Section title="Сценарий">
                {QA_SCENARIOS.map(([id, label]) => (
                  <Chip key={id} onClick={() => scenario(id)}>
                    {label}
                  </Chip>
                ))}
              </Section>

              <Section title="Подписка (демо)">
                {PLAN_OPTIONS.map(([id, label]) => (
                  <Chip key={label} active={entitlement.plan === id} onClick={() => demoControls.setPlan(id)}>
                    {label}
                  </Chip>
                ))}
              </Section>

              <Section title="События">
                <Chip
                  onClick={async () => {
                    qaDemoControls.addQuestion();
                    await refresh();
                    go({ name: 'inbox' });
                  }}
                >
                  + Вопрос мне
                </Chip>
                <Chip
                  onClick={async () => {
                    const id = qaDemoControls.addAskAnswer();
                    await refresh();
                    goStack([{ name: 'asks' }, { name: 'askDetail', id }]);
                  }}
                >
                  + Ответ на мой вопрос
                </Chip>
                <Chip onClick={() => demoControls.setAutoRenew(!entitlement.autoRenew)}>
                  Автопродление: {entitlement.autoRenew ? 'вкл' : 'выкл'}
                </Chip>
                <Chip
                  onClick={async () => {
                    qaDemoControls.reset();
                    demoControls.resetAll();
                    await refresh();
                    go({ name: 'start' });
                  }}
                >
                  Сбросить всё
                </Chip>
              </Section>

              <Section title="Экраны">
                {screens.map(([label, action, disabled]) => (
                  <Chip key={label} disabled={disabled} onClick={action}>
                    {label}
                  </Chip>
                ))}
              </Section>

              {INSIDE_APP && (
                <button
                  type="button"
                  onClick={() => window.location.replace('/')}
                  className="mt-[4px] w-full rounded-[12px] border border-line bg-[#101013] py-[12px] text-[15px] font-medium text-white active:scale-[0.98]"
                >
                  Выйти из демо в настоящее приложение
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-[16px]">
      <div className="step mb-[8px]">{title}</div>
      <div className="flex flex-wrap gap-[6px]">{children}</div>
    </section>
  );
}

function Chip({ children, onClick, active, disabled }: { children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-[9px] border px-[10px] py-[8px] text-[12px] font-semibold transition-colors active:scale-95 disabled:opacity-30',
        active ? 'border-[#66438d] bg-[#271734] text-[#d6b3ff]' : 'border-line bg-[#101013] text-white',
      )}
    >
      {children}
    </button>
  );
}
