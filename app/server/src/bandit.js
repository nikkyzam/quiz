/* Multi-armed bandit for difficulty selection (spec 6.3).

   The arms are the three tiers. After every answer the posterior for the tier
   that was served is updated, and the next tier is chosen by Thompson sampling
   — draw once from each arm's Beta posterior and take the best draw.

   The reward is the whole design, and it is not "did they get it right".
   A bandit rewarded for correctness alone converges on the easiest tier and
   parks the learner there forever, which is the opposite of adaptive. Reward
   here is correctness WEIGHTED BY DIFFICULTY, so the expected value of a tier
   is p(correct at that tier) x what that tier is worth. The maximum sits at the
   hardest tier the learner can still mostly succeed at, which is the thing the
   spec is actually asking for.

   Thompson sampling rather than epsilon-greedy because exploration should fall
   away as evidence accumulates: a learner with one observation should still be
   tried at other tiers, one with fifty should not be randomly dropped to
   practice. The Beta posterior does that on its own, with no schedule to tune. */

import { db, now } from "./db.js";

export const TIERS = ["practice", "challenge", "boss"];

/* What succeeding at each tier is worth. The ratios matter, not the units:
   getting a boss question right is worth three practice questions, so the
   bandit will accept a markedly lower success rate to stay there. */
export const TIER_WEIGHT = { practice: 1, challenge: 2, boss: 3 };

/* Beta(1,1) — uniform. Every tier starts equally plausible, which is what
   produces exploration early and confidence later without a tuning knob. */
const PRIOR_A = 1, PRIOR_B = 1;

function arm(learnerId, topicId, tier) {
  const row = db.prepare(
    "SELECT successes, failures FROM bandit_arms WHERE learner_id=? AND topic_id=? AND tier=?")
    .get(learnerId, topicId, tier);
  return { successes: row ? row.successes : 0, failures: row ? row.failures : 0 };
}

export function arms(learnerId, topicId) {
  return TIERS.map(tier => {
    const { successes, failures } = arm(learnerId, topicId, tier);
    const a = PRIOR_A + successes, b = PRIOR_B + failures;
    return {
      tier, successes, failures,
      /* Posterior mean, for reporting. The selection uses a draw, not this. */
      pSuccess: a / (a + b),
      expectedValue: (a / (a + b)) * TIER_WEIGHT[tier]
    };
  });
}

export function observe(learnerId, topicId, tier, correct) {
  if (!TIERS.includes(tier)) return;
  db.prepare(`INSERT INTO bandit_arms (learner_id, topic_id, tier, successes, failures, updated_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(learner_id, topic_id, tier) DO UPDATE SET
                successes = bandit_arms.successes + excluded.successes,
                failures  = bandit_arms.failures  + excluded.failures,
                updated_at = excluded.updated_at`)
    .run(learnerId, topicId, tier, correct ? 1 : 0, correct ? 0 : 1, now());
}

/* Gamma(k,1) for integer k by summing exponentials — enough for Beta draws
   with the small integer shapes this ever sees, and it keeps the module free
   of a statistics dependency. */
function gamma(k, rand) {
  let sum = 0;
  for (let i = 0; i < k; i++) sum -= Math.log(1 - rand());
  return sum;
}
function betaSample(a, b, rand) {
  const x = gamma(a, rand), y = gamma(b, rand);
  return x + y === 0 ? 0.5 : x / (x + y);
}

/* The next tier to serve.
   `rand` is injectable so the selection can be tested deterministically; a
   bandit that can only be observed through randomness cannot be asserted on. */
export function selectTier(learnerId, topicId, rand = Math.random) {
  let best = TIERS[0], bestDraw = -Infinity;
  for (const tier of TIERS) {
    const { successes, failures } = arm(learnerId, topicId, tier);
    const draw = betaSample(PRIOR_A + successes, PRIOR_B + failures, rand) * TIER_WEIGHT[tier];
    if (draw > bestDraw) { bestDraw = draw; best = tier; }
  }
  return best;
}

/* What the bandit would do with no randomness at all — the tier with the
   highest expected value. Used for reporting and for asserting the reward
   shape without fighting a sampler. */
export function greedyTier(learnerId, topicId) {
  return arms(learnerId, topicId).reduce((a, b) => (b.expectedValue > a.expectedValue ? b : a)).tier;
}
