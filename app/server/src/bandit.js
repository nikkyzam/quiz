/* Multi-armed bandit for difficulty selection (spec 6.3).

   Each tier of a topic is an arm. The arm's reward is "the learner answered
   correctly", tracked as a Beta posterior per (learner, topic, tier). Thompson
   sampling draws one plausible success rate per arm and picks the arm whose
   draw, weighted by how much a harder tier is worth, is highest.

   The weighting is the pedagogy: an easy question a learner will certainly
   get right teaches little, and a hard one they will certainly miss teaches
   less. Weighting harder tiers more means the policy reaches for the hardest
   tier the learner will probably manage — the zone of productive struggle —
   and backs off on its own as failures accumulate there. A streak rule
   cannot express uncertainty; this can, which is why it explores a tier it
   has not tried before rather than waiting for two answers in a row. */

import { db } from "./db.js";

export const ARMS = ["practice", "challenge", "boss"];
export const WEIGHT = { practice: 1.0, challenge: 1.6, boss: 2.2 };

/* Marsaglia–Tsang gamma sampler, shape >= 1, which holds because every
   posterior here starts from Beta(1, 1). */
function gamma(shape, rnd) {
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      /* Box–Muller for a standard normal. */
      const u1 = rnd() || 1e-12, u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(alpha, beta, rnd = Math.random) {
  const x = gamma(alpha, rnd), y = gamma(beta, rnd);
  return x / (x + y);
}

/* arms: { tier: { successes, failures } }. Returns the tier to serve. */
export function choose(arms, rnd = Math.random, available = ARMS) {
  let best = null, bestScore = -Infinity;
  for (const tier of ARMS) {
    if (!available.includes(tier)) continue;
    const a = arms[tier] || { successes: 0, failures: 0 };
    const p = sampleBeta(1 + a.successes, 1 + a.failures, rnd);
    const score = p * WEIGHT[tier];
    if (score > bestScore) { best = tier; bestScore = score; }
  }
  return best;
}

/* ---------- persistence ---------- */
export function load(learnerId, topicId) {
  const rows = db.prepare("SELECT tier, successes, failures FROM bandit_arms WHERE learner_id=? AND topic_id=?")
    .all(learnerId, topicId);
  const arms = {};
  for (const t of ARMS) arms[t] = { successes: 0, failures: 0 };
  for (const r of rows) arms[r.tier] = { successes: r.successes, failures: r.failures };
  return arms;
}

export function record(learnerId, topicId, tier, correct) {
  db.prepare(`INSERT INTO bandit_arms (learner_id, topic_id, tier, successes, failures)
              VALUES (?,?,?,?,?)
              ON CONFLICT(learner_id, topic_id, tier) DO UPDATE SET
                successes = successes + excluded.successes,
                failures  = failures  + excluded.failures`)
    .run(learnerId, topicId, tier, correct ? 1 : 0, correct ? 0 : 1);
}

/* Seed a tier with prior evidence, e.g. from an IRT placement, so a learner
   who was just placed at "challenge" is not started from a blank slate. */
export function seed(learnerId, topicId, tier, successes = 2) {
  db.prepare(`INSERT OR IGNORE INTO bandit_arms (learner_id, topic_id, tier, successes, failures)
              VALUES (?,?,?,?,0)`).run(learnerId, topicId, tier, successes);
}
