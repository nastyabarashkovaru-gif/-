import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Числа и проценты по-русски: 1 250, 78,4% */
export const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('ru-RU'));
export const pctf = (p: number | null | undefined, digits = 1) => (p === null || p === undefined ? '—' : `${p.toLocaleString('ru-RU', { maximumFractionDigits: digits })}%`);
export const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
export const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const monthLabel = (iso: string, long = false) => (long ? new Date(`${iso.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`);

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Плавная линия (Catmull-Rom → кубические Безье), пропуски данных разрывают линию */
function smoothPath(pts: ([number, number] | null)[]) {
  let d = '';
  let seg: [number, number][] = [];
  const flush = () => {
    if (!seg.length) return;
    d += `M${seg[0][0]},${seg[0][1]}`;
    for (let i = 0; i < seg.length - 1; i++) {
      const p0 = seg[i - 1] ?? seg[i], p1 = seg[i], p2 = seg[i + 1], p3 = seg[i + 2] ?? p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
    }
    seg = [];
  };
  for (const p of pts) (p ? seg.push(p) : flush());
  flush();
  return d;
}

export interface Series { key: string; name: string; color: string; values: (number | null)[]; dashed?: boolean }

/** Линейный график: касание или ведение пальцем показывает дату и значения */
export function LineChart({ labels, series, format = num, height = 190, tooltipLabels }: { labels: string[]; series: Series[]; format?: (v: number | null) => string; height?: number; tooltipLabels?: (i: number) => string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => setActive(null), [labels.length, series.length]);
  const L = 40, R = 10, T = 14, B = 26;
  const iw = w - L - R, ih = height - T - B;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = niceMax(Math.max(0, ...all));
  const x = (i: number) => L + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v: number) => T + ih - (v / max) * ih;
  const pick = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const rel = clientX - rect.left - L;
    const i = labels.length <= 1 ? 0 : Math.round((rel / iw) * (labels.length - 1));
    setActive(Math.min(labels.length - 1, Math.max(0, i)));
  };
  const ticks = Math.min(5, labels.length);
  const tickIdx = ticks <= 1 ? [0] : Array.from({ length: ticks }, (_, k) => Math.round((k * (labels.length - 1)) / (ticks - 1)));
  const empty = !all.some((v) => v > 0);
  return (
    <div className="chart" ref={ref}>
      <svg width={w} height={height} onPointerDown={(e) => pick(e.clientX)} onPointerMove={(e) => (e.buttons || e.pointerType === 'mouse' ? pick(e.clientX) : undefined)} style={{ touchAction: 'pan-y' }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity=".22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line x1={L} x2={w - R} y1={y(max * k)} y2={y(max * k)} className="grid" />
            <text x={L - 6} y={y(max * k) + 4} textAnchor="end" className="axis">{format(max * k).replace(/\s?₽$/, '')}</text>
          </g>
        ))}
        {tickIdx.map((i) => <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'} className="axis">{shortDate(labels[i])}</text>)}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => (v === null ? null : ([x(i), y(v)] as [number, number])));
          const line = smoothPath(pts);
          const first = pts.findIndex(Boolean), last = pts.length - 1 - [...pts].reverse().findIndex(Boolean);
          const area = si === 0 && !s.dashed && first >= 0 && pts.every(Boolean) ? `${line} L${x(last)},${T + ih} L${x(first)},${T + ih} Z` : null;
          return (
            <g key={s.key}>
              {area && <path d={area} fill={`url(#g-${s.key})`} className="draw-fade" />}
              <path d={line} fill="none" stroke={s.color} strokeWidth={s.dashed ? 2 : 2.6} strokeDasharray={s.dashed ? '5 5' : undefined} strokeLinecap="round" opacity={s.dashed ? 0.7 : 1} className="draw" />
              {labels.length <= 14 && !s.dashed && pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={2.6} fill="#fff" stroke={s.color} strokeWidth={2} />)}
            </g>
          );
        })}
        {active !== null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={T} y2={T + ih} className="guide" />
            {series.map((s) => s.values[active] !== null && <circle key={s.key} cx={x(active)} cy={y(s.values[active]!)} r={5} fill={s.color} stroke="#fff" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {empty && <div className="chart-empty">Нет данных за этот период</div>}
      {active !== null && (
        <div className="tip" style={{ left: Math.min(Math.max(x(active), 80), w - 80) }}>
          <b>{tooltipLabels ? tooltipLabels(active) : longDate(labels[active])}</b>
          {series.map((s) => <span key={s.key}><i style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }} />{s.name}: <b>{format(s.values[active])}</b></span>)}
        </div>
      )}
    </div>
  );
}

/** Столбики (динамика по месяцам) с подсказкой по касанию */
export function Bars({ labels, values, format = pctf, color = 'var(--accent)', height = 150, hint }: { labels: string[]; values: (number | null)[]; format?: (v: number | null) => string; color?: string; height?: number; hint?: (i: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...values.map((v) => v ?? 0)));
  return (
    <div className="bars" style={{ height }}>
      {values.map((v, i) => (
        <button key={labels[i]} className={`bar-col${active === i ? ' on' : ''}`} onClick={() => setActive(active === i ? null : i)}>
          <span className="bar-val">{active === i || values.length <= 6 ? format(v) : ''}</span>
          <span className="bar-track"><span className="bar-fill" style={{ height: `${((v ?? 0) / max) * 100}%`, background: color }} /></span>
          <span className="bar-lbl">{labels[i]}</span>
          {active === i && hint && <span className="bar-tip">{hint(i)}</span>}
        </button>
      ))}
    </div>
  );
}

export interface Slice { key: string; label: string; value: number; color: string }

/** Кольцевая диаграмма: касание сектора выделяет его */
export function Donut({ items, center, selected, onSelect, size = 180 }: { items: Slice[]; center: ReactNode; selected?: string | null; onSelect?: (k: string | null) => void; size?: number }) {
  const total = items.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - 18, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={22} />
        {total > 0 && items.map((s) => {
          const len = (s.value / total) * c;
          const gap = items.filter((x) => x.value > 0).length > 1 ? Math.min(3, len / 3) : 0;
          const el = (
            <circle
              key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
              strokeWidth={selected === s.key ? 30 : 22} strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-acc}
              transform={`rotate(-90 ${size / 2} ${size / 2})`} opacity={selected && selected !== s.key ? 0.35 : 1}
              style={{ cursor: 'pointer', transition: 'all .25s' }} onClick={() => onSelect?.(selected === s.key ? null : s.key)}
            />
          );
          acc += len;
          return el;
        })}
      </svg>
      <div className="donut-center">{center}</div>
    </div>
  );
}

/** Изменение к прошлому периоду: ↑ +18% (зелёный) / ↓ −5% (красный) */
export function Delta({ v, unit = '%', suffix = 'к прошлому периоду', invert = false }: { v: number | null | undefined; unit?: string; suffix?: string; invert?: boolean }) {
  if (v === null || v === undefined) return <span className="delta none">нет данных за прошлый период</span>;
  const good = invert ? v < 0 : v > 0;
  const cls = v === 0 ? 'flat' : good ? 'up' : 'down';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return <span className={`delta ${cls}`}>{v > 0 ? '↑' : v < 0 ? '↓' : '→'} {sign}{Math.abs(v).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}{unit} {suffix}</span>;
}
