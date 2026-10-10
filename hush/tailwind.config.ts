import type { Config } from 'tailwindcss';
import { colors, fonts, radii, spacing, typeScale } from './src/design/tokens';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors,
      fontFamily: {
        sans: [...fonts.sans],
        display: [...fonts.display],
      },
      fontSize: JSON.parse(JSON.stringify(typeScale)) as Record<string, [string, Record<string, string>]>,
      borderRadius: radii,
      spacing: {
        gutter: spacing.gutter,
        touch: spacing.touch,
        btn: spacing.button,
      },
      minHeight: { touch: spacing.touch },
      minWidth: { touch: spacing.touch },
      maxWidth: { app: '430px' },
    },
  },
  plugins: [],
} satisfies Config;
