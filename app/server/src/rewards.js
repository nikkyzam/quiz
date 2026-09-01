/* Points, badges and streaks (spec 5.1, 5.2, 5.4, 5.5).

   Advanced work is worth more than core work, as the spec asks. Badges are
   awarded once and never revoked; the unique index in the schema enforces
   that even if this module is called twice for the same event. */

import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";

export const BADGES = {
  first_steps:      { name: "First Steps",            hint: "Finish your first round" },
  perfect_round:    { name: "Clean Sweep",            hint: "Score 100% on a round" },
  unaided:          { name: "No Hints Needed",        hint: "Score 100% with no hints" },
  topic_mastered:   { name: "Topic Mastered",         hint: "Master every tier of a topic" },
  advanced_starter: { name: "Into the Deep End",      hint: "Finish a round on an advanced topic" },
  number_theory:    { name: "Number Theory Novice",   hint: "Master an advanced number theory topic" },
  combinatorics:    { name: "Combinatorics Champion", hint: "Master an advanced combinatorics topic" },
  persistent:       { name: "Persistent Problem Solver", hint: "Retry a topic after falling short" },
  contest_ready:    { name: "Contest Ready",          hint: "Score 80% or more on a timed paper" },
  streak_3:         { name: "Three in a Row",         hint: "Practise three days running" },
  streak_7:         { name: "A Full Week",            hint: "Practise seven days running" }
};

/* Advanced content is worth more (spec 5.1). */
export function pointsFor({ pct, total, track, hintsUsed = 0 }) {
  const base = Math.round((pct / 100) * total * (track === "adv" ? 15 : 10));
  const penalty = Math.min(base, hintsUsed * 2);
  return Math.max(0, base - penalty);
}

export function award(learnerId, kind, code, amount = 0) {
  try {
    db.prepare("INSERT INTO awards (id, learner_id, kind, code, amount, at) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), learnerId, kind, code, amount, now());
    return true;
  } catch {
    return false;   // badge already held; the unique index refused it
  }
}

const dayKey = iso => iso.slice(0, 10);

/* Consecutive days ending today (or the most recent active day). */
export function streak(learnerId, todayIso = new Date().toISOString()) {
  const days = db.prepare("SELECT DISTINCT substr(at,1,10) d FROM awards WHERE learner_id=? ORDER BY d DESC")
    .all(learnerId).map(r => r.d);
  if (!days.length) return 0;
  const today = dayKey(todayIso);
  const yesterday = dayKey(new Date(new Date(today).getTime() - 86400000).toISOString());
  if (days[0] !== today && days[0] !== yesterday) return 0;   // streak already broken
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]).getTime();
    const cur = new Date(days[i]).getTime();
    if (prev - cur === 86400000) run++; else break;
  }
  return run;
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
  return { points: pts, level, nextLevelAt: nextAt, badges };
}
