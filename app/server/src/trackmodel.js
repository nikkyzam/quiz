/* Separate adaptive models for the core and advanced tracks (spec 6.6).

   One pooled ability estimate per learner cannot express the thing this
   product is built around: children follow two tracks at once, and being
   fluent in grade-level arithmetic says very little about how they will fare
   on competition combinatorics. Pooled, a strong core record drags the
   advanced estimate up and the learner is dropped into enrichment material
   well above them; a weak advanced record drags the core estimate down and
   they are handed practice they finished months ago. Both failures are
   invisible in the average, which is exactly the problem — the average is
   never wrong about a learner who does not exist.

   So ability is held per (learner, track). Each track's estimate is the prior
   for the next topic started in that track, which is what makes it adaptation
   rather than bookkeeping: what a learner has shown in core changes where
   core begins, and leaves advanced alone. */

import { db, now } from "./db.js";
import * as irt from "./irt.js";

export const TRACKS = ["core", "adv"];

/* Ability is remembered, but not with the confidence it was measured at.

   Skill is not static between sessions: a child who tested at a level in
   October is not reliably there in March, and a stored standard error of 0.5
   would state otherwise. Widening the remembered uncertainty makes the prior
   informative without letting it overrule fresh evidence — the new
   diagnostic still leads, the history only decides where it starts. */
const MIN_CARRIED_SD = 0.8;

export function abilityFor(learnerId, track) {
  const row = db.prepare("SELECT theta, se, observations FROM track_ability WHERE learner_id=? AND track=?")
    .get(learnerId, track === "adv" ? "adv" : "core");
  if (!row) return { theta: 0, se: 1, observations: 0, known: false };
  return { theta: row.theta, se: row.se, observations: row.observations, known: true };
}

/* The prior to start a new estimate in this track from, or null when there is
   nothing to go on and the estimator should use its own standard prior. */
export function priorFor(learnerId, track) {
  const a = abilityFor(learnerId, track);
  if (!a.known || a.observations < 1) return null;
  return { mean: a.theta, sd: Math.max(MIN_CARRIED_SD, a.se) };
}

/* Fold new item-level evidence into a track's estimate.

   `responses` is [{ item, correct }] in the same shape irt.js uses, so a
   diagnostic's answers can be handed straight over. The previous estimate is
   the prior, so this accumulates across sessions instead of replacing. */
export function observe(learnerId, track, responses) {
  if (!Array.isArray(responses) || !responses.length) return abilityFor(learnerId, track);
  const key = track === "adv" ? "adv" : "core";
  const prior = priorFor(learnerId, key);
  const { theta, se } = irt.estimateAbility(responses, prior);
  const before = abilityFor(learnerId, key);

  db.prepare(`INSERT INTO track_ability (learner_id, track, theta, se, observations, updated_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(learner_id, track) DO UPDATE SET
                theta=excluded.theta, se=excluded.se,
                observations=track_ability.observations + excluded.observations,
                updated_at=excluded.updated_at`)
    .run(learnerId, key, theta, se, responses.length, now());

  return { theta, se, observations: before.observations + responses.length, known: true };
}

/* Both tracks at once, for the parent-facing view and for anything that needs
   to compare them. Reported separately on purpose: a single number here would
   undo the whole point of keeping two. */
export function profile(learnerId) {
  const out = {};
  for (const track of TRACKS) {
    const a = abilityFor(learnerId, track);
    out[track] = {
      ability: Number(a.theta.toFixed(2)),
      error: Number(a.se.toFixed(2)),
      observations: a.observations,
      measured: a.known && a.observations > 0,
      startsAt: irt.tierForAbility(a.theta)
    };
  }
  return out;
}
