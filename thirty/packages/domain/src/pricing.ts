export const OFFER_DURATION_MS = 3 * 60 * 60 * 1000;

export interface OfferWindow {
  startedAt: Date;
  expiresAt: Date;
  consumedAt?: Date | null;
}

export function offerActive(offer: OfferWindow | null | undefined, now: Date): boolean {
  return !!offer && !offer.consumedAt && now.getTime() < offer.expiresAt.getTime();
}

export function offerMsLeft(offer: OfferWindow | null | undefined, now: Date): number {
  if (!offerActive(offer, now)) return 0;
  return offer!.expiresAt.getTime() - now.getTime();
}

export interface PriceInput {
  months: number;
  promoPrice: number;
  regularPrice: number;
  comparisonMonthPrice: number;
}

export interface PriceQuote {
  price: number;
  variant: 'promo' | 'regular';
  /** «Стоимость отдельных месяцев» = months × базовая цена месяца */
  comparison: number;
  savings: number;
  savingsPercent: number;
  perMonth: number;
}

export function quote(t: PriceInput, promo: boolean): PriceQuote {
  const price = promo ? t.promoPrice : t.regularPrice;
  const comparison = t.months * t.comparisonMonthPrice;
  return {
    price,
    variant: promo ? 'promo' : 'regular',
    comparison,
    savings: Math.max(0, comparison - price),
    savingsPercent: comparison > 0 ? Math.round((1 - price / comparison) * 100) : 0,
    perMonth: Math.round(price / t.months),
  };
}

export function formatRub(n: number): string {
  return `${n.toLocaleString('ru-RU').replace(/ |,/g, ' ')} ₽`;
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
