import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.env.DB_FILE || "./data/mathquest.db";

if (FILE !== ":memory:") mkdirSync(dirname(FILE), { recursive: true });
export const db = new DatabaseSync(FILE);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
/* Wait for a lock rather than failing on contact with one.

   WAL allows one writer at a time, and this database genuinely has more than
   one process attached: the server, the scheduled backup, and the
   requirement suite, which opens its own connection to inspect what the
   server wrote. Without a busy timeout the loser of a race gets an immediate
   error instead of waiting the few milliseconds the other write takes, which
   surfaces as intermittent, unreproducible failures rather than as
   contention. Five seconds is far longer than any statement here needs and
   far shorter than any request should wait. */
db.exec("PRAGMA busy_timeout = 5000");

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
-- Lesson progress: how far a learner got, and whether they finished it, so
-- the app can offer "resume" (spec 4.1.3).
CREATE TABLE IF NOT EXISTS lesson_progress (
  learner_id  TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  lesson_id   TEXT NOT NULL,
  panel_index INTEGER NOT NULL DEFAULT 0,
  completed   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (learner_id, lesson_id)
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

-- 6.3: one Beta posterior per (learner, topic, tier) for difficulty selection.
CREATE TABLE IF NOT EXISTS bandit_arms (
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  topic_id   TEXT NOT NULL,
  tier       TEXT NOT NULL,
  successes  INTEGER NOT NULL DEFAULT 0,
  failures   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, topic_id, tier)
);

-- 8.5 / 3.5.5: content approval. An approval is bound to the HASH of what was
-- approved, so editing a topic after sign-off does not silently carry the
-- approval forward onto content nobody reviewed. Superseded approvals are kept
-- rather than overwritten: the record of who approved what, and when, is the
-- point of having a workflow at all.
CREATE TABLE IF NOT EXISTS content_reviews (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status       TEXT NOT NULL,          -- approved | changes_requested
  -- SET NULL, not CASCADE. Cascading deleted the approval record along with
  -- the reviewer's account, which is the one thing this table exists to keep:
  -- 40 topics signed off by someone who later left would silently revert to
  -- "never reviewed", with no trace that anyone had ever looked at them.
  -- Erasing the person is honoured; erasing the fact that a review happened
  -- is not the same request.
  reviewer_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes        TEXT,
  at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_topic ON content_reviews(topic_id, at DESC);

-- 4.3.5: competition teams within a class.
CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- learner_id is the PRIMARY KEY, not (team_id, learner_id): a learner belongs
-- to at most ONE team, enforced by the schema rather than by remembering to
-- check. Two teams sharing a member would count that child's paper twice in
-- the standings, and both teams would be ranked on work only one of them did.
CREATE TABLE IF NOT EXISTS team_members (
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Carried here so the key can be per class. With learner_id alone as the
  -- primary key the rule was one team per learner PLATFORM-wide, and a child
  -- in two classes could only ever be on the first teacher's team: the second
  -- teacher got "already on a team, remove them first" and had no permission
  -- to do it, or even to see who held them.
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (learner_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_team_class ON teams(class_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);

-- 5.5: streak freezes. A freeze is EARNED, then SPENT on one specific missed
-- day and recorded against it. Storing the day it covered rather than just a
-- balance is what stops a freeze being applied retroactively: a learner
-- returning after a month must not have every gap bridged by one token.
CREATE TABLE IF NOT EXISTS streak_freezes (
  id         TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  earned_at  TEXT NOT NULL,
  spent_on   TEXT,
  spent_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_freeze_learner ON streak_freezes(learner_id);

-- 4.1.2: one challenge attempt per learner per day. The date is the key, so
-- the "first attempt only" rule is enforced by the primary key rather than by
-- remembering to check.
CREATE TABLE IF NOT EXISTS daily_attempts (
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  date_key   TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  at         TEXT NOT NULL,
  PRIMARY KEY (learner_id, date_key)
);

-- 5.3: which accessories a learner is wearing. One row per equipped item;
-- what is UNLOCKED is derived from badges rather than stored, so it can never
-- drift from the achievement that earned it.
CREATE TABLE IF NOT EXISTS avatar_equipped (
  learner_id   TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  accessory_id TEXT NOT NULL,
  slot         TEXT NOT NULL,
  at           TEXT NOT NULL,
  PRIMARY KEY (learner_id, accessory_id)
);

-- 9.2: outbound webhooks. The secret is per subscription so revoking one
-- does not invalidate the others.
CREATE TABLE IF NOT EXISTS webhooks (
  id         TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  secret     TEXT NOT NULL,
  events     TEXT NOT NULL,
  created_by TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
-- Delivery outcomes, so a silently broken integration is visible rather than
-- something a school discovers weeks later.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id         TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,
  status     TEXT NOT NULL,
  error      TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_hook ON webhook_deliveries(webhook_id, at DESC);

-- 4.3.2: groups within a class, so one assignment can differentiate.
CREATE TABLE IF NOT EXISTS class_groups (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id   TEXT NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, learner_id)
);
-- Per-learner adjustments to one assignment: a later deadline, an easier
-- tier. Held apart from the assignment rather than duplicating it, so the
-- teacher still has ONE assignment to track and one place to see who is
-- working to a different arrangement.
CREATE TABLE IF NOT EXISTS assignment_accommodations (
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  learner_id    TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  tier          TEXT,
  due_at        TEXT,
  note          TEXT,
  set_at        TEXT NOT NULL,
  PRIMARY KEY (assignment_id, learner_id)
);
CREATE INDEX IF NOT EXISTS idx_group_class ON class_groups(class_id);

-- 6.6: one ability estimate per learner PER TRACK. Composite key rather than
-- two columns on learners, so adding a third track later is a row, not a
-- migration -- and so a learner with no advanced history simply has no row
-- instead of a zero that reads like a measurement.
CREATE TABLE IF NOT EXISTS track_ability (
  learner_id   TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  track        TEXT NOT NULL,
  theta        REAL NOT NULL,
  se           REAL NOT NULL,
  observations INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (learner_id, track)
);

-- 7.6: administrator-configurable platform settings. Key/value because the
-- alternative is a column per setting and a migration every time one is added.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- 7.2: summative tests spanning a whole unit.
-- Kept in their own table rather than folded into runs, because a run is
-- keyed by topic and a unit test is not about one topic. Writing it into runs
-- would mean inventing a fake topic id, which would then leak into every
-- per-topic query — progress, time on task, the readiness signals — as a
-- topic that does not exist. The per-topic breakdown is stored as JSON since
-- it is always read whole, alongside the result it belongs to.
CREATE TABLE IF NOT EXISTS unit_tests (
  id          TEXT PRIMARY KEY,
  learner_id  TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  unit_key    TEXT NOT NULL,
  unit_name   TEXT NOT NULL,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  pct         INTEGER NOT NULL,
  threshold   INTEGER NOT NULL,
  passed      INTEGER NOT NULL,
  breakdown   TEXT NOT NULL,
  seconds     INTEGER,
  finished_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_unit_tests_learner ON unit_tests(learner_id, finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_due ON review_schedule(learner_id, due_at);

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
  // 4.2.2: which curriculum a child is following. Defaults to core so existing
  // learners keep exactly the coverage they had before this column existed.
  if (addColumn("learners", "track", "TEXT NOT NULL DEFAULT 'core'")) applied.push("learners.track");
  // 4.2.3: how long a practice round took. Deliberately nullable: NULL means the
  // round predates this column and was never measured, which is a different fact
  // from a round that genuinely took under a second. Defaulting to 0 conflated
  // the two, and an average over them understates every total.
  if (addColumn("runs", "seconds", "INTEGER")) applied.push("runs.seconds");
  // 4.3.2: an assignment may target one group. NULL means the whole class,
  // which is what every existing assignment was, so no backfill is needed.
  if (addColumn("assignments", "group_id", "TEXT")) applied.push("assignments.group_id");
  // 5.4: which track the points were earned on, so levels can be reported per
  // subject. Nullable on purpose: rows written before this column existed
  // were not attributed, and calling them "core" would invent a measurement.
  if (addColumn("awards", "track", "TEXT")) applied.push("awards.track");
  // Two foreign keys were wrong in a way ALTER TABLE cannot reach, so these
  // rebuild the table and copy the rows across.
  if (rebuild("content_reviews", /reviewer_id[^,]*ON DELETE CASCADE/i,
    `CREATE TABLE content_reviews_new (
       id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, content_hash TEXT NOT NULL,
       status TEXT NOT NULL, reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
       notes TEXT, at TEXT NOT NULL);
     INSERT INTO content_reviews_new SELECT id, topic_id, content_hash, status, reviewer_id, notes, at
       FROM content_reviews;`)) applied.push("content_reviews.reviewer_id");
  if (rebuild("team_members", /learner_id[^,]*PRIMARY KEY/i,
    `CREATE TABLE team_members_new (
       learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
       team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
       class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
       joined_at TEXT NOT NULL, PRIMARY KEY (learner_id, class_id));
     INSERT INTO team_members_new SELECT m.learner_id, m.team_id, t.class_id, m.joined_at
       FROM team_members m JOIN teams t ON t.id = m.team_id;`)) applied.push("team_members.class_id");
  return applied;
}

/* Rebuild a table whose definition cannot be corrected with ALTER TABLE.

   Runs only when the CURRENT definition still matches `stale`, so it is a
   no-op on a database already carrying the corrected schema and on a fresh
   one. Foreign keys are disabled around it because dropping the old table
   would otherwise cascade the rows we are in the middle of copying, and the
   pragma is a no-op inside a transaction — hence the explicit ordering. */
function rebuild(table, stale, ddl) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!row || !stale.test(row.sql)) return false;
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`BEGIN;
      ${ddl}
      DROP TABLE ${table};
      ALTER TABLE ${table}_new RENAME TO ${table};
      COMMIT;`);
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* nothing open */ }
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  return true;
}

const appliedMigrations = migrate();
if (appliedMigrations.length && process.env.NODE_ENV !== "test")
  console.log("migrations applied:", appliedMigrations.join(", "));
