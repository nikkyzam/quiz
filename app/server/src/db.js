import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.env.DB_FILE || "./data/mathquest.db";

if (FILE !== ":memory:") mkdirSync(dirname(FILE), { recursive: true });
export const db = new DatabaseSync(FILE);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  pass_salt   TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- A learner is a child under a parent account. Progress hangs off the learner,
-- so one login can follow several kids from any device.
CREATE TABLE IF NOT EXISTS learners (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  beast       TEXT NOT NULL DEFAULT 'vex',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learners_user ON learners(user_id);

-- Best result per (learner, topic, tier), plus counters.
CREATE TABLE IF NOT EXISTS progress (
  learner_id  TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  topic_id    TEXT NOT NULL,
  tier        TEXT NOT NULL,
  best_score  INTEGER NOT NULL DEFAULT 0,
  best_total  INTEGER NOT NULL DEFAULT 0,
  best_pct    INTEGER NOT NULL DEFAULT 0,
  runs        INTEGER NOT NULL DEFAULT 0,
  last_at     TEXT NOT NULL,
  PRIMARY KEY (learner_id, topic_id, tier)
);

-- One row per finished round, so a parent can see history, not just bests.
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  learner_id  TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  topic_id    TEXT NOT NULL,
  tier        TEXT NOT NULL,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  pct         INTEGER NOT NULL,
  finished_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_learner ON runs(learner_id, finished_at DESC);
`);

export const now = () => new Date().toISOString();
