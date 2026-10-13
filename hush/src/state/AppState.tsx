import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type ApiErrorCode, type Bootstrap, type Pricing } from '@/api';
import { PLANS, STANDARD_MONTH } from '@/data/plans';
import { config } from '@/config';

interface AppStateValue extends Bootstrap {
  isPremium: boolean;
  /** Цены тарифов для этого пользователя */
  pricing: Pricing;
  refresh(): Promise<void>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

type LoadState = { status: 'loading' } | { status: 'error'; code: ApiErrorCode } | { status: 'ready'; data: Bootstrap };

export function AppStateProvider({
  children,
  fallback,
  error,
}: {
  children: ReactNode;
  fallback: ReactNode;
  error: (retry: () => void, code: ApiErrorCode) => ReactNode;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const data = await api.bootstrap();
      if (data.app) {
        config.botUsername = data.app.botUsername || config.botUsername;
        config.appShortName = data.app.appShortName || config.appShortName;
      }
      setState({ status: 'ready', data });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      setState((s) => (s.status === 'ready' ? s : { status: 'error', code }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Демо-панель и mock сообщают об изменениях данных
    const onChange = () => void refresh();
    window.addEventListener('hush:data-changed', onChange);
    return () => window.removeEventListener('hush:data-changed', onChange);
  }, [refresh]);

  if (state.status === 'loading') return <>{fallback}</>;
  if (state.status === 'error')
    return (
      <>
        {error(() => {
          setState({ status: 'loading' });
          void refresh();
        }, state.code)}
      </>
    );

  const value: AppStateValue = {
    ...state.data,
    isPremium: state.data.entitlement.plan !== null,
    pricing: state.data.pricing ?? {
      prices: { month: PLANS[0].price, quarter: PLANS[1].price, year: PLANS[2].price },
      standardMonth: STANDARD_MONTH,
      offerEndsAt: null,
      returning: false,
    },
    refresh,
  };
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState outside AppStateProvider');
  return ctx;
}
