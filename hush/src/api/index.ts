import { config } from '@/config';
import { httpApi } from './http';
import { mockApi } from './mock';
import type { HushApi } from './types';

/** Mock используется только в демо-режиме без VITE_API_URL */
export const api: HushApi = config.apiUrl || !config.demo ? httpApi : mockApi;
export const usingMock = api === mockApi;

export * from './types';
