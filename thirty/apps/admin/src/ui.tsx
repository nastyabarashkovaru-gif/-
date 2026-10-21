import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(fn);
  ref.current = fn;
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    ref.current().then((x) => { setData(x); setLoading(false); }, (e) => { setError(e.message); setLoading(false); });
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { data, error, loading, reload };
}

export function View<T>({ s, children }: { s: { data: T | null; error: string | null; loading: boolean }; children: (d: T) => ReactNode }) {
  if (s.loading && !s.data) return <div className="muted">Загрузка…</div>;
  if (s.error) return <div className="err">{s.error}</div>;
  return <>{s.data && children(s.data)}</>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>{title}</h2><button className="btn light" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

/** Действие с обязательной причиной — для журнала аудита */
export async function withReason(label: string, fn: (reason: string) => Promise<unknown>) {
  const reason = prompt(`${label}\nУкажите причину (обязательно):`);
  if (!reason || reason.trim().length < 3) return false;
  try {
    await fn(reason.trim());
    return true;
  } catch (e) {
    alert((e as Error).message);
    return false;
  }
}

export async function act(fn: () => Promise<unknown>) {
  try {
    await fn();
    return true;
  } catch (e) {
    alert((e as Error).message);
    return false;
  }
}

export function Status({ v }: { v: string }) {
  const ok = ['paid', 'active', 'approved', 'accepted', 'sent', 'resolved', 'synced', 'charged', 'joined'];
  const err = ['failed', 'rejected', 'refunded', 'disputed', 'expired', 'revoked', 'past_due'];
  return <span className={`pill ${ok.includes(v) ? 'ok' : err.includes(v) ? 'err' : 'warn'}`}>{v}</span>;
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  return (
    <div className="row">
      <label className="f">С<input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} /></label>
      <label className="f">По<input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} /></label>
    </div>
  );
}

export function defaultRange() {
  const to = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  return { from, to };
}
