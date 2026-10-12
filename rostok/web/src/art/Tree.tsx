import { useId, useMemo } from 'react';
import type { SpeciesId } from '@rostok/shared';
import { PALETTES, WITHERED } from './palette';
import { rng } from './rng';

/**
 * Процедурное «clay»-дерево (SVG). Временный арт, пока не подключены финальные 3D-ассеты из asset manifest.
 * Вид неизменен; уровень добавляет рост, новые кластеры кроны, цветы и крупные украшения каждые 10 уровней.
 */
export interface TreeProps {
  species: SpeciesId;
  level: number;
  withered?: boolean;
  /** Плоская заливка — для затемнённого силуэта следующего сюрприза */
  silhouette?: boolean;
  size?: number;
  sway?: boolean;
  className?: string;
  title?: string;
}

const GROUND = 204;
const ease = (l: number, k: number) => 1 - Math.exp(-(l - 1) / k);

export function treeGeometry(species: SpeciesId, level: number, withered: boolean) {
  const pal = PALETTES[species];
  const L = Math.max(2, level);
  const H = 26 + 50 * ease(L, 10);
  let R = 30 + 44 * ease(L, 11);
  const trunkW = (7 + 9 * ease(L, 12)) * (withered ? 0.8 : 1);
  const sx = pal.shape === 'wide' ? 1.28 : pal.shape === 'tall' ? 0.86 : pal.shape === 'cloud' ? 1.16 : 1;
  const sy = pal.shape === 'tall' ? 1.22 : pal.shape === 'wide' ? 0.84 : 1;
  if (withered) R *= 0.86;
  const cx = 100;
  const cy = GROUND - H - R * 0.5 * sy;
  const r = rng(`crown:${species}`);
  const slots = Array.from({ length: 16 }, (_, i) => {
    const a = i === 0 ? -Math.PI / 2 : (i * 2.39996 + r() * 0.6) % (Math.PI * 2);
    const d = i === 0 ? 0 : 0.45 + 0.55 * Math.sqrt(i / 16) + r() * 0.12;
    return { a, d, k: 0.44 + r() * 0.16, back: Math.sin(a) < -0.2, tone: r() > 0.55 ? 2 : 1 };
  });
  const count = Math.min(16, 5 + Math.floor((L - 1) * 0.7));
  const blobs = slots.slice(0, count).map((s) => ({
    x: cx + Math.cos(s.a) * R * 0.62 * s.d * sx,
    y: cy + Math.sin(s.a) * R * 0.5 * s.d * sy,
    r: R * s.k * (withered ? 0.74 : 1) * (0.9 + 0.1 * Math.min(1, L / 8)),
    back: s.back,
    tone: s.tone,
  }));
  return { pal, L, H, R, trunkW, sx, sy, cx, cy, blobs };
}

export function Tree({ species, level, withered = false, silhouette = false, size = 160, sway = false, className, title }: TreeProps) {
  const uid = useId().replace(/:/g, '');
  const g = useMemo(() => treeGeometry(species, level, withered), [species, level, withered]);
  const pal = g.pal;
  const crown = withered ? WITHERED.crown : pal.crown;
  const crown2 = withered ? WITHERED.crown2 : pal.crown2;
  const trunk = withered ? WITHERED.trunk : pal.trunk;
  const mono = silhouette ? '#26342C' : null;
  const fill = (id: string) => (mono ? mono : `url(#${id}-${uid})`);
  const h = (size * 220) / 200;

  if (level <= 1) return <Sprout size={size} species={species} withered={withered} silhouette={silhouette} className={className} title={title} sway={sway} />;

  const { cx, cy, R, trunkW, blobs, L } = g;
  const topY = cy + R * 0.25;
  const trunkPath = `M ${cx - trunkW * 1.35} ${GROUND} Q ${cx - trunkW * 0.7} ${GROUND - 4}, ${cx - trunkW * 0.62} ${GROUND - 16} C ${cx - trunkW * 0.5} ${topY + 20}, ${cx - trunkW * 0.42} ${topY + 8}, ${cx - trunkW * 0.38} ${topY}
    L ${cx + trunkW * 0.38} ${topY} C ${cx + trunkW * 0.42} ${topY + 8}, ${cx + trunkW * 0.5} ${topY + 20}, ${cx + trunkW * 0.62} ${GROUND - 16} Q ${cx + trunkW * 0.7} ${GROUND - 4}, ${cx + trunkW * 1.35} ${GROUND} Z`;
  const branches = L >= 4 ? blobs.slice(1, Math.min(blobs.length, 2 + Math.floor(L / 6))) : [];

  const fr = rng(`flowers:${species}`);
  const flowerCount = withered ? 0 : Math.min(42, Math.max(0, Math.floor((L - 2) * 1.6)));
  const flowers = Array.from({ length: 42 }, () => {
    const a = fr() * Math.PI * 2;
    const d = Math.sqrt(fr()) * 0.92;
    return { x: cx + Math.cos(a) * R * 0.95 * d * g.sx, y: cy + Math.sin(a) * R * 0.72 * d * g.sy, s: 0.8 + fr() * 0.5, rot: fr() * 72 };
  }).slice(0, flowerCount);
  const strands = pal.shape === 'droop' ? Math.min(14, 3 + Math.floor(L * 0.6)) : 0;

  return (
    <svg viewBox="0 0 200 220" width={size} height={h} className={className} role="img" aria-label={title} style={{ overflow: 'visible' }}>
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={`c1-${uid}`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={crown.hi} />
          <stop offset="55%" stopColor={crown.base} />
          <stop offset="100%" stopColor={crown.shade} />
        </radialGradient>
        <radialGradient id={`c2-${uid}`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={crown2.hi} />
          <stop offset="55%" stopColor={crown2.base} />
          <stop offset="100%" stopColor={crown2.shade} />
        </radialGradient>
        <linearGradient id={`t-${uid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={trunk.hi} />
          <stop offset="60%" stopColor={trunk.base} />
          <stop offset="100%" stopColor={trunk.shade} />
        </linearGradient>
        <radialGradient id={`glow-${uid}`}>
          <stop offset="0%" stopColor="#FFF6C9" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFF6C9" stopOpacity="0" />
        </radialGradient>
      </defs>

      {!silhouette && <ellipse cx={cx} cy={GROUND + 3} rx={20 + R * 0.75} ry={6 + R * 0.09} fill="#276B48" opacity="0.13" />}
      {!silhouette && (
        <g>
          <ellipse cx={cx} cy={GROUND} rx={trunkW * 2.6 + 6} ry={5.5} fill={withered ? '#B7A48E' : '#7DBF7F'} />
          <ellipse cx={cx - 2} cy={GROUND - 1.2} rx={trunkW * 2.2 + 4} ry={3.6} fill={withered ? '#CDBDA8' : '#A6DA98'} />
        </g>
      )}
      {!silhouette && L >= 40 && !withered && <circle cx={cx} cy={cy} r={R * 1.5} fill={`url(#glow-${uid})`} />}

      <g className={sway ? 'tree-sway' : undefined} style={{ transformOrigin: `${cx}px ${GROUND}px` }}>
        <path d={trunkPath} fill={fill('t')} />
        {!mono && <path d={`M ${cx - trunkW * 0.55} ${GROUND - 6} C ${cx - trunkW * 0.4} ${GROUND - 30}, ${cx - trunkW * 0.3} ${topY + 30}, ${cx - trunkW * 0.2} ${topY + 6}`} stroke={trunk.hi} strokeWidth={Math.max(1.2, trunkW * 0.22)} strokeLinecap="round" fill="none" opacity="0.6" />}
        {branches.map((b, i) => (
          <path key={i} d={`M ${cx} ${topY + 8} Q ${(cx + b.x) / 2} ${topY - 4} ${b.x} ${b.y + b.r * 0.2}`} stroke={mono ?? trunk.base} strokeWidth={Math.max(2, trunkW * 0.45)} strokeLinecap="round" fill="none" />
        ))}
        {!mono && <ellipse cx={cx} cy={topY + 6} rx={trunkW * 0.7} ry={5} fill="#3B2A20" opacity="0.18" />}
        {/* масса кроны */}
        <ellipse cx={cx} cy={cy + R * 0.08} rx={R * 0.9 * g.sx * (withered ? 0.8 : 1)} ry={R * 0.62 * g.sy * (withered ? 0.8 : 1)} fill={mono ?? crown.shade} opacity={withered ? 0.55 : 1} />
        {blobs.filter((b) => b.back).map((b, i) => <circle key={`b${i}`} cx={b.x} cy={b.y} r={b.r} fill={fill(b.tone === 2 ? 'c2' : 'c1')} />)}
        {blobs.filter((b) => !b.back).map((b, i) => <circle key={`f${i}`} cx={b.x} cy={b.y} r={b.r} fill={fill(b.tone === 2 ? 'c2' : 'c1')} />)}
        {!mono && <ellipse cx={cx + R * 0.1} cy={cy + R * 0.42 * g.sy} rx={R * 0.75 * g.sx} ry={R * 0.16} fill={crown.shade} opacity={0.35} />}
        {!mono && blobs.slice(0, 6).map((b, i) => (
          <ellipse key={`h${i}`} cx={b.x - b.r * 0.32} cy={b.y - b.r * 0.42} rx={b.r * 0.32} ry={b.r * 0.18} fill="#FFFFFF" opacity={withered ? 0.18 : 0.35} transform={`rotate(-25 ${b.x - b.r * 0.32} ${b.y - b.r * 0.42})`} />
        ))}
        {Array.from({ length: strands }, (_, i) => {
          const t = (i + 0.5) / strands;
          const x = cx + (t - 0.5) * R * 1.7;
          const y0 = cy + R * 0.25 + Math.sin(t * Math.PI) * R * 0.25;
          const len = R * (0.45 + 0.3 * Math.sin(t * Math.PI * 3 + 1)) * (withered ? 0.7 : 1);
          return <path key={`s${i}`} d={`M ${x} ${y0} q ${4 - t * 8} ${len * 0.5} ${2 - t * 4} ${len}`} stroke={mono ?? crown.shade} strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.9} />;
        })}
        {!mono && flowers.map((f, i) => <Accent key={i} species={species} x={f.x} y={f.y} s={f.s} rot={f.rot} />)}
        {!mono && withered && <FallingLeaves cx={cx} cy={cy} R={R} />}
        {/* крупные изменения каждые 10 уровней */}
        {L >= 10 && <Swing x={cx - R * 0.55 * g.sx} y={cy + R * 0.35} mono={mono} />}
        {L >= 20 && <Lanterns cx={cx} cy={cy} R={R} sx={g.sx} mono={mono} />}
        {L >= 50 && <Star x={cx} y={cy - R * 0.62 * g.sy - 10} mono={mono} />}
      </g>
      {L >= 30 && !mono && !withered && <Butterflies cx={cx} cy={cy} R={R} />}
    </svg>
  );
}

function Accent({ species, x, y, s, rot }: { species: SpeciesId; x: number; y: number; s: number; rot: number }) {
  const p = PALETTES[species];
  if (species === 'sakura' || species === 'blossom') {
    return (
      <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
        {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx={0} cy={-2.6} rx={1.9} ry={2.6} fill={p.accent} transform={`rotate(${a})`} />)}
        <circle r={1.3} fill={p.accent2} />
      </g>
    );
  }
  if (species === 'golden') {
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <circle r={3} fill={p.accent} />
        <circle r={3} fill="none" stroke="#C99A22" strokeWidth={0.7} />
        <ellipse cx={-1} cy={-1.1} rx={1.1} ry={0.7} fill={p.accent2} />
      </g>
    );
  }
  if (species === 'oak') {
    return (
      <g transform={`translate(${x} ${y}) scale(${s * 0.9})`}>
        <ellipse cy={1.4} rx={2.4} ry={3} fill={p.accent} />
        <path d="M -2.8 -0.4 Q 0 -3.6 2.8 -0.4 Z" fill="#7A5432" />
      </g>
    );
  }
  if (species === 'lush') {
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <circle r={2.8} fill={p.accent} />
        <ellipse cx={-0.9} cy={-1} rx={0.9} ry={0.6} fill="#FFFFFF" opacity={0.8} />
      </g>
    );
  }
  return (
    <g transform={`translate(${x} ${y}) rotate(45) scale(${s})`}>
      <rect x={-1.6} y={-1.6} width={3.2} height={3.2} rx={0.8} fill={p.accent} />
      <circle r={0.8} fill="#FFFFFF" />
    </g>
  );
}

function FallingLeaves({ cx, cy, R }: { cx: number; cy: number; R: number }) {
  return (
    <g fill="#B49A7E" opacity="0.85">
      <ellipse cx={cx + R * 0.9} cy={cy + R * 0.9} rx={3} ry={1.6} transform={`rotate(30 ${cx + R * 0.9} ${cy + R * 0.9})`} />
      <ellipse cx={cx - R * 0.8} cy={cy + R * 1.2} rx={3} ry={1.6} transform={`rotate(-20 ${cx - R * 0.8} ${cy + R * 1.2})`} />
      <ellipse cx={cx + R * 0.3} cy={cy + R * 1.5} rx={2.6} ry={1.4} />
    </g>
  );
}

function Swing({ x, y, mono }: { x: number; y: number; mono: string | null }) {
  return (
    <g>
      <line x1={x - 5} y1={y - 10} x2={x - 6} y2={y + 26} stroke={mono ?? '#B98F70'} strokeWidth={1.2} />
      <line x1={x + 5} y1={y - 10} x2={x + 6} y2={y + 26} stroke={mono ?? '#B98F70'} strokeWidth={1.2} />
      <rect x={x - 9} y={y + 25} width={18} height={4} rx={2} fill={mono ?? '#F6C6D8'} />
    </g>
  );
}

function Lanterns({ cx, cy, R, sx, mono }: { cx: number; cy: number; R: number; sx: number; mono: string | null }) {
  const pts = [-0.6, -0.2, 0.2, 0.6].map((t) => ({ x: cx + t * R * 1.3 * sx, y: cy + R * 0.2 + Math.abs(t) * -10 + 8 }));
  return (
    <g>
      <path d={`M ${pts[0].x - 10} ${pts[0].y - 10} Q ${cx} ${cy + R * 0.45} ${pts[3].x + 10} ${pts[3].y - 10}`} stroke={mono ?? '#8E6656'} strokeWidth={0.8} fill="none" />
      {pts.map((p, i) => (
        <g key={i}>
          {!mono && <circle cx={p.x} cy={p.y + 3} r={6} fill="#FFE9A8" opacity={0.45} />}
          <rect x={p.x - 2.6} y={p.y} width={5.2} height={6.5} rx={2.4} fill={mono ?? (i % 2 ? '#F6C6D8' : '#FFE08A')} />
        </g>
      ))}
    </g>
  );
}

function Star({ x, y, mono }: { x: number; y: number; mono: string | null }) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 3.2 : 7.5;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${x + Math.cos(a) * r},${y + Math.sin(a) * r}`;
  }).join(' ');
  return <polygon points={pts} fill={mono ?? '#FFD45E'} stroke={mono ? 'none' : '#F0B73A'} strokeWidth={0.8} strokeLinejoin="round" />;
}

function Butterflies({ cx, cy, R }: { cx: number; cy: number; R: number }) {
  const b = (x: number, y: number, c: string, d: number) => (
    <g transform={`translate(${x} ${y})`} className="butterfly" style={{ animationDelay: `${d}s` }}>
      <ellipse cx={-2.6} cy={0} rx={2.8} ry={2} fill={c} />
      <ellipse cx={2.6} cy={0} rx={2.8} ry={2} fill={c} />
      <rect x={-0.4} y={-2} width={0.8} height={4} rx={0.4} fill="#6B5A57" />
    </g>
  );
  return (
    <g>
      {b(cx + R * 1.05, cy - R * 0.3, '#F6C6D8', 0)}
      {b(cx - R * 1.0, cy - R * 0.55, '#B9E3F6', 1.2)}
    </g>
  );
}

/** Росток (уровень 1) — та же графика, что на splash и в иконке Mini App. */
export function Sprout({ size = 120, species, withered, silhouette, className, title, sway = true }: { size?: number; species?: SpeciesId; withered?: boolean; silhouette?: boolean; className?: string; title?: string; sway?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const mono = silhouette ? '#26342C' : null;
  const leaf = withered ? WITHERED.crown : { hi: '#D9F3C6', base: '#8FD08A', shade: '#4E9E5E' };
  const bud = species && !withered ? PALETTES[species].accent2 : null;
  return (
    <svg viewBox="0 0 200 220" width={size} height={(size * 220) / 200} className={className} role="img" aria-label={title ?? 'Росток'} style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id={`sl-${uid}`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor={leaf.hi} />
          <stop offset="55%" stopColor={leaf.base} />
          <stop offset="100%" stopColor={leaf.shade} />
        </radialGradient>
        <radialGradient id={`ss-${uid}`} cx="40%" cy="25%" r="80%">
          <stop offset="0%" stopColor="#D9B79A" />
          <stop offset="60%" stopColor="#B88A68" />
          <stop offset="100%" stopColor="#8E6649" />
        </radialGradient>
      </defs>
      {!mono && <ellipse cx="100" cy="206" rx="46" ry="7" fill="#276B48" opacity="0.12" />}
      <ellipse cx="100" cy="196" rx="40" ry="14" fill={mono ?? `url(#ss-${uid})`} />
      {!mono && <ellipse cx="88" cy="190" rx="14" ry="4" fill="#FFFFFF" opacity="0.25" />}
      <g className={sway ? 'tree-sway' : undefined} style={{ transformOrigin: '100px 192px' }}>
        <path d="M 100 192 C 98 170, 104 152, 100 128" stroke={mono ?? (withered ? '#94806B' : '#5FAF6A')} strokeWidth="7" strokeLinecap="round" fill="none" />
        <path d="M 100 140 C 78 112, 46 118, 40 132 C 56 152, 86 152, 100 140 Z" fill={mono ?? `url(#sl-${uid})`} />
        <path d="M 100 132 C 118 100, 154 96, 164 110 C 152 136, 118 144, 100 132 Z" fill={mono ?? `url(#sl-${uid})`} />
        {!mono && <path d="M 58 130 C 70 126, 84 130, 96 138" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="2.4" strokeLinecap="round" fill="none" />}
        {!mono && <path d="M 148 110 C 134 112, 118 120, 106 130" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="2.4" strokeLinecap="round" fill="none" />}
        {bud && <circle cx="100" cy="124" r="6" fill={bud} />}
      </g>
    </svg>
  );
}
