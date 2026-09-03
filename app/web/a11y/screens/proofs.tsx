/* Proof trainer and puzzle corner, rendered in their loaded states. */
import { renderToStaticMarkup } from "react-dom/server";
import { Proofs, type ProofsData, type Curriculum } from "../../src/screens/Proofs";
import { Puzzles, type PuzzlesData } from "../../src/screens/Puzzles";

const noop = () => {};
const learner = { id: "l1", name: "Josiah", beast: "vex", stars: 2, topics: 1 };

const cur = {
  curriculum: {
    "3": { label: "Grade 3", beast: "pip", units: [
      { name: "Patterns", track: "core", topics: [{ id: "g3-patterns", name: "Patterns and Rules" }] }
    ]},
    "7": { label: "Grade 7", beast: "vex", units: [
      { name: "Reasoning", track: "adv", topics: [{ id: "g7-proofs", name: "Proofs" }] }
    ]}
  },
  tiers: [{ id: "practice", name: "Practice", blurb: "Learn the idea." }],
  counts: {},
  thresholds: { "g3-patterns": 90, "g7-proofs": 80 },
  mastery: { core: 90, adv: 80 }
} as unknown as Curriculum;

const templates = {
  direct: { name: "Direct proof", when: "To show 'if P then Q', start from P and reason step by step to Q.",
    scaffold: ["Assume P. Write out what P means in symbols.", "Rearrange or compute.", "Recognise the form of Q. Conclude Q."] },
  contradiction: { name: "Proof by contradiction", when: "Suppose the claim is false, and show that leads to something impossible.",
    scaffold: ["Suppose the claim is false.", "Follow the consequences.", "Reach a contradiction. So the claim is true."] }
};

const library: ProofsData = {
  kinds: { order: "Put the steps in order", reasons: "Match each step to its reason",
           blanks: "Fill in the missing step", freeform: "Write the proof in your own words" },
  proofs: [
    { id: "p-even-sum", grade: 3, kind: "order", claim: "Adding two even numbers always gives an even number." },
    { id: "p-triangle-180", grade: 5, kind: "reasons", claim: "The angles inside a triangle add to 180°." },
    { id: "p-contrapositive-odd", grade: 7, kind: "blanks", claim: "If n² is odd, then n is odd." },
    { id: "p-free-even-square", grade: 7, kind: "freeform", claim: "If n is an even whole number, then n² is even." }
  ],
  completed: [{ proofId: "p-even-sum", at: "2026-09-01T10:00:00Z" }],
  templates
};

const orderExercise: ProofsData = {
  ...library,
  active: {
    sessionId: "s-order",
    proof: {
      id: "p-even-sum", grade: 3, kind: "order", claim: "Adding two even numbers always gives an even number.",
      instruction: "Put the steps in order",
      template: { id: "direct", ...templates.direct },
      steps: [
        { key: "2", text: "Putting them together still leaves no odd one out." },
        { key: "0", text: "An even number is made of pairs with none left over." },
        { key: "3", text: "So the total is even." },
        { key: "1", text: "Take two even numbers, each made only of pairs." }
      ]
    },
    result: { correct: false, points: 0, attempts: 1, kind: "order", firstWrongPosition: 1 }
  }
};

const freeformExercise: ProofsData = {
  ...library,
  active: {
    sessionId: "s-free",
    proof: {
      id: "p-free-even-square", grade: 7, kind: "freeform",
      claim: "If n is an even whole number, then n² is even.",
      instruction: "Write the proof in your own words",
      template: { id: "direct", ...templates.direct },
      hint: "Write what 'even' means in symbols first.",
      rubric: [
        { key: "define", must: "Say what an even n looks like in symbols (n as 2 times something)." },
        { key: "square", must: "Square that expression." },
        { key: "factor", must: "Show the result is 2 times a whole number, so it is even." }
      ],
      referenceLines: 3
    },
    prefill: ["Let n be even, so n = 2k for some whole number k.", "Then n² = (2k)² = 4k².", ""],
    result: { correct: false, points: 0, attempts: 1, kind: "freeform",
              missing: [{ key: "factor", must: "Show the result is 2 times a whole number, so it is even." }],
              lines: 2, elegant: false, note: "Rubric marking: each point must appear, in order, in its own line." }
  }
};

const puzzles: PuzzlesData = {
  puzzles: [
    { id: "pz-triangles", title: "How Many Triangles?", difficulty: 1, topic: "k-2d",
      prompt: "A big triangle is split by lines from each corner to the middle of the opposite side. Counting every size, how many triangles can you find?",
      hintCount: 3, multiple: false, hidden: false, area: null },
    { id: "pz-digitsum", title: "Any Nine", difficulty: 1, topic: "g1-tensones",
      prompt: "Give me ANY two-digit number whose digits add up to 9.",
      hintCount: 3, multiple: true, hidden: false, area: null },
    { id: "pz-handshakes", title: "Everyone Shakes Hands", difficulty: 2, topic: "g3-multprin",
      prompt: "Six people are in a room and everyone shakes hands with everyone else exactly once. How many handshakes happen altogether?",
      hintCount: 3, multiple: false, hidden: false, area: null },
    { id: "pz-vault-locker", title: "The Locker Problem", difficulty: 4, topic: "g4-factorpair",
      prompt: "100 lockers are closed. Person 1 opens every locker. Person 2 toggles every 2nd locker, and so on. How many lockers end up open?",
      hintCount: 3, multiple: false, hidden: true, area: "vault" }
  ],
  solved: [{ puzzleId: "pz-triangles", hintsUsed: 0, solvedAt: "2026-09-01T10:00:00Z", trophy: "gold", title: "How Many Triangles?" }],
  available: 14
};

const puzzleView: PuzzlesData = {
  ...puzzles,
  open: {
    puzzle: puzzles.puzzles[1],
    hints: ["Pick a tens digit first, then work out what the ones digit must be."],
    notes: "tens 4 -> ones 5",
    answer: "45",
    result: { correct: true, trophy: "silver", firstSolve: true, message: "Solved.",
              paths: ["Pick the tens digit and subtract from 9.", "List the pairs that add to 9 and read one off."] }
  }
};

const wrap = (el: React.ReactElement) =>
  renderToStaticMarkup(<div className="wrap"><main id="main">{el}</main></div>);

export const SCREENS: Record<string, string> = {
  proofsLibrary: wrap(<Proofs learner={learner} cur={cur} onBack={noop} initial={library} />),
  proofsOrder: wrap(<Proofs learner={learner} cur={cur} onBack={noop} initial={orderExercise} />),
  proofsFreeform: wrap(<Proofs learner={learner} cur={cur} onBack={noop} initial={freeformExercise} />),
  puzzlesList: wrap(<Puzzles learner={learner} onBack={noop} initial={puzzles} />),
  puzzleView: wrap(<Puzzles learner={learner} onBack={noop} initial={puzzleView} />)
};
