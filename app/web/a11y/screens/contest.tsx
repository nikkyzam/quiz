/* Contest Corner screens in their loaded state, for the axe audit. */
import { renderToStaticMarkup } from "react-dom/server";
import { Contest, type ContestData, type Paper, type ContestResult } from "../../src/screens/Contest";

const noop = () => {};
const learner = { id: "l1", name: "Josiah", beast: "vex", stars: 2, topics: 1 };
const cur = {
  curriculum: {
    "6": { label: "Grade 6", beast: "vex", units: [
      { name: "The Number System", track: "core", topics: [
        { id: "g6-nscoord", name: "Coordinate Plane" }, { id: "g6-ratio", name: "Ratios" } ] },
      { name: "Number Theory", track: "adv", topics: [{ id: "g6-crt", name: "Chinese Remainder Theorem" }] }
    ]}
  },
  tiers: [],
  counts: {},
  thresholds: { "g6-nscoord": 90, "g6-crt": 80 },
  mastery: { core: 90, adv: 80 }
};

const formats = {
  kangaroo:   { name: "Math Kangaroo style", questions: 12, minutes: 20 },
  moems:      { name: "MOEMS style",         questions: 5,  minutes: 30 },
  amc8:       { name: "AMC 8 style",         questions: 15, minutes: 40 },
  mathcounts: { name: "MATHCOUNTS sprint",   questions: 10, minutes: 20 },
  drill:      { name: "Quick drill",         questions: 6,  minutes: 6  }
};

const questions: Paper["questions"] = [
  { id: "g6-ratio:2", sec: "ratio", secName: "Ratios", type: "mc",
    q: "A recipe uses 3 cups of flour for every 2 cups of sugar. How much sugar goes with 9 cups of flour?",
    opts: ["4 cups", "6 cups", "9 cups", "12 cups"], mono: false, hint: null, fig: null },
  { id: "g6-nscoord:4", sec: "coord", secName: "Coordinate plane", type: "pair",
    q: "Point A is reflected across the y-axis. Where does it land?",
    mono: true, hint: null, fig: { pts: [[3, 2, "A"]] } },
  { id: "g6-crt:1", sec: "nt", secName: "Number theory", type: "in",
    q: "What is the smallest positive number that leaves remainder 1 when divided by 3 and remainder 2 when divided by 5?",
    mono: false, hint: null, fig: null },
  { id: "g6-nscoord:7", sec: "coord", secName: "Coordinate plane", type: "order",
    q: "Put these points in order of distance from the origin, nearest first.",
    items: ["(5, 0)", "(1, 1)", "(3, 4)", "(0, 2)"], mono: true, hint: null, fig: null },
  { id: "g6-ratio:5", sec: "ratio", secName: "Ratios", type: "multi",
    q: "Which of these ratios are equivalent to 2:3?",
    opts: ["4:6", "3:2", "10:15", "6:8"], mono: false, hint: null, fig: null },
  { id: "g6-crt:3", sec: "nt", secName: "Number theory", type: "in",
    q: "How many positive divisors does 36 have?", mono: false, hint: null, fig: null }
];

const startedAt = Date.now() - 4 * 60 * 1000;
const paper: Paper = {
  contestId: "c-demo-1", format: "drill", name: "Quick drill", limitSeconds: 360,
  questions, startedAt, deadline: startedAt + 360 * 1000,
  answers: { "g6-ratio:2": 1, "g6-nscoord:4": "(-3, 2)" },
  times: { "g6-ratio:2": 41, "g6-nscoord:4": 63 }
};

const result: ContestResult = {
  score: 4, total: 6, pct: 67, correctBeforePenalty: 4, seconds: 298, limitSeconds: 360,
  expired: false, percentile: 72,
  reward: { points: 12, badges: [], streak: 2 },
  detail: [
    { id: "g6-ratio:2", topicId: "g6-ratio", correct: true, correctAnswer: "6 cups",
      explanation: "9 cups of flour is 3 lots of 3, so you need 3 lots of 2 cups of sugar: 6 cups." },
    { id: "g6-nscoord:4", topicId: "g6-nscoord", correct: true, correctAnswer: "(-3, 2)",
      explanation: "Reflecting across the y-axis flips the sign of x and keeps y." },
    { id: "g6-crt:1", topicId: "g6-crt", correct: false, correctAnswer: "7",
      explanation: "List numbers with remainder 2 on dividing by 5: 2, 7, 12. The first with remainder 1 on dividing by 3 is 7." },
    { id: "g6-nscoord:7", topicId: "g6-nscoord", correct: true, correctAnswer: "(1, 1)  →  (0, 2)  →  (3, 4)  →  (5, 0)",
      explanation: "Distances are √2, 2, 5 and 5. (3, 4) and (5, 0) tie at 5, so either order of those two is accepted here." },
    { id: "g6-ratio:5", topicId: "g6-ratio", correct: false, correctAnswer: "4:6, 10:15",
      explanation: "Multiply both parts of 2:3 by the same number. 6:8 simplifies to 3:4, and 3:2 is the other way round." },
    { id: "g6-crt:3", topicId: "g6-crt", correct: true, correctAnswer: "9",
      explanation: "36 = 2² × 3², so it has (2 + 1)(2 + 1) = 9 divisors." }
  ],
  byTopic: [
    { topicId: "g6-ratio", asked: 2, correct: 1, pct: 50 },
    { topicId: "g6-crt", asked: 2, correct: 1, pct: 50 },
    { topicId: "g6-nscoord", asked: 2, correct: 2, pct: 100 }
  ]
};

const finishedPaper: Paper = {
  ...paper,
  answers: { "g6-ratio:2": 1, "g6-nscoord:4": "(-3, 2)", "g6-crt:1": "11",
             "g6-nscoord:7": ["(1, 1)", "(0, 2)", "(3, 4)", "(5, 0)"], "g6-ratio:5": [0, 3], "g6-crt:3": "9" },
  times: { "g6-ratio:2": 41, "g6-nscoord:4": 63, "g6-crt:1": 77, "g6-nscoord:7": 52, "g6-ratio:5": 38, "g6-crt:3": 27 }
};

const screen = (initial: ContestData) => renderToStaticMarkup(
  <div className="wrap"><main>
    <Contest learner={learner} cur={cur as any} onBack={noop} initial={initial} />
  </main></div>);

export const SCREENS: Record<string, string> = {
  contestFormats: screen({ tab: "formats", formats }),
  contestPaper:   screen({ tab: "paper", formats, paper }),
  contestResults: screen({ tab: "results", formats, results: { paper: finishedPaper, result } })
};
