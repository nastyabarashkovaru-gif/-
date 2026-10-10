import { AnimatePresence, motion } from 'framer-motion';
import { Check, RotateCcw, Wrench, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { SCENARIOS } from '@/data/scenarios';
import { cn } from '@/lib/cn';
import { useAppState } from '@/state/AppState';

const SCREENS = [
  { route: '/', label: 'Приветствие' },
  { route: '/questions', label: 'Выбор вопросов' },
  { route: '/home', label: 'Главный экран' },
  { route: '/paywall', label: 'Подписка' },
];

/**
 * Служебное меню прототипа: переключение сценариев и экранов.
 * Намеренно выглядит как инструмент разработчика, а не часть продукта.
 * Открывается кнопкой у левого края или клавишей «`».
 */
export function DevMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data, applyScenario } = useAppState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === '`' && !typing) setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Меню разработчика"
        className="fixed left-0 top-1/2 z-40 flex h-11 w-5 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-dashed border-[#3A3C48] bg-[#0F1015]/90 text-[#5A5C68] opacity-60 hover:opacity-100"
      >
        <Wrench size={11} />
      </button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[70] flex">
            <motion.div
              className="absolute inset-0 bg-black/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.2 }}
              className="relative flex h-full w-[300px] max-w-[85vw] flex-col overflow-y-auto border-r border-dashed border-[#3A3C48] bg-[#0F1015] pb-safe pt-safe font-mono text-[12px] text-[#C4C4CC]"
            >
              <div className="flex items-center justify-between border-b border-dashed border-[#2B2D36] px-4 py-3">
                <span className="uppercase tracking-[0.14em] text-[#8B8B95]">dev · прототип</span>
                <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="flex h-touch w-touch items-center justify-center -mr-3">
                  <X size={16} />
                </button>
              </div>

              <Section title="Сценарии">
                {SCENARIOS.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      applyScenario(s.id);
                      navigate(s.route, { replace: true });
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 rounded px-2 py-2 text-left hover:bg-[#1A1B22]',
                      data.scenarioId === s.id && 'bg-[#1A1B22] text-[#E4E4E7]',
                    )}
                  >
                    <span className="w-5 shrink-0 text-[#5A5C68]">{String(i + 1).padStart(2, '0')}</span>
                    <span className="flex-1">
                      <span className="block">{s.title}</span>
                      <span className="block text-[11px] text-[#6B6B75]">{s.hint}</span>
                    </span>
                    {data.scenarioId === s.id && <Check size={14} className="mt-0.5 text-accentSoft" />}
                  </button>
                ))}
              </Section>

              <Section title="Экраны">
                {SCREENS.map((s) => (
                  <button
                    key={s.route}
                    type="button"
                    onClick={() => {
                      navigate(s.route);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded px-2 py-2 text-left hover:bg-[#1A1B22]"
                  >
                    {s.label}
                    <span className="text-[#5A5C68]">{s.route}</span>
                  </button>
                ))}
              </Section>

              <Section title="Сброс">
                <button
                  type="button"
                  onClick={() => {
                    applyScenario('new');
                    navigate('/', { replace: true });
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#1A1B22]"
                >
                  <RotateCcw size={13} /> Начать заново
                </button>
              </Section>

              <p className="mt-auto px-4 py-4 text-[11px] leading-4 text-[#5A5C68]">
                Данные демонстрационные. Оплата имитируется — списаний нет. Клавиша «`» открывает это меню.
              </p>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-dashed border-[#2B2D36] px-2 py-3">
      <p className="px-2 pb-2 text-[10px] uppercase tracking-[0.14em] text-[#6B6B75]">{title}</p>
      {children}
    </div>
  );
}

