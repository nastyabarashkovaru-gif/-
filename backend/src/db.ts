import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'app.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,             -- telegram user id
  username TEXT,
  first_name TEXT,
  photo_url TEXT,
  age INTEGER,
  city TEXT,
  goal TEXT,
  before_photo TEXT,
  before_description TEXT,
  measurements TEXT,
  price_of_word INTEGER,
  force_majeure_allowed INTEGER DEFAULT 0,
  extra_tasks TEXT DEFAULT '[]',
  onboarding_completed INTEGER DEFAULT 0,
  manual_rank INTEGER,
  goal_confirmed_winner INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  challenge_start_date TEXT DEFAULT (date('now')),
  cycle INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cycle INTEGER NOT NULL DEFAULT 1,
  day_number INTEGER NOT NULL,
  date TEXT NOT NULL,
  training_done INTEGER DEFAULT 0,
  training_media_url TEXT,
  training_media_type TEXT,
  extra_tasks_done TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, cycle, day_number)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'word_price',
  status TEXT NOT NULL DEFAULT 'pending',
  prodamus_link TEXT,
  prodamus_order_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON daily_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
`);

export default db;
