import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import { UserProfile } from '../types';

interface UserContextValue {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({ user: null, loading: true, error: null, refresh: async () => {} });

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<UserProfile>('/users/me');
      setUser(data);
    } catch (e: any) {
      setError(e.message || 'Не удалось загрузить профиль');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <UserContext.Provider value={{ user, loading, error, refresh }}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
