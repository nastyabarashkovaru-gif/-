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
      plan            TEXT NOT NULL CHECK (plan IN ('week', 'month', 'quarter', 'year')),
      auto_renew      BOOLEAN NOT NULL DEFAULT TRUE,
      renews_at       TIMESTAMPTZ,
      -- 'provider' — от платёжной системы, 'manual' — выдано вручную для тестов
      source          TEXT NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS subscription_id TEXT;

    -- Программа для блогеров: кто пришёл по ссылке startapp=blogger / bl_*, скриншоты сторис, выданный Premium
    ALTER TABLE users ADD COLUMN IF NOT EXISTS blogger_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS blogger_campaign TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS blogger_premium_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS blogger_proofs (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id),
      image       TEXT NOT NULL,
      status      TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS blogger_proofs_user_idx ON blogger_proofs(user_id, created_at);

    -- Настройки приложения (stats_since — с какого момента считается статистика в админке)
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- Недельный тариф
    ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_plan_check;
    ALTER TABLE entitlements ADD CONSTRAINT entitlements_plan_check CHECK (plan IN ('week', 'month', 'quarter', 'year'));
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
    -- Отмена подписки: повторное оформление — по обычной цене без скидки
    ALTER TABLE users ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS offer_started_at TIMESTAMPTZ;
    -- Обычная сумма автосписания и скидка удержания (−50% только на следующий платёж, один раз)
    ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS base_amount NUMERIC(10, 2);
    ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS discount_next BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS retention_used BOOLEAN NOT NULL DEFAULT FALSE;
    -- kind: subscription | reveal (разовое раскрытие автора)
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'subscription';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS response_id TEXT;

    CREATE TABLE IF NOT EXISTS reveal_purchases (
      owner_id     BIGINT NOT NULL REFERENCES users(id),
      response_id  TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      order_id     TEXT NOT NULL REFERENCES orders(id),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, response_id)
    );

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

  // HUSH 2.0: анонимные вопросы и ответы (только добавление — старые данные не трогаем, см. docs/HUSH2_MIGRATION.md)
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ask_slug TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS link_created_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_source TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_last_at DATE;

    -- Входящие: kind user — от другого человека, self — сам себе (не считается активностью), system — вопрос дня от hush
    CREATE TABLE IF NOT EXISTS inbox (
      id               TEXT PRIMARY KEY,
      recipient_id     BIGINT NOT NULL REFERENCES users(id),
      sender_id        BIGINT REFERENCES users(id),
      kind             TEXT NOT NULL CHECK (kind IN ('user', 'self', 'system')),
      text             TEXT NOT NULL,
      answer           TEXT,
      answered_at      TIMESTAMPTZ,
      idempotency_key  TEXT UNIQUE,
      reported_at      TIMESTAMPTZ,
      deleted_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS inbox_recipient_idx ON inbox(recipient_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS inbox_sender_idx ON inbox(sender_id, created_at DESC);
    -- Ответ в сторис (маленькая карточка вопроса) и когда отправитель увидел личный ответ
    ALTER TABLE inbox ADD COLUMN IF NOT EXISTS story_at TIMESTAMPTZ;
    ALTER TABLE inbox ADD COLUMN IF NOT EXISTS sender_seen_at TIMESTAMPTZ;
    -- Согласие отправителя на раскрытие профиля (по умолчанию — анонимно)
    ALTER TABLE inbox ADD COLUMN IF NOT EXISTS consent_reveal BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE ask_answers ADD COLUMN IF NOT EXISTS consent_reveal BOOLEAN NOT NULL DEFAULT FALSE;

    -- «Задать свой вопрос»: вопрос аудитории и анонимные ответы на него
    CREATE TABLE IF NOT EXISTS asks (
      id          TEXT PRIMARY KEY,
      owner_id    BIGINT NOT NULL REFERENCES users(id),
      text        TEXT NOT NULL,
      deleted_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS asks_owner_idx ON asks(owner_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS ask_answers (
      id               TEXT PRIMARY KEY,
      ask_id           TEXT NOT NULL REFERENCES asks(id) ON DELETE CASCADE,
      respondent_id    BIGINT NOT NULL REFERENCES users(id),
      kind             TEXT NOT NULL CHECK (kind IN ('user', 'self')),
      text             TEXT NOT NULL,
      idempotency_key  TEXT UNIQUE,
      deleted_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (ask_id, respondent_id)
    );
    CREATE INDEX IF NOT EXISTS ask_answers_ask_idx ON ask_answers(ask_id, created_at DESC);

    -- Блокировки и жалобы: владелец блокирует отправителя, не узнавая, кто это
    CREATE TABLE IF NOT EXISTS blocks (
      owner_id    BIGINT NOT NULL REFERENCES users(id),
      blocked_id  BIGINT NOT NULL REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id           BIGSERIAL PRIMARY KEY,
      reporter_id  BIGINT NOT NULL REFERENCES users(id),
      target_kind  TEXT NOT NULL,
      target_id    TEXT NOT NULL,
      reason       TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Конверсия апсейла: попытка → предложение Premium → открыл Premium → купил (по уникальным пользователям)
  await pool.query(`
    CREATE OR REPLACE VIEW upsell_conversion AS
    WITH flows(flow, clicked, shown) AS (
      VALUES ('new_questionnaire', 'new_questionnaire_clicked', 'new_questionnaire_paywall_shown'),
             ('custom_question', 'custom_question_clicked', 'custom_question_paywall_shown'),
             ('question_library', 'question_library_clicked', 'question_library_paywall_shown')
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

/** С какого момента считается статистика в админке («сбросить статистику» не удаляет данные пользователей) */
export async function statsSince(): Promise<string> {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'stats_since'");
  const v = rows[0]?.value as string | undefined;
  return v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : '1970-01-01T00:00:00.000Z';
}
