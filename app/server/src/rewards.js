/* Points, badges, levels, streaks and titles (spec 5.1-5.5, 5.10).

   Advanced work is worth more than core work, as the spec asks. Badges are
   awarded once and never revoked; the unique index in the schema enforces
   that even if this module is called twice for the same event.

   Most badges are RULE-DRIVEN: each carries a predicate over a learner's
   statistics, and `sweep` awards every badge whose predicate has just become
   true. That is what makes a catalogue of a hundred-plus badges honest —
   every one of them can actually be earned, and check:gamification proves
   each rule fires. */

import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { CURRICULUM } from "../../shared/curriculum.mjs";
import { TOPIC_STANDARDS, STANDARDS } from "../../shared/standards.mjs";
import { TOPIC_NAME, trackOf, thresholdOf } from "./helpers.js";
import { AREA_BADGES } from "../../shared/unlockables.mjs";

/* ---------- subjects (5.4 per-subject levels) ---------- */
export const SUBJECTS = {
  number:        "Number",
  algebra:       "Algebra & patterns",
  geometry:      "Geometry & measure",
  data:          "Data & probability",
  numtheory:     "Number theory",
  combinatorics: "Combinatorics",
  logic:         "Logic & proof"
};
const STRAND_SUBJECT = { NT: "numtheory", CB: "combinatorics", AL: "algebra", GE: "geometry", PS: "data", LG: "logic", PR: "logic" };
export function subjectOf(topicId) {
  const st = TOPIC_STANDARDS[topicId];
  if (st?.strand) return STRAND_SUBJECT[st.strand];
  const unit = (TOPIC_NAME.get(topicId) || {}).unit || "";
  if (/Statistics|Probability|Data/i.test(unit)) return "data";
  if (/Geometry|Spatial|Measurement/i.test(unit)) return "geometry";
  if (/Algebra|Expressions|Functions|Patterns|Operations/i.test(unit)) return "algebra";
  if (/Logic|Strategy/i.test(unit)) return "logic";
  return "number";
}

/* ---------- hand-authored badges (kept: earlier checks reference them) ---------- */
const HAND = {
  first_steps:      { name: "First Steps",            hint: "Finish your first round", category: "meta" },
  perfect_round:    { name: "Clean Sweep",            hint: "Score 100% on a round", category: "meta" },
  unaided:          { name: "No Hints Needed",        hint: "Score 100% with no hints", category: "meta" },
  topic_mastered:   { name: "Topic Mastered",         hint: "Master every tier of a topic", category: "subject" },
  advanced_starter: { name: "Into the Deep End",      hint: "Finish a round on an advanced topic", category: "subject" },
  number_theory:    { name: "Number Theory Novice",   hint: "Master an advanced number theory topic", category: "subject" },
  combinatorics:    { name: "Combinatorics Champion", hint: "Master an advanced combinatorics topic", category: "subject" },
  persistent:       { name: "Persistent Problem Solver", hint: "Retry a topic after falling short", category: "meta" },
  contest_ready:    { name: "Contest Ready",          hint: "Score 80% or more on a timed paper", category: "competition" },
  streak_3:         { name: "Three in a Row",         hint: "Practise three days running", category: "meta" },
  streak_7:         { name: "A Full Week",            hint: "Practise seven days running", category: "meta" },
  elegant_solution: { name: "Elegant Solution",       hint: "Solve a puzzle with no hints at all", category: "puzzle" },
  daily_challenger: { name: "Daily Challenger",       hint: "Get a challenge of the day right", category: "meta" }
};

/* ---------- rule-driven badges ---------- */
export const RULES = [];
const rule = (code, name, hint, category, when) => RULES.push({ code, name, hint, category, when });
const ordinal = n => ({ 1: "first", 3: "third", 5: "fifth", 10: "tenth" }[n] || `${n}th`);

/* Subject badges: per grade and per strand. */
for (const [key, g] of Object.entries(CURRICULUM)) {
  const k = key.toLowerCase();
  rule(`grade_${k}_explorer`, `${g.label} Explorer`, `Finish a round in ${g.label}`, "subject", s => (s.roundsByGrade[key] || 0) >= 1);
  rule(`grade_${k}_champion`, `${g.label} Champion`, `Master three topics in ${g.label}`, "subject", s => (s.masteredByGrade[key] || 0) >= 3);
}
for (const [code, name] of Object.entries(STANDARDS.strands)) {
  const c = code.toLowerCase();
  rule(`strand_${c}_first`, `${name} Initiate`, `Master an advanced ${name.toLowerCase()} topic`, "subject", s => (s.masteredByStrand[code] || 0) >= 1);
  rule(`strand_${c}_adept`, `${name} Adept`, `Master five advanced ${name.toLowerCase()} topics`, "subject", s => (s.masteredByStrand[code] || 0) >= 5);
}
for (const [code, name] of Object.entries(SUBJECTS))
  rule(`subject_${code}_10`, `${name} Scholar`, `Reach level 10 in ${name.toLowerCase()}`, "subject", s => (s.subjectLevels[code] || 1) >= 10);

/* Meta badges: milestones. */
for (const n of [100, 250, 500, 1000, 2000, 5000, 10000])
  rule(`points_${n}`, `${n.toLocaleString("en")} Points`, `Earn ${n.toLocaleString("en")} points in total`, "meta", s => s.points >= n);
for (const n of [1, 5, 10, 25, 50, 100])
  rule(`mastered_${n}`, n === 1 ? "First Mastery" : `${n} Topics Mastered`, `Master ${n === 1 ? "your first topic" : `${n} topics`}`, "meta", s => s.masteredTopics >= n);
for (const n of [10, 50, 100, 250, 500])
  rule(`rounds_${n}`, `${n} Rounds`, `Finish ${n} rounds`, "meta", s => s.rounds >= n);
for (const n of [5, 10, 25])
  rule(`perfect_${n}`, `${n} Clean Sweeps`, `Score 100% on ${n} rounds`, "meta", s => s.perfectRounds >= n);
for (const n of [1, 10, 25])
  rule(`unaided_${n}`, n === 1 ? "Self-Reliant" : `Self-Reliant ×${n}`, `Score 100% with no hints ${n === 1 ? "once" : `${n} times`}`, "meta", s => s.unaidedPerfect >= n);
for (const n of [14, 30, 60, 100])
  rule(`streak_${n}`, `${n}-Day Streak`, `Practise ${n} days running`, "meta", s => s.streak >= n);
for (const n of [5, 10, 20, 30])
  rule(`level_${n}`, `Level ${n}`, `Reach level ${n}`, "meta", s => s.level >= n);
for (const n of [1, 5, 10])
  rule(`boss_${n}`, n === 1 ? "Boss Beaten" : `${n} Bosses Beaten`, `Master the boss tier on ${n === 1 ? "a topic" : `${n} topics`}`, "meta", s => s.bossMastered >= n);
for (const n of [1, 5, 10])
  rule(`advanced_${n}`, n === 1 ? "Advanced Scholar" : `Advanced ×${n}`, `Master ${n === 1 ? "an advanced topic" : `${n} advanced topics`}`, "subject", s => s.masteredAdv >= n);
for (const n of [3, 10, 25])
  rule(`core_${n}`, `Core ${n}`, `Master ${n} core topics`, "subject", s => s.masteredCore >= n);
for (const n of [1, 5, 15])
  rule(`mastery_check_${n}`, n === 1 ? "Checked Out" : `${n} Checks Passed`, `Pass ${n === 1 ? "a mastery check" : `${n} mastery checks`}`, "meta", s => s.masteryPassed >= n);
rule("placed", "Placed", "Complete a placement diagnostic", "meta", s => s.diagnostics >= 1);
rule("comeback", "Comeback", "Score 100% on a topic you once scored under 50% on", "meta", s => s.comebacks >= 1);
rule("all_rounder", "All-Rounder", "Master a topic in every subject", "subject", s => Object.keys(SUBJECTS).every(k => (s.masteredBySubject[k] || 0) >= 1));

/* Puzzle, proof, contest, challenge and story badges. */
for (const n of [1, 3, 5, 8])
  rule(`puzzles_${n}`, n === 1 ? "Puzzler" : `${n} Puzzles`, `Solve ${n === 1 ? "a puzzle" : `${n} puzzles`}`, "puzzle", s => s.puzzlesSolved >= n);
for (const n of [1, 4])
  rule(`gold_puzzles_${n}`, n === 1 ? "Gold Trophy" : `${n} Gold Trophies`, `Solve ${n === 1 ? "a puzzle" : `${n} puzzles`} without hints`, "puzzle", s => s.goldPuzzles >= n);
for (const n of [1, 3, 5, 10])
  rule(`proofs_${n}`, n === 1 ? "Proof Positive" : `${n} Proofs`, `Complete ${n === 1 ? "a proof" : `${n} proofs`}`, "proof", s => s.proofs >= n);
for (const n of [1, 5, 10])
  rule(`contests_${n}`, n === 1 ? "First Paper" : `${n} Papers`, `Finish ${n === 1 ? "a timed paper" : `${n} timed papers`}`, "competition", s => s.contests >= n);
rule("contest_90", "Contest Star", "Score 90% or more on a timed paper", "competition", s => s.contestBest >= 90);
rule("contest_perfect", "Flawless Paper", "Score 100% on a timed paper", "competition", s => s.contestBest >= 100);
for (const n of [7, 30])
  rule(`challenges_${n}`, `${n} Daily Challenges`, `Get ${n} challenges of the day right`, "meta", s => s.challenges >= n);
for (const n of [1, 3, 6])
  rule(`story_${n}`, n === 1 ? "Chapter One" : `${n} Chapters`, `Read ${n === 1 ? "the first chapter" : `${n} chapters`} of the story`, "story", s => s.chapters >= n);
for (const n of [1, 5, 10])
  rule(`lessons_${n}`, n === 1 ? "Lesson Learned" : `${n} Lessons`, `Finish ${n === 1 ? "a comic lesson" : `${n} comic lessons`}`, "meta", s => s.lessons >= n);
for (const n of [1, 5])
  rule(`games_${n}`, n === 1 ? "Game On" : `${n} Games`, `Play ${n === 1 ? "a mini-game" : `${n} mini-game rounds`}`, "meta", s => s.games >= n);

export const BADGES = {
  ...HAND,
  ...AREA_BADGES,
  ...Object.fromEntries(RULES.map(r => [r.code, { name: r.name, hint: r.hint, category: r.category }]))
};

/* ---------- learner statistics the rules read ---------- */
export function stats(learnerId) {
  const runs = db.prepare("SELECT topic_id, tier, pct, finished_at FROM runs WHERE learner_id=? ORDER BY finished_at").all(learnerId);
  const prog = db.prepare("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id=?").all(learnerId);
  const awards = db.prepare("SELECT kind, code, amount FROM awards WHERE learner_id=?").all(learnerId);
  const best = new Map();
  for (const r of prog) best.set(r.topic_id, Math.max(best.get(r.topic_id) || 0, r.best_pct));
  const mastered = [...best].filter(([id, pct]) => pct >= thresholdOf(id)).map(([id]) => id);

  const byGrade = {}, byStrand = {}, bySubject = {}, roundsByGrade = {};
  for (const id of mastered) {
    const g = TOPIC_NAME.get(id)?.gradeKey; if (g) byGrade[g] = (byGrade[g] || 0) + 1;
    const st = TOPIC_STANDARDS[id]?.strand; if (st) byStrand[st] = (byStrand[st] || 0) + 1;
    const sub = subjectOf(id); bySubject[sub] = (bySubject[sub] || 0) + 1;
  }
  for (const r of runs) { const g = TOPIC_NAME.get(r.topic_id)?.gradeKey; if (g) roundsByGrade[g] = (roundsByGrade[g] || 0) + 1; }

  const points = awards.filter(a => a.kind === "points").reduce((s, a) => s + a.amount, 0);
  const subjectPoints = subjectPointsFor(learnerId, awards);
  const subjectLevels = Object.fromEntries(Object.keys(SUBJECTS).map(k => [k, levelFor(subjectPoints[k] || 0)]));

  const lows = new Set(), comebacks = new Set();
  for (const r of runs) { if (r.pct < 50) lows.add(r.topic_id); else if (r.pct === 100 && lows.has(r.topic_id)) comebacks.add(r.topic_id); }

  const count = (kind, prefix) => awards.filter(a => a.kind === kind && a.code.startsWith(prefix)).length;
  const contests = db.prepare("SELECT pct FROM contests WHERE learner_id=?").all(learnerId);
  const puzzles = db.prepare("SELECT hints_used FROM puzzle_solves WHERE learner_id=?").all(learnerId);
  const tableCount = (sql) => { try { return db.prepare(sql).get(learnerId).c; } catch { return 0; } };

  return {
    points, level: levelFor(points), subjectLevels,
    rounds: runs.length,
    perfectRounds: runs.filter(r => r.pct === 100).length,
    unaidedPerfect: awards.filter(a => a.kind === "unaided_perfect").length,
    masteredTopics: mastered.length,
    masteredByGrade: byGrade, masteredByStrand: byStrand, masteredBySubject: bySubject, roundsByGrade,
    masteredCore: mastered.filter(id => trackOf(id) === "core").length,
    masteredAdv: mastered.filter(id => trackOf(id) === "adv").length,
    bossMastered: prog.filter(p => p.tier === "boss" && p.best_pct >= thresholdOf(p.topic_id)).length,
    masteryPassed: runs.filter(r => r.tier === "mastery" && r.pct >= thresholdOf(r.topic_id)).length,
    diagnostics: tableCount("SELECT COUNT(*) c FROM diagnostics WHERE learner_id=?"),
    comebacks: comebacks.size,
    streak: streak(learnerId),
    puzzlesSolved: puzzles.length, goldPuzzles: puzzles.filter(p => p.hints_used === 0).length,
    proofs: runs.filter(r => r.tier === "proof").length,
    contests: contests.length, contestBest: contests.reduce((m, c) => Math.max(m, c.pct), 0),
    challenges: awards.filter(a => a.kind === "points" && a.code.startsWith("challenge:") && a.amount > 0).length,
    chapters: tableCount("SELECT COUNT(*) c FROM story_choices WHERE learner_id=?"),
    lessons: tableCount("SELECT COUNT(*) c FROM lesson_progress WHERE learner_id=? AND completed_at IS NOT NULL"),
    games: count("points", "game:")
  };
}

/* Award every rule-driven badge whose condition now holds. Returns the codes
   newly earned this call. */
export function sweep(learnerId) {
  const s = stats(learnerId);
  const held = new Set(db.prepare("SELECT code FROM awards WHERE learner_id=? AND kind='badge'").all(learnerId).map(r => r.code));
  const earned = [];
  for (const r of RULES) {
    if (held.has(r.code)) continue;
    let ok = false;
    try { ok = !!r.when(s); } catch { ok = false; }
    if (ok && award(learnerId, "badge", r.code)) earned.push(r.code);
  }
  return earned;
}

/* Advanced content is worth more (spec 5.1). */
export function pointsFor({ pct, total, track, hintsUsed = 0 }) {
  const base = Math.round((pct / 100) * total * (track === "adv" ? 15 : 10));
  const penalty = Math.min(base, hintsUsed * 2);
  return Math.max(0, base - penalty);
}

export function award(learnerId, kind, code, amount = 0) {
  try {
    db.prepare("INSERT INTO awards (id, learner_id, kind, code, amount, at) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), learnerId, kind, code, amount, now());
    return true;
  } catch {
    return false;   // badge already held; the unique index refused it
  }
}

/* ---------- levels (5.4) ----------
   Levels grow with the square root of points, so early levels come quickly
   and later ones take real work. */
export const levelFor = pts => Math.max(1, Math.floor(Math.sqrt(Math.max(0, pts) / 50)) + 1);
export const nextLevelAt = level => Math.round(50 * Math.pow(level, 2));

/* Points by subject, from the topic each round was on. Puzzle, proof and
   contest points count towards the subject of their topic where known. */
function subjectPointsFor(learnerId, awards = null) {
  const rows = awards || db.prepare("SELECT kind, code, amount FROM awards WHERE learner_id=?").all(learnerId);
  const out = {};
  for (const a of rows) {
    if (a.kind !== "points") continue;
    const topic = a.code.replace(/^(round|puzzle|proof|game):/, "");
    const sub = TOPIC_NAME.has(topic) ? subjectOf(topic) : null;
    if (sub) out[sub] = (out[sub] || 0) + a.amount;
  }
  return out;
}

/* Prestige (5.4): once an advanced-track subject reaches PRESTIGE_LEVEL the
   learner may prestige it — the subject's level restarts from the points
   earned since, a permanent star is added, and the title shows it. */
export const PRESTIGE_LEVEL = 10;
export const PRESTIGE_SUBJECTS = ["numtheory", "combinatorics", "algebra", "geometry", "data", "logic"];
export function subjectLevels(learnerId) {
  const pts = subjectPointsFor(learnerId);
  const prestige = Object.fromEntries(db.prepare("SELECT subject, stars, points_at FROM prestige WHERE learner_id=?")
    .all(learnerId).map(r => [r.subject, r]));
  return Object.entries(SUBJECTS).map(([code, name]) => {
    const total = pts[code] || 0;
    const since = total - (prestige[code]?.points_at || 0);
    const level = levelFor(since);
    return { subject: code, name, points: total, level, nextLevelAt: nextLevelAt(level),
             prestige: prestige[code]?.stars || 0,
             canPrestige: PRESTIGE_SUBJECTS.includes(code) && level >= PRESTIGE_LEVEL };
  });
}
export function prestige(learnerId, subject) {
  const row = subjectLevels(learnerId).find(s => s.subject === subject);
  if (!row) return { error: "unknown_subject" };
  if (!row.canPrestige) return { error: "not_yet", level: row.level, needed: PRESTIGE_LEVEL };
  db.prepare(`INSERT INTO prestige (learner_id, subject, stars, points_at, at) VALUES (?,?,1,?,?)
              ON CONFLICT(learner_id, subject) DO UPDATE SET stars=stars+1, points_at=excluded.points_at, at=excluded.at`)
    .run(learnerId, subject, row.points, now());
  award(learnerId, "badge", `prestige_${subject}`);
  return { subject, stars: row.prestige + 1 };
}
for (const code of PRESTIGE_SUBJECTS)
  BADGES[`prestige_${code}`] = { name: `${SUBJECTS[code]} Prestige`, hint: `Prestige ${SUBJECTS[code].toLowerCase()} at level ${PRESTIGE_LEVEL}`, category: "subject" };

/* ---------- streaks and freezes (5.5) ---------- */
const dayKey = iso => iso.slice(0, 10);
const shiftDay = (key, n) => dayKey(new Date(new Date(key).getTime() + n * 86400000).toISOString());
export const MAX_FREEZES = 2;

function freezeCounts(learnerId) {
  const earned = db.prepare("SELECT COUNT(*) c FROM awards WHERE learner_id=? AND kind='freeze_earned'").get(learnerId).c;
  const used = db.prepare("SELECT COUNT(*) c FROM awards WHERE learner_id=? AND kind='freeze'").get(learnerId).c;
  return { earned, used, available: Math.max(0, Math.min(MAX_FREEZES, earned - used)) };
}

/* Consecutive days ending today (or the most recent active day). A single
   missed day is bridged by a streak freeze if one is available; the freeze
   is spent at that moment and recorded, so it cannot be spent twice. Two
   missed days in a row end the streak whatever is held. */
export function streak(learnerId, todayIso = new Date().toISOString(), { spend = true } = {}) {
  const active = new Set(db.prepare(`SELECT DISTINCT substr(at,1,10) d FROM awards
    WHERE learner_id=? AND kind IN ('points','badge','unaided_perfect')`).all(learnerId).map(r => r.d));
  const frozen = new Set(db.prepare("SELECT code FROM awards WHERE learner_id=? AND kind='freeze'").all(learnerId).map(r => r.code));
  if (!active.size) return 0;
  const today = dayKey(todayIso);
  let available = spend ? freezeCounts(learnerId).available : 0;
  let day = active.has(today) ? today : shiftDay(today, -1);
  let run = 0;
  for (;;) {
    if (active.has(day)) { run++; day = shiftDay(day, -1); continue; }
    if (frozen.has(day)) { day = shiftDay(day, -1); continue; }
    /* A gap. Bridge it with a freeze only if it is a single day with real
       activity on the far side — a freeze preserves a streak, it does not
       invent one. */
    if (available > 0 && active.has(shiftDay(day, -1))) {
      award(learnerId, "freeze", day);
      frozen.add(day); available--;
      day = shiftDay(day, -1); continue;
    }
    break;
  }
  /* Every full week of streak earns a freeze, once. */
  if (run >= 7 && run % 7 === 0) {
    const dup = db.prepare("SELECT 1 FROM awards WHERE learner_id=? AND kind='freeze_earned' AND code LIKE ?")
      .get(learnerId, `streak:${run}:%`);
    if (!dup) award(learnerId, "freeze_earned", `streak:${run}:${dayKey(todayIso)}`);
  }
  return run;
}

export function streakStatus(learnerId) {
  const days = streak(learnerId);
  const f = freezeCounts(learnerId);
  return { days, freezesAvailable: f.available, freezesUsed: f.used, freezesEarned: f.earned,
           nextFreezeAt: Math.ceil((days + 1) / 7) * 7 };
}

/* Achievement titles (spec 5.10): earned by mastering advanced strands,
   shown beside the learner's name. Ordered so the strongest wins. */
export const TITLES = [
  { code: "grand_combinatorialist", name: "Grand Combinatorialist", needs: ["combinatorics", "topic_mastered"] },
  { code: "master_of_modular",      name: "Master of Modular Arithmetic", needs: ["number_theory", "topic_mastered"] },
  { code: "proof_wright",           name: "Proof-Wright",          needs: ["elegant_solution", "unaided"] },
  { code: "contest_contender",      name: "Contest Contender",     needs: ["contest_ready"] },
  { code: "steady_hand",            name: "Steady Hand",           needs: ["streak_7"] },
  { code: "apprentice",             name: "Apprentice",            needs: ["first_steps"] }
];

export function titleFor(learnerId) {
  const held = new Set(db.prepare("SELECT code FROM awards WHERE learner_id=? AND kind='badge'")
    .all(learnerId).map(r => r.code));
  const earned = TITLES.filter(t => t.needs.every(n => held.has(n)));
  return { current: earned[0] || null, earned, locked: TITLES.filter(t => !earned.includes(t)) };
}

export function totals(learnerId) {
  const pts = db.prepare("SELECT COALESCE(SUM(amount),0) p FROM awards WHERE learner_id=? AND kind='points'")
    .get(learnerId).p;
  const badges = db.prepare("SELECT code, at FROM awards WHERE learner_id=? AND kind='badge' ORDER BY at")
    .all(learnerId)
    .map(b => ({ code: b.code, at: b.at, ...(BADGES[b.code] || { name: b.code }) }));
  const level = levelFor(pts);
  return { points: pts, level, nextLevelAt: nextLevelAt(level), badges, title: titleFor(learnerId) };
}
