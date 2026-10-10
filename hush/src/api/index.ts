import { httpApi } from './http';
import type { HushApi } from './types';

/**
 * Mock используется только в демо-режиме без VITE_API_URL.
 * Условие вычисляется при сборке: в production-сборке mock и демо-данные
 * полностью вырезаются из бандла.
 */
export const usingMock: boolean = import.meta.env.VITE_DEMO !== 'false' && !import.meta.env.VITE_API_URL;

function lazyMock(): HushApi {
  return new Proxy({} as HushApi, {
    get:
      (_target, key) =>
      async (...args: unknown[]) => {
        const { mockApi } = await import('./mock');
        return (mockApi[key as keyof HushApi] as (...a: unknown[]) => unknown)(...args);
      },
  });
}

export const api: HushApi =
  import.meta.env.VITE_DEMO !== 'false' && !import.meta.env.VITE_API_URL ? lazyMock() : httpApi;

export * from './types';
