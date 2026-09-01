/* Bayesian Knowledge Tracing (spec 6.3).

   Tracks P(the learner knows this skill) and updates it after every answer.
   Four parameters per skill:
     pInit  — prior probability of knowing it before any evidence
     pLearn — chance of learning it from one opportunity
     pSlip  — chance of getting it wrong despite knowing it
     pGuess — chance of getting it right without knowing it

   The slip and guess terms are the point: a single lucky answer must not
   declare mastery, and one careless slip must not erase it. A streak counter
   cannot express that, which is why the spec asks for this model. */

import { db, now } from "./db.js";

export const DEFAULTS = { pInit: 0.25, pLearn: 0.15, pSlip: 0.10, pGuess: 0.20 };

/* Multiple-choice questions are easier to guess, so the guess rate depends on
   how many options there were. */
export function paramsFor({ optionCount = 0 } = {}) {
  const pGuess = optionCount > 1 ? Math.min(0.45, 1 / optionCount) : DEFAULTS.pGuess;
  return { ...DEFAULTS, pGuess };
}

/* One observation. Returns the posterior probability of knowing the skill. */
export function update(pKnown, correct, params = DEFAULTS) {
  const { pLearn, pSlip, pGuess } = params;
  const pk = Math.min(0.999, Math.max(0.001, pKnown));

  /* P(known | observation) by Bayes. */
  const numerator = correct
    ? pk * (1 - pSlip)
    : pk * pSlip;
  const denominator = correct
    ? pk * (1 - pSlip) + (1 - pk) * pGuess
    : pk * pSlip + (1 - pk) * (1 - pGuess);
  const posterior = denominator === 0 ? pk : numerator / denominator;

  /* Then allow for learning it during this opportunity. */
  return posterior + (1 - posterior) * pLearn;
}

/* Persisted estimate per (learner, skill). Skills are curriculum topics. */
export function estimate(learnerId, skillId) {
  const row = db.prepare("SELECT p_known, observations FROM skill_state WHERE learner_id=? AND skill_id=?")
    .get(learnerId, skillId);
  return row ? { pKnown: row.p_known, observations: row.observations }
             : { pKnown: DEFAULTS.pInit, observations: 0 };
}

export function observe(learnerId, skillId, correct, params = DEFAULTS) {
  const cur = estimate(learnerId, skillId);
  const next = update(cur.pKnown, correct, params);
  db.prepare(`INSERT INTO skill_state (learner_id, skill_id, p_known, observations, updated_at)
              VALUES (?,?,?,1,?)
              ON CONFLICT(learner_id, skill_id) DO UPDATE SET
                p_known=excluded.p_known,
                observations=skill_state.observations+1,
                updated_at=excluded.updated_at`)
    .run(learnerId, skillId, next, now());
  return { pKnown: next, observations: cur.observations + 1 };
}

export function allFor(learnerId) {
  return db.prepare("SELECT skill_id, p_known, observations, updated_at FROM skill_state WHERE learner_id=? ORDER BY p_known")
    .all(learnerId)
    .map(r => ({ skillId: r.skill_id, pKnown: r.p_known, observations: r.observations, updatedAt: r.updated_at }));
}

/* A skill counts as known once the model is confident AND has seen enough
   evidence — probability alone can look high after a single lucky answer. */
export const MASTERY_P = 0.95;
export const MIN_OBSERVATIONS = 3;
export const isKnown = ({ pKnown, observations }) =>
  pKnown >= MASTERY_P && observations >= MIN_OBSERVATIONS;
