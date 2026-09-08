/* Points, badges and streaks (spec 5.1, 5.2, 5.4, 5.5).

   Advanced work is worth more than core work, as the spec asks. Badges are
   awarded once and never revoked; the unique index in the schema enforces
   that even if this module is called twice for the same event. */

import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";

/* The catalogue lives in badges.js alongside the conditions that earn each
   entry, so the two cannot drift. Re-exported here because callers across the
   codebase already ask rewards for it. */
export { BADGES, EVENT_BADGES, statsFor, evaluate as evaluateBadges } from "./badges.js";
import { BADGES } from "./badges.js";

/* Advanced content is worth more (spec 5.1). */
export function pointsFor({ pct, total, track, hintsUsed = 0 }) {
  const base = Math.round((pct / 100) * total * (track === "adv" ? 15 : 10));
  const penalty = Math.min(base, hintsUsed * 2);
  return Math.max(0, base - penalty);
}

export function award(learnerId, kind, code, amount = 0, track = null) {
  try {
    db.prepare("INSERT INTO awards (id, learner_id, kind, code, amount, at, track) VALUES (?,?,?,?,?,?,?)")
      .run(randomUUID(), learnerId, kind, code, amount, now(), track);
    return true;
  } catch {
    return false;   // badge already held; the unique index refused it
  }
}

const dayKey = iso => iso.slice(0, 10);

/* Consecutive days ending today (or the most recent active day). */
/* How many freezes a learner may hold at once.

   Capped, and the cap is the whole design. An uncapped balance turns into an
   unbreakable streak: a child who practises hard for a month banks enough
   tokens to cover every day of the next one, and the streak stops reporting
   practice at all. Two is enough to survive an illness or a holiday weekend
   without the number becoming a fiction. */
export const MAX_FREEZES = 2;
const FREEZE_EARNED_EVERY = 7;   // one per week of unbroken practice

const activeDays = learnerId =>
  db.prepare("SELECT DISTINCT substr(at,1,10) d FROM awards WHERE learner_id=? ORDER BY d DESC")
    .all(learnerId).map(r => r.d);

export const freezeBalance = learnerId =>
  db.prepare("SELECT COUNT(*) c FROM streak_freezes WHERE learner_id=? AND spent_on IS NULL")
    .get(learnerId).c;

const spentDays = learnerId => new Set(
  db.prepare("SELECT spent_on FROM streak_freezes WHERE learner_id=? AND spent_on IS NOT NULL")
    .all(learnerId).map(r => r.spent_on));

/* Grant a freeze for each full week of unbroken practice, up to the cap.

   "Already earned" is counted within THIS streak, not over the learner's
   lifetime. Comparing a lifetime total against a current-streak entitlement
   ratchets the requirement up for ever: a learner who earned two freezes,
   spent them, then broke their streak would need 21 unbroken days for the
   next one, then 28, then 35 — while the rule they were told is "one a
   week". Scoping the count to the run makes the rule the rule. */
export function grantFreezes(learnerId, todayIso = new Date().toISOString()) {
  const { run, start } = streakRun(learnerId, todayIso);
  const earned = start
    ? db.prepare("SELECT COUNT(*) c FROM streak_freezes WHERE learner_id=? AND earned_at >= ?")
        .get(learnerId, start).c
    : 0;
  const deserved = Math.floor(run / FREEZE_EARNED_EVERY);
  let granted = 0;
  while (earned + granted < deserved && freezeBalance(learnerId) < MAX_FREEZES) {
    db.prepare("INSERT INTO streak_freezes (id, learner_id, earned_at) VALUES (?,?,?)")
      .run(randomUUID(), learnerId, now());
    granted++;
  }
  return { granted, balance: freezeBalance(learnerId) };
}

/* Spend a freeze on YESTERDAY if it was missed and the streak is otherwise
   alive.

   Only yesterday, and only at the moment of activity. A freeze cannot be
   spent on an arbitrary past date, so returning after a long absence does not
   let one token repair the whole gap — the streak is broken and stays broken,
   which is the honest answer. */
export function useFreezeIfNeeded(learnerId, todayIso = new Date().toISOString()) {
  const today = dayKey(todayIso);
  const yesterday = dayKey(new Date(new Date(today).getTime() - 86400000).toISOString());
  const days = new Set(activeDays(learnerId));
  const covered = spentDays(learnerId);

  if (days.has(yesterday) || covered.has(yesterday)) return { used: false, reason: "yesterday was not missed" };
  /* Nothing to protect: if the day before yesterday was also missed the
     streak has already ended, and a freeze cannot resurrect it. */
  const dayBefore = dayKey(new Date(new Date(today).getTime() - 2 * 86400000).toISOString());
  if (!days.has(dayBefore) && !covered.has(dayBefore))
    return { used: false, reason: "the streak was already broken" };

  const spare = db.prepare("SELECT id FROM streak_freezes WHERE learner_id=? AND spent_on IS NULL LIMIT 1")
    .get(learnerId);
  if (!spare) return { used: false, reason: "no freeze available" };
  db.prepare("UPDATE streak_freezes SET spent_on=?, spent_at=? WHERE id=?")
    .run(yesterday, now(), spare.id);
  return { used: true, day: yesterday, balance: freezeBalance(learnerId) };
}

/* The current run AND the day it started on.

   The start date is what makes freezes grantable more than once: a freeze is
   earned per week of THIS streak, so the count of freezes already earned has
   to be scoped to this streak too, and that needs to know where it began. */
export function streakRun(learnerId, todayIso = new Date().toISOString()) {
  const days = activeDays(learnerId);
  if (!days.length) return { run: 0, start: null };
  const covered = spentDays(learnerId);
  const today = dayKey(todayIso);
  const yesterday = dayKey(new Date(new Date(today).getTime() - 86400000).toISOString());
  if (days[0] !== today && days[0] !== yesterday) return { run: 0, start: null };

  /* Walk back a day at a time. A day counts if it saw activity OR a freeze
     was spent on it, so a protected gap continues the run instead of ending
     it — and because freezes are recorded per day, the same token cannot
     cover a second gap later. */
  const active = new Set(days);
  let cursor = active.has(today) ? today : yesterday;
  let run = 0;
  let start = cursor;
  while (true) {
    if (active.has(cursor)) run++;
    else if (covered.has(cursor)) { /* protected: the run continues, but a
                                       frozen day is not a day of practice
                                       and is not counted as one */ }
    else break;
    start = cursor;
    cursor = dayKey(new Date(new Date(cursor).getTime() - 86400000).toISOString());
  }
  return { run, start };
}

export function streak(learnerId, todayIso = new Date().toISOString()) {
  return streakRun(learnerId, todayIso).run;
}

/* Achievement titles (spec 5.10): earned by mastering advanced strands,
   shown beside the learner's name. Ordered so the strongest wins. */
export const TITLES = [
  { code: "grand_combinatorialist", name: "Grand Combinatorialist", needs: ["combinatorics", "topic_mastered"] },
  { code: "master_of_modular",      name: "Master of Modular Arithmetic", needs: ["number_theory", "topic_mastered"] },
  { code: "proof_wright",           name: "Proof-Wright",          needs: ["elegant_solution", "unaided"] },
  { code: "contest_contender",      name: "Contest Contender",     needs: ["contest_ready"] },
  { code: "steady_hand",            name: "Steady Hand",           needs: ["streak_7"] },
  { code: "apprentice",             name: "Apprentice",            needs: ["first_steps"] }
];

export function titleFor(learnerId) {
  const held = new Set(db.prepare("SELECT code FROM awards WHERE learner_id=? AND kind='badge'")
    .all(learnerId).map(r => r.code));
  const earned = TITLES.filter(t => t.needs.every(n => held.has(n)));
  return { current: earned[0] || null, earned, locked: TITLES.filter(t => !earned.includes(t)) };
}

/* Levels per track, and prestige on the advanced one (spec 5.4).

   Prestige is DERIVED from the level rather than stored as a counter. A
   stored counter and a computed level are two records of the same fact, and
   they drift: recalculating points, correcting an award, or replaying history
   would move one and not the other, and a child would see their prestige stars
   disagree with their level. Deriving it means there is only one fact.

   It applies to the advanced track only, as the spec asks. Core work has
   levels but no prestige: the advanced track is where the ceiling is worth
   passing more than once. */
export const LEVEL_CAP = 10;

const levelFromPoints = pts => Math.max(1, Math.floor(Math.sqrt(pts / 50)) + 1);

export function trackTotals(learnerId, track) {
  const pts = db.prepare("SELECT COALESCE(SUM(amount),0) p FROM awards WHERE learner_id=? AND kind='points' AND track=?")
    .get(learnerId, track).p;
  const raw = levelFromPoints(pts);
  const prestige = track === "adv" ? Math.floor((raw - 1) / LEVEL_CAP) : 0;
  /* On the advanced track the displayed level wraps within the cap and the
     passes are shown as prestige; on core it is simply the level. */
  const level = track === "adv" ? ((raw - 1) % LEVEL_CAP) + 1 : raw;
  return {
    track, points: pts, level, prestige,
    levelCap: track === "adv" ? LEVEL_CAP : null,
    nextLevelAt: Math.round(50 * Math.pow(raw, 2))
  };
}

export function bySubject(learnerId) {
  return { core: trackTotals(learnerId, "core"), adv: trackTotals(learnerId, "adv") };
}

export function totals(learnerId) {
  const pts = db.prepare("SELECT COALESCE(SUM(amount),0) p FROM awards WHERE learner_id=? AND kind='points'")
    .get(learnerId).p;
  const badges = db.prepare("SELECT code, at FROM awards WHERE learner_id=? AND kind='badge' ORDER BY at")
    .all(learnerId)
    .map(b => ({ code: b.code, at: b.at, ...(BADGES[b.code] || { name: b.code }) }));
  /* Levels grow with the square root of points, so early levels come quickly
     and later ones take real work. */
  const level = Math.max(1, Math.floor(Math.sqrt(pts / 50)) + 1);
  const nextAt = Math.round(50 * Math.pow(level, 2));
  return { points: pts, level, nextLevelAt: nextAt, badges, title: titleFor(learnerId),
           subjects: bySubject(learnerId) };
}
