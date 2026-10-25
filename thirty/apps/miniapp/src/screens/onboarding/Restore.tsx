import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Gift, Instagram, Clock, CircleCheck, CircleX, Copy, ImagePlus, X } from 'lucide-react';
import { api, uploadImage } from '../../lib/api';
import { downloadImage, haptic } from '../../lib/telegram';
import { BrandBar, Cta, ErrorState, Loading, Screen, errorText, toast, useLoad } from '../../ui';

interface Req { id: string; status: 'pending' | 'approved' | 'rejected'; instagram: string; reason: string | null; promo: { code: string; validTo: string | null; used: boolean } | null }

/** «Вернуть скидку 🎁»: карточка для сторис, инструкция и заявка на проверку; после проверки — персональный промокод */
export function RestoreDiscount() {
  const nav = useNavigate();
  const card = useLoad(() => api<{ account: string; imageUrl: string }>('/api/story-card'));
  const mine = useLoad(() => api<{ request: Req | null }>('/api/story-requests/mine'));
  const [ig, setIg] = useState('');
  const [posted, setPosted] = useState(false);
  const [shot, setShot] = useState<{ id: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api('/api/me/screen', { body: { screen: '/restore' } }).catch(() => undefined);
  }, []);
  const r = mine.data?.request;

  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/story-requests', { body: { mediaId: shot!.id, instagram: ig.trim() } });
      haptic('success');
      mine.reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (card.loading || mine.loading) return <Screen id="RESTORE"><Loading /></Screen>;
  if (card.error || mine.error) return <Screen id="RESTORE"><ErrorState error={card.error ?? mine.error} retry={() => { card.reload(); mine.reload(); }} /></Screen>;
  const account = card.data!.account;

  return (
    <Screen id="RESTORE">
      <BrandBar />
      <span className="ic lg" style={{ alignSelf: 'center', marginTop: 6 }}><Gift size={30} strokeWidth={1.8} /></span>
      <div className="col" style={{ gap: 10 }}>
        <h1 className="hero">Верни скидку <em>на вступление!</em> 🎁</h1>
        <p className="lead">Выложи карточку в сторис — и получи персональный промокод на первоначальную акционную цену.</p>
      </div>

      {r?.status === 'approved' && r.promo ? (
        <div className="card" style={{ gap: 10, alignItems: 'center', textAlign: 'center' }}>
          <CircleCheck size={30} color="var(--green)" />
          <div className="h3">Сторис засчитана! Твой промокод:</div>
          <button className="promo-code" onClick={() => { void navigator.clipboard?.writeText(r.promo!.code); toast('Промокод скопирован'); }}>{r.promo.code}<Copy size={16} /></button>
          {r.promo.validTo && <div className="muted small">Действует до {new Date(r.promo.validTo).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</div>}
          <Cta onClick={() => nav('/tariffs')}>Ввести промокод на тарифах</Cta>
        </div>
      ) : r?.status === 'pending' ? (
        <div className="panel" style={{ gap: 6, padding: 16, alignItems: 'center', textAlign: 'center' }}>
          <Clock size={24} color="var(--accent)" />
          <div style={{ color: 'var(--accent-ink)', fontWeight: 600, fontSize: 17 }}>Хорошо! Мы проверим и пришлём тебе скидку на вступление в бот 💜</div>
          <div className="muted small">Обычно проверка занимает немного времени.</div>
        </div>
      ) : (
        <>
          <div className="card" style={{ gap: 12 }}>
            {[
              'Получи карточку «Я иду на челлендж 30 дней».',
              'Впиши в неё свои цели на ближайший месяц.',
              `Выложи карточку в Instagram Stories и отметь мой аккаунт${account ? ` @${account}` : ''}.`,
            ].map((t, i) => (
              <div key={t} className="row" style={{ gap: 12, alignItems: 'flex-start' }}><span className={`num-sq ${['', 'green', 'peach'][i]}`} style={{ width: 36, height: 36, fontSize: 16 }}>{i + 1}</span><span style={{ paddingTop: 6 }}>{t}</span></div>
            ))}
          </div>
          <img src={card.data!.imageUrl} alt="Карточка «Я иду на челлендж 30 дней»" style={{ width: '62%', alignSelf: 'center', borderRadius: 18, boxShadow: '0 6px 24px rgba(33,28,53,.12)' }} />
          <button className="btn btn-secondary" onClick={() => downloadImage(card.data!.imageUrl, '30-dney-story.png')}><Download size={18} />Скачать карточку</button>
          {r?.status === 'rejected' && <div className="banner err"><CircleX size={15} style={{ verticalAlign: -3 }} /> Прошлая заявка не прошла проверку{r.reason ? `: ${r.reason}` : ''}. Можно отправить ещё раз.</div>}
          {!posted ? (
            <Cta onClick={() => setPosted(true)}>Я выложила сторис ✅</Cta>
          ) : (
            <div className="card" style={{ gap: 10 }}>
              <span className="row h3" style={{ gap: 8 }}><Instagram size={18} color="var(--accent)" />Прикрепи скриншот сторис</span>
              <span className="muted small">Чтобы мы увидели карточку и отметку аккаунта.</span>
              {shot ? (
                <div className="photo-grid"><div style={{ position: 'relative' }}><img src={shot.url} alt="Скриншот сторис" /><button className="photo-x" aria-label="Убрать скриншот" onClick={() => setShot(null)}><X size={13} /></button></div></div>
              ) : (
                <label className="btn btn-secondary" style={{ minHeight: 48 }}>
                  <ImagePlus size={18} />{uploading ? 'Загружаем…' : 'Прикрепить скриншот'}
                  <input type="file" accept="image/*" hidden disabled={uploading} onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setUploading(true);
                    try { setShot(await uploadImage(f)); } catch (x) { toast(errorText(x)); } finally { setUploading(false); }
                  }} />
                </label>
              )}
              <input className="input" placeholder="Ник в Instagram (необязательно)" value={ig} maxLength={60} onChange={(e) => setIg(e.target.value)} />
              <Cta disabled={busy || !shot} onClick={submit}>Отправить на проверку</Cta>
            </div>
          )}
        </>
      )}
      <button className="link-btn" onClick={() => nav('/tariffs')}>Посмотреть тарифы</button>
    </Screen>
  );
}
