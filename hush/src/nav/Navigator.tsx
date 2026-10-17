import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { backButton, haptic } from '@/lib/telegram';
import type { Route } from './routes';

interface NavState {
  stack: Route[];
  /** 1 — вперёд, -1 — назад (для направления анимации) */
  direction: 1 | -1;
}

interface NavApi {
  route: Route;
  direction: 1 | -1;
  canGoBack: boolean;
  push(route: Route): void;
  replace(route: Route): void;
  /** Новый корень стека (например, после создания анкеты) */
  reset(route: Route): void;
  /** Новый стек целиком одним переходом (например, [входящие, ссылка готова]) */
  setStack(stack: Route[]): void;
  back(): void;
}

const NavContext = createContext<NavApi | null>(null);

export function NavigatorProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [state, setState] = useState<NavState>({ stack: [initial], direction: 1 });

  const push = useCallback((route: Route) => setState((s) => ({ stack: [...s.stack, route], direction: 1 })), []);
  const replace = useCallback(
    (route: Route) => setState((s) => ({ stack: [...s.stack.slice(0, -1), route], direction: 1 })),
    [],
  );
  const reset = useCallback((route: Route) => setState({ stack: [route], direction: 1 }), []);
  const setStack = useCallback((stack: Route[]) => setState({ stack, direction: 1 }), []);
  const back = useCallback(
    () => setState((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1), direction: -1 } : s)),
    [],
  );

  const route = state.stack[state.stack.length - 1];
  const canGoBack = state.stack.length > 1;

  // Нативная кнопка «Назад» Telegram
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    if (!canGoBack) return;
    return backButton.show(() => {
      haptic.tap();
      backRef.current();
    });
  }, [canGoBack]);

  const value = useMemo(
    () => ({ route, direction: state.direction, canGoBack, push, replace, reset, setStack, back }),
    [route, state.direction, canGoBack, push, replace, reset, setStack, back],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav outside NavigatorProvider');
  return ctx;
}
