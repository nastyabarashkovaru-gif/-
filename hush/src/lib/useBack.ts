import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** Назад по истории, а если истории нет (открыли по прямой ссылке) — на fallback. */
export function useBack(fallback = '/home') {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}
