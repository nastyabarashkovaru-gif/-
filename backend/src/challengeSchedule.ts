// Челлендж стартует только 1-го и 14-го числа каждого месяца — те, кто
// заполнил анкету между стартами, ждут ближайшую дату.
export function nextChallengeStartDate(from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = d.getDate();

  let candidate: Date;
  if (day <= 1) {
    candidate = new Date(d.getFullYear(), d.getMonth(), 1);
  } else if (day <= 14) {
    candidate = new Date(d.getFullYear(), d.getMonth(), 14);
  } else {
    candidate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }

  const y = candidate.getFullYear();
  const m = String(candidate.getMonth() + 1).padStart(2, '0');
  const day2 = String(candidate.getDate()).padStart(2, '0');
  return `${y}-${m}-${day2}`;
}
