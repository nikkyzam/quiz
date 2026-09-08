/* Challenge of the day and daily goals (spec 4.1.2).

   The challenge is derived from the date rather than stored or drawn at
   random. Two consequences make that the right choice: every learner gets the
   SAME problem on a given day, which is what makes it something to talk about
   at a table or in a class; and it cannot be re-rolled by reloading, which a
   random pick would allow — a child could spin until they got an easy one,
   and the challenge would stop being a challenge.

   The seed is the calendar date, so it turns over at local midnight and is
   reproducible after the fact: an adult can look up what yesterday's was. */

import { db, now } from "./db.js";

export const todayKey = (at = new Date()) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

/* A small deterministic hash. Not security, just a stable spread of dates
   across the question bank. */
function seedFrom(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* Pick the day's question from the authored banks.

   `topics` is sorted so the choice does not depend on object key order. That
   is necessary but NOT sufficient for reproducibility: the index is taken
   modulo how many banks there are, so publishing new content reshuffles every
   past date too. Authoring went from 16 banks to 147 in one stretch of work,
   which silently rewrote what every previous day's challenge had been.

   So this function decides a date that has never been decided before, and
   resolveChallenge() below is what the product actually calls. */
export function challengeFor(dateKey, questions) {
  const topics = Object.keys(questions).filter(t => questions[t]?.length).sort();
  if (!topics.length) return null;
  const seed = seedFrom(dateKey);
  const topicId = topics[seed % topics.length];
  const bank = questions[topicId];
  const idx = Math.floor(seed / topics.length) % bank.length;
  return { topicId, idx, dateKey };
}

/* The day's challenge, decided once and then remembered.

   The first request for a date writes the pick down; every later request —
   tomorrow, or next year from an adult looking up what their child was asked
   — reads that row back. This is what makes the two promises in the header
   true rather than approximately true: everyone gets the same problem on a
   given day even across a deploy that lands at lunchtime, and a past date
   still resolves to the question that was actually served.

   A remembered pick is validated against the banks before it is used, so
   content that has since been deleted or shortened degrades to a fresh pick
   rather than a crash or a blank question. */
export function resolveChallenge(dateKey, questions) {
  const key = `daily:${dateKey}`;
  const stored = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  if (stored) {
    try {
      const { topicId, idx } = JSON.parse(stored.value);
      if (questions[topicId]?.[idx]) return { topicId, idx, dateKey };
    } catch { /* unreadable row: fall through and decide again */ }
  }

  const pick = challengeFor(dateKey, questions);
  if (!pick) return null;
  /* DO NOTHING on conflict, then read back, so two learners arriving in the
     same millisecond both end up on whichever pick won rather than each
     trusting their own. */
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
              ON CONFLICT(key) DO NOTHING`)
    .run(key, JSON.stringify({ topicId: pick.topicId, idx: pick.idx }), now());
  const winner = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  try {
    const { topicId, idx } = JSON.parse(winner.value);
    if (questions[topicId]?.[idx]) return { topicId, idx, dateKey };
  } catch { /* fall through */ }
  return pick;
}

export const attemptFor = (learnerId, dateKey) =>
  db.prepare("SELECT * FROM daily_attempts WHERE learner_id=? AND date_key=?").get(learnerId, dateKey) || null;

export function recordAttempt(learnerId, dateKey, correct) {
  /* First attempt of the day only. Without this a learner could answer, see
     the explanation, and answer again for the reward — and the streak it
     feeds would measure persistence at re-submitting rather than practice. */
  /* The primary key is the real guard, not the read above it: two submissions
     arriving together both pass a check-then-insert and the second one used to
     throw a constraint violation out of the request as a 500. Letting the
     constraint decide, and reporting from the row count, makes a double-tap
     the 409 it should always have been. */
  const done = db.prepare(`INSERT INTO daily_attempts (learner_id, date_key, correct, at)
                           VALUES (?,?,?,?)
                           ON CONFLICT(learner_id, date_key) DO NOTHING`)
    .run(learnerId, dateKey, correct ? 1 : 0, now());
  return { alreadyDone: done.changes === 0, attempt: attemptFor(learnerId, dateKey) };
}

/* Today's goal progress.

   The stored goal is weekly, because that is the unit a family actually plans
   in. A daily target is derived from it rather than stored separately, so the
   two can never disagree — and it is rounded UP, since rounding 3 rounds a
   week down to 0 a day would present a real goal as no goal at all. */
export function todayProgress(learnerId, at = new Date()) {
  const key = todayKey(at);
  const goal = db.prepare("SELECT rounds_per_week, minutes_per_week FROM goals WHERE learner_id=?")
    .get(learnerId) || { rounds_per_week: 0, minutes_per_week: 0 };

  const startOfDay = new Date(at); startOfDay.setHours(0, 0, 0, 0);
  const rows = db.prepare("SELECT seconds FROM runs WHERE learner_id=? AND finished_at >= ?")
    .all(learnerId, startOfDay.toISOString());

  const roundsTarget = Math.ceil((goal.rounds_per_week || 0) / 7);
  const minutesTarget = Math.ceil((goal.minutes_per_week || 0) / 7);
  const roundsDone = rows.length;
  /* Rounds recorded before durations existed have a NULL seconds and are not
     counted as zero-minute rounds — that would understate the day's work. */
  const minutesDone = Math.round(rows.reduce((s, r) => s + (r.seconds || 0), 0) / 60);

  return {
    date: key,
    rounds: { done: roundsDone, target: roundsTarget, met: roundsTarget > 0 && roundsDone >= roundsTarget },
    minutes: { done: minutesDone, target: minutesTarget, met: minutesTarget > 0 && minutesDone >= minutesTarget },
    goalSet: (goal.rounds_per_week || 0) > 0 || (goal.minutes_per_week || 0) > 0,
    weeklyGoal: { rounds: goal.rounds_per_week || 0, minutes: goal.minutes_per_week || 0 }
  };
}
