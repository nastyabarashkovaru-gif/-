import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import { rub } from '../api';
import { Sheet } from '../ui';

/** Карта сообщений бота (ТЗ 14.11): карточки слева направо, линии с задержками, свободное перемещение и масштаб */

interface Btn { text: string; key: string; to?: string | null; clicks: number | null; pct: number | null; paid?: number | null; paidPct?: number | null; note?: string }
interface Node { key: string; col: number; row: number; title: string; preview: string; text: string; sent: number; buttons: Btn[]; note: string | null }
interface Edge { from: string; to: string; label: string; kind: 'auto' | 'button' }
export interface MapData { nodes: Node[]; edges: Edge[] }

const W = 280;
const GAP_X = 120;
const ROW_Y = [0, 560, 1060];
const ANCHOR = 34;
const VIEW_KEY = 'thirty.admin.mapView';
const fmt = (n: number) => n.toLocaleString('ru-RU');
const pctTxt = (p: number | null) => (p === null ? '' : ` (${String(p).replace('.', ',')}%)`);

export function FunnelMap({ data }: { data: MapData }) {
  const box = useRef<HTMLDivElement>(null);
  // Положение и масштаб карты помним: даже если страница перерисуется, карта остаётся там, где её оставили
  const [view, setViewRaw] = useState<{ x: number; y: number; k: number }>(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? '');
      if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.k)) return v;
    } catch {
      /* нет сохранённого — начало карты */
    }
    return { x: 24, y: 40, k: 0.8 };
  });
  const setView = (u: { x: number; y: number; k: number } | ((v: { x: number; y: number; k: number }) => { x: number; y: number; k: number })) =>
    setViewRaw((v) => {
      const next = typeof u === 'function' ? u(v) : u;
      try {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        /* без хранилища — просто не запоминаем */
      }
      return next;
    });
  const [open, setOpen] = useState<Node | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    // на телефоне — мельче, чтобы сразу было видно начало цепочки (только при первом открытии)
    let saved = false;
    try {
      saved = Boolean(sessionStorage.getItem(VIEW_KEY));
    } catch {
      /* нет хранилища */
    }
    if (!saved && box.current && box.current.clientWidth < 700) setView({ x: 12, y: 30, k: 0.55 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (n: Node) => ({ x: n.col * (W + GAP_X), y: ROW_Y[n.row] ?? n.row * 500 });
  const byKey = new Map(data.nodes.map((n) => [n.key, n]));
  const width = Math.max(...data.nodes.map((n) => pos(n).x + W)) + 80;
  const height = Math.max(...data.nodes.map((n) => pos(n).y)) + 560;

  const zoomAt = (k: number, cx: number, cy: number) =>
    setView((v) => {
      const nk = Math.min(1.8, Math.max(0.25, k));
      return { k: nk, x: cx - ((cx - v.x) / v.k) * nk, y: cy - ((cy - v.y) / v.k) * nk };
    });
  const onWheel = (e: React.WheelEvent) => {
    const r = box.current!.getBoundingClientRect();
    zoomAt(view.k * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX - r.left, e.clientY - r.top);
  };
  const onDown = (e: React.PointerEvent) => {
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    moved.current = false;
    if (pts.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      drag.current = null;
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      const r = box.current!.getBoundingClientRect();
      zoomAt((pinch.current.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      moved.current = true;
      return;
    }
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
      // значения берём сразу: палец могли уже отпустить, пока React применяет обновление
      const nx = d.vx + dx, ny = d.vy + dy;
      setView((v) => ({ ...v, x: nx, y: ny }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    if (!pts.current.size) drag.current = null;
  };

  const path = (e: Edge) => {
    const a = byKey.get(e.from), b = byKey.get(e.to);
    if (!a || !b) return null;
    const pa = pos(a), pb = pos(b);
    const x1 = pa.x + W, y1 = pa.y + ANCHOR, x2 = pb.x, y2 = pb.y + ANCHOR;
    // в другой ряд — из нижнего края карточки вниз и вправо
    if (pb.y !== pa.y) {
      const sx = pa.x + 40, sy = pa.y + 140;
      return { d: `M${sx},${sy} C${sx},${y2} ${sx},${y2} ${x2},${y2}`, lx: (sx + x2) / 2 + 10, ly: pb.y - 16 };
    }
    const mx = (x1 + x2) / 2;
    return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, lx: mx, ly: pa.y - 16 };
  };

  return (
    <div className="fm-map" ref={box} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="fm-zoom">
        <button onClick={() => zoomAt(view.k * 1.2, box.current!.clientWidth / 2, box.current!.clientHeight / 2)} aria-label="Приблизить"><Plus size={16} /></button>
        <button onClick={() => zoomAt(view.k / 1.2, box.current!.clientWidth / 2, box.current!.clientHeight / 2)} aria-label="Отдалить"><Minus size={16} /></button>
        <button onClick={() => setView({ x: box.current!.clientWidth < 700 ? 12 : 24, y: box.current!.clientWidth < 700 ? 30 : 40, k: box.current!.clientWidth < 700 ? 0.55 : 0.8 })} aria-label="К началу"><Maximize2 size={15} /></button>
      </div>
      <div className="fm-world" style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="fm-lines" width={width} height={height}>
          <defs><marker id="fm-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6f6a7d" /></marker></defs>
          {data.edges.map((e) => {
            const p = path(e);
            return p && <path key={`${e.from}-${e.to}`} d={p.d} className={`fm-line ${e.kind}`} markerEnd="url(#fm-arr)" />;
          })}
        </svg>
        {data.edges.map((e) => {
          const p = path(e);
          return p && <div key={`l-${e.from}-${e.to}`} className={`fm-edge-label ${e.kind}`} style={{ left: p.lx, top: p.ly }}>{e.label}</div>;
        })}
        {data.nodes.map((n) => {
          const p = pos(n);
          return (
            <div key={n.key} className="fm-card" style={{ left: p.x, top: p.y, width: W }}>
              <div className="fm-title">{n.title.replace(/^Цепочка\s*/, '')}</div>
              <button className="fm-preview" onClick={() => !moved.current && setOpen(n)}>«{n.preview || '…'}»</button>
              <div className="fm-sent">Отправлено: <b>{fmt(n.sent)}</b></div>
              {n.note && <div className="fm-note">{n.note}</div>}
              {n.buttons.map((b) => (
                <div key={b.key} className="fm-btn">
                  <div className="fm-btn-name">«{b.text}»{b.to === 'tariffs_pick' && n.key !== 'tariffs_pick' ? <span className="fm-to"> → Выбери свой тариф</span> : null}</div>
                  {b.clicks === null ? (
                    <div className="fm-na">Нет данных{b.note ? ` — ${b.note.toLowerCase()}` : ''}</div>
                  ) : !n.sent && !b.clicks ? (
                    <div className="fm-na">Нет данных</div>
                  ) : (
                    <div className="fm-click">Нажали: <b>{fmt(b.clicks)}</b>{pctTxt(b.pct)}</div>
                  )}
                  {b.paid !== null && b.paid !== undefined && b.clicks ? <div className="fm-paid">Оплатили: <b>{fmt(b.paid)}</b>{pctTxt(b.paidPct ?? null)}</div> : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open?.title ?? ''}>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{open?.text}</div>
      </Sheet>
    </div>
  );
}

export function MoneyCards({ m }: { m: { revenue: number; refunds: number; commission: number | null; noFeeData: number; profit: number; payments: number } }) {
  return (
    <div className="fm-money">
      <div className="fm-money-card">
        <span>Общая выручка</span>
        <b>{rub(m.revenue)}</b>
        <small>{fmt(m.payments)} {m.payments % 10 === 1 && m.payments % 100 !== 11 ? 'успешная оплата' : 'успешных оплат'}</small>
      </div>
      <div className="fm-money-card">
        <span>Прибыль</span>
        <div className="fm-row"><span>Выручка</span><span>{rub(m.revenue)}</span></div>
        <div className="fm-row"><span>Комиссия CloudPayments</span><span>{m.commission === null ? 'Нет данных' : `− ${rub(m.commission)}`}</span></div>
        {m.refunds > 0 && <div className="fm-row"><span>Возвраты</span><span>− {rub(m.refunds)}</span></div>}
        <b className="fm-profit">{rub(m.profit)}</b>
        {m.noFeeData > 0 && <small>По {fmt(m.noFeeData)} из {fmt(m.payments)} оплат CloudPayments не прислал комиссию — для них она не вычтена</small>}
      </div>
    </div>
  );
}
