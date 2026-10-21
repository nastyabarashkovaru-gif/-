import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, MessagesSquare, Video, Trophy, Send, Check, CircleCheck, TrendingUp, SlidersHorizontal, ShieldCheck, Eye } from 'lucide-react';
import { api, rub } from '../../lib/api';
import { ctx, track } from '../../lib/analytics';
import { Bar, DayGrid, Screen, useLoad, Loading, ErrorState, type DayState } from '../../ui';

/** Основная формулировка ТЗ §1 — без изменения смысла */
export const MAIN_PITCH =
  '30 дней, чтобы доказать себе, что ты можешь. Выбери цель, выполняй задания, отмечай прогресс каждый день. А мы дадим тебе бадди, окружение, еженедельные созвоны и возможность побороться за главный приз.';

const STEPS = ['/welcome', '/onboarding/home', '/onboarding/club', '/onboarding/cases', '/onboarding/value'];
const SCREEN_IDS = ['S01', 'S02', 'S03', 'S04', 'S05'];

function useStep(idx: number) {
  const nav = useNavigate();
  useEffect(() => {
    if (idx === 0 && !sessionStorage.getItem('thirty.onbStarted')) {
      sessionStorage.setItem('thirty.onbStarted', '1');
      track('onboarding_started', { screen: 'S01' });
    }
    track('onboarding_step_view', { screen: SCREEN_IDS[idx], metadata: { step: idx + 1 } });
    if (idx === 4) track('value_screen_view', { screen: 'S05' });
    void api('/api/me/screen', { body: { screen: STEPS[idx], stage: 'onboarding' } }).catch(() => undefined);
  }, [idx]);
  return {
    // A/B «onboarding_flow»: вариант short — сразу от приветствия к экрану ценности
    next: () => nav(idx === 0 && ctx.variants.onboarding_flow === 'short' ? '/onboarding/value' : idx < STEPS.length - 1 ? STEPS[idx + 1] : '/tariffs'),
    skip: () => {
      track('onboarding_skipped', { screen: SCREEN_IDS[idx], metadata: { step: idx + 1 } });
      nav('/tariffs');
    },
  };
}

function Dots({ idx }: { idx: number }) {
  return (
    <div className="dots" aria-label={`Шаг ${idx + 1} из ${STEPS.length}`}>
      {STEPS.map((s, i) => <i key={s} className={i === idx ? 'on' : ''} />)}
    </div>
  );
}

function OnbLayout({ idx, children, cta = 'Дальше' }: { idx: number; children: ReactNode; cta?: string }) {
  const { next, skip } = useStep(idx);
  return (
    <Screen id={SCREEN_IDS[idx]}>
      <div className="row between">
        <Dots idx={idx} />
        <button className="btn btn-ghost btn-sm" onClick={skip}>Пропустить</button>
      </div>
      {children}
      <div className="spacer" />
      <button className="btn btn-primary" onClick={next}>{cta}</button>
    </Screen>
  );
}

export function Welcome() {
  return (
    <OnbLayout idx={0} cta="Начать">
      <div className="col" style={{ gap: 16, marginTop: 8 }}>
        <span className="pill" style={{ alignSelf: 'flex-start' }}>Клуб дисциплины</span>
        <h1 className="hero"><em>30 дней</em>, чтобы доказать себе, что ты можешь</h1>
        <p style={{ margin: 0, fontSize: 17 }}>{MAIN_PITCH.replace('30 дней, чтобы доказать себе, что ты можешь. ', '')}</p>
      </div>
      <div className="card">
        {[
          [Send, 'Бадди на весь месяц', 'Подберём партнёра — идти вдвоём легче'],
          [MessagesSquare, 'Окружение', 'Чат твоего потока и тематические клубы'],
          [Video, 'Еженедельные созвоны', 'Групповые встречи с экспертами по направлениям'],
          [Trophy, 'Главный приз', 'Для тех, кто выполнит все обязательства'],
        ].map(([Icon, t, s]) => {
          const I = Icon as typeof Send;
          return (
            <div className="row" key={t as string}>
              <div className="tile-icon"><I size={22} /></div>
              <div className="grow"><div className="h3" style={{ fontSize: 16 }}>{t as string}</div><div className="muted small">{s as string}</div></div>
            </div>
          );
        })}
      </div>
    </OnbLayout>
  );
}

/** S02: пример главной — данные демонстрационные (как на утверждённом макете) */
export function DemoHome() {
  const days: { date: string; state: DayState }[] = Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, state: i < 12 ? 'success' : i === 12 ? 'today' : 'future' }));
  return (
    <OnbLayout idx={1}>
      <div>
        <h2 className="h2">Так выглядит твоя главная</h2>
        <p className="sub">Только твой прогресс — без лишнего шума</p>
      </div>
      <div className="card peach" style={{ padding: 12 }}>
        <div className="row between" style={{ padding: '4px 8px' }}>
          <div><div className="h2">Мои 30 дней</div><div className="muted small">1 ноября — 30 ноября</div></div>
          <div className="icon-btn"><SlidersHorizontal size={18} /></div>
        </div>
        <div className="card">
          <div className="row between">
            <div><div className="label">Твой прогресс</div><div className="big-num">12 из 30 дней</div></div>
            <div className="badge-pct">40%</div>
          </div>
          <Bar value={0.4} />
          <DayGrid days={days} />
          <div className="row green small"><TrendingUp size={18} /> 12 успешных дней в этом месяце</div>
        </div>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row between"><div className="h3">Моя цель</div><span className="pill">Привычки</span></div>
          <div className="h2" style={{ fontWeight: 600 }}>30 дней без сигарет</div>
          <div className="row muted"><CircleCheck size={20} color="var(--green)" /> Сегодня не курила</div>
          <div className="btn btn-primary" aria-hidden>Сдать отчёт за сегодня</div>
        </div>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="h3">Мой бадди</div>
          <div className="row">
            <div className="ava lg"><Users size={24} /></div>
            <div className="grow"><div className="h3">Алина</div><div className="green">Прогресс: 47%</div></div>
            <div className="icon-btn peach"><Send size={18} /></div>
          </div>
        </div>
      </div>
      <p className="muted small center">Пример оформления, данные демонстрационные</p>
    </OnbLayout>
  );
}

/** S03: окружение — три блока как на макете раздела «Клуб» */
export function ClubIntro() {
  return (
    <OnbLayout idx={2}>
      <div>
        <h2 className="h2">Ты будешь не один</h2>
        <p className="sub">В разделе «Клуб» — три блока</p>
      </div>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="tile-icon"><Users size={24} /></div>
          <div className="grow"><div className="h3">Общий чат моего потока</div><p className="muted" style={{ margin: '6px 0 0' }}>Только участники, которые стартовали в одну дату. Там знакомства, поддержка, общение и организационные объявления.</p></div>
        </div>
        <div className="divider" />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="tile-icon"><MessagesSquare size={24} /></div>
          <div className="grow col">
            <div className="h3">Тематические клубы</div>
            <div className="grid2">
              {['💰 Деньги', '🥗 Похудение', '📱 Блог', '🇬🇧 Английский', '🌱 Привычки'].map((t) => <div key={t} className="chip" style={{ cursor: 'default' }}>{t}</div>)}
            </div>
            <p className="muted small" style={{ margin: 0 }}>Объединяют участников разных потоков. Можно состоять сразу в нескольких.</p>
          </div>
        </div>
        <div className="divider" />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="tile-icon"><Video size={24} /></div>
          <div className="grow"><div className="h3">Созвоны с экспертами</div><p className="muted" style={{ margin: '6px 0 0' }}>Каждую неделю — групповой созвон по каждому направлению. Ближайшие встречи, описание темы, кнопка присоединения и отзыв после занятия.</p></div>
        </div>
      </div>
    </OnbLayout>
  );
}

/** S04: кейсы (только реальные, из админки) и правила приза */
export function Cases() {
  const { data, error, loading, reload } = useLoad(() => api<{ prizeRules: string; cases: { name: string; text: string; result: string }[] }>('/api/public/rules'));
  return (
    <OnbLayout idx={3}>
      <div>
        <h2 className="h2">Как побороться за приз</h2>
        <p className="sub">Правила одинаковые для всех тарифов</p>
      </div>
      {loading ? <Loading lines={1} /> : error ? <ErrorState error={error} retry={reload} /> : (
        <>
          {data!.cases.length > 0 && data!.cases.map((c) => (
            <div className="card" key={c.name}><div className="h3">{c.name}</div><p style={{ margin: 0 }}>{c.text}</p><span className="pill green">{c.result}</span></div>
          ))}
          <div className="card">
            <div className="row"><Trophy size={22} color="var(--orange)" /><div className="h3">Правила приза</div></div>
            <p style={{ margin: 0 }} className="small">{data!.prizeRules}</p>
          </div>
          <div className="card">
            <div className="row"><Eye size={22} color="var(--orange)" /><div className="h3">Отчёты — публичные</div></div>
            <p style={{ margin: 0 }} className="small">Все принятые отчёты видны участникам клуба в ленте. Фото «ДО» и «ПОСЛЕ» — только с твоего отдельного согласия.</p>
          </div>
          <div className="card">
            <div className="row"><ShieldCheck size={22} color="var(--green)" /><div className="h3">Честный рейтинг</div></div>
            <p style={{ margin: 0 }} className="small">Считаем процент выполненных обязательств по всем твоим целям. Больше целей не даёт преимущества.</p>
          </div>
        </>
      )}
    </OnbLayout>
  );
}

/** S05: ценность до тарифов — только позиции, включённые и подтверждённые в админке */
export function Value() {
  const { data, error, loading, reload } = useLoad(() => api<{ items: { id: string; title: string; price: number; priceLabel?: string }[]; total: number }>('/api/public/value'));
  return (
    <OnbLayout idx={4} cta="Выбрать тариф">
      <div>
        <h2 className="h2">Что входит в клуб</h2>
        <p className="sub">Если покупать то же самое по отдельности</p>
      </div>
      {loading ? <Loading lines={1} /> : error ? <ErrorState error={error} retry={reload} /> : (
        <div className="card">
          {data!.items.map((i) => (
            <div className="list-item" key={i.id}>
              <Check size={20} color="var(--green)" />
              <div className="grow">{i.title}</div>
              <div className="muted">{i.priceLabel ?? rub(i.price)}</div>
            </div>
          ))}
          <div className="row between" style={{ paddingTop: 8 }}>
            <div className="h3">Итого</div>
            <div className="h2" style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{rub(data!.total)}</div>
          </div>
          <div className="pill green" style={{ alignSelf: "flex-start" }}>Всё это — внутри клуба</div>
        </div>
      )}
    </OnbLayout>
  );
}

export function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
