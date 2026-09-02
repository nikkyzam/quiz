/* Helpers shared by every route module: topic metadata, the public form of a
   question, grading, hint ladders, ownership checks and the progress upsert. */

import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { CURRICULUM } from "../../shared/curriculum.mjs";
import { QUESTIONS, SECS } from "../../shared/questions.mjs";
import { generate } from "../../shared/generators.mjs";

export const TIER_BY_LVL = { 1: "practice", 2: "challenge", 3: "boss" };
export const tierOf = q => TIER_BY_LVL[q.lvl || 1];

/* Topic -> track index, built once from the curriculum. Spec 7.6: mastery is
   90% for core skills and 80% for advanced, so the threshold is a property of
   the topic, decided server-side rather than trusted from the client. */
export const MASTERY = { core: 90, adv: 80 };
export const TOPIC_TRACK = (() => {
  const map = new Map();
  for (const g of Object.values(CURRICULUM))
    for (const u of g.units)
      for (const t of u.topics) map.set(t.id, u.track === "adv" ? "adv" : "core");
  return map;
})();
export const trackOf = topicId => TOPIC_TRACK.get(topicId) || null;

/* Per-class overrides (7.6) are consulted by thresholdFor; thresholdOf is the
   platform default and stays pure so content checks can rely on it. */
export const thresholdOf = topicId => MASTERY[trackOf(topicId) || "core"];

export const TOPIC_NAME = (() => {
  const m = new Map();
  for (const [gradeKey, g] of Object.entries(CURRICULUM))
    for (const u of g.units)
      for (const t of u.topics) m.set(t.id, { name: t.name, grade: g.label, gradeKey, unit: u.name, track: u.track });
  return m;
})();
export const describe = id => ({ topicId: id, ...(TOPIC_NAME.get(id) || { name: id }) });

/* Fisher-Yates on a copy; the caller's array is never mutated. */
export function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Strip everything that would give the answer away. The client never sees
   `a`, `ans`, `ansP`, `ansPt` or `expl` until it has submitted. */
export function publicQuestion(topicId, idx) {
  const q = QUESTIONS[topicId][idx];
  return {
    id: `${topicId}:${idx}`,
    sec: q.sec, secName: SECS[q.sec] || "Problem",
    type: q.type, q: q.q,
    opts: (q.type === "mc" || q.type === "multi") ? q.opts : undefined,
    // Ordering items are sent shuffled; the correct sequence stays server-side.
    items: q.type === "order" ? shuffled(q.items) : undefined,
    mono: q.mono || false,
    hint: q.hint || null,
    fig: q.fig || null,
    grid: q.type === "plot" ? (q.grid || { min: -10, max: 10 }) : undefined
  };
}

export function publicGenerated(topicId, seed) {
  const g = generate(topicId, seed);
  if (!g) return null;
  return {
    id: `gen:${topicId}:${seed}`,
    sec: g.sec, secName: SECS[g.sec] || "Problem",
    type: g.type, q: g.q, mono: false, hint: g.hint || null, fig: null, generated: true
  };
}

/* A generated question's id carries its seed, so the server can rebuild the
   exact same problem when marking it — no session storage, and a learner
   returning to a review item sees the identical question. */
export function resolveQuestion(questionId) {
  const parts = String(questionId || "").split(":");
  if (parts[0] === "gen") {
    const [, topicId, seedRaw] = parts;
    const seed = Number(seedRaw);
    if (!Number.isFinite(seed)) return null;
    const q = generate(topicId, seed);
    return q ? { q, topicId } : null;
  }
  const [topicId, idxRaw] = parts;
  const bank = QUESTIONS[topicId];
  const idx = Number(idxRaw);
  if (!bank || !Number.isInteger(idx) || !bank[idx]) return null;
  return { q: bank[idx], topicId };
}

const parsePair = raw => String(raw).replace(/−/g, "-").replace(/[^0-9.,\-]/g, "")
  .split(",").filter(s => s !== "");

export function gradeAnswer(q, raw) {
  /* Ordering: exact match to be correct, but partial credit for the
     positions that were right (spec 7.3). */
  if (q.type === "order") {
    const got = Array.isArray(raw) ? raw.map(String) : [];
    const want = q.ansOrder;
    const inPlace = got.filter((v, i) => v === want[i]).length;
    const ok = got.length === want.length && inPlace === want.length;
    return {
      ok, correctAnswer: want.join("  →  "),
      credit: want.length ? inPlace / want.length : 0,
      creditDetail: `${inPlace} of ${want.length} in the right place`
    };
  }
  /* Select-all: set equality to be correct. Partial credit rewards the right
     picks and penalises wrong ones, so guessing everything scores nothing. */
  if (q.type === "multi") {
    const got = Array.isArray(raw) ? [...new Set(raw.map(Number))] : [];
    const want = [...q.aMulti];
    const hits = got.filter(i => want.includes(i)).length;
    const falseHits = got.filter(i => !want.includes(i)).length;
    const ok = hits === want.length && falseHits === 0;
    const credit = want.length ? Math.max(0, (hits - falseHits) / want.length) : 0;
    return {
      ok, correctAnswer: want.map(i => q.opts[i]).join(", "),
      credit: Math.min(1, credit),
      creditDetail: `${hits} correct, ${falseHits} incorrect selected`
    };
  }
  if (q.type === "mc") {
    const ok = Number(raw) === q.a;
    return { ok, correctAnswer: q.opts[q.a], credit: ok ? 1 : 0 };
  }
  if (q.type === "pair") {
    const p = parsePair(raw);
    const ok = p.length === 2 &&
      Math.abs(parseFloat(p[0]) - q.ansP[0]) < 1e-9 &&
      Math.abs(parseFloat(p[1]) - q.ansP[1]) < 1e-9;
    return { ok, correctAnswer: `(${q.ansP[0]}, ${q.ansP[1]})`, credit: ok ? 1 : 0 };
  }
  /* Plot: the learner placed a point on the grid (spec 3.2.2). Accepts either
     an [x, y] array or "x, y" text; must land exactly on the target point. */
  if (q.type === "plot") {
    const p = Array.isArray(raw) ? raw.map(Number) : parsePair(raw).map(Number);
    const ok = p.length === 2 && p.every(Number.isFinite) &&
      Math.abs(p[0] - q.ansPt[0]) < 1e-9 && Math.abs(p[1] - q.ansPt[1]) < 1e-9;
    return { ok, correctAnswer: `(${q.ansPt[0]}, ${q.ansPt[1]})`, credit: ok ? 1 : 0 };
  }
  const n = parseFloat(String(raw).replace(/−/g, "-").replace(/[^0-9.\-]/g, ""));
  const numOk = !isNaN(n) && Math.abs(n - q.ans) < 1e-9;
  return { ok: numOk, correctAnswer: String(q.ans), credit: numOk ? 1 : 0 };
}

/* Hint ladder (spec 4.1.4): three levels, served one at a time so the client
   cannot read ahead. Level 3 is the worked solution. Questions may supply a
   `hints` array; otherwise we fall back to what the bank has authored. */
export function hintLadder(q) {
  if (Array.isArray(q.hints) && q.hints.length) return q.hints.slice(0, 3);
  const ladder = [];
  if (q.hint) ladder.push(q.hint);
  else ladder.push("Read the question again and name what you are being asked to find.");
  ladder.push("Work out what you know first, then take it one step at a time.");
  ladder.push(q.expl);
  return ladder;
}

export function ownLearner(req, id) {
  return db.prepare("SELECT id FROM learners WHERE id = ? AND user_id = ?").get(id, req.user.id);
}

/* One finished round: a history row plus the best-per-tier upsert. Seconds
   feed the time-on-task reporting (4.2.3). Returns the percentage. */
export function recordRun(learnerId, topicId, tier, score, total, { seconds = 0, at = now() } = {}) {
  const pct = Math.round((score / total) * 100);
  db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, seconds, finished_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), learnerId, topicId, tier, score, total, pct, Math.max(0, Math.round(seconds)), at);
  const prev = db.prepare("SELECT * FROM progress WHERE learner_id=? AND topic_id=? AND tier=?")
    .get(learnerId, topicId, tier);
  if (!prev) {
    db.prepare(`INSERT INTO progress (learner_id, topic_id, tier, best_score, best_total, best_pct, runs, last_at)
                VALUES (?,?,?,?,?,?,1,?)`).run(learnerId, topicId, tier, score, total, pct, at);
  } else if (pct > prev.best_pct) {
    db.prepare(`UPDATE progress SET best_score=?, best_total=?, best_pct=?, runs=runs+1, last_at=?
                WHERE learner_id=? AND topic_id=? AND tier=?`)
      .run(score, total, pct, at, learnerId, topicId, tier);
  } else {
    db.prepare("UPDATE progress SET runs=runs+1, last_at=? WHERE learner_id=? AND topic_id=? AND tier=?")
      .run(at, learnerId, topicId, tier);
  }
  for (const hook of afterRunHooks) { try { hook(learnerId, { topicId, tier, score, total, pct }); } catch {} }
  return pct;
}

/* Modules that want to react to a finished round (goal checks, alerts,
   webhooks) register here rather than being imported by the upsert. */
const afterRunHooks = [];
export const onRunRecorded = fn => afterRunHooks.push(fn);
