/* Adaptive placement diagnostic (spec 4.1.1, 6.1).

   The difficulty rule is deliberately simple and readable: step up a tier
   after two consecutive correct answers, step down after two consecutive
   wrong ones. That is a real adaptive sequence, but it is NOT the IRT/BKT
   model requirement 6.3 asks for — that stays open, and this module is the
   seam it will slot into.

   Sessions live server-side so the client cannot choose its own questions,
   see answers ahead of time, or report its own result. */

import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";

export const TIER_ORDER = ["practice", "challenge", "boss"];
const MAX_QUESTIONS = 12;
const MIN_QUESTIONS = 6;

const sessions = new Map();

/* Exposed so routes can grade without duplicating the bank lookup. */
export function makeDiagnostic({ questionsByTier, topicId, learnerId }) {
  const id = randomUUID();
  sessions.set(id, {
    learnerId, topicId,
    tierIdx: 0,
    streakRight: 0, streakWrong: 0,
    asked: [], results: [],
    pool: questionsByTier,          // { practice: [idx...], challenge: [...], boss: [...] }
    used: new Set()
  });
  return id;
}

export const getSession = id => sessions.get(id);
export const endSession = id => sessions.delete(id);

/* Pick an unused question at the current tier, falling back outward if that
   tier is exhausted, so a short bank cannot deadlock the diagnostic. */
export function nextQuestion(sess) {
  if (sess.asked.length >= MAX_QUESTIONS) return null;
  const order = [sess.tierIdx, ...TIER_ORDER.map((_, i) => i).filter(i => i !== sess.tierIdx)];
  for (const ti of order) {
    const tier = TIER_ORDER[ti];
    const pool = (sess.pool[tier] || []).filter(i => !sess.used.has(i));
    if (pool.length) {
      const idx = pool[Math.floor(Math.random() * pool.length)];
      sess.used.add(idx);
      return { idx, tier };
    }
  }
  return null;   // bank exhausted
}

/* Apply the adaptive step after each answer. */
export function record(sess, { idx, tier, sec, correct }) {
  sess.asked.push({ idx, tier, sec });
  sess.results.push({ sec, tier, correct });
  if (correct) {
    sess.streakRight++; sess.streakWrong = 0;
    if (sess.streakRight >= 2 && sess.tierIdx < TIER_ORDER.length - 1) {
      sess.tierIdx++; sess.streakRight = 0;
    }
  } else {
    sess.streakWrong++; sess.streakRight = 0;
    if (sess.streakWrong >= 2 && sess.tierIdx > 0) {
      sess.tierIdx--; sess.streakWrong = 0;
    }
  }
}

export function shouldStop(sess, exhausted) {
  if (exhausted) return true;
  return sess.asked.length >= MAX_QUESTIONS;
}

/* Turn the answer history into a per-section skill map plus a recommendation.
   Sections with no evidence are reported as "untested" rather than guessed. */
export function summarise(sess, secNames) {
  const bySec = {};
  for (const r of sess.results) {
    const s = (bySec[r.sec] ||= { asked: 0, correct: 0 });
    s.asked++; if (r.correct) s.correct++;
  }
  const skillMap = Object.entries(bySec).map(([sec, s]) => ({
    sec, name: secNames[sec] || sec,
    asked: s.asked, correct: s.correct,
    pct: Math.round((s.correct / s.asked) * 100),
    level: s.correct / s.asked >= 0.8 ? "secure"
         : s.correct / s.asked >= 0.5 ? "developing" : "needs work"
  })).sort((a, b) => a.pct - b.pct);

  const asked = sess.results.length;
  const correct = sess.results.filter(r => r.correct).length;
  const overall = asked ? Math.round((correct / asked) * 100) : 0;

  /* Recommend the tier the learner was holding when the diagnostic ended,
     and name the weakest section as the place to begin. */
  const startTier = overall >= 80 ? TIER_ORDER[Math.min(sess.tierIdx + 0, 2)]
                  : overall >= 50 ? TIER_ORDER[sess.tierIdx]
                  : "practice";
  const weakest = skillMap[0] || null;
  return {
    asked, correct, overall,
    reliable: asked >= MIN_QUESTIONS,   // too few answers is a weak signal; say so
    skillMap,
    recommendation: {
      topicId: sess.topicId,
      tier: startTier,
      focus: weakest ? weakest.name : null,
      message: !skillMap.length ? "Not enough evidence to place this learner yet."
        : overall >= 80 ? `Strong start — begin at ${startTier}, and keep an eye on ${weakest.name}.`
        : overall >= 50 ? `Begin at ${startTier}. ${weakest.name} needs the most attention.`
        : `Start with practice. ${weakest.name} is the place to begin.`
    }
  };
}

export function persist(sess, summary) {
  db.prepare(`INSERT INTO diagnostics (id, learner_id, topic_id, asked, correct, skill_map, recommendation, finished_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), sess.learnerId, sess.topicId, summary.asked, summary.correct,
         JSON.stringify(summary.skillMap), JSON.stringify(summary.recommendation), now());
}

export function latestFor(learnerId) {
  const row = db.prepare("SELECT * FROM diagnostics WHERE learner_id = ? ORDER BY finished_at DESC LIMIT 1")
    .get(learnerId);
  if (!row) return null;
  return {
    topicId: row.topic_id, asked: row.asked, correct: row.correct,
    skillMap: JSON.parse(row.skill_map),
    recommendation: JSON.parse(row.recommendation),
    finishedAt: row.finished_at
  };
}
