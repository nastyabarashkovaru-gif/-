import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { View, act, useLoad } from '../ui';

interface Video { url: string; title: string; duration: string }

const ytId = (u: string) => u.trim().match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] ?? null;

/** Продающее видео на первом экране: ссылка YouTube, название, длительность */
// Блок скрыт, пока нет видео: вернуть — добавить <VideoBlock initial={s.data!.video} /> перед блоком счётчика
export function VideoBlock({ initial }: { initial: Video }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const id = ytId(v.url);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const bad = v.url.trim() !== '' && !id;
  const save = async () => { if (await act(() => api('/admin-api/onboarding/video', { method: 'PUT', body: v }))) { setSaved(v); alert(v.url.trim() ? 'Сохранено — видео уже на первом экране' : 'Видео убрано с первого экрана'); } };
  return (
    <div className="block">
      <h2>Продающее видео</h2>
      <p className="sub" style={{ margin: '0 0 8px' }}>Карточка «▶ Смотреть» над счётчиком участников. Видео открывается прямо в приложении. Чтобы убрать — очистите ссылку и сохраните.</p>
      <label className="f">Ссылка на YouTube<input value={v.url} type="url" autoCapitalize="none" autoCorrect="off" placeholder="https://youtu.be/…" onChange={(e) => setV({ ...v, url: e.target.value })} /></label>
      {bad && <div className="err">Это не похоже на ссылку на ролик YouTube</div>}
      {id && <img src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" style={{ width: 160, borderRadius: 10, display: 'block', margin: '4px 0 8px' }} />}
      <label className="f">Название на карточке<input value={v.title} maxLength={80} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
      <label className="f">Длительность<input value={v.duration} maxLength={20} placeholder="6 мин" onChange={(e) => setV({ ...v, duration: e.target.value })} /></label>
      <button className="btn big" disabled={!dirty || bad || !v.title.trim()} onClick={save}>{dirty ? 'Сохранить видео' : 'Сохранено'}</button>
    </div>
  );
}

interface Review { id: string; emoji: string; title: string; text?: string; image?: string; enabled: boolean }

const imgUrl = (image?: string) => (!image ? null : image.startsWith('/') ? image : `/api/public/review-image/${image.replace(/^reviews\//, '')}`);

function csrf() {
  return document.cookie.split('; ').find((c) => c.startsWith('thirty_csrf='))?.split('=')[1] ?? '';
}

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/admin-api/onboarding/image', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf() } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? `Ошибка ${res.status}`);
  return data.image as string;
}

/** Первый экран онбординга: карточки результатов участниц (порядок, текст, оригинальный скриншот) и «Нас уже 300+» */
export function OnboardingReviews() {
  const s = useLoad(() => api<{ reviews: Review[]; count: string; since: string; live: number; video: Video }>('/admin-api/onboarding'));
  const [list, setList] = useState<Review[]>([]);
  const [count, setCount] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (s.data) { setList(s.data.reviews); setCount(s.data.count); setDirty(false); }
  }, [s.data]);
  const upd = (k: number, patch: Partial<Review>) => { setList(list.map((x, j) => (j === k ? { ...x, ...patch } : x))); setDirty(true); };
  const move = (k: number, d: -1 | 1) => {
    const j = k + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[k], next[j]] = [next[j], next[k]];
    setList(next);
    setDirty(true);
  };
  const save = async () => { if (await act(() => api('/admin-api/onboarding', { method: 'PUT', body: { reviews: list, count } }))) { s.reload(); alert('Сохранено — в приложении уже новая карусель'); } };
  return (
    <>
      <h1 className="page-title">Первый экран: отзывы</h1>
      <p className="sub">Карусель «Посмотри, чего уже добились наши участники». Только реальные результаты — по нажатию на карточку участник видит оригинальный скриншот.</p>
      <View s={s}>{() => (
        <>
          <div className="block">
            <div className="money-hero" style={{ margin: '0 0 10px' }}>
              <span>Сейчас в приложении</span>
              <b>{s.data!.live}</b>
              <em>«Сейчас с нами уже … участников!» — стартовое число {s.data!.count}{s.data!.since ? ` + новые оплатившие с ${new Date(s.data!.since).toLocaleDateString('ru-RU')}` : ''}</em>
            </div>
            <label className="f">Стартовое число (после сохранения отсчёт новых оплат начнётся заново)<input value={count} inputMode="numeric" onChange={(e) => { setCount(e.target.value.replace(/\D/g, '')); setDirty(true); }} placeholder="274" /></label>
          </div>
          <div className="list">
            {list.map((r, k) => (
              <div key={r.id} className={`block review-edit${r.enabled ? '' : ' off'}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>№ {k + 1}</b>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn light icon" aria-label="Выше" disabled={k === 0} onClick={() => move(k, -1)}><ArrowUp size={18} /></button>
                    <button className="btn light icon" aria-label="Ниже" disabled={k === list.length - 1} onClick={() => move(k, 1)}><ArrowDown size={18} /></button>
                    <button className="btn light icon" aria-label="Удалить" onClick={() => { if (confirm('Удалить карточку?')) { setList(list.filter((_, j) => j !== k)); setDirty(true); } }}><Trash2 size={18} /></button>
                  </div>
                </div>
                <label className="switch"><input type="checkbox" checked={r.enabled} onChange={(e) => upd(k, { enabled: e.target.checked })} /><span>Показывать в приложении</span></label>
                <label className="f">Эмодзи<input value={r.emoji} maxLength={16} onChange={(e) => upd(k, { emoji: e.target.value })} /></label>
                <label className="f">Главный результат<input value={r.title} maxLength={120} onChange={(e) => upd(k, { title: e.target.value })} /></label>
                <label className="f">Уточнение (необязательно)<input value={r.text ?? ''} maxLength={240} onChange={(e) => upd(k, { text: e.target.value || undefined })} /></label>
                <div className="review-img">
                  {imgUrl(r.image) ? <img src={imgUrl(r.image)!} alt="" /> : <span className="muted">Скриншот не прикреплён</span>}
                  <label className="btn light"><ImagePlus size={18} />{r.image ? 'Заменить скриншот' : 'Загрузить скриншот'}
                    <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { upd(k, { image: await uploadImage(f) }); } catch (err) { alert((err as Error).message); } }} />
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button className="btn big light" onClick={() => { setList([...list, { id: `r${Date.now()}`, emoji: '💜', title: '', enabled: false }]); setDirty(true); }}><Plus size={18} />Добавить карточку</button>
          <button className="btn big" disabled={!dirty || list.some((r) => !r.title.trim())} onClick={save}>{dirty ? 'Сохранить' : 'Сохранено'}</button>
        </>
      )}</View>
    </>
  );
}
