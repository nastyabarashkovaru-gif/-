import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, PartyPopper, Share2, Sparkles, Sprout } from 'lucide-react';
import { api } from '../../lib/api';
import { canShareStory, downloadImage, openExternal, shareStory } from '../../lib/telegram';
import { Popup, errorText, toast } from '../../ui';

/** Итоги недели (ТЗ 14.11): окно «Твой прогресс» после каждой недели и карточка для сторис из конструктора */
export interface WeekResult {
  week: number;
  of: number;
  weeks: number[];
  percent: number;
  done: number;
  total: number;
  activeDays: number;
  days: number;
  rank: { place: number; of: number } | null;
  label: string;
  text: string;
}

function useInstagram() {
  const [account, setAccount] = useState('barashkova.aa');
  useEffect(() => {
    void api<{ account: string }>('/api/story-card').then((r) => r.account && setAccount(r.account)).catch(() => undefined);
  }, []);
  return account;
}

/** «Поделись результатами в сторис, отметь @ник, а мы репостнем к себе! 💗» — ник открывает профиль в Instagram */
function TagLine({ account }: { account: string }) {
  return (
    <p className="muted small center" style={{ margin: 0 }}>
      Поделись результатами в сторис, отметь{' '}
      <button className="wk-nick" onClick={() => openExternal(`https://instagram.com/${account}`)}>@{account}</button>, а мы репостнем к себе! 💗
    </p>
  );
}

export function WeekResultView({ r, onShare }: { r: WeekResult; onShare: () => void }) {
  const account = useInstagram();
  const good = r.percent >= 50;
  return (
    <div className="wk">
      <div className="wk-head">
        <span className="wk-spark"><Sparkles size={18} /></span>
        <span className="wk-title">30 дней · Твой прогресс</span>
        <span className="wk-pill">Неделя {r.week}/{r.of}</span>
      </div>
      <div className="wk-body">
        <span className="ic lg" style={{ alignSelf: 'center' }}>{good ? <PartyPopper size={30} strokeWidth={1.8} /> : <Sprout size={30} strokeWidth={1.8} />}</span>
        <div className="wk-label">{r.label}</div>
        <p className="wk-text">{r.text}</p>
        <div className="wk-grid">
          <div className="wk-tile on"><span>Выполнение</span><b>{r.percent}%</b></div>
          <div className="wk-tile on"><span>Задачи</span><b>{r.done}/{r.total}</b></div>
          <div className="wk-tile"><span>Дней с отчётами</span><b>{r.activeDays} из {r.days}</b></div>
          <div className="wk-tile"><span>В рейтинге недели</span><b>{r.rank ? `#${r.rank.place}` : '—'}</b></div>
        </div>
        <div className="bar soft"><i style={{ width: `${r.percent}%` }} /></div>
        <button className="btn btn-light" onClick={onShare}><Share2 size={18} />Поделиться результатами в Stories</button>
        <TagLine account={account} />
      </div>
    </div>
  );
}

interface CardResp { imageUrl: string }

/** Конструктор карточки: что показать на карточке — как у итоговой карточки челленджа */
export function WeekStoryBuilder({ r, onBack }: { r: WeekResult; onBack?: () => void }) {
  const account = useInstagram();
  const [opts, setOpts] = useState({ showPercent: true, showTasks: true, showDays: true, showRank: Boolean(r.rank) });
  const [showName, setShowName] = useState(false);
  const [name, setName] = useState('');
  const [result, setResult] = useState('');
  const [card, setCard] = useState<CardResp | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setBusy(true);
      api<CardResp>('/api/week-card', { body: { week: r.week, ...opts, result, name: showName ? name : '' } })
        .then(setCard)
        .catch((e) => toast(errorText(e)))
        .finally(() => setBusy(false));
    }, 400);
  }, [r.week, opts, result, name, showName]);
  const toggle = (k: keyof typeof opts, label: string, can = true) =>
    can && (
      <label className="check" key={k}>
        <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
        <span>{label}</span>
      </label>
    );
  return (
    <>
      {onBack && <button className="link-btn row" style={{ alignSelf: 'flex-start', gap: 6 }} onClick={onBack}><ArrowLeft size={16} />Назад к итогам</button>}
      <h2 className="hero" style={{ fontSize: 22 }}>Карточка для Stories</h2>
      <div className="story-frame" style={{ width: "58%", flexShrink: 0 }}>
        {card ? <img src={card.imageUrl} alt="Карточка недели" style={{ opacity: busy ? 0.6 : 1 }} /> : <span className="story-loading">Собираем карточку…</span>}
      </div>
      <div className="card" style={{ gap: 6 }}>
        <span className="h3" style={{ fontSize: 15 }}>Что показать на карточке</span>
        {toggle('showPercent', `Выполнение за неделю — ${r.percent}%`)}
        {toggle('showTasks', `Задачи — ${r.done} из ${r.total}`, r.total > 0)}
        {toggle('showDays', `Дни с отчётами — ${r.activeDays} из 7`)}
        {toggle('showRank', `Место в рейтинге недели — #${r.rank?.place ?? ''}`, Boolean(r.rank))}
        <label className="check">
          <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
          <span>Показать имя</span>
        </label>
        {showName && <input className="input" value={name} maxLength={40} placeholder="Имя на карточке" onChange={(e) => setName(e.target.value)} />}
        <input className="input" value={result} maxLength={60} placeholder="Мой результат за неделю (по желанию)" onChange={(e) => setResult(e.target.value)} />
      </div>
      {card && canShareStory() && <button className="btn btn-primary" onClick={() => shareStory(card.imageUrl, '')}><Share2 size={18} />Выложить в Stories</button>}
      {card && <button className={`btn ${canShareStory() ? 'btn-secondary' : 'btn-primary'}`} onClick={() => downloadImage(card.imageUrl, `30-dney-week-${r.week}.png`)}><Download size={18} />Сохранить карточку</button>}
      <TagLine account={account} />
    </>
  );
}

/** Окно на главной: сначала итоги, по кнопке — конструктор карточки (то же окно, другой шаг) */
export function WeekResultPopup({ week, onClose }: { week: number | null | undefined; onClose: () => void }) {
  const [r, setR] = useState<WeekResult | null>(null);
  const [step, setStep] = useState<'result' | 'story'>('result');
  useEffect(() => {
    if (!week) return;
    setStep('result');
    void api<WeekResult>(`/api/week-result/${week}`).then(setR).catch(() => undefined);
    void api(`/api/week-result/${week}/seen`, { body: {} }).catch(() => undefined);
  }, [week]);
  return (
    <Popup open={Boolean(week && r)} onClose={onClose} stepKey={step}>
      {r && (step === 'result' ? <WeekResultView r={r} onShare={() => setStep('story')} /> : <WeekStoryBuilder r={r} onBack={() => setStep('result')} />)}
    </Popup>
  );
}
