import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { Garden, Me, PublicConfig, Task } from '../api/types';

interface AppState {
  config: PublicConfig;
  me: Me;
  garden: Garden | null;
  tasks: Task[] | null;
  refreshMe: () => Promise<Me>;
  refreshGarden: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshAll: () => Promise<void>;
  setTasks: (f: (t: Task[]) => Task[]) => void;
  setGarden: (f: (g: Garden) => Garden) => void;
  reducedMotion: boolean;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppProvider missing');
  return c;
};

export function AppProvider({ config, initialMe, children }: { config: PublicConfig; initialMe: Me; children: ReactNode }) {
  const [me, setMe] = useState(initialMe);
  const [garden, setGardenState] = useState<Garden | null>(null);
  const [tasks, setTasksState] = useState<Task[] | null>(null);
  const refreshMe = useCallback(async () => {
    const m = await api<Me>('GET', '/me');
    setMe(m);
    return m;
  }, []);
  const refreshGarden = useCallback(async () => {
    if (!me.access) return;
    setGardenState(await api<Garden>('GET', '/garden'));
  }, [me.access]);
  const refreshTasks = useCallback(async () => {
    if (!me.access) return;
    setTasksState((await api<{ tasks: Task[] }>('GET', '/tasks')).tasks);
  }, [me.access]);
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshGarden(), refreshTasks()]);
  }, [refreshGarden, refreshTasks]);
  useEffect(() => {
    if (me.access) refreshAll().catch(() => {});
  }, [me.access, refreshAll]);
  const reducedMotion = me.settings.reducedMotion || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reducedMotion);
  }, [reducedMotion]);
  const value = useMemo<AppState>(() => ({
    config, me, garden, tasks, refreshMe, refreshGarden, refreshTasks, refreshAll, reducedMotion,
    setTasks: (f) => setTasksState((t) => (t ? f(t) : t)),
    setGarden: (f) => setGardenState((g) => (g ? f(g) : g)),
  }), [config, me, garden, tasks, refreshMe, refreshGarden, refreshTasks, refreshAll, reducedMotion]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
