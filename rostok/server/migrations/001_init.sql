-- ROSTOK: начальная схема. Балансы — integer. Время — timestamptz (UTC), локальные даты — date в таймзоне пользователя.

CREATE TABLE users (
  id               bigserial PRIMARY KEY,
  telegram_id      bigint UNIQUE,
  is_demo          boolean NOT NULL DEFAULT false,
  first_name       text,
  last_name        text,
  username         text,
  photo_url        text,
  language_code    text,
  timezone         text NOT NULL DEFAULT 'Europe/Moscow',
  timezone_changed_at timestamptz,
  activated_at     timestamptz,           -- первая активация доступа: старт «возраста сада»
  best_open_streak integer NOT NULL DEFAULT 0,
  bot_started      boolean NOT NULL DEFAULT false,
  bot_blocked      boolean NOT NULL DEFAULT false,
  last_seen_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE TABLE sessions (
  id          bigserial PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE user_settings (
  user_id               bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notifications_enabled boolean NOT NULL DEFAULT false,
  notify_max_per_day    smallint NOT NULL DEFAULT 1 CHECK (notify_max_per_day BETWEEN 1 AND 3),
  quiet_start           smallint NOT NULL DEFAULT 22 CHECK (quiet_start BETWEEN 0 AND 23),
  quiet_end             smallint NOT NULL DEFAULT 9 CHECK (quiet_end BETWEEN 0 AND 23),
  habit_mentions        boolean NOT NULL DEFAULT false,
  selected_spheres      text[] NOT NULL DEFAULT '{}',
  reduced_motion        boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE onboarding_progress (
  user_id              bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  step                 text NOT NULL DEFAULT 'slides',
  slides_seen          smallint NOT NULL DEFAULT 0,
  tutorial_completed_at timestamptz,
  spheres_selected_at  timestamptz,
  paywall_seen_at      timestamptz,
  completed_at         timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint
);

-- Подписки --------------------------------------------------------------
CREATE TABLE subscription_plans (
  id               text PRIMARY KEY,
  title            text NOT NULL,
  subtitle         text,
  kind             text NOT NULL CHECK (kind IN ('recurring','prepaid')),
  period_days      integer NOT NULL CHECK (period_days > 0),
  price_stars      integer NOT NULL CHECK (price_stars > 0),
  display_price_rub integer,
  eligibility      text NOT NULL DEFAULT 'all' CHECK (eligibility IN ('all','returning','retention')),
  is_active        boolean NOT NULL DEFAULT true,
  sort             smallint NOT NULL DEFAULT 0,
  terms            text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                     bigserial PRIMARY KEY,
  user_id                bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id                text REFERENCES subscription_plans(id),
  provider               text NOT NULL,
  status                 text NOT NULL DEFAULT 'none'
                         CHECK (status IN ('none','pending','active','cancel_at_period_end','expired','payment_failed','refunded')),
  current_period_start   timestamptz,
  current_period_end     timestamptz,          -- точная дата окончания доступа
  provider_ref           text,                 -- telegram_payment_charge_id подписки Stars
  auto_renew             boolean NOT NULL DEFAULT false,
  cancel_requested_at    timestamptz,
  retention_offer_used_at timestamptz,
  next_charge_plan_id    text REFERENCES subscription_plans(id),
  ever_paid              boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_intents (
  id          uuid PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id     text NOT NULL REFERENCES subscription_plans(id),
  provider    text NOT NULL,
  amount      integer NOT NULL,
  currency    text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','expired')),
  invoice_link text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  paid_at     timestamptz
);
CREATE INDEX payment_intents_user_idx ON payment_intents(user_id, created_at DESC);

CREATE TABLE payment_events (
  id          bigserial PRIMARY KEY,
  provider    text NOT NULL,
  event_key   text NOT NULL UNIQUE,     -- дедупликация вебхуков
  type        text NOT NULL,            -- payment_succeeded, renewal, refund, failed, canceled, retention_offer
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  intent_id   uuid REFERENCES payment_intents(id),
  plan_id     text,
  amount      integer,
  currency    text,
  charge_id   text,
  access_until timestamptz,
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_user_idx ON payment_events(user_id, created_at DESC);

-- Сад -------------------------------------------------------------------
CREATE TABLE spheres (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  species  text NOT NULL,
  sort     smallint NOT NULL
);

CREATE TABLE trees (
  id                  bigserial PRIMARY KEY,
  user_id             bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sphere_id           text NOT NULL REFERENCES spheres(id),
  level               integer NOT NULL DEFAULT 1 CHECK (level >= 1),
  available_drops     integer NOT NULL DEFAULT 0 CHECK (available_drops >= 0),
  total_earned_drops  integer NOT NULL DEFAULT 0 CHECK (total_earned_drops >= 0),
  total_spent_drops   integer NOT NULL DEFAULT 0 CHECK (total_spent_drops >= 0),
  total_penalty_drops integer NOT NULL DEFAULT 0 CHECK (total_penalty_drops >= 0),
  visual_variant      smallint NOT NULL DEFAULT 0,
  health_visual_state text NOT NULL DEFAULT 'normal' CHECK (health_visual_state IN ('normal','withered')),
  last_activity_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sphere_id)
);

CREATE TABLE tree_level_config (
  from_level integer PRIMARY KEY CHECK (from_level >= 1),
  cost       integer NOT NULL CHECK (cost >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE waterings (
  id              bigserial PRIMARY KEY,
  tree_id         bigint NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_level      integer NOT NULL,
  to_level        integer NOT NULL,
  cost            integer NOT NULL CHECK (cost > 0),
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tree_id, from_level),            -- ровно один полив на уровень
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE tree_unlocks (
  id          bigserial PRIMARY KEY,
  tree_id     bigint NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  level       integer NOT NULL,
  watering_id bigint REFERENCES waterings(id),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tree_id, level)
);

CREATE TABLE garden_levels (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level      integer NOT NULL,
  reached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, level)
);

CREATE TABLE garden_open_days (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date)
);

-- Задачи ----------------------------------------------------------------
CREATE TABLE tasks (
  id                bigserial PRIMARY KEY,
  user_id           bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sphere_id         text NOT NULL REFERENCES spheres(id),
  title             text NOT NULL,
  description       text,
  kind              text NOT NULL CHECK (kind IN ('daily','weekly','once','habit')),
  times_per_week    smallint CHECK (times_per_week BETWEEN 1 AND 7),
  drops             smallint NOT NULL CHECK (drops BETWEEN 1 AND 25),
  hardcore          boolean NOT NULL DEFAULT false,
  penalty_drops     smallint CHECK (penalty_drops BETWEEN 1 AND 100),
  deadline_at       timestamptz,
  habit_question    text,
  habit_missing_penalty boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired','deleted')),
  terms_locked_at   timestamptz,     -- момент первого обещанного подарка
  created_local_date date NOT NULL,
  processed_through date,            -- курсор обработки пропусков/штрафов
  completions_count integer NOT NULL DEFAULT 0 CHECK (completions_count >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CHECK (kind <> 'habit' OR sphere_id = 'health'),
  CHECK (kind <> 'once' OR deadline_at IS NOT NULL),
  CHECK (kind <> 'weekly' OR times_per_week IS NOT NULL)
);
CREATE INDEX tasks_user_idx ON tasks(user_id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_deadline_idx ON tasks(deadline_at) WHERE kind = 'once' AND status = 'active';

-- Версии расписания: изменения вступают в силу с будущего периода
CREATE TABLE task_schedules (
  id             bigserial PRIMARY KEY,
  task_id        bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  kind           text NOT NULL,
  times_per_week smallint,
  drops          smallint NOT NULL,
  hardcore       boolean NOT NULL,
  sphere_id      text NOT NULL REFERENCES spheres(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, effective_from)
);

CREATE TABLE task_occurrences (
  id             bigserial PRIMARY KEY,
  task_id        bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  period_key     text NOT NULL,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  required       smallint NOT NULL DEFAULT 1,
  done           smallint NOT NULL DEFAULT 0,
  status         text NOT NULL CHECK (status IN ('done','partial','missed','expired','unanswered','grace')),
  penalty_applied integer NOT NULL DEFAULT 0,
  processed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, period_key)
);

CREATE TABLE task_completions (
  id              bigserial PRIMARY KEY,
  task_id         bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tree_id         bigint NOT NULL REFERENCES trees(id),
  sphere_id       text NOT NULL,
  local_date      date NOT NULL,
  period_key      text NOT NULL,
  drops_awarded   integer NOT NULL CHECK (drops_awarded >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, local_date)            -- не более одного вознаграждаемого выполнения в день
);
CREATE INDEX task_completions_user_idx ON task_completions(user_id, created_at);

CREATE TABLE habit_checkins (
  id             bigserial PRIMARY KEY,
  task_id        bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id        bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date     date NOT NULL,
  answer_yes     boolean NOT NULL,
  applied_amount integer NOT NULL DEFAULT 0,   -- фактическое нетто-изменение баланса за этот день
  revision       integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, local_date)
);

-- Ledger: каждое движение капель — отдельная запись
CREATE TABLE drop_ledger (
  id               bigserial PRIMARY KEY,
  user_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tree_id          bigint NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('task_reward','habit_reward','penalty','watering','habit_correction','adjustment')),
  amount           integer NOT NULL,          -- фактическое изменение (+/−)
  requested_amount integer NOT NULL,          -- запрошенное (штраф может быть урезан до 0)
  source_type      text NOT NULL,
  source_id        bigint,
  idempotency_key  text NOT NULL UNIQUE,
  balance_after    integer NOT NULL CHECK (balance_after >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drop_ledger_tree_idx ON drop_ledger(tree_id, created_at DESC);
CREATE INDEX drop_ledger_user_idx ON drop_ledger(user_id, created_at DESC);

-- Подарки ---------------------------------------------------------------
CREATE TABLE reward_promises (
  id          bigserial PRIMARY KEY,
  task_id     bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  threshold   integer NOT NULL CHECK (threshold >= 1),
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','unlocked','claimed')),
  unlocked_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, threshold)
);
CREATE TABLE reward_claims (
  id         bigserial PRIMARY KEY,
  promise_id bigint NOT NULL UNIQUE REFERENCES reward_promises(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

-- Челленджи -------------------------------------------------------------
CREATE TABLE challenges (
  id               bigserial PRIMARY KEY,
  owner_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            text NOT NULL,
  goal             integer NOT NULL CHECK (goal BETWEEN 1 AND 1000),
  ends_on          date,
  max_participants smallint NOT NULL DEFAULT 2,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished','deleted')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE challenge_participants (
  challenge_id bigint NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id      bigint REFERENCES tasks(id) ON DELETE SET NULL,
  sphere_id    text REFERENCES spheres(id),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, user_id)
);
CREATE TABLE challenge_invites (
  id           bigserial PRIMARY KEY,
  challenge_id bigint NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_by   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  used_by      bigint REFERENCES users(id),
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Уведомления, аналитика, админка --------------------------------------
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  local_date date NOT NULL,
  text       text NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);
CREATE INDEX notifications_user_day_idx ON notifications(user_id, local_date);

CREATE TABLE analytics_events (
  id         uuid PRIMARY KEY,
  user_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  name       text NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}',
  source     text NOT NULL DEFAULT 'server' CHECK (source IN ('server','client')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_idx ON analytics_events(name, created_at);
CREATE INDEX analytics_events_user_idx ON analytics_events(user_id, created_at);

CREATE TABLE admin_users (
  id            bigserial PRIMARY KEY,
  login         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner','analyst','support')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);
CREATE TABLE admin_sessions (
  token_hash text PRIMARY KEY,
  admin_id   bigint NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_audit_log (
  id         bigserial PRIMARY KEY,
  admin_id   bigint REFERENCES admin_users(id),
  action     text NOT NULL,
  target     text,
  details    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE error_log (
  id         bigserial PRIMARY KEY,
  source     text NOT NULL,
  message    text NOT NULL,
  context    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_state (
  name        text PRIMARY KEY,
  last_run_at timestamptz,
  last_ok_at  timestamptz,
  last_error  text
);

ALTER TABLE tasks ADD COLUMN next_process_at timestamptz;
CREATE INDEX tasks_next_process_idx ON tasks(next_process_at) WHERE status = 'active' AND deleted_at IS NULL;
