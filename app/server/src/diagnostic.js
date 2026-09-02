/* Adaptive placement diagnostic (spec 4.1.1, 6.1).

   Item selection and stopping are driven by the IRT model in irt.js: after
   every answer the ability estimate is updated, the next question is drawn
   from the tier carrying the most information at that estimate, and the run
   ends once the estimate is precise enough (or at the maximum length). The
   placement recommendation comes from the ability estimate, not from which
   tier the learner happened to be on when the questions ran out.

   Sessions live server-side so the client cannot choose its own questions,
   see answers ahead of time, or report its own result. */

import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import * as irt from "./irt.js";

export const TIER_ORDER = ["practice", "challenge", "boss"];

const sessions = new Map();

/* Exposed so routes can grade without duplicating the bank lookup. */
export function makeDiagnostic({ questionsByTier, topicId, learnerId }) {
  const id = randomUUID();
  sessions.set(id, {
    learnerId, topicId,
    theta: 0, se: 1,
    asked: [], results: [], responses: [],
    pool: questionsByTier,          // { practice: [idx...], challenge: [...], boss: [...] }
    used: new Set()
  });
  return id;
}

export const getSession = id => sessions.get(id);
export const endSession = id => sessions.delete(id);

/* Pick an unused question from the most informative tier at the current
   ability estimate. Tiers with nothing left are skipped, so a short bank
   cannot deadlock the diagnostic. */
export function nextQuestion(sess) {
  if (sess.responses.length >= irt.MAX_ITEMS) return null;
  const candidates = TIER_ORDER
    .filter(t => (sess.pool[t] || []).some(i => !sess.used.has(i)))
    .map(t => ({ tier: t, item: irt.ITEM_PARAMS[t] }));
  const pick = irt.selectItem(sess.theta, candidates);
  if (!pick) return null;   // bank exhausted
  const pool = sess.pool[pick.tier].filter(i => !sess.used.has(i));
  const idx = pool[Math.floor(Math.random() * pool.length)];
  sess.used.add(idx);
  return { idx, tier: pick.tier };
}

/* Update the ability estimate after each answer. */
export function record(sess, { idx, tier, sec, correct }) {
  sess.asked.push({ idx, tier, sec });
  sess.results.push({ sec, tier, correct });
  sess.responses.push({ item: irt.ITEM_PARAMS[tier], correct });
  const est = irt.estimate(sess.responses);
  sess.theta = est.theta;
  sess.se = est.se;
}

export function shouldStop(sess, exhausted) {
  if (exhausted) return true;
  return irt.shouldStop(sess.responses);
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

  const startTier = asked ? irt.placement(sess.theta) : "practice";
  const weakest = skillMap[0] || null;
  return {
    asked, correct, overall,
    reliable: asked >= irt.MIN_ITEMS,   // too few answers is a weak signal; say so
    ability: { theta: sess.theta, se: sess.se, model: "2PL-IRT/EAP" },
    sequence: sess.asked.map(a => a.tier),
    skillMap,
    recommendation: {
      topicId: sess.topicId,
      tier: startTier,
      focus: weakest ? weakest.name : null,
      message: !skillMap.length ? "Not enough evidence to place this learner yet."
        : startTier === "boss" ? `Strong start — begin at ${startTier}, and keep an eye on ${weakest.name}.`
        : startTier === "challenge" ? `Begin at ${startTier}. ${weakest.name} needs the most attention.`
        : `Start with practice. ${weakest.name} is the place to begin.`
    }
  };
}

export function persist(sess, summary) {
  db.prepare(`INSERT INTO diagnostics (id, learner_id, topic_id, asked, correct, skill_map, recommendation, theta, se, finished_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), sess.learnerId, sess.topicId, summary.asked, summary.correct,
         JSON.stringify(summary.skillMap), JSON.stringify(summary.recommendation),
         summary.ability.theta, summary.ability.se, now());
}

export function latestFor(learnerId, topicId = null) {
  const row = topicId
    ? db.prepare("SELECT * FROM diagnostics WHERE learner_id = ? AND topic_id = ? ORDER BY finished_at DESC LIMIT 1").get(learnerId, topicId)
    : db.prepare("SELECT * FROM diagnostics WHERE learner_id = ? ORDER BY finished_at DESC LIMIT 1").get(learnerId);
  if (!row) return null;
  return {
    topicId: row.topic_id, asked: row.asked, correct: row.correct,
    skillMap: JSON.parse(row.skill_map),
    recommendation: JSON.parse(row.recommendation),
    ability: row.theta == null ? null : { theta: row.theta, se: row.se },
    finishedAt: row.finished_at
  };
}
