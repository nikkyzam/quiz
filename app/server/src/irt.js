/* Item Response Theory for the placement diagnostic (spec 6.1).

   What this replaces: a rule that stepped up a tier after two right in a row
   and down after two wrong. That rule has no memory. A learner who answers
   nine correctly and then slips twice is treated as identical to one who got
   two wrong from a standing start, because only the last two answers survive.
   It also cannot say when it has seen enough, so every diagnostic ran to a
   fixed twelve questions whether the picture was clear after six or still
   muddy at twelve.

   The model here uses every response, weighted by how much each question
   actually tells you about the learner, and reports how sure it is.

   Three-parameter logistic:

       P(correct | theta) = c + (1 - c) / (1 + exp(-a * (theta - b)))

   theta is the learner's ability, b the item's difficulty, a how sharply the
   item separates learners either side of b, and c the floor — the chance of
   answering correctly while knowing nothing.

   The guessing term is the part that is genuinely not optional. A four-option
   multiple-choice question is answered correctly by chance a quarter of the
   time. Without c, the model reads that lucky quarter as ability and places
   the learner too high. Free-input questions have c = 0 — nobody produces "8"
   from thin air — so an identical correct answer there is stronger evidence,
   and the model treats it that way. The streak rule counted both as one
   tick towards promotion. */

/* Ability is estimated on a grid rather than by maximum likelihood, and that
   is a correctness decision, not a shortcut. The likelihood for an all-correct
   or all-wrong response pattern has no interior maximum — the estimate runs
   away to infinity. In a twelve-question diagnostic both patterns are common
   (a strong learner on an easy topic, a learner who has not met the material
   at all), so the estimator has to stay finite exactly where MLE gives up.
   Expected a posteriori against a standard-normal prior is always defined,
   including before a single answer has been given. */
const GRID_MIN = -4;
const GRID_MAX = 4;
const GRID_STEP = 0.1;

const GRID = [];
for (let t = GRID_MIN; t <= GRID_MAX + 1e-9; t += GRID_STEP) GRID.push(Number(t.toFixed(4)));

/* Standard normal prior, unnormalised: the constant cancels in the ratio. */
const PRIOR = GRID.map(t => Math.exp(-(t * t) / 2));

/* Cold-start item parameters.

   With no response history there is nothing to calibrate against, so the
   authored tier supplies the difficulty and the question type supplies the
   guessing floor. These are honest priors, not measurements: once real answer
   data exists, b and a should be fitted per item and read from the bank
   instead. Until then the ordering is what carries the weight — a boss item
   is harder than a practice item, and the model is told by how much. */
const DIFFICULTY_BY_LVL = { 1: -1.2, 2: 0.0, 3: 1.2 };

/* Discrimination is deliberately uniform across tiers.

   An earlier version graded it 0.8 / 1.0 / 1.2, on the unexamined assumption
   that harder items separate learners more sharply. Simulating the diagnostic
   showed what that actually did: information scales with a-squared, so the
   1.2 on boss items outweighed being badly targeted, and the selector served
   middle and hard questions to a learner whose true ability was -1.5. It
   never asked a single easy one, learned nothing about how far below the
   middle they were, and placed a struggling child at "challenge".

   Nothing in the bank justifies believing a boss item discriminates better
   than a practice one. With the gradient removed, maximum information reduces
   to "ask the item whose difficulty is nearest this learner", which is what
   adaptive testing is supposed to mean. Per-item values belong here once
   there is response data to fit them from. */
const UNIFORM_DISCRIMINATION = 1.0;

/* Probability of answering correctly while knowing nothing at all.

   Derived from the question's own shape rather than assumed, because the
   spread is wide: a four-option multiple choice sits at 0.25, while getting
   four items into the right order by luck is 1 in 24. Treating those as the
   same floor would misread a correct ordering as far weaker evidence than it
   is. */
export function guessingFloor(q) {
  const type = q.type || "in";
  if (type === "mc") {
    const n = Array.isArray(q.opts) ? q.opts.length : 4;
    return n > 0 ? 1 / n : 0.25;
  }
  if (type === "multi") {
    /* Select-all is graded exact-match, so the space is every non-empty
       subset of the options. */
    const n = Array.isArray(q.opts) ? q.opts.length : 4;
    const subsets = Math.pow(2, n) - 1;
    return subsets > 0 ? 1 / subsets : 0.05;
  }
  if (type === "order") {
    const n = Array.isArray(q.items) ? q.items.length : 4;
    let fact = 1;
    for (let i = 2; i <= n; i++) fact *= i;
    return 1 / fact;
  }
  /* "in" and "pair" are free input: there is no menu to guess from. */
  return 0;
}

/* Item parameters for a question, derived from the bank. */
export function itemParams(q) {
  const lvl = q.lvl || 1;
  return {
    b: DIFFICULTY_BY_LVL[lvl] ?? 0,
    a: UNIFORM_DISCRIMINATION,
    c: guessingFloor(q)
  };
}

/* P(correct | theta) under the 3PL model. */
export function probability(theta, item) {
  const { a, b, c } = item;
  const logistic = 1 / (1 + Math.exp(-a * (theta - b)));
  return c + (1 - c) * logistic;
}

/* Fisher information: how much this item tells you about a learner at this
   ability. Selection maximises it, which is what makes the sequence adaptive
   in the real sense — the next question is the one whose answer is hardest to
   predict, and therefore most informative. An item far too easy or far too
   hard for the learner carries almost none: you already know the answer
   before it is given, so asking is a wasted question.

       I(theta) = a^2 * ((P - c) / (1 - c))^2 * (1 - P) / P                */
export function information(theta, item) {
  const { a, c } = item;
  const p = probability(theta, item);
  if (p <= 0 || p >= 1) return 0;
  const ratio = (p - c) / (1 - c);
  return a * a * ratio * ratio * ((1 - p) / p);
}

/* Expected a posteriori ability estimate, with the posterior standard
   deviation as the standard error.

   `responses` is [{ item, correct }]. With none, this returns the prior:
   theta 0, se 1 — "we know nothing yet", which is the truthful answer and the
   right place to start selecting from. */
export function estimateAbility(responses) {
  const weights = GRID.map((theta, i) => {
    let w = PRIOR[i];
    for (const r of responses) {
      const p = probability(theta, r.item);
      w *= r.correct ? p : 1 - p;
    }
    return w;
  });

  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0) || !Number.isFinite(total)) return { theta: 0, se: 1 };

  let mean = 0;
  for (let i = 0; i < GRID.length; i++) mean += GRID[i] * weights[i];
  mean /= total;

  let variance = 0;
  for (let i = 0; i < GRID.length; i++) {
    const d = GRID[i] - mean;
    variance += d * d * weights[i];
  }
  variance /= total;

  return { theta: mean, se: Math.sqrt(variance) };
}

/* Choose the most informative unused item at the current ability.

   `candidates` is [{ idx, tier, item }]. Ties are broken by the first
   candidate, and the caller shuffles, so equally informative items do not
   always come out in bank order. */
export function selectNext(theta, candidates) {
  let best = null;
  let bestInfo = -Infinity;
  for (const cand of candidates) {
    const info = information(theta, cand.item);
    if (info > bestInfo) { bestInfo = info; best = cand; }
  }
  return best;
}

/* The tier whose difficulty band contains this ability — where to start the
   learner once measurement is done. The boundaries sit midway between the
   authored tier difficulties, so a learner is placed at the tier they are
   closest to rather than the one they last happened to be asked. */
export function tierForAbility(theta) {
  if (theta >= 0.6) return "boss";
  if (theta >= -0.5) return "challenge";
  return "practice";
}

/* Standard error at which the estimate is precise enough to place on.

   Set from simulation, not from taste. The first value tried here was 0.4,
   which sounded respectable and turned out to be unreachable: with three
   authored difficulty levels and a twelve-question ceiling, the standard
   error bottoms out around 0.52 no matter how consistent the learner is. A
   target below that floor is not a high standard, it is dead configuration —
   the early stop never fires, and every learner is told their placement is
   provisional even when it is the best this diagnostic can produce.

   0.55 is roughly half a tier band. Simulated over 72 learners it is reached
   at question ten or eleven for most and never before the six-question floor,
   so it saves one or two questions rather than the several that a fuller item
   bank would allow. That is a small win honestly measured, not the large one
   the number was first chosen to imply.

   Raising the precision means more distinct item difficulties, not a smaller
   number here: three levels and twelve questions is the binding constraint. */
export const SE_TARGET = 0.55;
