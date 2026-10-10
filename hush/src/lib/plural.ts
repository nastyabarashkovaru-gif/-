/** Русская плюрализация: plural(3, ['человек', 'человека', 'человек']) */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/** 1499 → «1 499 ₽» (неразрывный пробел, как в макете) */
export function formatRub(value: number): string {
  return `${value.toLocaleString('ru-RU').replace(/\s/g, '\u00a0')}\u00a0₽`;
}
