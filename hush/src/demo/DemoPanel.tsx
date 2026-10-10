import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { demoControls, type DemoScenario } from '@/api/mock';
import type { PlanId } from '@/data/plans';
import { cn } from '@/lib/cn';
import { useNav } from '@/nav/Navigator';
import type { Route } from '@/nav/routes';
import { useAppState } from '@/state/AppState';
import { DEMO_FRIEND_QUESTIONNAIRE_ID } from './seed';

const SCENARIOS: Array<[DemoScenario, string]> = [
  ['new', 'Новый пользователь'],
  ['waiting-0', 'Ожидание 0/5'],
  ['waiting-3', 'Ожидание 3/5'],
  ['results-5', 'Результаты · 5'],
  ['results-18', 'Результаты · 18'],
  ['results-50', 'Результаты · 50'],
  ['results-100', 'Результаты · 100'],
];

const PLAN_OPTIONS: Array<[PlanId | null, string]> = [
  [null, 'Без подписки'],
  ['month', '1 месяц'],
  ['quarter', '3 месяца'],
  ['year', '1 год'],
];

/**
 * Панель демо-режима (только VITE_DEMO=true + mock API).
 * Явно помечает, что все данные демонстрационные.
 */
export function DemoPanel() {
  const [open, setOpen] = useState(false);
  const nav = useNav();
  const { questionnaires, entitlement, refresh } = useAppState();
  const latest = questionnaires[0];

  const go = (route: Route) => {
    nav.reset(route);
    setOpen(false);
  };

  const scenario = async (s: DemoScenario) => {
    demoControls.setScenario(s);
    await refresh();
    go(s === 'new' ? { name: 'welcome' } : { name: 'dashboard', qid: 'DEMO1' });
  };

  const screens: Array<[string, () => void, boolean?]> = [
    ['01 Приветствие', () => go({ name: 'welcome' })],
    ['02 Вопросы', () => go({ name: 'questions' })],
    ['03 Поделиться', () => latest && go({ name: 'share', qid: latest.id }), !latest],
    ['04/05 Ответы', () => latest && go({ name: 'dashboard', qid: latest.id }), !latest],
    ['06 Premium', () => go({ name: 'premium' })],
    [
      '07 Узнать автора',
      () => latest && go({ name: 'reveal', qid: latest.id, respondentId: `${latest.id}-r2` }),
      !latest || latest.respondentCount < 5,
    ],
    [
      '08 Ответить другу',
      () => {
        demoControls.resetFriendAnswer();
        go({ name: 'answer', qid: DEMO_FRIEND_QUESTIONNAIRE_ID });
      },
    ],
    ['09 Успех', () => go({ name: 'success' })],
    ['Оплата прошла', () => go({ name: 'premiumSuccess' })],
    ['10 Настройки', () => go({ name: 'settings' })],
    ['10b Подписка', () => go({ name: 'subscription' })],
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
                Все ответы, имена и подписки — демонстрационные. Оплата не подключена. В production панель и данные отключаются (VITE_DEMO=false).
              </p>

              <Section title="Сценарий">
                {SCENARIOS.map(([id, label]) => (
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
                <Chip disabled={!latest} onClick={() => demoControls.addRespondent()}>
                  + Ответ друга {latest ? `(${latest.respondentCount})` : ''}
                </Chip>
                <Chip onClick={() => demoControls.setAutoRenew(!entitlement.autoRenew)}>
                  Автопродление: {entitlement.autoRenew ? 'вкл' : 'выкл'}
                </Chip>
                <Chip
                  onClick={async () => {
                    demoControls.resetAll();
                    await refresh();
                    go({ name: 'welcome' });
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
