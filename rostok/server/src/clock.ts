/** Источник серверного времени. В тестах подменяется; клиентскому времени не доверяем. */
let offsetMs = 0;
let fixed: number | null = null;
export const clock = {
  now: (): Date => new Date(fixed ?? Date.now() + offsetMs),
  set: (d: Date | null) => { fixed = d ? d.getTime() : null; },
  advance: (ms: number) => { if (fixed !== null) fixed += ms; else offsetMs += ms; },
};
