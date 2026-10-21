/** Реализация — в modules/bot.ts; здесь точка входа, чтобы модули не зависели от бота напрямую */
export type NotifyFn = (userId: bigint, templateKey: string, vars: Record<string, string | number>, dedupeKey: string) => Promise<'sent' | 'skipped' | 'failed'>;

let impl: NotifyFn = async () => 'skipped';

export function setNotifier(fn: NotifyFn) {
  impl = fn;
}

export function notify(userId: bigint, templateKey: string, vars: Record<string, string | number>, dedupeKey: string) {
  return impl(userId, templateKey, vars, dedupeKey).catch((e) => {
    console.warn('[notify]', templateKey, (e as Error).message);
    return 'failed' as const;
  });
}
