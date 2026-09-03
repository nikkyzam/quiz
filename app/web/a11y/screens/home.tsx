/* Learner home screen rendered in its loaded state for the axe audit. */
import { renderToStaticMarkup } from "react-dom/server";
import { Home, type HomeData, type Curriculum } from "../../src/screens/Home";

const noop = () => {};
const learner = { id: "l1", name: "Josiah", beast: "vex", stars: 2, topics: 3 };

const cur = {
  curriculum: {
    "6": { label: "Grade 6", beast: "vex", units: [
      { name: "The Number System", track: "core", topics: [
        { id: "g6-nscoord", name: "Coordinate Plane" },
        { id: "g6-nsdiv", name: "Dividing Fractions" }
      ]},
      { name: "Ratios & Proportions", track: "core", topics: [
        { id: "g6-ratio", name: "Ratios and Rates" }
      ]},
      { name: "Number Theory", track: "adv", topics: [
        { id: "g6-crt", name: "Chinese Remainder Theorem" },
        { id: "g6-modarith", name: "Modular Arithmetic" }
      ]}
    ]}
  },
  tiers: [
    { id: "practice", name: "Practice", blurb: "Learn the idea and get it solid." },
    { id: "challenge", name: "Challenge", blurb: "Multi-step problems." },
    { id: "boss", name: "Boss", blurb: "Work backwards." }
  ],
  counts: {
    "g6-nscoord": { practice: 40, challenge: 22, boss: 16 },
    "g6-nsdiv": { practice: 30, challenge: 12, boss: 8 },
    "g6-ratio": { practice: 24, challenge: 10, boss: 6 },
    "g6-crt": { practice: 12, challenge: 8, boss: 4 }
  },
  thresholds: { "g6-nscoord": 90, "g6-nsdiv": 90, "g6-ratio": 90, "g6-crt": 80, "g6-modarith": 80 },
  mastery: { core: 90, adv: 80 }
} as unknown as Curriculum;

const initial: HomeData = {
  home: {
    learner: { id: "l1", name: "Josiah", beast: "vex", track: "core" },
    streak: { days: 5, freezesAvailable: 1, freezesUsed: 0, freezesEarned: 1, nextFreezeAt: 7 },
    dailyGoal: { target: 2, done: 1, met: false, weeklyTarget: 10 },
    challenge: {
      id: "g6-nscoord:14", sec: "plot", secName: "Coordinate Plane", type: "mc",
      q: "Which point lies in Quadrant III?",
      opts: ["(3, 4)", "(-3, 4)", "(-3, -4)", "(3, -4)"],
      mono: true, hint: "Both coordinates are negative in Quadrant III.", fig: null,
      topic: "Coordinate Plane", done: false, bonus: 30
    },
    map: [{ grade: "6", label: "Grade 6",
            core: { topics: 3, available: 3, started: 2, mastered: 1 },
            advanced: { topics: 2, available: 1, started: 1, mastered: 0 } }],
    rewards: { points: 420, level: 4, nextLevelAt: 500, badges: [{ code: "first_steps", name: "First Steps" }] }
  },
  streak: { days: 5, freezesAvailable: 1, freezesUsed: 0, freezesEarned: 1, nextFreezeAt: 7 },
  levels: { overall: { level: 4, points: 420, nextLevelAt: 500 }, subjects: [], prestigeLevel: 10, prestigeSubjects: [] },
  avatar: {
    slots: ["hat", "glasses"],
    unlocked: [{ id: "cap", slot: "hat", name: "Explorer cap" }],
    equipped: { hat: "cap" },
    locked: [{ id: "shades", slot: "glasses", name: "Cool shades", hint: "Reach level 5" }]
  },
  review: [
    { topicId: "g6-nsdiv", tier: "challenge", bestPct: 62, threshold: 90, track: "core", gap: 28,
      lastAt: "2026-09-01T10:00:00Z", reason: "not_yet_mastered" },
    { topicId: "g6-nscoord", threshold: 90, track: "core", gap: 0, lastAt: "2026-08-20T10:00:00Z",
      dueAt: "2026-09-03T00:00:00Z", intervalDays: 14, reason: "due_for_review" },
    { topicId: "g6-crt", threshold: 80, track: "adv", gap: 0, lastAt: "2026-07-01T10:00:00Z",
      dueAt: "2026-08-01T00:00:00Z", intervalDays: 30, reason: "mastery_decayed" }
  ],
  next: {
    track: "core",
    ready: [{ topicId: "g6-ratio", name: "Ratios and Rates", track: "core", bestPct: 0, optional: false }],
    blocked: [{ topicId: "g6-modarith", name: "Modular Arithmetic",
                missing: [{ topicId: "g6-crt", name: "Chinese Remainder Theorem" }] }]
  },
  track: {
    track: "core",
    tracks: {
      core: { name: "Core", blurb: "Grade-level standards. Advanced topics are there but optional." },
      enrichment: { name: "Enrichment", blurb: "Core plus the advanced strands, recommended side by side." },
      competition: { name: "Competition", blurb: "Advanced strands first, with timed papers and proofs woven in." }
    },
    recommended: { track: "enrichment", reason: "3 core topics mastered" }
  },
  goal: { goal: { roundsPerWeek: 10, minutesPerWeek: 60, setAt: "2026-08-30T09:00:00Z" },
          roundsThisWeek: 6, percentOfGoal: 60, met: false, atRisk: false },
  progress: [
    { topic_id: "g6-nscoord", tier: "practice", best_score: 9, best_total: 10, best_pct: 90, runs: 3, last_at: "2026-09-01T10:00:00Z" },
    { topic_id: "g6-nsdiv", tier: "challenge", best_score: 5, best_total: 8, best_pct: 62, runs: 2, last_at: "2026-09-01T10:00:00Z" },
    { topic_id: "g6-crt", tier: "practice", best_score: 7, best_total: 10, best_pct: 70, runs: 1, last_at: "2026-07-01T10:00:00Z" }
  ]
};

export const SCREENS: Record<string, string> = {
  home: renderToStaticMarkup(
    <div className="wrap"><main>
      <Home learner={learner} cur={cur} onBack={noop} onOpenTopic={noop} onPractice={noop} onGo={noop} initial={initial} />
    </main></div>)
};
