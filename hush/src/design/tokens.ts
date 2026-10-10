/**
 * HUSH — дизайн-токены.
 * Единственный источник правды для цветов, типографики, геометрии и анимаций.
 * Tailwind получает значения отсюда (см. tailwind.config.ts).
 */

export const colors = {
  bg: '#0B0C10',
  surface: '#171820',
  surface2: '#20212B',
  accent: '#895CF6',
  accentSoft: '#A78BFA',
  text: '#F4F4F5',
  muted: '#A1A1AA',
  border: '#2B2D36',
  danger: '#F87171',
  success: '#4ADE80',
} as const;

export const fonts = {
  sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
  display: ['"Manrope Variable"', 'Manrope', '"Inter Variable"', 'system-ui', 'sans-serif'],
} as const;

/** [размер, межстрочный интервал, трекинг] */
export const typeScale = {
  hero: ['30px', { lineHeight: '36px', letterSpacing: '-0.02em', fontWeight: '700' }],
  title: ['23px', { lineHeight: '30px', letterSpacing: '-0.015em', fontWeight: '600' }],
  card: ['17px', { lineHeight: '24px', letterSpacing: '-0.01em', fontWeight: '600' }],
  body: ['15px', { lineHeight: '22px' }],
  'body-sm': ['14px', { lineHeight: '20px' }],
  hint: ['13px', { lineHeight: '18px' }],
  micro: ['12px', { lineHeight: '16px' }],
  button: ['16px', { lineHeight: '20px', fontWeight: '600' }],
} as const;

export const radii = {
  card: '16px',
  button: '14px',
  control: '12px',
  pill: '999px',
} as const;

export const spacing = {
  gutter: '16px',
  block: '16px',
  touch: '44px',
  button: '52px',
} as const;

export const motion = {
  fast: 0.15,
  base: 0.2,
  slow: 0.25,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
} as const;
