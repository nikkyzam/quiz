/* Parent portal rendered in its loaded state for the accessibility audit. */
import { renderToStaticMarkup } from "react-dom/server";
import { Family, type FamilyData } from "../../src/screens/Family";

const noop = () => {};
const user = { id: "u1", email: "sam@example.com", name: "Sam", role: "parent" };
const learner = { id: "l1", name: "Josiah", beast: "vex", stars: 2, topics: 3 };
const cur = {
  curriculum: {
    "6": { label: "Grade 6", beast: "vex", units: [
      { name: "The Number System", track: "core", topics: [{ id: "g6-nscoord", name: "Coordinate Plane" }] },
      { name: "Number Theory", track: "adv", topics: [{ id: "g6-crt", name: "Chinese Remainder Theorem" }] }
    ]}
  },
  tiers: [
    { id: "practice", name: "Practice", blurb: "Learn the idea and get it solid." },
    { id: "challenge", name: "Challenge", blurb: "Multi-step problems." },
    { id: "boss", name: "Boss", blurb: "Work backwards." }
  ],
  counts: { "g6-nscoord": { practice: 40, challenge: 22, boss: 16 } },
  thresholds: { "g6-nscoord": 90, "g6-crt": 80 },
  mastery: { core: 90, adv: 80 }
};

const topic = { topicId: "g6-nscoord", name: "Coordinate Plane", grade: "Grade 6", gradeKey: "6", unit: "The Number System", track: "core" };
const data: FamilyData = {
  time: {
    totalSeconds: 5400, last7DaysSeconds: 1800, rounds: 12,
    byDay: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => ({ day, seconds: (i + 1) * 120 })),
    byTopic: [{ ...topic, seconds: 1800 }]
  },
  readiness: {
    level: 4, points: 320, title: { code: "explorer", name: "Explorer" },
    mastery: { core: 3, advanced: 1, started: 5 }, knownSkills: 9, contests: { papers: 2, best: 70 },
    readiness: {
      advanced: { ready: true, reason: "Three core topics mastered in this grade." },
      competition: { ready: false, reason: "Try two more timed papers first." },
      advancedTopicsTried: 1
    }
  },
  alerts: [
    { kind: "ready_to_advance", topicId: "g6-nscoord", topic: "Coordinate Plane", detail: "Mastered at 95%. The next topic is open." },
    { kind: "inactive", detail: "No rounds in the last 5 days." }
  ],
  inbox: {
    notifications: [{ id: "n1", learnerId: "l1", learnerName: "Josiah", kind: "ready_to_advance", kindLabel: "Ready to advance",
      title: "Josiah is ready for the next topic", body: "Coordinate Plane mastered at 95%.", createdAt: "2026-09-01T10:00:00Z", readAt: null, deliveredVia: "inbox" }],
    unread: 1, kinds: { ready_to_advance: "Ready to advance", struggling: "Struggling", inactive: "Inactive" }
  },
  goal: { goal: { roundsPerWeek: 5, minutesPerWeek: 60, setAt: "2026-08-30T10:00:00Z" }, roundsThisWeek: 3, percentOfGoal: 60, met: false, atRisk: false },
  track: {
    track: "core",
    tracks: { core: { name: "Core", blurb: "Grade-level standards." }, enrichment: { name: "Enrichment", blurb: "Core plus the advanced strands." }, competition: { name: "Competition", blurb: "Contest preparation." } },
    recommended: { track: "enrichment", reason: "Mastered three core topics quickly." }
  },
  progress: {
    progress: [{ topic_id: "g6-nscoord", tier: "practice", best_score: 9, best_total: 10, best_pct: 90, runs: 3, last_at: "2026-09-01T10:00:00Z" }],
    recent: [{ topic_id: "g6-nscoord", tier: "practice", score: 9, total: 10, pct: 90, finished_at: "2026-09-01T10:00:00Z" }]
  },
  errors: {
    total: 4, byCategory: [{ category: "sign", label: "Sign errors", count: 3 }, { category: "axis", label: "Axis mix-up", count: 1 }],
    byTopic: [{ topicId: "g6-nscoord", count: 4, categories: [{ category: "sign", label: "Sign errors", count: 3 }] }],
    categories: { sign: "Sign errors", axis: "Axis mix-up" }
  },
  mastery: { topics: [{ ...topic, state: "mastered", threshold: 90, bestPct: 95 }, { topicId: "g6-crt", name: "Chinese Remainder Theorem", gradeKey: "6", state: "not_yet", threshold: 80, bestPct: 40 }] },
  skills: { skills: [{ skillId: "A", name: "Know the plane", known: true, confidence: 0.92, grade: "6" }], masteryThreshold: 0.9, minObservations: 3 },
  streak: { days: 4, freezesAvailable: 1, freezesUsed: 0, freezesEarned: 1, nextFreezeAt: 7 },
  weekly: {
    week: "2026-W36",
    learners: [{ learnerId: "l1", name: "Josiah", rounds: 5, minutes: 42, mastered: ["Coordinate Plane"], badges: ["First star"], streak: 4, text: "Josiah played 5 rounds and mastered Coordinate Plane." }],
    text: "A good week: 5 rounds, 42 minutes, one topic mastered."
  },
  section: "overview",
  grade: "6",
  overviews: {
    "6": { grade: "6", label: "Grade 6", units: [{ name: "The Number System", track: "core", topics: [{
      id: "g6-nscoord", name: "Coordinate Plane", threshold: 90, questions: 78,
      standards: { framework: "CCSS", codes: ["6.NS.C.6"], strand: null, note: null },
      sample: { id: "q1", sec: "A", secName: "Know the Plane", type: "mc", q: "The point (−8, −3) is in which quadrant?",
        opts: ["Quadrant III", "Quadrant I", "Quadrant II", "Quadrant IV"], mono: false, hint: null, fig: null }
    }] }] }
  }
};

const render = (initial: FamilyData) => renderToStaticMarkup(
  <div className="wrap"><main>
    <Family user={user} learner={learner} cur={cur as any} onBack={noop} onOpenTopic={noop} initial={initial} />
  </main></div>);

export const SCREENS: Record<string, string> = {
  familyOverview: render(data),
  familyAlerts: render({ ...data, section: "alerts" }),
  familyCurriculum: render({ ...data, section: "curriculum" })
};
