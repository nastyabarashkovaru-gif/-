import type { Config } from 'tailwindcss';
export default {
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: {
        paper: '#FFFFFF',
        cream: '#FAFCF9',
        leaf: { DEFAULT: '#78BC8A', soft: '#E8F4EB', deep: '#276B48', ink: '#1F5A3B' },
        blush: { DEFAULT: '#F6C6D8', soft: '#FDF0F5', accent: '#E98CB2', ink: '#B5487A' },
        ink: { DEFAULT: '#26342C', soft: '#5E6B63', mute: '#69756E', faint: '#87918B', line: '#E7ECE8' },
        drop: { DEFAULT: '#7BCBF0', deep: '#2E8FC0', soft: '#E7F5FC' },
        danger: '#C9524A',
      },
      borderRadius: { card: '22px', btn: '16px' },
      boxShadow: {
        soft: '0 6px 24px -10px rgba(39, 107, 72, 0.22)',
        card: '0 2px 14px -6px rgba(38, 52, 44, 0.14)',
        lift: '0 14px 34px -14px rgba(39, 107, 72, 0.45)',
      },
      fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'Roboto', '"Segoe UI"', 'Inter', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
