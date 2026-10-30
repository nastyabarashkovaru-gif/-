import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { api, dt } from '../api';
import { View, act, useLoad } from '../ui';

interface Info { link: string | null; maxUses: number; expiresAt: string; enabled: boolean; uses: number; claims: { userId: string; name: string; username: string | null; at: string }[] }

/** Ссылка для тех, кто оплатил до запуска приложения: месяц участия без оплаты, сразу в анкету */
export function Legacy() {
  const s = useLoad(() => api<Info>('/admin-api/legacy'));
  const [f, setF] = useState({ maxUses: 0, expiresAt: '', enabled: true });
  useEffect(() => { if (s.data) setF({ maxUses: s.data.maxUses, expiresAt: s.data.expiresAt, enabled: s.data.enabled }); }, [s.data]);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); alert('Ссылка скопирована'); } catch { prompt('Скопируй ссылку:', text); } };
  return (
    <>
      <h1 className="page-title">Переход прошлых участниц</h1>
      <p className="sub">Для тех, кто оплатил до запуска приложения. По ссылке человек получает участие в ближайшем потоке на один месяц без оплаты и без автопродления и сразу попадает в анкету. Отправляй ссылку только в прежний платный чат — по ней может пройти любой, у кого она есть.</p>
      <View s={s}>{(d) => (
        <>
          <div className="block">
            <div className="money-hero" style={{ margin: '0 0 8px' }}><span>Активировали</span><b>{d.uses} из {d.maxUses}</b><em>{d.enabled ? `ссылка действует до ${d.expiresAt.split('-').reverse().join('.')} включительно` : 'ссылка выключена'}</em></div>
            {d.link && <div className="legacy-link">{d.link}</div>}
            {d.link && <button className="btn big" onClick={() => copy(d.link!)}><Copy size={18} />Скопировать ссылку</button>}
            <button className="btn big light" onClick={async () => { if (confirm('Создать новую ссылку? Старая сразу перестанет работать.') && await act(() => api('/admin-api/legacy/regenerate', { body: {} }))) s.reload(); }}><RefreshCw size={18} />Новая ссылка (старая перестанет работать)</button>
          </div>
          <div className="block form">
            <label className="f">Сколько человек могут активировать<input type="number" min={0} value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: Number(e.target.value) })} /></label>
            <label className="f">Действует до (включительно)<input type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></label>
            <label className="switch"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /><span>Ссылка включена</span></label>
            <button className="btn big" onClick={async () => { if (await act(() => api('/admin-api/legacy', { method: 'PUT', body: f }))) s.reload(); }}>Сохранить</button>
          </div>
          <h3>Кто перешёл</h3>
          {d.claims.length ? (
            <div className="list">{d.claims.map((c) => <a key={c.userId} className="user-row" href={`/admin/users/${c.userId}`}><div className="avatar">{c.name.slice(0, 1)}</div><div className="grow"><b>{c.name}</b><span>{c.username ? `@${c.username} · ` : ''}{dt(c.at)}</span></div></a>)}</div>
          ) : <div className="empty">Пока никто</div>}
        </>
      )}</View>
    </>
  );
}
