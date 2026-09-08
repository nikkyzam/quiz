/* The badge catalogue and the engine that awards it (spec 5.2).

   Every badge carries the condition that earns it, in the same object as its
   name and hint. That is the point of the design rather than a tidiness
   preference: with award conditions scattered through the request handlers,
   the catalogue and the code drift, and the two failures are both bad — a
   badge in the catalogue that nothing can award is a promise to a child that
   never arrives, and a badge awarded by code that is missing from the
   catalogue renders to them as a raw string like "streak_30".

   Holding them together makes both impossible: awards are issued by walking
   this object, so nothing outside it can be awarded, and every entry in it is
   reachable by definition.

   Conditions are evaluated against one snapshot of a learner's record rather
   than fired from individual events. That means a badge added later is earned
   retroactively by learners who already qualify, instead of only by children
   who happen to do the thing again afterwards. */

import { db } from "./db.js";
import { masteryThresholds } from "./settings.js";

/* One pass over the learner's record, so evaluating a hundred conditions
   costs a handful of queries rather than a hundred. */
export function statsFor(learnerId, { streak = 0, trackOf = () => "core", secOf = () => null } = {}) {
  /* The bar for "mastered" is the platform's configured threshold, read once
     here rather than per topic. An earlier version hardcoded 80, which meant
     a core topic at 85% earned "Topic Mastered" while the review queue still
     listed it as unmastered against the real bar of 90 — and an admin raising
     the threshold moved every part of the product except the badges. */
  const thresholds = masteryThresholds();
  const barFor = topicId => thresholds[trackOf(topicId) === "adv" ? "adv" : "core"];
  const one = (sql, ...args) => db.prepare(sql).get(learnerId, ...args);
  const all = (sql, ...args) => db.prepare(sql).all(learnerId, ...args);

  const runs = all("SELECT topic_id, tier, pct FROM runs WHERE learner_id=?");
  const progress = all("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id=?");
  const points = one("SELECT COALESCE(SUM(amount),0) p FROM awards WHERE learner_id=? AND kind='points'").p;
  const badgesHeld = one("SELECT COUNT(*) c FROM awards WHERE learner_id=? AND kind='badge'").c;
  const contests = all("SELECT pct, expired FROM contests WHERE learner_id=?").filter(c => !c.expired);
  const diagnostics = one("SELECT COUNT(*) c FROM diagnostics WHERE learner_id=?").c;
  const unitTests = all("SELECT passed FROM unit_tests WHERE learner_id=?");
  const lessons = one("SELECT COUNT(*) c FROM lesson_progress WHERE learner_id=? AND completed=1").c;

  /* A topic counts as mastered when every tier of it is at or above the bar,
     which is the same rule the rest of the product uses. */
  const byTopic = {};
  for (const p of progress) (byTopic[p.topic_id] ||= []).push(p);
  const masteredTopics = Object.entries(byTopic)
    .filter(([topicId, rows]) => rows.filter(r =>
      ["practice", "challenge", "boss"].includes(r.tier) && r.best_pct >= barFor(topicId)).length >= 3)
    .map(([t]) => t);

  /* Topic ids are "k-count" and "g6-ratios" — a leading letter, then the
     grade. An earlier version matched /^([k1-8])/ against the whole id, which
     only ever matched the twelve kindergarten topics: every g1..g8 id starts
     with "g", produced an empty grade, and was dropped. That silently made
     eight of the grade badges unearnable by anyone. */
  const gradeOf = t => {
    const m = /^(k|g([1-8]))(?:-|$)/i.exec(String(t));
    return m ? (m[2] || "K").toUpperCase() : "";
  };
  const gradesTouched = new Set(masteredTopics.map(gradeOf).filter(Boolean));
  const strands = new Set(masteredTopics.map(secOf).filter(Boolean));

  return {
    rounds: runs.length,
    perfectRounds: runs.filter(r => r.pct === 100).length,
    masteryRuns: runs.filter(r => r.tier === "mastery").length,
    topicsMastered: masteredTopics.length,
    advTopicsMastered: masteredTopics.filter(t => trackOf(t) === "adv").length,
    gradesMastered: gradesTouched.size,
    strandsMastered: strands.size,
    points, badgesHeld, streak,
    contests: contests.length,
    bestContestPct: contests.length ? Math.max(...contests.map(c => c.pct)) : 0,
    diagnostics,
    unitTestsPassed: unitTests.filter(u => u.passed).length,
    lessonsCompleted: lessons
  };
}

/* Build a family of milestone badges from one shape, so a hundred badges do
   not mean a hundred hand-written near-duplicates that can quietly disagree
   with each other. */
function milestones(prefix, field, steps, name, hint, group) {
  const out = {};
  for (const n of steps)
    out[`${prefix}_${n}`] = {
      name: name(n), hint: hint(n), group,
      when: s => (s[field] || 0) >= n
    };
  return out;
}

export const BADGES = {
  /* The original twelve keep their codes: titles, the avatar wardrobe and
     existing learners' records all refer to them. */
  first_steps:      { name: "First Steps", hint: "Finish your first round", group: "starting", when: s => s.rounds >= 1 },
  perfect_round:    { name: "Clean Sweep", hint: "Score 100% on a round", group: "accuracy", when: s => s.perfectRounds >= 1 },
  unaided:          { name: "No Hints Needed", hint: "Score 100% with no hints", group: "accuracy", when: null },
  topic_mastered:   { name: "Topic Mastered", hint: "Master every tier of a topic", group: "mastery", when: s => s.topicsMastered >= 1 },
  advanced_starter: { name: "Into the Deep End", hint: "Finish a round on an advanced topic", group: "advanced", when: null },
  number_theory:    { name: "Number Theory Novice", hint: "Master an advanced number theory topic", group: "advanced", when: null },
  combinatorics:    { name: "Combinatorics Champion", hint: "Master an advanced combinatorics topic", group: "advanced", when: null },
  persistent:       { name: "Persistent Problem Solver", hint: "Retry a topic after falling short", group: "character", when: null },
  contest_ready:    { name: "Contest Ready", hint: "Score 80% or more on a timed paper", group: "contest", when: s => s.bestContestPct >= 80 },
  streak_3:         { name: "Three in a Row", hint: "Practise three days running", group: "streak", when: s => s.streak >= 3 },
  streak_7:         { name: "A Full Week", hint: "Practise seven days running", group: "streak", when: s => s.streak >= 7 },
  elegant_solution: { name: "Elegant Solution", hint: "Solve a puzzle with no hints at all", group: "puzzle", when: null },

  ...milestones("rounds", "rounds", [5, 10, 25, 50, 100, 250, 500],
    n => `${n} Rounds`, n => `Finish ${n} rounds`, "practice"),
  ...milestones("perfect", "perfectRounds", [5, 10, 25, 50, 100],
    n => `${n} Perfect Rounds`, n => `Score 100% on ${n} rounds`, "accuracy"),
  ...milestones("mastered", "topicsMastered", [3, 5, 10, 20, 35, 50, 75, 100],
    n => `${n} Topics Mastered`, n => `Master every tier of ${n} topics`, "mastery"),
  ...milestones("advanced", "advTopicsMastered", [1, 3, 5, 10, 20, 35],
    n => `${n} Advanced Topics`, n => `Master ${n} advanced topics`, "advanced"),
  ...milestones("grades", "gradesMastered", [1, 2, 3, 4, 5, 6, 7, 8, 9],
    n => `${n} Grade${n === 1 ? "" : "s"} Underway`, n => `Master a topic in ${n} different grades`, "breadth"),
  ...milestones("strands", "strandsMastered", [2, 3, 4, 5, 6, 8, 10],
    n => `${n} Strands`, n => `Master topics across ${n} different strands`, "breadth"),
  ...milestones("streak", "streak", [14, 21, 30, 50, 75, 100, 150, 200, 365],
    n => `${n}-Day Streak`, n => `Practise ${n} days running`, "streak"),
  ...milestones("points", "points", [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000],
    n => `${n.toLocaleString("en-GB")} Points`, n => `Earn ${n.toLocaleString("en-GB")} points`, "points"),
  ...milestones("papers", "contests", [1, 3, 5, 10, 25, 50, 100],
    n => `${n} Timed Paper${n === 1 ? "" : "s"}`, n => `Sit ${n} timed papers`, "contest"),
  ...milestones("contest_score", "bestContestPct", [50, 60, 70, 90, 95, 100],
    n => `${n}% Under Time`, n => `Score ${n}% or more on a timed paper`, "contest"),
  ...milestones("diagnostic", "diagnostics", [1, 3, 5, 10],
    n => `${n} Placement${n === 1 ? "" : "s"}`, n => `Complete ${n} placement checks`, "assessment"),
  ...milestones("unit_test", "unitTestsPassed", [1, 3, 5, 10, 20],
    n => `${n} Unit Test${n === 1 ? "" : "s"} Passed`, n => `Pass ${n} unit tests`, "assessment"),
  ...milestones("mastery_check", "masteryRuns", [1, 5, 10, 25, 50],
    n => `${n} Mastery Check${n === 1 ? "" : "s"}`, n => `Complete ${n} mastery checks`, "assessment"),
  ...milestones("lessons", "lessonsCompleted", [1, 3, 5, 10, 20],
    n => `${n} Lesson${n === 1 ? "" : "s"} Read`, n => `Finish ${n} comic lessons`, "lessons"),
  /* Meta badges: awarded for the collection itself. */
  ...milestones("collector", "badgesHeld", [10, 25, 50, 75],
    n => `Collector: ${n}`, n => `Earn ${n} badges`, "meta")
};

/* Badges whose condition cannot be computed from a snapshot — they describe a
   MOMENT (a round finished without hints, a puzzle solved cold) rather than a
   state — are awarded at the event and carry `when: null`. Naming them here
   rather than leaving them out keeps one catalogue. */
export const EVENT_BADGES = Object.entries(BADGES).filter(([, b]) => b.when === null).map(([c]) => c);

/* Award everything now earned and not yet held. Returns the new codes. */
export function evaluate(learnerId, award, context = {}) {
  const stats = statsFor(learnerId, context);
  const held = new Set(db.prepare("SELECT code FROM awards WHERE learner_id=? AND kind='badge'")
    .all(learnerId).map(r => r.code));
  const earned = [];
  /* Two passes, so meta badges counting badges see the ones just awarded and
     a learner is not left one short until their next round. */
  for (let pass = 0; pass < 2; pass++) {
    const snapshot = pass === 0 ? stats : { ...stats, badgesHeld: held.size };
    for (const [code, badge] of Object.entries(BADGES)) {
      if (!badge.when || held.has(code)) continue;
      if (badge.when(snapshot)) { if (award(learnerId, "badge", code)) { earned.push(code); held.add(code); } }
    }
  }
  return earned;
}
