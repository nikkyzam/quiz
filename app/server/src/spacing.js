/* Spaced repetition (spec 3.3.3, 6.4).

   An SM-2 style scheduler: each topic carries an interval and an ease factor.
   A good review multiplies the interval by the ease; a poor one collapses it
   back to a day and reduces the ease, so weak material returns quickly and
   secure material drifts further out. Intervals adapt to the individual
   learner rather than following a fixed calendar. */

import { db, now } from "./db.js";

const DAY_MS = 86_400_000;
const MIN_EASE = 1.3;

/* score 0..1 from the most recent attempt on the topic */
export function schedule(learnerId, topicId, score, at = new Date()) {
  const prev = db.prepare("SELECT * FROM review_schedule WHERE learner_id=? AND topic_id=?")
    .get(learnerId, topicId);

  let interval = prev ? prev.interval_days : 1;
  let ease = prev ? prev.ease : 2.5;
  let reps = prev ? prev.reps : 0;
  let lapses = prev ? prev.lapses : 0;

  const good = score >= 0.6;
  if (good) {
    reps++;
    // First two successes use fixed short steps; after that grow by ease.
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.min(180, interval * ease);
    ease = Math.min(2.8, ease + (score >= 0.9 ? 0.1 : 0));
  } else {
    lapses++;
    reps = 0;
    interval = 1;
    ease = Math.max(MIN_EASE, ease - 0.2);
  }

  const due = new Date(at.getTime() + interval * DAY_MS).toISOString();
  db.prepare(`INSERT INTO review_schedule
      (learner_id, topic_id, interval_days, ease, reps, lapses, due_at, last_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(learner_id, topic_id) DO UPDATE SET
        interval_days=excluded.interval_days, ease=excluded.ease, reps=excluded.reps,
        lapses=excluded.lapses, due_at=excluded.due_at, last_at=excluded.last_at`)
    .run(learnerId, topicId, interval, ease, reps, lapses, due, at.toISOString());

  return { intervalDays: interval, ease, reps, lapses, dueAt: due };
}

/* Everything due on or before `at`, soonest first. */
export function due(learnerId, at = new Date()) {
  return db.prepare(
    "SELECT * FROM review_schedule WHERE learner_id=? AND due_at <= ? ORDER BY due_at")
    .all(learnerId, at.toISOString());
}

export function scheduleFor(learnerId) {
  return db.prepare("SELECT * FROM review_schedule WHERE learner_id=? ORDER BY due_at")
    .all(learnerId);
}
