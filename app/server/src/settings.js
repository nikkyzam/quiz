/* Platform settings that an administrator can change at run time (spec 7.6).

   Mastery thresholds were compile-time constants: 90% for core skills, 80%
   for advanced. Those are good defaults and stay the defaults, but a school
   running an intervention group and a school running a competition squad do
   not agree on where "mastered" sits, and neither should have to fork the
   code to say so.

   Stored rather than held in memory, because a threshold that resets on
   every deploy is not a setting — a class would silently revert to 90% in
   the middle of a term and nobody would be told. */

import { db, now } from "./db.js";

export const DEFAULT_MASTERY = { core: 90, adv: 80 };

/* A threshold below this is not a standard, it is a formality: at 40% a
   learner who gets more wrong than right is recorded as having mastered the
   topic, and every downstream signal built on mastery — the review queue,
   readiness, unit placement — quietly becomes noise. 100 is allowed but
   means perfection on every question. */
export const MASTERY_MIN = 50;
export const MASTERY_MAX = 100;

const KEY = "mastery.thresholds";

/* Read through to the database on every call rather than caching.

   A cache here would have to be invalidated across processes: the scheduled
   sweep, a second worker, or the next deploy would each hold their own copy,
   and a threshold change would apply in one and not the others. The read is
   a single indexed lookup on a table with a handful of rows. */
export function masteryThresholds() {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY);
  if (!row) return { ...DEFAULT_MASTERY };
  try {
    const parsed = JSON.parse(row.value);
    return {
      core: clamp(parsed.core, DEFAULT_MASTERY.core),
      adv: clamp(parsed.adv, DEFAULT_MASTERY.adv)
    };
  } catch {
    /* A malformed row must not take mastery with it. Falling back to the
       defaults keeps the platform coherent; failing here would break every
       endpoint that asks what "mastered" means. */
    return { ...DEFAULT_MASTERY };
  }
}

function clamp(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MASTERY_MAX, Math.max(MASTERY_MIN, Math.round(n)));
}

/* Returns { ok, thresholds } or { ok: false, error }. Refuses out-of-range
   values outright rather than silently clamping them: an admin who typed 5
   meant something, and quietly storing 50 would leave them believing the
   platform is doing what they asked. */
export function setMasteryThresholds({ core, adv }, userId) {
  for (const [name, value] of [["core", core], ["adv", adv]]) {
    const n = Number(value);
    if (!Number.isInteger(n))
      return { ok: false, error: `${name} threshold must be a whole number` };
    if (n < MASTERY_MIN || n > MASTERY_MAX)
      return { ok: false, error: `${name} threshold must be between ${MASTERY_MIN} and ${MASTERY_MAX}` };
  }
  const value = JSON.stringify({ core: Number(core), adv: Number(adv) });
  db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value,
                                             updated_at=excluded.updated_at,
                                             updated_by=excluded.updated_by`)
    .run(KEY, value, now(), userId || null);
  return { ok: true, thresholds: masteryThresholds() };
}

export function resetMasteryThresholds() {
  db.prepare("DELETE FROM settings WHERE key = ?").run(KEY);
  return { ...DEFAULT_MASTERY };
}
