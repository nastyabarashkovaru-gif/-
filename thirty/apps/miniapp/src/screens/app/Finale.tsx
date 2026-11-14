import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Download, Share2, Send, Trophy } from 'lucide-react';
import { api, uploadImage } from '../../lib/api';
import { canDownload, canShareStory, downloadImage, shareLink, shareStory } from '../../lib/telegram';
import { useMe } from '../../state';
import { Empty, ErrorState, Header, Loading, Popup, Screen, errorText, humanDate, plural, toast, useLoad } from '../../ui';
import { useMembership } from '../reg/Registration';
import { WeekResultView, WeekStoryBuilder, type WeekResult } from './WeekResult';

/** S31: итоги недель (14.11) — то же окно «Твой прогресс», что всплывает на главной, и конструктор карточки для сторис */
export function CardScreen() {
  const nav = useNavigate();
  const [week, setWeek] = useState<number | null>(null);
  const [story, setStory] = useState(false);
  const r = useLoad(() => api<WeekResult>(`/api/week-result/${week ?? 'latest'}`), [week]);
  if (r.loading && !r.data) return <Screen id="S31"><Header title="Итоги недели" back /><Loading /></Screen>;
  if (r.error && !r.data) return <Screen id="S31"><Header title="Итоги недели" back /><Empty title="Первые итоги — после 7-го дня" text="Каждую неделю мы собираем твой прогресс: выполнение, задачи, дни с отчётами и место в рейтинге — и карточку для сторис" /></Screen>;
  const d = r.data!;
  return (
    <Screen id="S31">
      <Header title="Итоги недели" back />
      <div className="seg">
        {d.weeks.map((w) => <button key={w} className={w === d.week ? 'on' : ''} onClick={() => setWeek(w)}>Неделя {w}</button>)}
        {d.weeks.length >= d.of && <button onClick={() => nav('/finale')}>Итог</button>}
      </div>
      <div className="card"><WeekResultView r={d} onShare={() => setStory(true)} /></div>
      <Popup open={story} onClose={() => setStory(false)}><WeekStoryBuilder r={d} /></Popup>
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
      <Header title={trigger === 'meeting' ? 'Как прошла встреча?' : 'Что изменилось?'} sub="Это добровольно и не влияет на рейтинг" back />
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
