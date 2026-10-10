/** Русская плюрализация: plural(5, ['ответ', 'ответа', 'ответов']) */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** 1499 → «1 499 ₽» с неразрывными пробелами, чтобы цена не переносилась. */
export function formatPrice(rub: number): string {
  const digits = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${digits} ₽`;
}
