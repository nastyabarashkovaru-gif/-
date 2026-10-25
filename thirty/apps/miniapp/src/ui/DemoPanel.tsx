import { useEffect, useState } from 'react';
import { api, demoKey, setDevUser } from '../lib/api';
import { Sheet, toast } from '.';

const SCENARIOS = [
  { id: 'fresh', title: 'С самого начала', text: 'Новый человек: приветствие, тарифы, оплата (тестовая), анкета' },
  { id: 'waiting', title: 'Ожидание старта', text: 'Оплачено, анкета заполнена, до старта 6 дней. В клубе ещё 6 участниц' },
  { id: 'active', title: 'Идёт челлендж — 13-й день', text: 'Отчёты за 12 дней, чат, прогресс, лидерборд. Сегодняшний отчёт ещё не сдан' },
] as const;

/** Панель демо-версии (только на демо-сервере и только по ссылке владельца) */
export function DemoPanel() {
  const [info, setInfo] = useState<{ demo: boolean; now: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!demoKey()) return;
    api<{ demo: boolean; now: string }>('/api/demo/info').then(setInfo).catch(() => undefined);
  }, [open]);
  if (!info?.demo) return null;

  const run = async (scenario: string) => {
    setBusy(true);
    try {
      const r = await api<{ userId: string; go: string }>('/api/demo/scenario', { body: { scenario } });
      setDevUser(r.userId);
      location.href = r.go;
    } catch {
      toast('Не получилось переключить сценарий');
      setBusy(false);
    }
  };
  const advance = async () => {
    setBusy(true);
    try {
      await api('/api/demo/advance', { body: {} });
      location.reload();
    } catch {
      toast('Не получилось перемотать время');
      setBusy(false);
    }
  };
  const now = new Date(info.now).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <button className="demo-fab" onClick={() => setOpen(true)}>Демо</button>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <div className="col" style={{ gap: 10 }}>
          <div className="h3">Демо-версия</div>
          <div className="muted small">Сейчас в демо: {now} (МСК). Данные здесь ненастоящие, оплата тестовая, сообщения в Telegram не отправляются.</div>
          {SCENARIOS.map((s) => (
            <button key={s.id} className="card card-link" style={{ textAlign: 'left', padding: 12, gap: 2 }} disabled={busy} onClick={() => run(s.id)}>
              <span className="h3" style={{ display: 'block' }}>{s.title}</span>
              <span className="muted small" style={{ display: 'block' }}>{s.text}</span>
            </button>
          ))}
          <button className="btn btn-primary" disabled={busy} onClick={advance}>Перемотать на следующий день ⏩</button>
          {busy && <div className="muted small" style={{ textAlign: 'center' }}>Готовлю данные… (до минуты)</div>}
        </div>
      </Sheet>
    </>
  );
}
