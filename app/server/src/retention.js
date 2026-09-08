/* Automated retention deletion (spec 10.3, 4.4.3).

   Before this, retention was a paragraph of prose on the admin endpoint and
   nothing else. Sessions were said to "expire after 30 days" and did stop
   working, but the rows stayed for ever; the audit log was said to be kept
   while the account existed and was never trimmed. A policy no code reads is
   a description of intentions, and under GDPR/FERPA the obligation is to
   actually stop holding the data.

   So POLICY below is the single source of both: the admin endpoint renders
   it, and the sweep enforces it. They cannot drift apart, because there is
   only one of them.

   What is deliberately NOT swept: a learner's own work — runs, progress,
   mistakes, diagnostics, unit tests. That data is retained for exactly as
   long as the learner exists and is removed with them, by the cascade on
   DELETE. A time-based sweep over a child's progress would quietly delete
   the record of a year's learning from under a family that had done nothing
   wrong, which is a far worse failure than keeping it. Erasure stays
   deliberate: the account holder asks, and it all goes at once. */

import { db, now } from "./db.js";

const DAY = 86_400_000;

export const POLICY = {
  sessions: {
    days: 1,
    basis: "expires_at",
    describe: "sign-in sessions are deleted 1 day after they expire"
  },
  resetTokens: {
    days: 1,
    basis: "expires_at",
    describe: "password-reset tokens are deleted 1 day after they expire, used or not"
  },
  auditLog: {
    /* Thirteen months: long enough to cover a full school year and the
       investigation of anything that happened in it, short enough that the
       log does not become an indefinite record of a child's IP addresses. */
    days: 400,
    basis: "at",
    describe: "audit entries are deleted after 400 days, or with the account if sooner"
  },
  learnerWork: {
    days: null,
    basis: null,
    describe: "runs, progress, mistakes and assessments are kept while the learner exists and deleted with the learner or the account — never on a timer"
  }
};

const cutoff = (days, at = Date.now()) => new Date(at - days * DAY).toISOString();

/* Delete everything past its retention period. Returns what it removed, so a
   scheduled run can be logged and an admin can see the effect before and
   after. `at` is injectable so the behaviour can be tested against a clock
   rather than by waiting 400 days. */
export function sweep({ at = Date.now() } = {}) {
  const removed = {};

  removed.sessions = db.prepare("DELETE FROM sessions WHERE expires_at < ?")
    .run(cutoff(POLICY.sessions.days, at)).changes;

  removed.resetTokens = db.prepare("DELETE FROM reset_tokens WHERE expires_at < ?")
    .run(cutoff(POLICY.resetTokens.days, at)).changes;

  removed.auditLog = db.prepare("DELETE FROM audit_log WHERE at < ?")
    .run(cutoff(POLICY.auditLog.days, at)).changes;

  /* Audit rows outlive the accounts they refer to: user_id has no foreign
     key, so deleting a user leaves its entries behind claiming to describe
     someone who is no longer here. The policy says the log goes with the
     account, and this is what makes that true. Rows with a null user_id are
     system events and are kept — they belong to nobody to delete them with. */
  removed.orphanedAudit = db.prepare(
    "DELETE FROM audit_log WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)"
  ).run().changes;

  markSwept();
  return { at: now(), removed };
}

/* When the sweep last ran, persisted so it survives a restart.

   This is what makes the schedule real on a host that stops the machine when
   it is idle. A setInterval is destroyed with the process, so on a suspending
   deployment a 24-hour timer never reaches its first tick and the policy is
   never enforced — the config looks enabled and does nothing. Recording the
   last run instead means the next boot can see that a sweep is overdue and
   run it.

   It also solves the problem the deferred first-run was there for: a
   crash-looping container cannot sweep on every restart, because the
   timestamp says it already swept minutes ago. */
const LAST_SWEPT = "retention.lastSweptAt";

export const lastSweptAt = () => readStamp(LAST_SWEPT);
const markSwept = () => stamp(LAST_SWEPT);

/* The same due-tracking, reused for scheduled backups.

   Kept here rather than duplicated in backup.js because it is one mechanism —
   "did this periodic job run recently enough" — and two copies of it would
   drift the moment one grew a fix the other did not. */
const LAST_BACKUP = "backup.lastRunAt";
export const backupDue = (intervalHours, at = Date.now()) =>
  dueSince(LAST_BACKUP, intervalHours, at);
export const markBackedUp = () => stamp(LAST_BACKUP);

function stamp(key) {
  db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,NULL)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, now(), now());
}

function readStamp(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function dueSince(key, intervalHours, at) {
  if (!(intervalHours > 0)) return false;
  const last = readStamp(key);
  if (!last) return true;
  const elapsed = at - new Date(last).getTime();
  /* An unparseable stored value must not wedge the job off for ever, so it
     counts as overdue and gets overwritten by the next run. */
  return !Number.isFinite(elapsed) || elapsed >= intervalHours * 3_600_000;
}

/* Is a sweep overdue? Never swept counts as overdue. */
export const isDue = (intervalHours, at = Date.now()) =>
  dueSince(LAST_SWEPT, intervalHours, at);

/* The policy as the admin endpoint reports it, derived from the same object
   the sweep runs on rather than written out a second time in prose. */
export function policyReport() {
  const out = {};
  for (const [key, rule] of Object.entries(POLICY)) out[key] = rule.describe;
  return out;
}
