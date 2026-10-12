import { pool, logError } from './db.js';
import { processDueTasks } from './services/scheduler.js';
import { processSubscriptions } from './services/subscription.js';
import { sendReminders } from './services/notifications.js';

const JOBS: { name: string; everyMs: number; run: () => Promise<unknown> }[] = [
  { name: 'tasks', everyMs: 60_000, run: () => processDueTasks() },
  { name: 'subscriptions', everyMs: 60_000, run: () => processSubscriptions() },
  { name: 'reminders', everyMs: 10 * 60_000, run: () => sendReminders() },
];

/**
 * Фоновый планировщик внутри процесса. pg_try_advisory_lock гарантирует, что при нескольких репликах
 * задание выполняет один экземпляр. Не зависит от входа пользователя; после простоя догоняет пропущенное.
 */
export function startWorker() {
  const last = new Map<string, number>();
  const tick = async () => {
    for (const job of JOBS) {
      if (Date.now() - (last.get(job.name) ?? 0) < job.everyMs) continue;
      last.set(job.name, Date.now());
      const c = await pool.connect();
      try {
        const lockId = 72000 + JOBS.indexOf(job);
        const { rows } = await c.query('SELECT pg_try_advisory_lock($1) AS ok', [lockId]);
        if (!rows[0].ok) continue;
        try {
          await job.run();
          await c.query(`INSERT INTO job_state(name,last_run_at,last_ok_at) VALUES ($1,now(),now()) ON CONFLICT (name) DO UPDATE SET last_run_at=now(), last_ok_at=now(), last_error=NULL`, [job.name]);
        } catch (e) {
          const msg = (e as Error).message;
          console.error(`[worker] ${job.name}:`, msg);
          await logError(`job:${job.name}`, msg);
          await c.query(`INSERT INTO job_state(name,last_run_at,last_error) VALUES ($1,now(),$2) ON CONFLICT (name) DO UPDATE SET last_run_at=now(), last_error=$2`, [job.name, msg]);
        } finally {
          await c.query('SELECT pg_advisory_unlock($1)', [lockId]);
        }
      } finally {
        c.release();
      }
    }
  };
  const loop = () => tick().catch((e) => console.error('[worker]', e)).finally(() => setTimeout(loop, 15_000));
  setTimeout(loop, 3_000);
}
