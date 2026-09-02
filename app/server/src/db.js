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
  role        TEXT NOT NULL DEFAULT 'parent',
  -- COPPA: children never hold accounts here; a responsible adult creates the
  -- account and affirms they may consent for the children they add.
  coppa_consent_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       TEXT PRIMARY KEY,
  user_id  TEXT,
  action   TEXT NOT NULL,
  detail   TEXT,
  ip       TEXT,
  at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
-- Password reset tokens. Only a hash is stored, so a leaked database does not
-- hand out working reset links. Single use, short lived.
CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_reset_user ON reset_tokens(user_id);

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

-- Placement/diagnostic results. skill_map is the per-section estimate the
-- adaptive engine produced; recommendation is where the learner should start.
CREATE TABLE IF NOT EXISTS diagnostics (
  id             TEXT PRIMARY KEY,
  learner_id     TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  topic_id       TEXT NOT NULL,
  asked          INTEGER NOT NULL,
  correct        INTEGER NOT NULL,
  skill_map      TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  finished_at    TEXT NOT NULL
);
-- Spaced repetition schedule, one row per (learner, topic). Interval grows
-- when a review goes well and collapses when it does not, so the next due
-- date tracks the learner rather than a fixed calendar.
CREATE TABLE IF NOT EXISTS review_schedule (
  learner_id   TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  topic_id     TEXT NOT NULL,
  interval_days REAL NOT NULL DEFAULT 1,
  ease         REAL NOT NULL DEFAULT 2.5,
  reps         INTEGER NOT NULL DEFAULT 0,
  lapses       INTEGER NOT NULL DEFAULT 0,
  due_at       TEXT NOT NULL,
  last_at      TEXT NOT NULL,
  PRIMARY KEY (learner_id, topic_id)
);
-- One row per wrong answer, with the misconception it looked like, so
-- reporting can target the mistake rather than just the topic.
CREATE TABLE IF NOT EXISTS mistakes (
  id         TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  topic_id   TEXT NOT NULL,
  question_id TEXT NOT NULL,
  category   TEXT NOT NULL,
  at         TEXT NOT NULL
);
-- Timed contest attempts, kept apart from practice so contest analytics
-- are not polluted by untimed work.
CREATE TABLE IF NOT EXISTS contests (
  id          TEXT PRIMARY KEY,
  learner_id  TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  format      TEXT NOT NULL,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  pct         INTEGER NOT NULL,
  seconds     INTEGER NOT NULL,
  limit_secs  INTEGER NOT NULL,
  expired     INTEGER NOT NULL DEFAULT 0,
  detail      TEXT NOT NULL,
  finished_at TEXT NOT NULL
);
-- Gamification: points, badges and daily streaks (spec 5.1, 5.2, 5.5).
CREATE TABLE IF NOT EXISTS awards (
  id         TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,          -- points | badge
  code       TEXT NOT NULL,          -- badge id, or the reason points were given
  amount     INTEGER NOT NULL DEFAULT 0,
  at         TEXT NOT NULL
);
-- Teacher portal: classes, membership and assignments (spec 4.3).
CREATE TABLE IF NOT EXISTS classes (
  id         TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  join_code  TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
-- Weekly goals a parent sets per learner (spec 4.2.6).
CREATE TABLE IF NOT EXISTS goals (
  learner_id     TEXT PRIMARY KEY REFERENCES learners(id) ON DELETE CASCADE,
  rounds_per_week INTEGER NOT NULL DEFAULT 0,
  minutes_per_week INTEGER NOT NULL DEFAULT 0,
  set_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id);

-- Leaderboards are OFF by default and controlled by the teacher, per class.
-- display_names decides whether learners appear by name or anonymously.
CREATE TABLE IF NOT EXISTS class_settings (
  class_id       TEXT PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  leaderboard_on INTEGER NOT NULL DEFAULT 0,
  display_names  INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class_members (
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (class_id, learner_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  topic_id   TEXT NOT NULL,
  tier       TEXT,
  due_at     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assign_class ON assignments(class_id);

-- Solved puzzles, with how many hints were taken so a trophy can reflect it.
CREATE TABLE IF NOT EXISTS puzzle_solves (
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  puzzle_id  TEXT NOT NULL,
  hints_used INTEGER NOT NULL DEFAULT 0,
  attempts   INTEGER NOT NULL DEFAULT 1,
  solved_at  TEXT NOT NULL,
  PRIMARY KEY (learner_id, puzzle_id)
);

CREATE INDEX IF NOT EXISTS idx_awards_learner ON awards(learner_id, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_badge_once ON awards(learner_id, code) WHERE kind = 'badge';

CREATE INDEX IF NOT EXISTS idx_contests_learner ON contests(learner_id, finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_mistakes_learner ON mistakes(learner_id, at DESC);

-- Bayesian Knowledge Tracing state, one row per learner per skill.
CREATE TABLE IF NOT EXISTS skill_state (
  learner_id   TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  skill_id     TEXT NOT NULL,
  p_known      REAL NOT NULL,
  observations INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (learner_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_review_due ON review_schedule(learner_id, due_at);

-- In-app notifications and the outbox that email/push drain (spec 4.2.5, 9.4).
CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learner_id   TEXT REFERENCES learners(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  read_at      TEXT,
  delivered_via TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

-- Bandit posteriors for difficulty selection (spec 6.3): one Beta(successes+1,
-- failures+1) per learner, topic and tier.
CREATE TABLE IF NOT EXISTS bandit_arms (
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  topic_id   TEXT NOT NULL,
  tier       TEXT NOT NULL,
  successes  INTEGER NOT NULL DEFAULT 0,
  failures   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (learner_id, topic_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_diag_learner ON diagnostics(learner_id, finished_at DESC);
`);

export const now = () => new Date().toISOString();

/* ---------- migrations ----------
   CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
   columns added after a database is in use must be applied explicitly. Each
   migration is idempotent and safe to run on every boot. Without this, an
   existing deployment breaks the moment a column is added. */
function columns(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
}
function addColumn(table, name, ddl) {
  if (!columns(table).has(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    return true;
  }
  return false;
}

export function migrate() {
  const applied = [];
  // 10.3: roles and recorded COPPA consent
  if (addColumn("users", "role", "TEXT NOT NULL DEFAULT 'parent'")) applied.push("users.role");
  if (addColumn("users", "coppa_consent_at", "TEXT")) applied.push("users.coppa_consent_at");
  // 4.2.2 / 6.6: curriculum track per learner, overridable by parent or teacher
  if (addColumn("learners", "track", "TEXT NOT NULL DEFAULT 'core'")) applied.push("learners.track");
  // 6.1: IRT ability estimate stored with each diagnostic
  if (addColumn("diagnostics", "theta", "REAL")) applied.push("diagnostics.theta");
  if (addColumn("diagnostics", "se", "REAL")) applied.push("diagnostics.se");
  // 4.2.3: time on task per round
  if (addColumn("runs", "seconds", "INTEGER NOT NULL DEFAULT 0")) applied.push("runs.seconds");
  return applied;
}

const appliedMigrations = migrate();
if (appliedMigrations.length && process.env.NODE_ENV !== "test")
  console.log("migrations applied:", appliedMigrations.join(", "));
