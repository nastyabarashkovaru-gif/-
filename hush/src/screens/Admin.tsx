import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { api, type AdminStats } from '@/api';
import { formatRub } from '@/lib/plural';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BackArrow, CloseButton, Screen } from '@/ui';

const PLAN_NAMES: Record<string, string> = { month: '1 месяц', quarter: '3 месяца', year: '1 год', reveal: 'Раскрытие автора (99 ₽)' };
const num = (v: number | string) => Number(v) || 0;
const rub = (v: number | string) => formatRub(Math.round(num(v)));

/** Статистика для владельца (доступ проверяет сервер по ADMIN_IDS) */
export function AdminScreen() {
  const nav = useNav();
  const { me, questionnaires } = useAppState();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    api
      .adminStats()
      .then(setStats)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const close = () =>
    nav.canGoBack ? nav.back() : nav.reset(questionnaires[0] ? { name: 'dashboard', qid: questionnaires[0].id } : { name: 'welcome' });

  return (
    <Screen className="!gap-[16px]">
      <header className="top">
        <span className="flex items-center gap-[16px]">
          {nav.canGoBack && <BackArrow onClick={close} />}
          <h1 className="text-[22px] font-bold">Статистика</h1>
        </span>
        <span className="flex items-center gap-[4px]">
          <button type="button" aria-label="Обновить" onClick={load} className="flex h-11 w-11 items-center justify-center rounded-full active:opacity-50">
            <RotateCw size={20} strokeWidth={1.8} className={loading ? 'animate-spin text-[#a1a1aa]' : 'text-[#a1a1aa]'} />
          </button>
          {!nav.canGoBack && <CloseButton onClick={close} />}
        </span>
      </header>

      {!me.isAdmin || error ? (
        <p className="muted">{me.isAdmin ? 'Не удалось загрузить. Нажми «Обновить».' : 'Раздел доступен только владельцу.'}</p>
      ) : !stats ? (
        <p className="muted">Загружаем…</p>
      ) : (
        <>
          <Section title="Оплаты, ₽" note="Без тестовых платежей, до комиссии CloudPayments и чеков">
            <PeriodRow values={stats.revenue} format={rub} big />
            <PeriodRow label="Платежей" values={stats.paymentsCount} />
          </Section>

          <Section title="По тарифам (всё время)">
            {stats.byKind.length === 0 && <p className="muted">Оплат пока нет</p>}
            {stats.byKind.map((k) => (
              <Line key={k.plan} label={PLAN_NAMES[k.plan] ?? k.plan} value={`${k.count} × · ${rub(k.sum)}`} />
            ))}
            {stats.testPayments.count > 0 && (
              <Line label="Тестовые (не деньги)" value={`${stats.testPayments.count} × · ${rub(stats.testPayments.sum)}`} muted />
            )}
          </Section>

          <Section title="Подписки сейчас">
            {stats.active.length === 0 && <p className="muted">Активных платных подписок нет</p>}
            {stats.active.map((a) => (
              <Line key={a.plan} label={PLAN_NAMES[a.plan] ?? a.plan} value={`${a.count} · с автопродлением ${a.renewing}`} />
            ))}
            <Line label="Отменяли подписку" value={String(stats.cancelled.count)} />
            <Line label="Открывали тарифы" value={String(stats.offers.paywall_opened)} />
            <Line
              label="Купили подписку"
              value={`${stats.offers.paying_users}${
                stats.offers.paywall_opened ? ` · ${Math.round((stats.offers.paying_users / stats.offers.paywall_opened) * 100)}%` : ''
              }`}
            />
          </Section>

          <Section title="Пользователи и анкеты">
            <PeriodRow label="Новые пользователи" values={stats.users} />
            <PeriodRow label="Анкеты" values={stats.questionnaires} />
            <PeriodRow label="Ответы" values={stats.responses} />
          </Section>

          <Section title="Рост по дням">
            <GrowthChart days={stats.days} />
          </Section>

          <Section title="По дням (МСК)">
            <div className="grid grid-cols-[52px_1fr_1fr_1fr_1.4fr] gap-y-[8px] text-[14px] tabular-nums">
              {['', 'Новые', 'Ответы', 'Оплаты', '₽'].map((h) => (
                <span key={h} className="text-[12px] text-[#77737f]">
                  {h}
                </span>
              ))}
              {stats.days.slice(0, 14).map((d) => (
                <DayRow key={d.day} d={d} />
              ))}
            </div>
          </Section>

          {stats.stories.length > 0 && (
            <Section title="Сторис">
              {stats.stories.map((s) => (
                <Line key={`${s.name}-${s.source}`} label={`${s.name === 'story_shared' ? 'Поделились' : 'Открыли окно'} · ${s.source ?? '—'}`} value={String(s.count)} />
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card flex flex-col gap-[10px]">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      {children}
      {note && <p className="text-[12px] leading-[1.35] text-[#77737f]">{note}</p>}
    </section>
  );
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-[12px] text-[15px] ${muted ? 'text-[#77737f]' : ''}`}>
      <span className={muted ? '' : 'text-[#c9c6d1]'}>{label}</span>
      <span className="shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

function PeriodRow({
  label,
  values,
  format = (v) => String(num(v)),
  big,
}: {
  label?: string;
  values: AdminStats['revenue'];
  format?: (v: number | string) => string;
  big?: boolean;
}) {
  const cells: Array<[string, number | string]> = [
    ['Сегодня', values.today],
    ['7 дней', values.d7],
    ['30 дней', values.d30],
    ['Всего', values.total],
  ];
  return (
    <div className="flex flex-col gap-[6px]">
      {label && <span className="text-[14px] text-[#9a97a3]">{label}</span>}
      <div className="grid grid-cols-4 gap-[6px]">
        {cells.map(([name, v]) => (
          <div key={name} className="flex flex-col gap-[2px] rounded-[12px] bg-[#1f1d26] px-[8px] py-[8px]">
            <span className="text-[11px] text-[#77737f]">{name}</span>
            <span className={`${big ? 'text-[15px] font-semibold' : 'text-[15px]'} tabular-nums`}>{format(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayRow({ d }: { d: AdminStats['days'][number] }) {
  return (
    <>
      <span className="text-[#9a97a3]">{d.day}</span>
      <span>{d.users}</span>
      <span>{d.responses}</span>
      <span>{d.payments}</span>
      <span>{num(d.revenue) ? rub(d.revenue) : '—'}</span>
    </>
  );
}

const SERIES = [
  { key: 'users', label: 'Новые пользователи', color: '#A855F7' },
  { key: 'questionnaires', label: 'Новые анкеты', color: '#22A3C9' },
] as const;
const DAY_W = 44;
const CHART_H = 170;
const PAD_T = 12;
const PAD_B = 28;

/** Линейный график по дням: листается вправо-влево, сразу показывает последние дни; тап по дню — значения */
function GrowthChart({ days }: { days: AdminStats['days'] }) {
  const points = [...days].reverse(); // старые слева
  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(points.length - 1);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [points.length]);

  const rawMax = Math.max(1, ...points.flatMap((p) => [p.users, p.questionnaires]));
  const step = niceStep(rawMax);
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const plotH = CHART_H - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const x = (i: number) => i * DAY_W + DAY_W / 2;
  const width = points.length * DAY_W;
  const sel = points[selected];

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-wrap gap-x-[16px] gap-y-[6px] text-[13px] text-[#c9c6d1]">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-[6px]">
            <span className="h-[3px] w-[14px] rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>

      {sel && (
        <div className="flex items-center justify-between rounded-[12px] bg-[#1f1d26] px-[12px] py-[8px] text-[14px] tabular-nums" aria-live="polite">
          <span className="text-[#9a97a3]">{formatDate(sel.date)}</span>
          <span className="flex gap-[14px]">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-[6px]">
                <span className="h-[8px] w-[8px] rounded-full" style={{ background: s.color }} aria-hidden />
                {sel[s.key]}
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="relative flex">
        {/* Ось Y остаётся на месте при прокрутке */}
        <div className="relative w-[28px] shrink-0" style={{ height: CHART_H }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-[6px] -translate-y-1/2 text-[11px] tabular-nums text-[#77737f]" style={{ top: y(t) }}>
              {t}
            </span>
          ))}
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <svg width={width} height={CHART_H} role="img" aria-label="Новые пользователи и анкеты по дням" className="block">
            {ticks.map((t) => (
              <line key={t} x1={0} x2={width} y1={y(t)} y2={y(t)} stroke="#2a2930" strokeWidth={1} />
            ))}
            {selected >= 0 && <line x1={x(selected)} x2={x(selected)} y1={PAD_T} y2={PAD_T + plotH} stroke="#4a4752" strokeWidth={1} />}
            {SERIES.map((s) => (
              <polyline
                key={s.key}
                points={points.map((p, i) => `${x(i)},${y(p[s.key])}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {sel &&
              SERIES.map((s) => (
                <circle key={s.key} cx={x(selected)} cy={y(sel[s.key])} r={4.5} fill={s.color} stroke="#141318" strokeWidth={2} />
              ))}
            {points.map((p, i) => (
              <g key={p.date}>
                <text x={x(i)} y={CHART_H - 8} textAnchor="middle" fontSize={11} fill={i === selected ? '#ffffff' : '#77737f'}>
                  {p.day.slice(0, 5)}
                </text>
                {/* Зона нажатия — весь столбец дня */}
                <rect x={i * DAY_W} y={0} width={DAY_W} height={CHART_H} fill="transparent" onClick={() => setSelected(i)} onPointerEnter={(e) => e.pointerType === 'mouse' && setSelected(i)}>
                  <title>{`${formatDate(p.date)}: пользователи ${p.users}, анкеты ${p.questionnaires}`}</title>
                </rect>
              </g>
            ))}
          </svg>
        </div>
      </div>
      <p className="text-[12px] text-[#77737f]">Листай график влево к прошлым дням, нажми на день — увидишь цифры. Время московское.</p>
    </div>
  );
}

function niceStep(max: number) {
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough || 1));
  return ([1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10) || 1;
}

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
