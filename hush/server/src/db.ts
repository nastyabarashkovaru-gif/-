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

    ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS subscription_id TEXT;
    CREATE INDEX IF NOT EXISTS entitlements_sub_idx ON entitlements(subscription_id);

    -- Заказы: сумма и тариф фиксируются на сервере до открытия виджета
    CREATE TABLE IF NOT EXISTS orders (
      id              TEXT PRIMARY KEY,
      user_id         BIGINT NOT NULL REFERENCES users(id),
      plan            TEXT NOT NULL,
      amount          NUMERIC(10, 2) NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at         TIMESTAMPTZ
    );

    -- Каждое уведомление об оплате учитывается ровно один раз (по TransactionId)
    CREATE TABLE IF NOT EXISTS payments (
      transaction_id  TEXT PRIMARY KEY,
      user_id         BIGINT NOT NULL REFERENCES users(id),
      order_id        TEXT REFERENCES orders(id),
      subscription_id TEXT,
      plan            TEXT NOT NULL,
      amount          NUMERIC(10, 2) NOT NULL,
      test_mode       BOOLEAN NOT NULL DEFAULT FALSE,
      raw             JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT;

    -- События аналитики: кто, что, откуда, когда
    CREATE TABLE IF NOT EXISTS events (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id),
      name        TEXT NOT NULL,
      source      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS events_name_idx ON events(name, created_at);

    CREATE TABLE IF NOT EXISTS reveals (
      id               BIGSERIAL PRIMARY KEY,
      questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
      response_id      TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      owner_id         BIGINT NOT NULL REFERENCES users(id),
      result           TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Конверсия апсейла: попытка → предложение Premium → открыл Premium → купил (по уникальным пользователям)
  await pool.query(`
    CREATE OR REPLACE VIEW upsell_conversion AS
    WITH flows(flow, clicked, shown) AS (
      VALUES ('new_questionnaire', 'new_questionnaire_clicked', 'new_questionnaire_paywall_shown'),
             ('custom_question', 'custom_question_clicked', 'custom_question_paywall_shown')
    )
    SELECT
      f.flow,
      (SELECT count(DISTINCT user_id) FROM events e WHERE e.name = f.clicked) AS attempted_users,
      (SELECT count(DISTINCT user_id) FROM events e WHERE e.name = f.shown) AS paywall_shown_users,
      (SELECT count(DISTINCT user_id) FROM events e WHERE e.name = 'premium_upsell_clicked' AND e.source = f.flow) AS opened_premium_users,
      (SELECT count(DISTINCT user_id) FROM orders o WHERE o.source = f.flow AND o.status = 'paid') AS purchased_users,
      (SELECT coalesce(sum(amount), 0) FROM orders o WHERE o.source = f.flow AND o.status = 'paid') AS revenue_rub
    FROM flows f;
  `);
}
