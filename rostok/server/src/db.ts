import pg from 'pg';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

pg.types.setTypeParser(1082, (v) => v); // date → 'YYYY-MM-DD' строкой, без сдвигов таймзоны
pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number (id в пределах 2^53)

const isLocal = /localhost|127\.0\.0\.1|railway\.internal/.test(config.databaseUrl);
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});

export type Db = pg.Pool | pg.PoolClient;

export async function q<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params as any[]);
  return r.rows as T[];
}
export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(db, sql, params))[0];
}

/** Транзакция с повтором при serialization/deadlock-конфликтах. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const res = await fn(c);
      await c.query('COMMIT');
      return res;
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => {});
      if ((e?.code === '40001' || e?.code === '40P01') && attempt < 3) continue;
      throw e;
    } finally {
      c.release();
    }
  }
}

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, 'migrations'), join(here, '..', 'migrations')]) if (existsSync(p)) return p;
  throw new Error('migrations directory not found');
}

export async function migrate(): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(71001)');
    const done = new Set((await q<{ name: string }>(c, 'SELECT name FROM schema_migrations')).map((r) => r.name));
    const dir = migrationsDir();
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(join(dir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        console.log(`[db] migration applied: ${f}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(71001)').catch(() => {});
    c.release();
  }
}

export async function logError(source: string, message: string, context: Record<string, unknown> = {}) {
  try {
    await pool.query('INSERT INTO error_log(source, message, context) VALUES ($1,$2,$3)', [source, message.slice(0, 2000), context]);
  } catch {
    /* ignore */
  }
}
