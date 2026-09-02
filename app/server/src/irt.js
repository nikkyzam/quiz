/* Item Response Theory (spec 6.1).

   A two-parameter logistic model: the chance a learner of ability θ answers
   an item right is 1 / (1 + e^(-a(θ - b))), where b is the item's difficulty
   and a its discrimination. Ability is estimated by expected a posteriori
   (EAP) over a grid with a standard-normal prior, which is stable from the
   first answer and never diverges the way maximum likelihood does on an
   all-correct or all-wrong run.

   The diagnostic uses this two ways: the next item is the one carrying the
   most Fisher information at the current estimate, and the run stops as soon
   as the standard error is small enough — or after a fixed maximum, so a
   noisy learner is never questioned forever.

   Item parameters are set per tier. They are a modelling choice, not values
   fitted from real response data; requirement 13.2 covers that calibration
   and needs real learners. */

export const ITEM_PARAMS = {
  practice:  { a: 1.0, b: -1.2 },
  challenge: { a: 1.2, b: 0.0 },
  boss:      { a: 1.4, b: 1.2 }
};

export const GRID = Array.from({ length: 61 }, (_, i) => -3 + i * 0.1);

/* Probability of a correct answer at ability theta. */
export function prob(theta, { a = 1, b = 0 } = {}) {
  return 1 / (1 + Math.exp(-a * (theta - b)));
}

/* Fisher information an item carries at theta: highest where p ≈ 0.5. */
export function info(theta, item) {
  const p = prob(theta, item);
  return item.a * item.a * p * (1 - p);
}

const prior = t => Math.exp(-0.5 * t * t);

/* EAP estimate from a list of { item, correct }. Returns theta and its
   posterior standard error. With no responses this is the prior: 0 ± 1. */
export function estimate(responses) {
  let num = 0, den = 0;
  const w = GRID.map(t => {
    let like = prior(t);
    for (const r of responses) {
      const p = prob(t, r.item);
      like *= r.correct ? p : 1 - p;
    }
    return like;
  });
  for (let i = 0; i < GRID.length; i++) { num += GRID[i] * w[i]; den += w[i]; }
  const theta = den ? num / den : 0;
  let v = 0;
  for (let i = 0; i < GRID.length; i++) v += (GRID[i] - theta) ** 2 * w[i];
  const se = den ? Math.sqrt(v / den) : 1;
  return { theta: Math.round(theta * 1000) / 1000, se: Math.round(se * 1000) / 1000 };
}

/* The candidate carrying the most information at theta. Candidates are
   { tier, item }; ties go to the earlier candidate. */
export function selectItem(theta, candidates) {
  let best = null, bestInfo = -1;
  for (const c of candidates) {
    const i = info(theta, c.item);
    if (i > bestInfo) { best = c; bestInfo = i; }
  }
  return best;
}

/* Where an ability estimate places a learner. The cut points sit halfway
   between the tier difficulties. */
export function placement(theta) {
  if (theta < -0.6) return "practice";
  if (theta < 0.6) return "challenge";
  return "boss";
}

/* Stopping rule: enough precision, once a minimum number of answers is in. */
export const MIN_ITEMS = 6;
export const MAX_ITEMS = 12;
export const TARGET_SE = 0.45;
export function shouldStop(responses) {
  if (responses.length >= MAX_ITEMS) return true;
  if (responses.length < MIN_ITEMS) return false;
  return estimate(responses).se <= TARGET_SE;
}
