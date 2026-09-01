/* Proof exercises (spec 3.2.5, 3.3.4, 3.4.6, 4.1.10).

   Progression follows the spec: a single spoken justification in the early
   grades, ordering given steps in the middle, filling in the reasons by
   grade 5, and constructing a full argument by grade 8.

   Checking is structural, not free-text AI: an ordering proof is right when
   the steps are in a valid order, and a reasons proof is right when each
   step is paired with a justification that actually supports it. That is
   honest about what it can verify. */

export const PROOF_KINDS = {
  order:   "Put the steps in order",
  reasons: "Match each step to its reason",
  blanks:  "Fill in the missing step"
};

export const PROOFS = {
  /* Grade 1-2: justify a claim by choosing the reason that supports it. */
  "g1-deduce": [
    { id: "p-cats", grade: 1, kind: "reasons",
      claim: "All cats have tails. Max is a cat. So Max has a tail.",
      steps: [
        { text: "All cats have tails.", reason: "Given" },
        { text: "Max is a cat.", reason: "Given" },
        { text: "So Max has a tail.", reason: "Applying the rule to Max" }
      ],
      reasonBank: ["Given", "Applying the rule to Max", "Guessing", "Counting"] }
  ],

  /* Grade 3: ordering a short argument. */
  "g3-patterns": [
    { id: "p-even-sum", grade: 3, kind: "order",
      claim: "Adding two even numbers always gives an even number.",
      steps: [
        { text: "An even number is made of pairs with none left over." },
        { text: "Take two even numbers, each made only of pairs." },
        { text: "Putting them together still leaves no odd one out." },
        { text: "So the total is even." }
      ] }
  ],

  /* Grade 5: two-column style — each step needs its reason. */
  "g5-angletri": [
    { id: "p-triangle-180", grade: 5, kind: "reasons",
      claim: "The angles inside a triangle add to 180°.",
      steps: [
        { text: "Draw a line through one vertex parallel to the opposite side.",
          reason: "Construction" },
        { text: "The two outer angles equal the two far angles of the triangle.",
          reason: "Alternate angles on parallel lines are equal" },
        { text: "Those three angles sit on a straight line.",
          reason: "Angles on a straight line add to 180°" },
        { text: "So the triangle's three angles add to 180°.",
          reason: "Substituting the equal angles" }
      ],
      reasonBank: ["Construction", "Alternate angles on parallel lines are equal",
                   "Angles on a straight line add to 180°", "Substituting the equal angles",
                   "Vertically opposite angles are equal", "Because it looks true"] }
  ],

  /* Grade 6: proof by contradiction, ordered. */
  "g6-perfect": [
    { id: "p-infinite-primes", grade: 6, kind: "order",
      claim: "There is no largest prime number.",
      steps: [
        { text: "Suppose there were a largest prime, and list every prime up to it." },
        { text: "Multiply them all together and add 1. Call the result N." },
        { text: "N leaves remainder 1 when divided by any prime on the list." },
        { text: "So N has a prime factor not on the list, or is itself prime." },
        { text: "Either way there is a prime beyond the supposed largest — a contradiction." }
      ] }
  ],

  /* Grade 8: induction, with a missing step to supply. */
  "g8-series": [
    { id: "p-induction-sum", grade: 8, kind: "blanks",
      claim: "1 + 2 + ... + n = n(n+1)/2 for every whole number n ≥ 1.",
      steps: [
        { text: "Check n = 1: the left side is 1 and the right side is 1(2)/2 = 1." },
        { text: "MISSING", blank: true,
          options: [
            "Assume the formula holds for some n = k.",
            "Assume the formula holds for every n at once.",
            "Check n = 2 and conclude it always works.",
            "Assume the formula is false."
          ],
          answer: 0 },
        { text: "Then 1 + ... + k + (k+1) = k(k+1)/2 + (k+1)." },
        { text: "That simplifies to (k+1)(k+2)/2, which is the formula for n = k+1." },
        { text: "So it holds for 1, and whenever it holds for k it holds for k+1." }
      ] }
  ]
};

/* Serve a proof without giving the answer away. */
export function publicProof(p) {
  const base = { id: p.id, grade: p.grade, kind: p.kind, claim: p.claim,
                 instruction: PROOF_KINDS[p.kind] };
  if (p.kind === "order") {
    /* Steps shuffled deterministically enough to be a real task. */
    const shuffled = p.steps.map((s, i) => ({ key: String(i), text: s.text }));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return { ...base, steps: shuffled };
  }
  if (p.kind === "reasons") {
    return { ...base,
      steps: p.steps.map((s, i) => ({ key: String(i), text: s.text })),
      reasonBank: p.reasonBank };
  }
  return { ...base,
    steps: p.steps.map((s, i) => s.blank
      ? { key: String(i), blank: true, options: s.options }
      : { key: String(i), text: s.text }) };
}

/* Mark a submission. Returns which steps are wrong, never the whole answer. */
export function checkProof(p, submission) {
  if (p.kind === "order") {
    const given = Array.isArray(submission?.order) ? submission.order.map(String) : [];
    const want = p.steps.map((_, i) => String(i));
    const correct = given.length === want.length && given.every((k, i) => k === want[i]);
    const firstWrong = given.findIndex((k, i) => k !== want[i]);
    return { correct, firstWrongPosition: correct ? null : (firstWrong === -1 ? given.length : firstWrong) };
  }
  if (p.kind === "reasons") {
    const given = submission?.reasons || {};
    const wrong = p.steps
      .map((s, i) => ({ key: String(i), ok: given[String(i)] === s.reason }))
      .filter(r => !r.ok).map(r => r.key);
    return { correct: wrong.length === 0, wrongSteps: wrong };
  }
  const blanks = p.steps.map((s, i) => ({ s, i })).filter(x => x.s.blank);
  const given = submission?.blanks || {};
  const wrong = blanks.filter(b => Number(given[String(b.i)]) !== b.s.answer).map(b => String(b.i));
  return { correct: wrong.length === 0, wrongSteps: wrong };
}

export const proofsForTopic = id => PROOFS[id] || [];
export const allProofs = () => Object.values(PROOFS).flat();
