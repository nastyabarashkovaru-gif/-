import type { SVGProps } from 'react';
import type { SphereId } from '@rostok/shared';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 20, ...p }: P) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const IconPlus = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const IconCheck = (p: P) => <svg {...base(p)}><path d="M5 12.5l4.2 4.2L19 7" /></svg>;
export const IconClose = (p: P) => <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IconChevron = (p: P) => <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>;
export const IconBack = (p: P) => <svg {...base(p)}><path d="M15 6l-6 6 6 6" /></svg>;
export const IconList = (p: P) => <svg {...base(p)}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" /><circle cx="4.5" cy="12" r="1.2" /><circle cx="4.5" cy="18" r="1.2" /></svg>;
export const IconUser = (p: P) => <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 20c1.6-3.6 4.6-5.4 8-5.4s6.4 1.8 8 5.4" /></svg>;
export const IconSettings = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
export const IconGift = (p: P) => <svg {...base(p)}><rect x="3.5" y="8" width="17" height="4.5" rx="1.2" /><path d="M5 12.5V20h14v-7.5M12 8v12M12 8c-1.5-3.5-6-3.5-5 0M12 8c1.5-3.5 6-3.5 5 0" /></svg>;
export const IconLock = (p: P) => <svg {...base(p)}><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const IconUsers = (p: P) => <svg {...base(p)}><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20c1.2-3.2 3.7-4.8 6.5-4.8s5.3 1.6 6.5 4.8" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 15.6c1.6.6 2.8 2 3.5 4.4" /></svg>;
export const IconSupport = (p: P) => <svg {...base(p)}><path d="M21 12a9 9 0 1 1-3.6-7.2" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" /></svg>;
export const IconFlame = (p: P) => <svg {...base(p)}><path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.5 2.7-5.3 3.9-8.8 2.6 1.6 3.4 3.7 3.2 5.4 1-.7 1.6-1.9 1.7-3 2 1.6 4.2 4 4.2 6.6C18.5 18.4 15.9 21 12 21z" /></svg>;
export const IconTrash = (p: P) => <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" /></svg>;
export const IconEdit = (p: P) => <svg {...base(p)}><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>;
export const IconClock = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
export const IconShare = (p: P) => <svg {...base(p)}><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" /><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" /></svg>;

/** Капля воды — единственная игровая единица. */
export function Drop({ size = 16, className, muted }: { size?: number; className?: string; muted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="drop-g" cx="38%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#E7F7FE" />
          <stop offset="55%" stopColor="#7BCBF0" />
          <stop offset="100%" stopColor="#3B9FD0" />
        </radialGradient>
      </defs>
      <path d="M12 2.5c3.6 4.6 6.5 8.2 6.5 11.8a6.5 6.5 0 0 1-13 0C5.5 10.7 8.4 7.1 12 2.5z" fill={muted ? '#C9D3CD' : 'url(#drop-g)'} />
      {!muted && <ellipse cx="9.4" cy="14" rx="1.6" ry="2.6" fill="#FFFFFF" opacity="0.7" transform="rotate(20 9.4 14)" />}
    </svg>
  );
}

/** Векторные иконки сфер (не emoji). */
export function SphereIcon({ sphere, size = 18, className }: { sphere: SphereId | string; size?: number; className?: string }) {
  const p = base({ size, className });
  switch (sphere) {
    case 'relationships': return <svg {...p}><path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" /></svg>;
    case 'savings': return <svg {...p}><ellipse cx="12" cy="7" rx="6.5" ry="2.8" /><path d="M5.5 7v5c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8V7M5.5 12v5c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-5" /></svg>;
    case 'work': return <svg {...p}><rect x="3.5" y="7.5" width="17" height="12" rx="2.5" /><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17" /></svg>;
    case 'creativity': return <svg {...p}><path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.1-.9-1.4-.9-2.4 0-.9.8-1.6 1.7-1.6h2.1a3.8 3.8 0 0 0 3.8-3.8c0-4.2-3.8-7.5-8.5-7.5z" /><circle cx="8" cy="11" r="1" /><circle cx="11" cy="7.5" r="1" /><circle cx="15.5" cy="8.5" r="1" /></svg>;
    case 'health': return <svg {...p}><path d="M5 19c0-8 5-13 14-14-.5 9-5.5 14-14 14z" /><path d="M5 19l7-7" /></svg>;
    case 'study': return <svg {...p}><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" /></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="8" /></svg>;
  }
}

export function WateringCan({ size = 80, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="can-g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#FFD9E7" />
          <stop offset="100%" stopColor="#E98CB2" />
        </linearGradient>
      </defs>
      <path d="M58 44 L88 28 L92 33 L64 54 Z" fill="#E98CB2" />
      <ellipse cx="90" cy="30" rx="5" ry="3" fill="#D6709B" transform="rotate(-30 90 30)" />
      <path d="M22 40 Q 22 32 30 32 L 56 32 Q 64 32 64 40 L 62 72 Q 61 80 53 80 L 33 80 Q 25 80 24 72 Z" fill="url(#can-g)" />
      <path d="M30 32 Q 43 14 56 32" stroke="#E98CB2" strokeWidth="5" fill="none" strokeLinecap="round" />
      <ellipse cx="34" cy="48" rx="4" ry="10" fill="#FFFFFF" opacity="0.5" />
    </svg>
  );
}
