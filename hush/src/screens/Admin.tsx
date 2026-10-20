import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, RotateCw } from 'lucide-react';
import { api, type AdminBlogger, type AdminBloggers, type AdminStats } from '@/api';
import { formatRub } from '@/lib/plural';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BackArrow, CloseButton, Screen, useToast } from '@/ui';
import { copyText } from '@/lib/share';

const PLAN_NAMES: Record<string, string> = { week: '1 неделя', month: '1 месяц', quarter: '3 месяца', year: '1 год', reveal: 'Раскрытие автора (99 ₽)' };
const num = (v: number | string) => Number(v) || 0;
const rub = (v: number | string) => formatRub(Math.round(num(v)));

/** Статистика для владельца (доступ проверяет сервер по ADMIN_IDS) */
export function AdminScreen() {
  const nav = useNav();
  const { me } = useAppState();
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
    nav.canGoBack ? nav.back() : nav.reset({ name: 'inbox' });

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
          {stats.since && stats.since > '1971' && (
            <p className="small -mt-[6px]">Статистика считается с {new Date(stats.since).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}</p>
          )}
          <BloggersSection />
          {stats.qa && <QaSections qa={stats.qa} />}

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
  { key: 'questions', label: 'Вопросы от подписчиков', color: '#22A3C9' },
] as const;
const DAY_W = 44;
const CHART_H = 170;
const PAD_T = 12;
const PAD_B = 28;

/** Линейный график по дням: листается вправо-влево, сразу показывает последние дни; тап по дню — значения */
function GrowthChart({ days }: { days: AdminStats['days'] }) {
  const points = [...days].reverse().map((d) => ({ ...d, questions: d.questions ?? 0 })); // старые слева
  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(points.length - 1);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [points.length]);

  const rawMax = Math.max(1, ...points.flatMap((p) => [p.users, p.questions]));
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
          <svg width={width} height={CHART_H} role="img" aria-label="Новые пользователи и вопросы по дням" className="block">
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
                  <title>{`${formatDate(p.date)}: пользователи ${p.users}, вопросы ${p.questions}`}</title>
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

const EVENT_NAMES: Record<string, string> = {
  app_open: 'Открыли приложение',
  start_choice: 'Выбрали сценарий',
  link_created: 'Создали личную ссылку',
  share_clicked: 'Нажали «Поделиться»',
  link_copied: 'Скопировали ссылку',
  link_opened: 'Открыли чужую ссылку',
  question_typing_started: 'Начали писать',
  question_sent: 'Отправили вопрос',
  ask_created: 'Создали свой вопрос',
  ask_answer_sent: 'Ответили на чужой вопрос',
  inbox_answered: 'Ответили на входящий',
  guest_create_link: 'Гость → создать ссылку',
  paywall_opened: 'Открыли тарифы',
  story_shared: 'Сторис: поделились / сохранили',
};

function QaSections({ qa }: { qa: NonNullable<AdminStats['qa']> }) {
  // Воронка: события по названию (сумма по источникам), уникальные пользователи
  const byName = new Map<string, { count: number; users: number; sources: string[] }>();
  for (const e of qa.funnel) {
    const cur = byName.get(e.name) ?? { count: 0, users: 0, sources: [] };
    cur.count += e.count;
    cur.users = Math.max(cur.users, e.users);
    if (e.source) cur.sources.push(`${e.source}: ${e.count}`);
    byName.set(e.name, cur);
  }
  const conv = qa.guestConversion;
  return (
    <>
      <Section title="Вопросы и ответы" note="Без вопросов самому себе и вопросов дня от hush.">
        <PeriodRow label="Создали личную ссылку" values={qa.links} />
        <PeriodRow label="Вопросы от подписчиков" values={qa.questions} />
        <PeriodRow label="Ответы на входящие" values={qa.inboxAnswers} />
        <PeriodRow label="Свои вопросы аудитории" values={qa.asks} />
        <PeriodRow label="Ответы подписчиков на них" values={qa.askAnswers} />
      </Section>

      <Section title="Вирусность">
        <Line label="Пришли по чужой ссылке" value={String(conv.guests)} />
        <Line
          label="Из них создали свою ссылку"
          value={`${conv.guests_with_link}${conv.guests ? ` · ${Math.round((conv.guests_with_link / conv.guests) * 100)}%` : ''}`}
        />
      </Section>

      <Section title="Кто приводит людей" note="По чьей ссылке пришли новые пользователи (блогеры и все остальные)">
        {qa.referrers.length === 0 && <p className="muted">Пока никого</p>}
        {qa.referrers.map((r) => (
          <Line key={r.id} label={r.username ? `@${r.username}` : r.first_name} value={`${r.invited} чел. · ${r.made_link} со своей ссылкой`} />
        ))}
      </Section>

      <Section title="Откуда пришли">
        {qa.sources.map((s) => (
          <Line key={s.source} label={s.source} value={String(s.users)} />
        ))}
      </Section>

      <Section title="Воронка за 30 дней" note="Событий · уникальных пользователей">
        {Object.keys(EVENT_NAMES)
          .filter((n) => byName.has(n))
          .map((n) => {
            const v = byName.get(n)!;
            return <Line key={n} label={EVENT_NAMES[n]} value={`${v.count} · ${v.users}`} />;
          })}
        {byName.size === 0 && <p className="muted">Событий пока нет</p>}
      </Section>
    </>
  );
}

/* ───────── Блогеры: ссылка, воронка, выручка по блогерам и рассыльщикам, вопросы блогера ───────── */

function BloggersSection() {
  const toast = useToast();
  const [data, setData] = useState<AdminBloggers | null>(null);
  const load = () => {
    api.adminBloggers().then(setData).catch(() => toast.show('Не удалось загрузить блогеров'));
  };
  useEffect(load, []);
  if (!data) return null;
  const f = data.funnel;
  const t = data.totals;
  return (
    <>
      <Section title="Блогеры" note={`Общая ссылка; для рассыльщика — …?startapp=bl_<имя>. За скриншот сторис — Premium на ${Math.round(data.premiumDays / 30)} мес. сразу`}>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(data.link)) toast.show('Ссылка для блогеров скопирована');
          }}
          className="flex items-center gap-[8px] rounded-[12px] border border-[#3a2d4d] bg-[#141018] px-[12px] py-[10px] text-left active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1 break-all text-[14px] text-purple-text">{data.link.replace(/^https?:\/\//, '')}</span>
          <Copy size={16} strokeWidth={1.8} className="shrink-0 text-[#a1a1aa]" aria-hidden />
        </button>
        <Line label="Открыли ссылку" value={String(f.opened)} />
        <Line label="Создали свою ссылку" value={String(f.made_link)} />
        <Line label="Нажали «в сторис»" value={String(f.story_clicked)} />
        <Line label="Прислали скриншот сторис" value={String(f.proof_sent)} />
        <Line label="Выдан Premium" value={String(f.premium_given)} />
      </Section>

      <Section title="Что принесли блогеры" note="По людям, пришедшим по ссылкам блогеров; выручка — без тестовых платежей">
        <Line label="Заработали с блогеров" value={rub(t.revenue)} />
        <Line label="Пришло людей" value={String(t.guests)} />
        <Line label="Из них создали свою ссылку" value={String(t.guestsLinks)} />
        <Line label="Заплатили" value={String(t.payers)} />
        <Line label="Вопросов блогерам" value={String(t.questions)} />
      </Section>

      {data.managers.length > 0 && (
        <Section title="Рассыльщики" note="Метка из ссылки bl_<имя>; «—» — общая ссылка">
          {data.managers.map((m) => (
            <Line key={m.manager} label={`${m.manager} · блогеров ${m.bloggers} · со сторис ${m.withStory} · людей ${m.guests}`} value={rub(m.revenue)} />
          ))}
        </Section>
      )}

      <Section title="Все блогеры" note="Сверху — кто принёс больше денег. Нажми, чтобы открыть подробности">
        {data.bloggers.map((b) => (
          <BloggerRow key={b.id} b={b} onChange={load} />
        ))}
        {!data.bloggers.length && <p className="small">Пока никто не открыл ссылку для блогеров.</p>}
      </Section>
    </>
  );
}

function BloggerRow({ b, onChange }: { b: AdminBlogger; onChange: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Array<{ text: string; createdAt: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const name = b.username ? `@${b.username}` : b.firstName;

  const toggle = () => {
    setOpen(!open);
    if (!open && !questions) api.adminBloggerQuestions(b.id).then((r) => setQuestions(r.items)).catch(() => setQuestions([]));
  };

  return (
    <div className="flex flex-col gap-[8px] rounded-[14px] border border-[#2a2930] bg-[#101013] p-[12px]">
      <button type="button" onClick={toggle} className="flex flex-col gap-[6px] text-left">
        <span className="flex w-full items-center justify-between gap-[8px]">
          <span className="truncate text-[15px] font-semibold">{name}</span>
          <span className="shrink-0 text-[15px] font-semibold text-green">{rub(b.revenue)}</span>
        </span>
        <span className="text-[13px] leading-[1.4] text-[#9a97a3]">
          {b.manager ? `${b.manager} · ` : ''}пришло {b.guests} · создали ссылку {b.guestsLinks} · заплатили {b.payers} · вопросов {b.questions}
        </span>
        <span className={`text-[12px] ${b.premiumAt ? 'text-green' : 'text-[#8e8b97]'}`}>
          {b.premiumAt ? 'Сторис прислал · Premium выдан' : b.storyClicked ? 'Нажал «в сторис», скриншота нет' : 'Без сторис'}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-[10px] border-t border-[#2a2930] pt-[10px]">
          <p className="text-[13px] leading-[1.5] text-[#c9c6d1]">
            Открыл: {new Date(b.openedAt).toLocaleDateString('ru-RU')}
            <br />
            Своя ссылка: {b.hasLink ? 'есть' : 'нет'} · своих вопросов у пришедших: {b.guestsAsks} · анкет (старых): {b.guestsQuestionnaires}
          </p>
          {b.username && (
            <a href={`https://t.me/${b.username}`} target="_blank" rel="noreferrer" className="self-start text-[14px] font-medium text-purple-text underline underline-offset-[2px]">
              Написать {name}
            </a>
          )}
          {b.proofId && !image && (
            <button
              type="button"
              onClick={() => api.adminBloggerProof(b.proofId!).then((r) => setImage(r.image)).catch(() => toast.show('Не удалось открыть скриншот'))}
              className="self-start text-[14px] font-medium text-purple-text underline underline-offset-[2px]"
            >
              Показать скриншот сторис
            </button>
          )}
          {image && <img src={image} alt={`Скриншот сторис ${name}`} className="max-h-[420px] w-auto self-start rounded-[10px] border border-[#2a2930]" />}
          <div className="flex flex-col gap-[6px]">
            <span className="step">Вопросы блогеру</span>
            {!questions ? (
              <p className="small">Загружаем…</p>
            ) : questions.length ? (
              questions.map((q, i) => (
                <p key={i} className="rounded-[10px] bg-[#141318] px-[10px] py-[8px] text-[14px] leading-[1.4]">
                  {q.text}
                  <span className="ml-[6px] text-[12px] text-[#6f6b78]">{new Date(q.createdAt).toLocaleDateString('ru-RU')}</span>
                </p>
              ))
            ) : (
              <p className="small">Пока вопросов нет</p>
            )}
          </div>
          {!b.premiumAt && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.adminApproveBlogger(b.id);
                  toast.show(`Premium выдан ${name}`);
                  onChange();
                } catch {
                  toast.show('Не получилось. Попробуй ещё раз');
                } finally {
                  setBusy(false);
                }
              }}
              className="self-start text-[13px] text-[#8e8b97] underline underline-offset-[2px]"
            >
              Выдать Premium вручную (если скриншот прислали в личку)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
