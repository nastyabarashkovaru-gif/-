import { useCallback, useEffect, useState } from 'react';
import { api, type ResultsView } from '@/api';

/** Кэш результатов, чтобы 05 ↔ 07 открывались без мигания */
const cache = new Map<string, ResultsView>();
/** Запоминаем, какую карточку смотрел пользователь (сохраняется при новых ответах) */
export const carouselPosition = new Map<string, string>();
/** Раскрытые в этой сессии авторы (backend всё равно перепроверяет права) */
export const revealedIdentities = new Map<string, { firstName: string; username?: string; photoUrl?: string }>();

export function useResults(qid: string, version: string) {
  const [data, setData] = useState<ResultsView | undefined>(cache.get(qid));
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const fresh = await api.getResults(qid);
      cache.set(qid, fresh);
      setData(fresh);
    } catch {
      setError(true);
    }
  }, [qid]);

  useEffect(() => {
    void load();
    // version меняется при новых ответах или смене подписки
  }, [load, version]);

  return { data, error, retry: load };
}
