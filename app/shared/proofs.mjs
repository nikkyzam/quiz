/* Proof exercises (spec 3.2.5, 3.3.4, 3.4.6, 4.1.10, 7.3).

   Progression follows the spec: a single spoken justification in the early
   grades, ordering given steps in the middle, filling in the reasons by
   grade 5, constructing arguments by grades 7-8.

   Four exercise kinds:
     order    — put the steps of a given argument in order
     reasons  — pair each step with the justification that supports it
     blanks   — supply a missing step from options
     freeform — write the proof in your own words; checked against a RUBRIC
                of things a correct proof must establish, in order

   Checking is structural and says so. A freeform proof is judged by whether
   each rubric item is present in a line, in the right order, using phrasings
   an author listed. That is honest rubric marking, not a theorem prover: a
   valid proof written in an unexpected way can be refused, and the feedback
   names what it could not find rather than what to write. */

export const PROOF_KINDS = {
  order:    "Put the steps in order",
  reasons:  "Match each step to its reason",
  blanks:   "Fill in the missing step",
  freeform: "Write the proof in your own words"
};

/* Template library (4.1.10): the shape of each kind of argument, with a
   scaffold the learner can start from. */
export const TEMPLATES = {
  direct: { name: "Direct proof", when: "To show 'if P then Q', start from P and reason step by step to Q.",
    scaffold: ["Assume P. Write out what P means in symbols.", "Rearrange or compute.", "Recognise the form of Q. Conclude Q."] },
  contrapositive: { name: "Contrapositive", when: "'If P then Q' is the same claim as 'if not Q then not P'. Sometimes the second is easier.",
    scaffold: ["Assume not Q.", "Show what that forces.", "Arrive at not P. That proves the original claim."] },
  contradiction: { name: "Proof by contradiction", when: "Suppose the claim is false, and show that leads to something impossible.",
    scaffold: ["Suppose the claim is false.", "Follow the consequences.", "Reach a contradiction. So the claim is true."] },
  induction: { name: "Induction", when: "For a claim about every whole number n: check the first case, then show each case forces the next.",
    scaffold: ["Base case: check n = 1.", "Assume it holds for n = k.", "Show it then holds for n = k + 1.", "Conclude it holds for all n ≥ 1."] },
  pigeonhole: { name: "Pigeonhole principle", when: "If more objects than boxes are placed in boxes, some box holds at least two.",
    scaffold: ["Name the objects and the boxes.", "Count both: more objects than boxes.", "So some box has two objects. Say what that means."] },
  extremal: { name: "Extremal principle", when: "Look at the largest or smallest thing in the problem; it often has to satisfy something special.",
    scaffold: ["Pick the smallest (or largest) case.", "Say why it exists.", "Show what being extreme forces.", "Conclude."] }
};

export const PROOFS = {
  /* Grade 1-2: justify a claim by choosing the reason that supports it. */
  "g1-deduce": [
    { id: "p-cats", grade: 1, kind: "reasons", template: "direct",
      claim: "All cats have tails. Max is a cat. So Max has a tail.",
      steps: [
        { text: "All cats have tails.", reason: "Given" },
        { text: "Max is a cat.", reason: "Given" },
        { text: "So Max has a tail.", reason: "Applying the rule to Max" }
      ],
      reasonBank: ["Given", "Applying the rule to Max", "Guessing", "Counting"] }
  ],
  "g2-prime20": [
    { id: "p-seven-odd", grade: 2, kind: "reasons", template: "direct",
      claim: "7 is an odd number.",
      steps: [
        { text: "Put 7 counters into pairs.", reason: "Pairing up" },
        { text: "Three pairs are made and one counter is left over.", reason: "Counting" },
        { text: "A number with one left over after pairing is odd.", reason: "What odd means" },
        { text: "So 7 is odd.", reason: "Applying the meaning to 7" }
      ],
      reasonBank: ["Pairing up", "Counting", "What odd means", "Applying the meaning to 7", "Because 7 is big", "Guessing"] }
  ],

  /* Grade 3-4: ordering a short argument. */
  "g3-patterns": [
    { id: "p-even-sum", grade: 3, kind: "order", template: "direct",
      claim: "Adding two even numbers always gives an even number.",
      steps: [
        { text: "An even number is made of pairs with none left over." },
        { text: "Take two even numbers, each made only of pairs." },
        { text: "Putting them together still leaves no odd one out." },
        { text: "So the total is even." }
      ] }
  ],
  "g4-paths": [
    { id: "p-birth-month", grade: 4, kind: "order", template: "pigeonhole",
      claim: "In any group of 13 people, two were born in the same month.",
      steps: [
        { text: "There are 12 months in a year." },
        { text: "Think of each person as being placed in the month they were born." },
        { text: "13 people are placed into only 12 months." },
        { text: "So at least one month must hold two people." },
        { text: "Those two people share a birth month." }
      ] }
  ],

  /* Grade 5: two-column style — each step needs its reason. */
  "g5-angletri": [
    { id: "p-triangle-180", grade: 5, kind: "reasons", template: "direct",
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

  /* Grade 6: proof by contradiction, and the extremal principle, ordered. */
  "g6-perfect": [
    { id: "p-infinite-primes", grade: 6, kind: "order", template: "contradiction",
      claim: "There is no largest prime number.",
      steps: [
        { text: "Suppose there were a largest prime, and list every prime up to it." },
        { text: "Multiply them all together and add 1. Call the result N." },
        { text: "N leaves remainder 1 when divided by any prime on the list." },
        { text: "So N has a prime factor not on the list, or is itself prime." },
        { text: "Either way there is a prime beyond the supposed largest — a contradiction." }
      ] }
  ],
  "g6-symmetry": [
    { id: "p-five-numbers", grade: 6, kind: "order", template: "extremal",
      claim: "Among any five different whole numbers, two of them differ by at least 4.",
      steps: [
        { text: "Call the smallest of the five numbers a and the largest b." },
        { text: "The five numbers are all different, so going from a up to b passes through at least four jumps of at least 1 each." },
        { text: "So b − a is at least 4." },
        { text: "a and b are two of the five numbers, and they differ by at least 4." }
      ] }
  ],

  /* Grade 7: contrapositive with a missing step, and a first freeform proof. */
  "g7-proofs": [
    { id: "p-contrapositive-odd", grade: 7, kind: "blanks", template: "contrapositive",
      claim: "If n² is odd, then n is odd.",
      steps: [
        { text: "We prove the contrapositive: if n is even, then n² is even." },
        { text: "MISSING", blank: true,
          options: [
            "Suppose n is even, so n = 2k for some whole number k.",
            "Suppose n is odd, so n = 2k + 1 for some whole number k.",
            "Suppose n² is odd.",
            "Suppose n is a prime number."
          ],
          answer: 0 },
        { text: "Then n² = (2k)² = 4k² = 2(2k²), which is even." },
        { text: "So if n is even, n² is even — which is the same as: if n² is odd, n is odd." }
      ] },
    { id: "p-free-even-square", grade: 7, kind: "freeform", template: "direct",
      claim: "If n is an even whole number, then n² is even.",
      hint: "Write what 'even' means in symbols first.",
      rubric: [
        { key: "define", must: "Say what an even n looks like in symbols (n as 2 times something).",
          accept: [/n\s*=\s*2\s*\*?\s*[a-z]/i, /2\s*\*?\s*[a-z]\b.*even|even.*2\s*\*?\s*[a-z]\b/i, /n\s*=\s*2k/i] },
        { key: "square", must: "Square that expression.",
          accept: [/\(\s*2\s*\*?\s*[a-z]\s*\)\s*(\^\s*2|²)/i, /4\s*\*?\s*[a-z]\s*(\^\s*2|²)/i, /2[a-z]\s*(\*|×|x)\s*2[a-z]/i] },
        { key: "factor", must: "Show the result is 2 times a whole number, so it is even.",
          accept: [/2\s*\*?\s*\(\s*2\s*\*?\s*[a-z]\s*(\^\s*2|²)\s*\)/i, /2\s*(\*|×)\s*\(?\s*2[a-z]/i, /(is|so|therefore|hence).*(even|multiple of 2|divisible by 2)/i] }
      ],
      referenceLines: 3,
      reference: ["Let n be even, so n = 2k for some whole number k.", "Then n² = (2k)² = 4k².", "So n² = 2(2k²), which is even."] }
  ],

  /* Grade 8: induction, with a missing step to supply; and a freeform contradiction. */
  "g8-series": [
    { id: "p-induction-sum", grade: 8, kind: "blanks", template: "induction",
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
      ] },
    { id: "p-free-largest-even", grade: 8, kind: "freeform", template: "contradiction",
      claim: "There is no largest even number.",
      hint: "Suppose there were one. What could you build from it?",
      rubric: [
        { key: "suppose", must: "Suppose there IS a largest even number, and give it a name.",
          accept: [/suppose|assume|imagine|say/i] },
        { key: "build", must: "Build a bigger even number from it (add 2).",
          accept: [/\+\s*2\b/, /plus\s+2\b|two more|add(ing)?\s+2\b|next even/i] },
        { key: "contradict", must: "Point out the contradiction: the new number is even and larger.",
          accept: [/contradict|impossible|cannot be|can't be|bigger|larger|greater/i] }
      ],
      referenceLines: 3,
      reference: ["Suppose there is a largest even number, and call it N.", "Then N + 2 is also even.", "But N + 2 is bigger than N, which contradicts N being the largest."] }
  ]
};

/* Serve a proof without giving the answer away. */
export function publicProof(p) {
  const base = { id: p.id, grade: p.grade, kind: p.kind, claim: p.claim,
                 instruction: PROOF_KINDS[p.kind], template: p.template ? { id: p.template, ...TEMPLATES[p.template] } : null };
  if (p.kind === "order") {
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
  if (p.kind === "freeform") {
    /* The learner sees what a proof must establish, never the phrasings. */
    return { ...base, hint: p.hint || null,
      rubric: p.rubric.map(r => ({ key: r.key, must: r.must })),
      referenceLines: p.referenceLines };
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
  if (p.kind === "freeform") return checkFreeform(p, submission);
  const blanks = p.steps.map((s, i) => ({ s, i })).filter(x => x.s.blank);
  const given = submission?.blanks || {};
  const wrong = blanks.filter(b => Number(given[String(b.i)]) !== b.s.answer).map(b => String(b.i));
  return { correct: wrong.length === 0, wrongSteps: wrong };
}

/* Rubric marking for freeform proofs. Each rubric item must be found in a
   line AFTER the line that satisfied the previous item, so the argument has
   to be in a valid order, not just mention the right things. Elegance (7.3)
   is a proof that hits every item in no more lines than the reference. */
export function checkFreeform(p, submission) {
  const lines = (Array.isArray(submission?.lines) ? submission.lines : String(submission?.text || "").split(/\n+/))
    .map(l => String(l).trim()).filter(Boolean).slice(0, 40);
  let from = 0;
  const missing = [];
  for (const r of p.rubric) {
    let found = -1;
    for (let i = from; i < lines.length && found < 0; i++)
      if (r.accept.some(re => re.test(lines[i]))) found = i;
    if (found < 0) missing.push({ key: r.key, must: r.must });
    else from = found + 1;
  }
  const correct = missing.length === 0 && lines.length > 0;
  return {
    correct,
    missing,                                     // what could not be found, in rubric order
    lines: lines.length,
    elegant: correct && lines.length <= p.referenceLines,
    note: correct ? null : "Rubric marking: each point must appear, in order, in its own line."
  };
}

export const proofsForTopic = id => PROOFS[id] || [];
export const allProofs = () => Object.values(PROOFS).flat();
