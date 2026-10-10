import type { SurveyResponse } from '@/data/responses';

/** Сколько разных ответивших нужно, чтобы открыть результаты. */
export const RESULTS_THRESHOLD = 5;
/** Сколько ответов видно в каждой закрытой анкете без подписки. */
export const FREE_VISIBLE_ANSWERS = 2;

/** Длина содержательной части ответа: только буквы и цифры. */
function meaningfulLength(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** Анкета, открытая бесплатно полностью: с максимальной суммарной длиной ответов. */
export function pickFullyOpenResponseId(responses: SurveyResponse[]): string | null {
  let best: { id: string; score: number } | null = null;
  for (const r of responses) {
    const score = r.answers.reduce((sum, a) => sum + meaningfulLength(a), 0);
    if (!best || score > best.score) best = { id: r.id, score };
  }
  return best?.id ?? null;
}

export function isAnswerVisible(index: number, opts: { premium: boolean; fullyOpen: boolean }): boolean {
  if (opts.premium || opts.fullyOpen) return true;
  return index < FREE_VISIBLE_ANSWERS;
}
