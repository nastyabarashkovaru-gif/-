import pg, { type PoolClient } from 'pg';
import { config } from './config';

const isLocal = /localhost|127\.0\.0\.1/.test(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Внутренняя сеть Railway и локальная база — без SSL
  ssl: isLocal || /railway\.internal/.test(config.databaseUrl) ? false : { rejectUnauthorized: false },
  max: 10,
});

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Схема создаётся при старте (идемпотентно) */
export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              BIGINT PRIMARY KEY,
      first_name      TEXT NOT NULL,
      last_name       TEXT,
      username        TEXT,
      photo_url       TEXT,
      allows_write    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS questionnaires (
      id              TEXT PRIMARY KEY,
      owner_id        BIGINT NOT NULL REFERENCES users(id),
      questions       JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- уведомление о 5 ответах отправляется ровно один раз
      notified_at     TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS questionnaires_owner_idx ON questionnaires(owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS responses (
      id                  TEXT PRIMARY KEY,
      questionnaire_id    TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
      respondent_id       BIGINT NOT NULL REFERENCES users(id),
      answers             JSONB NOT NULL,
      -- аудит согласия на раскрытие профиля
      consent_reveal      BOOLEAN NOT NULL,
      consent_version     TEXT NOT NULL,
      consent_decided_at  TIMESTAMPTZ NOT NULL,
      idempotency_key     TEXT NOT NULL UNIQUE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (questionnaire_id, respondent_id)
    );
    CREATE INDEX IF NOT EXISTS responses_q_idx ON responses(questionnaire_id, created_at);

    CREATE TABLE IF NOT EXISTS entitlements (
      user_id         BIGINT PRIMARY KEY REFERENCES users(id),
      plan            TEXT NOT NULL CHECK (plan IN ('month', 'quarter', 'year')),
      auto_renew      BOOLEAN NOT NULL DEFAULT TRUE,
      renews_at       TIMESTAMPTZ,
      -- 'provider' — от платёжной системы, 'manual' — выдано вручную для тестов
      source          TEXT NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reveals (
      id               BIGSERIAL PRIMARY KEY,
      questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
      response_id      TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      owner_id         BIGINT NOT NULL REFERENCES users(id),
      result           TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
