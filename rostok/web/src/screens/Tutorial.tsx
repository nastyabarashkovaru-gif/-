import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { SPHERES, wateringCost, type SphereId } from '@rostok/shared';
import { Island } from '../art/Island';
import { MiniGarden } from '../art/Scenes';
import { Tree } from '../art/Tree';
import { Drop, IconCheck, SphereIcon } from '../art/icons';
import { api, track } from '../api/client';
import { Button, cx } from '../ui/kit';
import { NextSilhouette, WateringScene } from '../ui/Watering';
import { haptic } from '../lib/telegram';

/**
 * Интерактивное обучение. Все капли и уровни здесь — локальные и тестовые:
 * на сервер уходит только прогресс шага и выбор сфер, реальные балансы не затрагиваются.
 */
type Step = 'intro' | 'mark' | 'earn' | 'water' | 'wither' | 'garden' | 'spheres';
const ORDER: Step[] = ['intro', 'mark', 'earn', 'water', 'wither', 'garden', 'spheres'];

export function Tutorial({ intro, initialSpheres, reduced, onDone }: { intro: string; initialSpheres: SphereId[]; reduced: boolean; onDone: () => void }) {
  const [step, setStep] = useState<Step>('intro');
  const [drops, setDrops] = useState(0);
  const [level, setLevel] = useState(1);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [watering, setWatering] = useState<{ from: number; to: number } | null>(null);
  const [fly, setFly] = useState<number | null>(null);
  const [spheres, setSpheres] = useState<SphereId[]>(initialSpheres);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    track(step === 'intro' ? 'tutorial_start' : 'tutorial_step', { step });
    api('POST', '/onboarding', { step: 'tutorial' }).catch(() => {});
  }, [step]);

  const next = () => setStep(ORDER[ORDER.indexOf(step) + 1]);
  const mark = (id: string, n: number) => {
    if (done[id]) return;
    haptic.light();
    setDone((d) => ({ ...d, [id]: true }));
    setFly(n);
    setTimeout(() => { setDrops((d) => d + n); setFly(null); }, reduced ? 50 : 650);
  };
  const cost = wateringCost(level);
  const water = () => {
    if (drops < cost || watering) return;
    setWatering({ from: level, to: level + 1 });
    track('tutorial_watering', { level });
  };
  const finishSpheres = async () => {
    setSaving(true);
    await api('POST', '/onboarding', { step: 'paywall', tutorialCompleted: true, spheres }).catch(() => {});
    onDone();
  };

  const card = (id: string, title: string, n: number) => (
    <button onClick={() => mark(id, n)} disabled={done[id]}
      className={cx('flex w-full items-center gap-3 rounded-[20px] bg-white p-4 text-left shadow-card ring-1 ring-ink-line transition-transform active:scale-[0.99]', !done[id] && 'ring-2 ring-leaf')}>
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-colors', done[id] ? 'border-leaf bg-leaf text-white' : 'border-ink-line bg-white')}>
        {done[id] && <IconCheck size={18} strokeWidth={2.6} />}
      </span>
      <span className="flex-1 text-[16px] font-medium text-ink">{title}</span>
      <span className="text-[14px] font-semibold text-drop-deep">+{n} 💧</span>
    </button>
  );

  return (
    <div className="fixed inset-0 flex flex-col overflow-y-auto bg-white pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col px-5">
        <div className="flex items-center justify-between pb-2">
          <span className="rounded-full bg-blush-soft px-3 py-1 text-[12px] font-semibold text-blush-ink">Обучение · тестовые капли</span>
          {['mark', 'earn', 'water'].includes(step) && (
            <span className="relative inline-flex items-center gap-1 rounded-full bg-drop-soft px-3 py-1 text-[15px] font-bold text-[#1F6F96]" aria-live="polite">
              <Drop size={16} /> {drops}
              <AnimatePresence>
                {fly && (
                  <motion.span className="absolute -top-6 right-1 text-[15px] font-bold text-drop-deep" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: -4 }} exit={{ opacity: 0 }}>+{fly}</motion.span>
                )}
              </AnimatePresence>
            </span>
          )}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} className="flex flex-1 flex-col" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
            {step === 'intro' && (
              <>
                <div className="relative mx-auto mt-4 aspect-[400/300] w-full max-w-[320px]">
                  <Island className="absolute inset-0 h-full w-full" />
                  <div className="absolute left-1/2 top-[56%] w-[36%] -translate-x-1/2 -translate-y-full"><Tree species="lush" level={1} size={200} className="h-auto w-full" sway /></div>
                </div>
                <h1 className="mt-4 text-[26px] font-bold leading-tight">{intro}</h1>
                <p className="mt-2 text-[16px] leading-relaxed text-ink-soft">Выполни задачу в жизни → получи капли → полей дерево своими руками → открой сюрприз. Давай попробуем на тестовом ростке.</p>
                <div className="mt-auto pt-6"><Button className="w-full" onClick={next}>Начать</Button></div>
              </>
            )}

            {step === 'mark' && (
              <>
                <h2 className="mt-3 text-[22px] font-bold">Отметь выполненное действие</h2>
                <p className="mt-1 text-[15px] text-ink-soft">Представь, что ты уже это сделала. Нажми на задачу.</p>
                <div className="mt-5">{card('t1', 'Выпить стакан воды', 1)}</div>
                <div className="mx-auto mt-6 w-[46%]"><Tree species="lush" level={level} size={200} className="h-auto w-full" sway /></div>
                <div className="mt-auto pt-6"><Button className="w-full" disabled={!done.t1} onClick={next}>Дальше</Button></div>
              </>
            )}

            {step === 'earn' && (
              <>
                <h2 className="mt-3 text-[22px] font-bold">Получи капли</h2>
                <p className="mt-1 text-[15px] text-ink-soft">Капли копятся у дерева той сферы, к которой относится задача. Сама отметка дерево не меняет — растит его только полив.</p>
                <div className="mt-5 space-y-3">{card('t2', 'Сделать 10 приседаний', 2)}</div>
                <div className="mx-auto mt-6 w-[46%]"><Tree species="lush" level={level} size={200} className="h-auto w-full" sway /></div>
                <div className="mt-auto pt-6"><Button className="w-full" disabled={!done.t2} onClick={next}>Дальше</Button></div>
              </>
            )}

            {step === 'water' && (
              <>
                <h2 className="mt-3 text-[22px] font-bold">Полей росток</h2>
                <p className="mt-1 text-[15px] text-ink-soft">Полив — единственный способ вырастить дерево. Ты сама решаешь, когда потратить капли.</p>
                <div className="mt-6">
                  <WateringScene species="lush" fromLevel={watering?.from ?? level} toLevel={watering?.to ?? level} size={210} reduced={reduced} playing={!!watering}
                    onDone={() => { setDrops((d) => d - wateringCost(watering!.from)); setLevel(watering!.to); setTimeout(() => setWatering(null), 600); }} />
                </div>
                <div className="mt-6 flex justify-center">{!watering && level < 4 && <NextSilhouette species="lush" level={level + 1} />}</div>
                <div className="mt-auto space-y-3 pt-6">
                  {level < 3 ? (
                    <Button className="w-full" disabled={drops < cost || !!watering} onClick={water}>
                      Полить · {cost} 💧
                    </Button>
                  ) : (
                    <Button className="w-full" disabled={!!watering} onClick={next}>Здорово! Дальше</Button>
                  )}
                  {level >= 3 && <p className="text-center text-[14px] text-ink-mute">Каждый уровень — новая стадия того же дерева. Следующий сюрприз пока скрыт.</p>}
                </div>
              </>
            )}

            {step === 'wither' && (
              <>
                <h2 className="mt-3 text-[22px] font-bold">Сад живёт вместе с тобой</h2>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-[22px] bg-leaf-soft/60 p-3 text-center">
                    <Tree species="lush" level={7} size={200} className="mx-auto h-auto w-full" sway />
                    <div className="mt-1 text-[14px] font-semibold text-leaf-deep">Регулярные действия</div>
                  </div>
                  <div className="rounded-[22px] bg-cream p-3 text-center">
                    <Tree species="lush" level={7} withered size={200} className="mx-auto h-auto w-full" />
                    <div className="mt-1 text-[14px] font-semibold text-ink-soft">Грустное дерево</div>
                  </div>
                </div>
                <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">
                  Регулярные действия поддерживают жизнь сада. Если долго ничего не делать или отметить вредную привычку, дерево может загрустить. Оно не погибнет, а уровень и прогресс никуда не денутся.
                </p>
                <div className="mt-auto pt-6"><Button className="w-full" onClick={next}>Дальше</Button></div>
              </>
            )}

            {step === 'garden' && (
              <>
                <h2 className="mt-3 text-[22px] font-bold">Так может вырасти твой сад</h2>
                <p className="mt-1 text-[15px] text-ink-soft">Шесть сфер — шесть деревьев. Каждое растёт от твоих действий в своей сфере.</p>
                <div className="mt-5"><MiniGarden levels={[12, 7, 18, 9, 15, 5]} /></div>
                <div className="mt-auto pt-6"><Button className="w-full" onClick={next}>Выбрать свои сферы</Button></div>
              </>
            )}

            {step === 'spheres' && (
              <>
                <h2 className="mt-3 text-[22px] font-bold">Что для тебя сейчас важно?</h2>
                <p className="mt-1 text-[15px] text-ink-soft">Подскажем идеи задач. Все шесть деревьев будут доступны в любом случае.</p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {SPHERES.map((s) => {
                    const on = spheres.includes(s.id);
                    return (
                      <button key={s.id} aria-pressed={on} onClick={() => { haptic.select(); setSpheres((x) => (on ? x.filter((y) => y !== s.id) : [...x, s.id])); }}
                        className={cx('flex flex-col items-center rounded-[20px] p-3 ring-1 transition-all', on ? 'bg-leaf-soft ring-2 ring-leaf' : 'bg-white ring-ink-line')}>
                        <div className="w-[64px]"><Tree species={s.species} level={5} size={200} className="h-auto w-full" /></div>
                        <div className="mt-1 flex items-center gap-1.5 text-[15px] font-semibold" style={{ color: s.ink }}><SphereIcon sphere={s.id} size={16} />{s.name}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-auto pt-6"><Button className="w-full" loading={saving} onClick={finishSpheres}>Продолжить</Button></div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
