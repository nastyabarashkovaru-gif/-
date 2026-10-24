import { useNavigate } from 'react-router-dom';
import { Bell, HeartHandshake, MessageCircleReply, ClipboardCheck, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { Empty, ErrorState, Header, Loading, Screen, useLoad } from '../../ui';

interface Item { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string }

const ICON: Record<string, typeof Bell> = { buddy_report: HeartHandshake, chat_reply: MessageCircleReply, report_due: ClipboardCheck };

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** Уведомления: по реальным событиям; открытие отмечает прочитанным и ведёт к нужному месту */
export function Notifications() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<{ unread: number; items: Item[] }>('/api/notifications'));
  const open = async (n: Item) => {
    if (!n.read) await api(`/api/notifications/${n.id}/read`, { body: {} }).catch(() => undefined);
    if (n.link) nav(n.link);
    else reload();
  };
  return (
    <Screen id="S_NOTIFY" nav>
      <Header title="Уведомления" back />
      {loading && !data ? <Loading lines={2} /> : error || !data ? <ErrorState error={error} retry={reload} /> : data.items.length === 0 ? (
        <Empty icon={<Bell size={36} color="var(--accent)" />} title="Уведомлений пока нет" />
      ) : data.items.map((n) => {
        const I = ICON[n.kind] ?? Bell;
        return (
          <button key={n.id} className={`card card-link notif ${n.read ? '' : 'unread'}`} onClick={() => open(n)}>
            <span className="ic sq" style={{ width: 44, height: 44, borderRadius: 13 }}><I size={20} strokeWidth={1.8} /></span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="row between" style={{ gap: 8 }}><span className="h3" style={{ fontSize: 16 }}>{n.title}</span><span className="muted small nowrap">{when(n.createdAt)}</span></span>
              {n.body && <span className="muted small ellipsis" style={{ marginTop: 2 }}>{n.body}</span>}
            </span>
            {!n.read && <i className="notif-dot" />}
            <ChevronRight size={17} color="var(--muted-2)" />
          </button>
        );
      })}
    </Screen>
  );
}
