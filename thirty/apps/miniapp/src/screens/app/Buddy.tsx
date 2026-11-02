import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Send, Sparkles, User } from 'lucide-react';
import { api } from '../../lib/api';
import { haptic, openTelegram } from '../../lib/telegram';
import { BuddyProposals } from '../reg/Registration';
import { Avatar, ErrorState, Header, Loading, Screen, Sheet, errorText, humanDate, toast, useLoad } from '../../ui';

type BuddyState = { state: 'paired'; pairId: string; source: string; since: string; buddy: { id: string; name: string; photoUrl: string | null; percent: number | null; writeUrl: string } } | { state: 'waiting' | 'invited' | 'none'; mode?: 'auto' | 'self' | null };

/** S29: бадди — прогресс, написать, замена (по согласию или при отсутствии связи > 5 дней), жалоба */
export function BuddyScreen() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<BuddyState>('/api/buddy'));
  const [params] = useSearchParams();
  const [sheet, setSheet] = useState(params.get('replace') === '1');
  const [reason, setReason] = useState<'no_contact' | 'mismatch' | 'other' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading) return <Screen id="S29"><Loading /></Screen>;
  if (error || !data) return <Screen id="S29"><ErrorState error={error} retry={reload} /></Screen>;
  if (data.state !== 'paired') {
    return (
      <Screen id="S29">
        <Header title="Мой бадди" back="/" />
        <BuddyProposals onChange={reload} />
        <FindBuddy mode={data.mode ?? null} onChange={reload} />
      </Screen>
    );
  }
  const replace = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      const r = await api<{ state: string; newBuddy: string | null }>('/api/buddy/replace', { body: { reason, comment: comment.trim() || undefined } });
      toast(r.newBuddy ? `Готово! Твой новый бадди — ${r.newBuddy} 💜` : 'Пара распущена. Подберём нового бадди, как только появится свободная участница, и напишем в боте');
      setSheet(false);
      reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen id="S29">
      <Header title="Мой бадди" back="/" />
      <div className="card center" style={{ alignItems: 'center' }}>
        <div className="ava lg">{data.buddy.photoUrl ? <img src={data.buddy.photoUrl} alt="" /> : <User size={26} />}</div>
        <div className="h2">{data.buddy.name}</div>
        {data.buddy.percent !== null && <div className="badge-pct">{data.buddy.percent}%</div>}
        <div className="muted small">Вместе с {humanDate(data.since.slice(0, 10))} · {data.source === 'invite' ? 'по приглашению' : 'подобран по интересам'}</div>
      </div>
      <button className="btn btn-primary" onClick={() => openTelegram(data.buddy.writeUrl)}><Send size={18} /> Написать</button>
      <button className="btn btn-ghost" onClick={() => nav(`/u/${data.buddy.id}`)}>Профиль бадди</button>
      <div className="spacer" />
      <button className="btn btn-ghost" onClick={() => setSheet(true)}>Заменить бадди</button>
      <Sheet open={sheet} onClose={() => setSheet(false)}>
        <div className="h3">Заменить бадди</div>
        <p className="muted small" style={{ margin: 0 }}>Подберём тебе нового бадди из свободных участниц — бывшего с тобой снова не поставим. Что случилось?</p>
        {([['no_contact', 'Не выходит на связь'], ['mismatch', 'Не сошлись'], ['other', 'Другое']] as const).map(([k, t]) => (
          <button key={k} className={`btn ${reason === k ? 'btn-secondary' : 'btn-light'}`} onClick={() => setReason(k)}>{t}</button>
        ))}
        <textarea className="input" rows={2} maxLength={500} placeholder="Комментарий (по желанию)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button className="btn btn-primary" disabled={!reason || busy} onClick={replace}>{busy ? 'Подбираем…' : 'Заменить бадди'}</button>
        <button className="btn btn-ghost" onClick={async () => {
          const reason = prompt('Опишите проблему');
          if (!reason) return;
          try { await api('/api/complaints', { body: { kind: 'buddy', targetUserId: data.buddy.id, reason } }); toast('Жалоба отправлена модератору'); } catch (e) { toast(errorText(e)); }
        }}>Пожаловаться</button>
      </Sheet>
    </Screen>
  );
}

interface FreePerson { id: string; name: string; username: string | null; photoUrl: string | null; city: string | null; goals: string[]; proposed: boolean }

/** Поиск бадди (ТЗ 02.11): выбрать способ — автоподбор по очереди или самостоятельно из свободных участников */
function FindBuddy({ mode, onChange }: { mode: 'auto' | 'self' | null; onChange: () => void }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [spin, setSpin] = useState(false);
  const choose = async (m: 'auto' | 'self') => {
    if (m === 'auto') {
      setSpin(true);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ state: string }>('/api/buddy/mode', { body: { mode: m } });
      if (r.state === 'paired') toast('Ура! Мы нашли тебе бадди! 💜');
      onChange();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const roulette = spin && <BuddyRoulette onClose={() => { setSpin(false); onChange(); }} />;
  if (mode === 'auto') {
    return (
      <>
        <div className="card center" style={{ alignItems: 'center', gap: 10 }}>
          <Sparkles size={40} color="var(--accent)" />
          <div className="h3">Ищем тебе бадди 💜</div>
          <div className="muted small">Сейчас все бадди заняты. Как только появится свободная участница, мы сразу пришлём уведомление в бот!</div>
        </div>
        <button className="btn btn-primary" onClick={() => choose('auto')}>🎲 Подобрать пару ещё раз</button>
        <button className="btn btn-light" disabled={busy} onClick={() => choose('self')}>Выбрать бадди самостоятельно</button>
        {roulette}
      </>
    );
  }
  if (mode === 'self') return <>{<FreeList onChange={onChange} onAuto={() => choose('auto')} />}{roulette}</>;
  return (
    <>
      <div className="col" style={{ gap: 6 }}>
        <h2 className="h2" style={{ margin: 0 }}>Как хочешь найти своего бадди?</h2>
        <p className="muted" style={{ margin: 0 }}>Бадди — напарник, с которым вы поддерживаете друг друга и вместе идёте к своим целям.</p>
      </div>
      <button className="card card-link buddy-choice" disabled={busy} onClick={() => choose('auto')}>
        <span className="buddy-choice-ic">🤝</span>
        <span className="grow"><b>Подобрать автоматически</b><span>Мы найдём тебе напарника среди участников клуба</span></span>
      </button>
      <button className="card card-link buddy-choice" disabled={busy} onClick={() => choose('self')}>
        <span className="buddy-choice-ic">💜</span>
        <span className="grow"><b>Выбрать самостоятельно</b><span>Выбери участника, с которым хочешь проходить челлендж вместе</span></span>
      </button>
      <button className="link-btn" onClick={() => nav('/reg/buddy')}>Пригласить подругу по ссылке</button>
      {roulette}
    </>
  );
}

/** Свободные участники: без пары, с поиском по имени и @нику, «Предложить стать бадди» */
function FreeList({ onChange, onAuto }: { onChange: () => void; onAuto: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => api<{ items: FreePerson[] }>(`/api/buddy/free?q=${encodeURIComponent(q)}`), [q]);
  const [busy, setBusy] = useState<string | null>(null);
  const propose = async (p: FreePerson) => {
    setBusy(p.id);
    try {
      const r = await api<{ matched: boolean }>(`/api/buddy/propose/${p.id}`, { body: {} });
      toast(r.matched ? 'Теперь вы пара! 💜' : `Предложение отправлено — ${p.name} получит его в боте 💜`);
      if (r.matched) onChange();
      else reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="col" style={{ gap: 6 }}>
        <h2 className="h2" style={{ margin: 0 }}>Найти бадди 💜</h2>
        <p className="muted" style={{ margin: 0 }}>Участники клуба, у которых пока нет пары. Пара появится, когда второй человек примет предложение.</p>
      </div>
      <label className="search-field"><Search size={17} /><input value={q} type="search" autoCapitalize="none" autoCorrect="off" placeholder="Имя или @ник" onChange={(e) => setQ(e.target.value)} /></label>
      {loading && !data ? <Loading lines={2} /> : error ? <ErrorState error={error} retry={reload} /> : data!.items.length === 0 ? (
        <div className="card center muted small">{q ? 'Никого не нашли' : 'Сейчас все участники уже в парах. Можешь доверить подбор нам — объединим, как только кто-то освободится.'}</div>
      ) : data!.items.map((p) => (
        <div key={p.id} className="card free-row">
          <button className="row" style={{ gap: 12, border: 0, background: 'none', padding: 0, textAlign: 'left', alignItems: 'center' }} onClick={() => nav(`/u/${p.id}`)}>
            <Avatar name={p.name} url={p.photoUrl} />
            <span className="grow" style={{ minWidth: 0 }}>
              <b style={{ display: 'block' }}>{p.name}</b>
              <span className="muted small">{[p.username ? `@${p.username}` : null, p.city].filter(Boolean).join(' · ')}</span>
              {p.goals.length > 0 && <span className="small" style={{ display: 'block', color: 'var(--ink-2)', marginTop: 2 }}>🎯 {p.goals.join(' · ')}</span>}
            </span>
          </button>
          <button className={`btn ${p.proposed ? 'btn-light' : 'btn-primary'}`} style={{ minHeight: 44 }} disabled={p.proposed || busy === p.id} onClick={() => propose(p)}>{p.proposed ? 'Предложение отправлено' : 'Предложить стать бадди'}</button>
        </div>
      ))}
      <button className="link-btn" onClick={onAuto}>Лучше подберите мне бадди автоматически</button>
    </>
  );
}

type Found = { name: string; photoUrl: string | null; writeUrl: string } | null;

/**
 * «Подобрать пару автоматически»: окно с «крутилкой» аватарок (~2,5 с), затем результат —
 * бадди найдена или «все заняты, пришлём уведомление в бот».
 */
export function BuddyRoulette({ onClose }: { onClose: () => void }) {
  const [faces, setFaces] = useState<{ name: string; photoUrl: string | null }[]>([]);
  const [phase, setPhase] = useState<'spin' | 'found' | 'wait'>('spin');
  const [found, setFound] = useState<Found>(null);
  useEffect(() => {
    let alive = true;
    const started = Date.now();
    void api<{ items: { name: string; photoUrl: string | null }[] }>('/api/buddy/free').then((r) => alive && setFaces(r.items.slice(0, 12))).catch(() => undefined);
    void (async () => {
      let res: Found = null;
      try {
        const r = await api<{ state: string; buddy?: { name: string; photoUrl: string | null; writeUrl: string } }>('/api/buddy/mode', { body: { mode: 'auto' } });
        if (r.state === 'paired' && r.buddy) res = r.buddy;
      } catch (e) {
        toast(errorText(e));
      }
      // крутилка крутится минимум 2,5 секунды — даже если ответ пришёл сразу
      await new Promise((ok) => setTimeout(ok, Math.max(0, 2500 - (Date.now() - started))));
      if (!alive) return;
      setFound(res);
      setPhase(res ? 'found' : 'wait');
      haptic(res ? 'success' : 'light');
    })();
    return () => { alive = false; };
  }, []);
  // лента аватарок для «слота»: повторяем, чтобы прокрутка была длинной
  const base = faces.length ? faces : [{ name: '💜', photoUrl: null }, { name: '✨', photoUrl: null }, { name: '🤝', photoUrl: null }, { name: '🔥', photoUrl: null }];
  const reel = Array.from({ length: 6 }, () => base).flat();
  return createPortal(
    <div className="roulette-overlay">
      <div className="roulette-card">
        {phase === 'spin' && (
          <>
            <div className="slot"><div className="slot-reel">{reel.map((f, i) => <div key={i} className="slot-face">{f.photoUrl ? <img src={f.photoUrl} alt="" /> : <span>{f.name.slice(0, 1)}</span>}</div>)}</div></div>
            <div className="h2 center" style={{ margin: 0 }}>Подбираем тебе бадди…</div>
            <div className="muted center">Ищем свободную участницу 💜</div>
          </>
        )}
        {phase === 'found' && found && (
          <>
            <div className="found-party" aria-hidden>🎉</div>
            <div className="found-face">{found.photoUrl ? <img src={found.photoUrl} alt="" /> : <span>{found.name.slice(0, 1)}</span>}</div>
            <div className="h2 center" style={{ margin: 0 }}>Ура! Мы нашли тебе бадди! 💜</div>
            <div className="muted center">Твой напарник — <b style={{ color: 'var(--ink)' }}>{found.name}</b>. Познакомьтесь и вместе двигайтесь к своим целям!</div>
            <button className="btn btn-primary" onClick={() => openTelegram(found.writeUrl)}><Send size={18} />Написать бадди</button>
            <button className="btn btn-ghost" onClick={onClose}>Отлично!</button>
          </>
        )}
        {phase === 'wait' && (
          <>
            <div className="wait-ic" aria-hidden>⏳</div>
            <div className="h2 center" style={{ margin: 0 }}>Сейчас все бадди заняты 💜</div>
            <div className="muted center">Как только появится свободная участница, мы сразу пришлём уведомление в бот!</div>
            <button className="btn btn-primary" onClick={onClose}>Хорошо, жду</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
