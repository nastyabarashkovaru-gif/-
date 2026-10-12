import type { SpeciesId } from '@rostok/shared';

/** Палитры видов. Мягкий «clay»-свет: hi (блик) → base → shade (тень). */
export interface SpeciesPalette {
  crown: { hi: string; base: string; shade: string };
  crown2: { hi: string; base: string; shade: string };
  trunk: { hi: string; base: string; shade: string };
  accent: string;
  accent2: string;
  shape: 'round' | 'wide' | 'tall' | 'droop' | 'cloud';
}

export const PALETTES: Record<SpeciesId, SpeciesPalette> = {
  sakura: {
    crown: { hi: '#FFE6F0', base: '#F7B8D0', shade: '#E58BB0' },
    crown2: { hi: '#FFF0F6', base: '#FBCFE0', shade: '#EFA0C0' },
    trunk: { hi: '#B48A7A', base: '#8E6656', shade: '#6C4A3E' },
    accent: '#FFFFFF', accent2: '#E98CB2', shape: 'wide',
  },
  golden: {
    crown: { hi: '#FFF3C4', base: '#F5D372', shade: '#DDA73E' },
    crown2: { hi: '#FFF8DC', base: '#F9E29A', shade: '#E9BB58' },
    trunk: { hi: '#C29B77', base: '#9A7351', shade: '#76553A' },
    accent: '#FFD24A', accent2: '#FFFBEA', shape: 'round',
  },
  oak: {
    crown: { hi: '#C9E9B8', base: '#7FBF79', shade: '#4C9157' },
    crown2: { hi: '#D8F0C8', base: '#95CC88', shade: '#5EA164' },
    trunk: { hi: '#A98563', base: '#7D5C41', shade: '#5B412D' },
    accent: '#B07A45', accent2: '#E6C79A', shape: 'cloud',
  },
  blossom: {
    crown: { hi: '#F6E9FF', base: '#D9B5F0', shade: '#B386D6' },
    crown2: { hi: '#FFEFF7', base: '#F2C2DD', shade: '#DB97BE' },
    trunk: { hi: '#AE8C86', base: '#856562', shade: '#634A48' },
    accent: '#FFFFFF', accent2: '#F59AC3', shape: 'round',
  },
  lush: {
    crown: { hi: '#DDF7CF', base: '#94D485', shade: '#56A862' },
    crown2: { hi: '#E8FBDC', base: '#A9E09A', shade: '#69B871' },
    trunk: { hi: '#B08B69', base: '#836347', shade: '#604631' },
    accent: '#F48C8C', accent2: '#FFE3A3', shape: 'tall',
  },
  willow: {
    crown: { hi: '#DFF7F3', base: '#98D6CE', shade: '#5BAEA9' },
    crown2: { hi: '#E6F6FF', base: '#A9DCEF', shade: '#6DB6D3' },
    trunk: { hi: '#A6907C', base: '#7B6655', shade: '#594A3E' },
    accent: '#7BCBF0', accent2: '#FFFFFF', shape: 'droop',
  },
};

/** Увядшее состояние — одно на все виды: коричнево-серое, но та же форма. */
export const WITHERED = {
  crown: { hi: '#E1D6C8', base: '#BDAA93', shade: '#94806B' },
  crown2: { hi: '#E6DDD2', base: '#C8B8A4', shade: '#A08D78' },
  trunk: { hi: '#9C8E80', base: '#76695D', shade: '#574D44' },
};
