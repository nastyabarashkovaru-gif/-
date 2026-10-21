import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Download, Share2, Send, Trophy } from 'lucide-react';
import { api, uploadImage } from '../../lib/api';
import { canDownload, canShareStory, downloadImage, shareLink, shareStory } from '../../lib/telegram';
import { useMe } from '../../state';
import { Empty, ErrorState, Header, Loading, Screen, errorText, humanDate, plural, toast, useLoad } from '../../ui';
import { useMembership } from '../reg/Registration';

interface Card { id: string; imageUrl: string; link: string; stats: { week: number; successfulDays: number; previous: number | null; delta: number | null; percent: number; streak: number; from: string; to: string } }

/** S31: еженедельная карточка (7/14/21/28 и итог) с QR и персональной ссылкой */
export function CardScreen() {
  const weeks = useLoad(() => api<{ weeks: number[] }>('/api/cards'));
  const [week, setWeek] = useState<number | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (weeks.data?.weeks.length && week === null) setWeek(weeks.data.weeks[weeks.data.weeks.length - 1]);
  }, [weeks.data, week]);
  useEffect(() => {
    if (week === null) return;
    setCard(null);
    api<Card>(`/api/cards/${week}`, { body: {} }).then(setCard).catch(setError);
  }, [week]);
  const share = (target: 'story' | 'message' | 'download') => void api('/api/share/click', { body: { target, week } }).catch(() => undefined);

  if (weeks.loading) return <Screen id="S31"><Loading /></Screen>;
  if (weeks.error) return <Screen id="S31"><ErrorState error={weeks.error} retry={weeks.reload} /></Screen>;
  if (!weeks.data!.weeks.length) return <Screen id="S31"><Header title="Карточки" back /><Empty title="Первая карточка — на 7-й день" text="Каждые 7 дней мы собираем твой прогресс в карточку, которой можно поделиться" /></Screen>;
  return (
    <Screen id="S31">
      <Header title="Карточка прогресса" back />
      <div className="seg">{weeks.data!.weeks.map((w) => <button key={w} className={w === week ? 'on' : ''} onClick={() => setWeek(w)}>{w === 5 ? 'Итог' : `Неделя ${w}`}</button>)}</div>
      {error ? <ErrorState error={error} /> : !card ? <Loading lines={1} /> : (
        <>
          <img src={card.imageUrl} alt="Карточка прогресса" style={{ borderRadius: 20, width: '100%', aspectRatio: '9/16', objectFit: 'cover', background: '#fff' }} />
          <div className="muted small center">{card.stats.week === 5 ? 'Итог месяца' : `${humanDate(card.stats.from)} — ${humanDate(card.stats.to)}: ${card.stats.successfulDays} ${plural(card.stats.successfulDays, 'успешный день', 'успешных дня', 'успешных дней')}`}</div>
          {canShareStory() && <button className="btn btn-primary" onClick={() => { share('story'); shareStory(card.imageUrl, card.link); }}><Share2 size={18} /> В сторис Telegram</button>}
          <button className={`btn ${canShareStory() ? 'btn-secondary' : 'btn-primary'}`} onClick={() => { share('message'); shareLink(card.link, `Мой прогресс в «30 днях»: ${card.stats.percent}% обязательств. Присоединяйся к челленджу!`); }}><Send size={18} /> Поделиться ссылкой</button>
          <button className="btn btn-light" onClick={() => { share('download'); downloadImage(card.imageUrl, `30-dney-${card.stats.week}.png`); }}><Download size={18} /> {canDownload() ? 'Сохранить' : 'Открыть картинку'}</button>
          <p className="muted small center">На карточке только цифры прогресса — без названий целей и личных данных.</p>
        </>
      )}
    </Screen>
  );
}

const EMOTIONS = ['Гордость', 'Радость', 'Спокойствие', 'Уверенность', 'Усталость', 'Вдохновение'];

/** S32: отзыв — добровольный, отдельные согласия на публикацию текста, фото и имени */
export function ReviewScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const trigger = (params.get('trigger') ?? 'day14') as 'day14' | 'final' | 'meeting';
  const meetingId = params.get('meetingId') ?? undefined;
  const [rating, setRating] = useState(0);
  const [emotions, setEmotions] = useState<string[]>([]);
  const [changes, setChanges] = useState('');
  const [result, setResult] = useState('');
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [allow, setAllow] = useState({ text: false, photo: false, name: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => void api('/api/reviews/prompt', { body: { trigger } }).catch(() => undefined), [trigger]);
  const send = async () => {
    setBusy(true);
    try {
      await api('/api/reviews', { body: { trigger, meetingId, rating: rating || undefined, emotions, changes: changes || undefined, result: result || undefined, mediaIds: photos.map((p) => p.id), allowText: allow.text, allowPhoto: allow.photo, allowName: allow.name } });
      toast('Спасибо за отзыв!');
      nav('/');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen id="S32">
      <Header title={trigger === 'meeting' ? 'Как прошла встреча?' : 'Что изменилось?'} sub="Это добровольно и не влияет на рейтинг и приз" back />
      <div className="card">
        <div className="h3">Оценка клуба</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <button key={n} className={`chip ${rating === n ? 'on' : ''}`} style={{ minWidth: 44, justifyContent: 'center', padding: 8 }} onClick={() => setRating(n)}>{n}</button>)}</div>
        <div className="h3">Эмоции</div>
        <div className="chips">{EMOTIONS.map((e) => <button key={e} className={`chip ${emotions.includes(e) ? 'on' : ''}`} onClick={() => setEmotions(emotions.includes(e) ? emotions.filter((x) => x !== e) : [...emotions, e])}>{e}</button>)}</div>
        <label className="field"><span>Что изменилось</span><textarea className="textarea" maxLength={3000} value={changes} onChange={(e) => setChanges(e.target.value)} /></label>
        <label className="field"><span>Результат в цифрах (если есть)</span><input className="input" maxLength={300} value={result} placeholder="Например, −3 кг или 25 дней без сигарет" onChange={(e) => setResult(e.target.value)} /></label>
        <div className="photo-grid">{photos.map((p) => <img key={p.id} src={p.url} alt="" />)}</div>
        <label className="btn btn-light btn-sm" style={{ alignSelf: 'flex-start' }}><Camera size={18} /> Фото «после»
          <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setPhotos([...photos, await uploadImage(f)]); } catch (x) { toast(errorText(x)); } }} />
        </label>
      </div>
      <div className="card">
        <div className="h3">Можно ли опубликовать?</div>
        <div className="muted small">Каждое разрешение — отдельно. Отозвать можно в любой момент для будущего использования.</div>
        <label className="check"><input type="checkbox" checked={allow.text} onChange={(e) => setAllow({ ...allow, text: e.target.checked })} /><span>Разрешаю публиковать текст отзыва в рекламе и сторис клуба</span></label>
        <label className="check"><input type="checkbox" checked={allow.photo} onChange={(e) => setAllow({ ...allow, photo: e.target.checked })} /><span>Разрешаю публиковать мои фото</span></label>
        <label className="check"><input type="checkbox" checked={allow.name} onChange={(e) => setAllow({ ...allow, name: e.target.checked })} /><span>Разрешаю указывать моё имя</span></label>
      </div>
      <button className="btn btn-primary" disabled={busy || (!changes && !rating && !result)} onClick={send}>Отправить</button>
      <button className="btn btn-ghost" onClick={() => nav('/')}>Не сейчас</button>
    </Screen>
  );
}

/** S33: финал потока — подтверждение по каждой цели, фото «после», переход к следующему потоку */
export function FinalScreen() {
  const nav = useNavigate();
  const { me } = useMe();
  const { data: m, error, loading, reload } = useMembership();
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [consent, setConsent] = useState(me?.consents.includes('sensitive_photos') ?? false);
  const [busy, setBusy] = useState(false);
  if (loading) return <Screen id="S33"><Loading /></Screen>;
  if (error || !m) return <Screen id="S33"><ErrorState error={error} retry={reload} /></Screen>;
  const allAnswered = m.goals.every((g) => answers[g.id] !== undefined);
  const submit = async () => {
    setBusy(true);
    try {
      if (photos.length && consent && !me?.consents.includes('sensitive_photos')) await api('/api/consents', { body: { kinds: ['sensitive_photos'] } });
      await api('/api/membership/final', { body: { goals: m.goals.map((g) => ({ goalId: g.id, achieved: answers[g.id] })), after: { text: text || undefined, metrics: {}, mediaIds: consent ? photos.map((p) => p.id) : [] } } });
      toast('Итоги сохранены!');
      nav('/cards');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen id="S33">
      <Header title="Итоги месяца" sub={m.flow.title} back="/" />
      <div className="card peach"><div className="row"><Trophy size={24} color="var(--orange)" /><div className="grow small">Для приза нужны 100% обязательств, ни одного пропуска и подтверждение каждой цели. Отвечай честно — претендентов проверяют вручную.</div></div></div>
      {m.goals.map((g) => (
        <div className="card" key={g.id}>
          <div className="h3">{g.title}</div>
          <div className="muted small">Критерий: {g.successCriterion}</div>
          <div className="seg">
            <button className={answers[g.id] === true ? 'on' : ''} onClick={() => setAnswers({ ...answers, [g.id]: true })}>Цель достигнута</button>
            <button className={answers[g.id] === false ? 'on' : ''} onClick={() => setAnswers({ ...answers, [g.id]: false })}>Пока нет</button>
          </div>
        </div>
      ))}
      <div className="card">
        <div className="h3">Точка «ПОСЛЕ»</div>
        <textarea className="textarea" placeholder="Что получилось за месяц" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Согласен(на) на хранение фото «ПОСЛЕ» для проверки результата</span></label>
        <div className="photo-grid">{photos.map((p) => <img key={p.id} src={p.url} alt="" />)}</div>
        <label className="btn btn-light btn-sm" style={{ alignSelf: 'flex-start', opacity: consent ? 1 : 0.45 }}><Camera size={18} /> Фото «после»
          <input type="file" accept="image/*" hidden disabled={!consent} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setPhotos([...photos, await uploadImage(f)]); } catch (x) { toast(errorText(x)); } }} />
        </label>
      </div>
      <button className="btn btn-primary" disabled={!allAnswered || busy} onClick={submit}>Отправить итоги</button>
    </Screen>
  );
}
