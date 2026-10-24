import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Headphones, ShoppingBasket, Target, TrendingUp, BookOpen } from 'lucide-react';
import { api } from '../../lib/api';
import { openExternal, openTelegram } from '../../lib/telegram';
import { ErrorState, Loading, Screen, toast, useLoad } from '../../ui';

interface Material { id: string; kind: string; title: string; text: string; icon: string; url: string }

const ICONS: Record<string, [typeof Target, string]> = {
  target: [Target, ''],
  basket: [ShoppingBasket, 'green'],
  trend: [TrendingUp, 'orange'],
  headphones: [Headphones, 'blue'],
};

/** «Полезные материалы»: библиотека для роста. Ссылки задаются в админке. */
export function Materials() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<{ items: Material[] }>('/api/public/materials'));
  const open = (m: Material) => {
    if (!m.url) return toast('Материал скоро появится');
    if (/^https:\/\/t\.me\//.test(m.url)) openTelegram(m.url);
    else openExternal(m.url);
  };
  return (
    <Screen id="S_MATERIALS">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <button className="icon-btn" aria-label="Назад" onClick={() => nav(-1)}><ArrowLeft size={18} /></button>
        <div className="grow">
          <h1 className="h2" style={{ fontSize: 21 }}>Полезные материалы</h1>
          <div className="muted small" style={{ marginTop: 2 }}>Твоя библиотека для роста 💜</div>
        </div>
      </div>
      <div className="panel" style={{ gap: 4, padding: 16 }}>
        <div style={{ color: 'var(--accent-ink)', fontWeight: 700, fontSize: 17 }}>Не знаешь, с чего начать?</div>
        <div className="muted" style={{ fontSize: 14 }}>Мы собрали материалы, которые помогут определиться с целью и быстрее двигаться к результату.</div>
      </div>
      {loading ? <Loading lines={2} /> : error ? <ErrorState error={error} retry={reload} /> : data!.items.map((m) => {
        const [Icon, c] = ICONS[m.icon] ?? [BookOpen, ''];
        return (
          <button key={m.id} className="card card-link" style={{ flexDirection: 'row', alignItems: 'center', textAlign: 'left', padding: 12, gap: 12 }} onClick={() => open(m)}>
            <span className={`ic sq ${c}`} style={{ width: 56, height: 56, borderRadius: 14 }}><Icon size={22} strokeWidth={1.8} /></span>
            <span className="grow">
              <span className="label" style={{ display: 'block' }}>{m.kind}</span>
              <span className="h3" style={{ display: 'block', margin: '2px 0 3px' }}>{m.title}</span>
              <span className="muted small" style={{ display: 'block' }}>{m.text}</span>
            </span>
            <ChevronRight size={18} color="var(--muted-2)" />
          </button>
        );
      })}
    </Screen>
  );
}
