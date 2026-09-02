/* Policy that varies by class or platform (spec 7.6, 4.3.2):
   configurable mastery thresholds, mastery decay, and accommodations.

   thresholdOf(topic) in helpers.js is the platform DEFAULT (90 core / 80
   advanced). thresholdFor(topic, learner) applies, in order: a per-class
   override set by the learner's teacher (the strictest wins when a child is
   in several classes), then a platform-wide setting an admin has changed,
   then the default. Every call site that judges mastery for a specific
   learner goes through thresholdFor. */

import { db, now } from "./db.js";
import { thresholdOf, trackOf, MASTERY } from "./helpers.js";

/* ---------- platform settings (admin) ---------- */
export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(value), now());
}

export const THRESHOLD_BOUNDS = { min: 50, max: 100 };
export const validThreshold = v => Number.isInteger(v) && v >= THRESHOLD_BOUNDS.min && v <= THRESHOLD_BOUNDS.max;

/* Per-class overrides, from class_settings. */
function classOverrides(learnerId) {
  return db.prepare(`SELECT cs.threshold_core, cs.threshold_adv FROM class_members m
                     JOIN class_settings cs ON cs.class_id = m.class_id
                     WHERE m.learner_id=? AND (cs.threshold_core IS NOT NULL OR cs.threshold_adv IS NOT NULL)`)
    .all(learnerId);
}

export function thresholdFor(topicId, learnerId = null) {
  const track = trackOf(topicId) || "core";
  const col = track === "adv" ? "threshold_adv" : "threshold_core";
  if (learnerId) {
    const overrides = classOverrides(learnerId).map(r => r[col]).filter(v => v != null);
    if (overrides.length) return Math.max(...overrides);
  }
  const platform = getSetting("mastery", null);
  if (platform && validThreshold(platform[track])) return platform[track];
  return thresholdOf(topicId);
}

export function thresholdsFor(learnerId = null) {
  return { core: thresholdFor("k-count", learnerId), adv: thresholdFor("k-evenodd", learnerId), defaults: MASTERY };
}

/* ---------- mastery decay (7.6) ----------
   A topic mastered long ago and never revisited is not mastered now. Once
   the spaced-repetition due date is DECAY_GRACE_DAYS past, the topic counts
   as "decayed": the best score is kept, but it drops out of the mastered set
   until a fresh round clears the bar again. */
export const DECAY_GRACE_DAYS = 14;

export function decayed(learnerId, topicId, at = Date.now()) {
  const row = db.prepare("SELECT due_at FROM review_schedule WHERE learner_id=? AND topic_id=?").get(learnerId, topicId);
  if (!row) return false;
  return at - new Date(row.due_at).getTime() > DECAY_GRACE_DAYS * 86400000;
}

/* mastered / decayed / not_yet for one (learner, topic), from the best score
   across tiers. */
export function masteryState(learnerId, topicId, bestPct = null) {
  if (bestPct === null) {
    const r = db.prepare("SELECT MAX(best_pct) b FROM progress WHERE learner_id=? AND topic_id=?").get(learnerId, topicId);
    bestPct = r?.b || 0;
  }
  const bar = thresholdFor(topicId, learnerId);
  if (bestPct < bar) return { state: "not_yet", threshold: bar, bestPct };
  if (decayed(learnerId, topicId)) return { state: "decayed", threshold: bar, bestPct };
  return { state: "mastered", threshold: bar, bestPct };
}

/* ---------- accommodations (4.3.2) ----------
   Set per learner by a teacher; merged across classes in the learner's
   favour. They change the conditions of a check, never its marking. */
export const ACCOMMODATION_DEFAULTS = { extraTimePct: 0, hintsInChecks: false, shorterChecks: false, readAloud: false, notes: "" };

export function accommodationsFor(learnerId) {
  const rows = db.prepare("SELECT * FROM accommodations WHERE learner_id=?").all(learnerId);
  const out = { ...ACCOMMODATION_DEFAULTS };
  for (const r of rows) {
    out.extraTimePct = Math.max(out.extraTimePct, r.extra_time_pct);
    out.hintsInChecks = out.hintsInChecks || !!r.hints_in_checks;
    out.shorterChecks = out.shorterChecks || !!r.shorter_checks;
    out.readAloud = out.readAloud || !!r.read_aloud;
    if (r.notes) out.notes = out.notes ? `${out.notes}; ${r.notes}` : r.notes;
  }
  return out;
}
