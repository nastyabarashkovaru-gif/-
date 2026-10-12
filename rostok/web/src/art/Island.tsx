import { useId } from 'react';

/** Изометрический остров. Декор открывается на общих порогах уровня сада (без отдельной валюты). */
export function Island({ decor = [], className }: { decor?: string[]; className?: string }) {
  const u = useId().replace(/:/g, '');
  const has = (d: string) => decor.includes(d);
  return (
    <svg viewBox="0 40 400 300" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`side-${u}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#E9C9B0" />
          <stop offset="55%" stopColor="#D9AE93" />
          <stop offset="100%" stopColor="#C8977C" />
        </linearGradient>
        <radialGradient id={`top-${u}`} cx="42%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#D6F0CC" />
          <stop offset="60%" stopColor="#A9DB9E" />
          <stop offset="100%" stopColor="#86C789" />
        </radialGradient>
        <radialGradient id={`pond-${u}`} cx="40%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#E3F6FD" />
          <stop offset="70%" stopColor="#A6DDF4" />
          <stop offset="100%" stopColor="#7BCBF0" />
        </radialGradient>
      </defs>
      <ellipse cx="200" cy="300" rx="150" ry="26" fill="#276B48" opacity="0.08" />
      {/* бока острова: слои глины */}
      <path d="M 18 196 C 18 262, 382 262, 382 196 L 380 222 C 370 300, 250 322, 200 322 C 150 322, 30 300, 20 222 Z" fill={`url(#side-${u})`} />
      <path d="M 26 226 C 90 282, 310 282, 374 226" stroke="#F3DCCB" strokeWidth="3" fill="none" opacity="0.7" />
      <path d="M 60 262 C 140 304, 260 304, 340 262" stroke="#C08B70" strokeWidth="2" fill="none" opacity="0.3" />
      <path d="M 150 316 C 180 324, 220 324, 250 316" stroke="#B98066" strokeWidth="2" fill="none" opacity="0.3" />
      {/* верх острова */}
      <ellipse cx="200" cy="196" rx="182" ry="104" fill="#76BC84" />
      <ellipse cx="200" cy="192" rx="180" ry="100" fill={`url(#top-${u})`} />
      <path d="M 70 140 C 120 108, 200 98, 260 104" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* травинки */}
      {[[52, 214, 1], [342, 206, 0.8], [118, 272, 0.9], [292, 270, 1], [206, 112, 0.7], [352, 160, 0.7]].map(([x, y, k], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${k})`}>
          <ellipse cx="0" cy="2" rx="13" ry="3" fill="#5E9F68" opacity="0.25" />
          <circle cx="-6" cy="-3" r="6" fill="#86C98A" />
          <circle cx="5" cy="-4" r="7" fill="#9AD69A" />
          <circle cx="0" cy="-7" r="6" fill="#B3E3AA" />
          <ellipse cx="-1" cy="-10" rx="3" ry="1.6" fill="#FFFFFF" opacity="0.5" />
        </g>
      ))}
      {has('pond') && (
        <g>
          <ellipse cx="200" cy="200" rx="40" ry="17" fill="#6FB8A0" opacity="0.4" />
          <ellipse cx="200" cy="197" rx="37" ry="15" fill={`url(#pond-${u})`} />
          <ellipse cx="188" cy="192" rx="12" ry="3" fill="#FFFFFF" opacity="0.7" />
          <ellipse cx="216" cy="203" rx="7" ry="3" fill="#8CD17D" />
        </g>
      )}
      {has('stones') && (
        <g fill="#EDEAE3" stroke="#D6D0C4" strokeWidth="1.2">
          {[[200, 258], [214, 240], [192, 226], [226, 280]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="10" ry="5" />)}
        </g>
      )}
      {has('flowers') && (
        <g>
          {[[78, 176, '#F6C6D8'], [96, 250, '#FFFFFF'], [312, 248, '#F6C6D8'], [336, 176, '#FFE08A'], [146, 286, '#FFE08A'], [258, 120, '#FFFFFF']].map(([x, y, c], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-3.2" rx="2.4" ry="3.2" fill={c as string} transform={`rotate(${a})`} />)}
              <circle r="1.8" fill="#F2B53A" />
            </g>
          ))}
        </g>
      )}
      {has('mushrooms') && (
        <g>
          {[[112, 230], [124, 236]].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y}) scale(${i ? 0.8 : 1})`}>
              <rect x="-2.5" y="-8" width="5" height="9" rx="2" fill="#FFF6EC" />
              <path d="M -9 -7 Q 0 -19 9 -7 Z" fill="#E98CB2" />
              <circle cx="-3" cy="-11" r="1.4" fill="#FFFFFF" />
              <circle cx="3" cy="-9" r="1.1" fill="#FFFFFF" />
            </g>
          ))}
        </g>
      )}
      {has('lanterns') && (
        <g>
          {[[150, 150], [254, 150]].map(([x, y], i) => (
            <g key={i}>
              <rect x={x - 1.5} y={y - 26} width="3" height="28" rx="1.5" fill="#B48A7A" />
              <circle cx={x} cy={y - 28} r="9" fill="#FFE9A8" opacity="0.5" />
              <rect x={x - 4} y={y - 33} width="8" height="10" rx="3" fill="#FFE08A" />
            </g>
          ))}
        </g>
      )}
      {has('bench') && (
        <g transform="translate(300 262)">
          <rect x="-18" y="-10" width="36" height="5" rx="2.5" fill="#C49A7A" />
          <rect x="-18" y="-18" width="36" height="4" rx="2" fill="#D3AE8F" />
          <rect x="-15" y="-6" width="3" height="8" fill="#9E7556" />
          <rect x="12" y="-6" width="3" height="8" fill="#9E7556" />
        </g>
      )}
      {has('butterflies') && (
        <g>
          <g transform="translate(110 120)" className="butterfly">
            <ellipse cx="-3" cy="0" rx="3.4" ry="2.4" fill="#F6C6D8" />
            <ellipse cx="3" cy="0" rx="3.4" ry="2.4" fill="#F6C6D8" />
          </g>
          <g transform="translate(296 130)" className="butterfly" style={{ animationDelay: '1.4s' }}>
            <ellipse cx="-3" cy="0" rx="3.4" ry="2.4" fill="#B9E3F6" />
            <ellipse cx="3" cy="0" rx="3.4" ry="2.4" fill="#B9E3F6" />
          </g>
        </g>
      )}
    </svg>
  );
}

/** Позиции деревьев на острове (база ствола), % от контейнера. Кольцо вокруг центра — без перекрытия подписей. */
export const TREE_SLOTS: Record<string, { x: number; y: number }> = {
  relationships: { x: 34, y: 33 },
  savings: { x: 66, y: 33 },
  work: { x: 16, y: 53 },
  creativity: { x: 84, y: 53 },
  health: { x: 34, y: 74 },
  study: { x: 66, y: 74 },
};
