import { Link } from 'react-router-dom';
import {
  BadgePercent, BarChart3, Bot, CalendarRange, ChevronRight, ClipboardList, CreditCard, Download, FlaskConical, Gift, Layers, LogOut, MessageCircle,
  MessagesSquare, Settings, ShoppingBag, Star, Target, Video, type LucideIcon,
} from 'lucide-react';
import { api } from '../api';
import { num, pctf } from '../charts';
import { View, useLoad } from '../ui';

export interface HubItem { to: string; title: string; text: string; icon: LucideIcon; perm: string; external?: boolean }

function Hub({ title, items, can }: { title: string; items: HubItem[]; can: (p: string) => boolean }) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <div className="list">
        {items.filter((i) => can(i.perm)).map((i) => {
          const inner = (
            <>
              <div className="hub-ico"><i.icon size={20} /></div>
              <div className="grow"><b>{i.title}</b><span>{i.text}</span></div>
              <ChevronRight size={18} className="muted" />
            </>
          );
          return i.external ? <a key={i.to} className="hub-row" href={i.to}>{inner}</a> : <Link key={i.to} className="hub-row" to={i.to}>{inner}</Link>;
        })}
      </div>
    </>
  );
}

export const MANAGE: HubItem[] = [
  { to: '/flows', title: 'Потоки', text: 'Старт каждого месяца, участники, итоги', icon: CalendarRange, perm: 'flows' },
  { to: '/tariffs', title: 'Тарифы и ценность', text: 'Цены, акция, что входит в клуб', icon: Layers, perm: 'tariffs' },
  { to: '/promos', title: 'Промокоды и сторис', text: 'СТАРТ, персональные коды, проверка сторис', icon: BadgePercent, perm: 'tariffs' },
  { to: '/bot', title: 'Сообщения бота', text: 'Приветствие, дожимы, напоминания', icon: Bot, perm: 'bot' },
  { to: '/chats', title: 'Чаты', text: 'Общий чат потока и тематические чаты', icon: MessagesSquare, perm: 'chats' },
  { to: '/meetings', title: 'Созвоны и эксперты', text: 'Расписание и ссылки на эфиры', icon: Video, perm: 'meetings' },
  { to: '/upsells', title: 'Доп. продукты', text: 'Апселлы и заявки', icon: ShoppingBag, perm: 'upsells' },
  { to: '/journey', title: 'Ссылки на трекеры', text: 'Подарок за отзыв: ссылки и заявки', icon: Gift, perm: 'reviews' },
  { to: '/settings', title: 'Настройки и роли', text: 'Ссылки, поддержка, доступы команды', icon: Settings, perm: 'settings' },
  { to: '/experiments', title: 'A/B-тесты', text: 'Варианты онбординга и цен', icon: FlaskConical, perm: 'experiments' },
];

export const MORE: HubItem[] = [
  { to: '/more/insights', title: 'Цели, анкеты и рефералы', text: 'С какими целями приходят, трекеры, приглашения', icon: Target, perm: 'dashboard' },
  { to: '/journey', title: 'Обратная связь и итоги', text: 'Ответы 29-го дня, итоги, ожидания из анкеты', icon: ClipboardList, perm: 'reviews' },
  { to: '/reviews', title: 'Отзывы и кейсы', text: 'Отзывы участников и разрешения на публикацию', icon: Star, perm: 'reviews' },
  { to: '/payments', title: 'Все оплаты', text: 'Фильтры, возвраты, тестовые оплаты, сверка', icon: CreditCard, perm: 'payments' },
  { to: '/funnel', title: 'Экраны приложения', text: 'Подробная воронка, время на экранах, retention D1–D30', icon: BarChart3, perm: 'analytics' },
  { to: '/dashboard', title: 'Сводка показателей', text: 'DAU/MAU, MRR, отчёты, жалобы', icon: MessageCircle, perm: 'dashboard' },
  { to: '/more/exports', title: 'Выгрузки', text: 'CSV: пользователи, платежи, события', icon: Download, perm: 'analytics' },
];

export function ManageHub({ can }: { can: (p: string) => boolean }) {
  return <Hub title="Управление" items={MANAGE} can={can} />;
}

export function MoreHub({ can, onLogout, who }: { can: (p: string) => boolean; onLogout: () => void; who: string }) {
  return (
    <>
      <Hub title="Ещё" items={MORE} can={can} />
      <button className="hub-row logout" onClick={onLogout}><div className="hub-ico"><LogOut size={20} /></div><div className="grow"><b>Выйти</b><span>{who}</span></div></button>
    </>
  );
}

export function Exports() {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const items: [string, string, string][] = [
    ['/admin-api/export/users', 'Пользователи', 'Все, кто приходил в бота и приложение'],
    ['/admin-api/export/payments', 'Платежи', 'Все оплаты, возвраты и продления'],
    [`/admin-api/export/events?from=${from}&to=${today}`, 'События аналитики', 'Последние 90 дней: открытия, экраны, оплаты'],
    ['/admin-api/journey/expectations?csv=1', 'Ответы анкеты', '«Что ты хочешь получить от клуба?»'],
    ['/admin-api/journey/feedback?csv=1', 'Обратная связь', 'Форма предпоследнего дня'],
    ['/admin-api/journey/results?csv=1', 'Итоги потоков', 'Оценка целей и результат'],
  ];
  return (
    <>
      <h1 className="page-title">Выгрузки</h1>
      <div className="list">
        {items.map(([href, t, s]) => <a key={href} className="hub-row" href={href}><div className="hub-ico"><Download size={20} /></div><div className="grow"><b>{t}</b><span>{s}</span></div></a>)}
      </div>
    </>
  );
}

const CATEGORY: Record<string, string> = { money: 'Деньги', weightloss: 'Похудение', blog: 'Блог', english: 'Английский', habits: 'Привычки', selfdev: 'Саморазвитие', other: 'Другое' };

/** Дополнительная аналитика: цели, анкеты, обратная связь, трекеры, рефералы */
export function Insights() {
  const s = useLoad(() => api('/admin-api/home/insights'));
  return (
    <>
      <h1 className="page-title">Цели, анкеты и рефералы</h1>
      <View s={s}>{(d: any) => {
        const t = d.trackers;
        const steps: [string, number][] = [['Увидели предложение', t.saw], ['Нажали «Оставить отзыв»', t.clicked], ['Отправили скриншот', t.sent], ['Отзыв подтверждён', t.approved], ['Трекеры выданы', t.issued]];
        const maxT = Math.max(1, ...steps.map((x) => x[1]));
        return (
          <>
            <section className="block">
              <h2>Цели участников</h2>
              <div className="mini-grid">
                <div><span>Всего целей</span><b>{num(d.goals.total)}</b></div>
                <div><span>Целей на участника</span><b>{d.goals.perMember.toLocaleString('ru-RU')}</b></div>
                <div><span>Достигнуты полностью</span><b>{pctf(d.goals.achievedPct)}</b><em>из {num(d.goals.assessed)} оценённых</em></div>
                <div><span>Частично</span><b>{pctf(d.goals.partialPct)}</b></div>
              </div>
              <h3>С какими целями приходят</h3>
              {d.goals.categories.length ? d.goals.categories.map((c: any) => (
                <div key={c.category} className="hbar"><span>{CATEGORY[c.category] ?? c.category}</span><div className="fbar"><i style={{ width: `${c.pct}%` }} /></div><b>{pctf(c.pct)}</b></div>
              )) : <div className="empty">Целей пока нет</div>}
            </section>
            <section className="block">
              <h2>Анкеты и обратная связь</h2>
              <div className="mini-grid">
                <div><span>Ответов «Что хочешь получить от клуба»</span><b>{num(d.expectations)}</b></div>
                <div><span>Заполнили обратную связь</span><b>{num(d.feedback.count)}</b><em>{pctf(d.feedback.pct)} начавших челлендж</em></div>
              </div>
              <Link className="btn big light" to="/journey">Читать ответы <ChevronRight size={18} /></Link>
            </section>
            <section className="block">
              <h2>Отзывы за трекеры</h2>
              <div className="funnel">
                {steps.map(([title, n]) => <div key={title} className="fstep static"><div className="fstep-head"><span>{title}</span><b>{num(n)}</b></div><div className="fbar"><i style={{ width: `${Math.max(1.5, (n / maxT) * 100)}%` }} /></div></div>)}
              </div>
            </section>
            <section className="block">
              <h2>Реферальная программа</h2>
              <div className="mini-grid">
                <div><span>Пришли по приглашениям</span><b>{num(d.referral.invited)}</b></div>
                <div><span>Из них оплатили</span><b>{num(d.referral.paidUsers)}</b></div>
                <div><span>Выручка от приглашённых</span><b>{d.referral.revenue.toLocaleString('ru-RU')} ₽</b></div>
                <div><span>Вернули скидку за приглашение</span><b>{num(d.referral.rewards)}</b></div>
              </div>
            </section>
          </>
        );
      }}</View>
    </>
  );
}
