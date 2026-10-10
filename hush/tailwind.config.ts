import type { Config } from 'tailwindcss';

/** Токены 1:1 из design/design-reference.html */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        purple: { DEFAULT: '#A855F7', 2: '#8B5CF6', text: '#B987FF', soft: '#BB91FF', check: '#C396FF', icon: '#C69CFF', menu: '#AE84F1' },
        green: '#4ADE80',
        muted: '#A1A1AA',
        small: '#8E8B97',
        step: '#A7A0B0',
        panel: '#121216',
        line: '#29272F',
        divider: '#2B2930',
      },
      fontFamily: {
        // Системный шрифт как в макетах: SF Pro на iOS/macOS, Roboto на Android; Inter — запасной
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"SF Pro Display"', '"Segoe UI"', 'Roboto', '"Inter Variable"', 'Inter', 'Arial', 'sans-serif'],
      },
      maxWidth: { app: '430px' },
    },
  },
  plugins: [],
} satisfies Config;
