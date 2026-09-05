/* Adaptive placement diagnostic (spec 4.1.1, 6.1).

   Question selection and placement are driven by the Item Response Theory
   model in irt.js: ability is re-estimated after every answer, the next
   question is the one that tells us most about a learner at that ability, and
   the diagnostic stops once the estimate is precise enough to place on.

   This replaced a two-in-a-row streak rule. Three things changed for the
   better and are worth naming, because none of them are visible in the API:

     - Every answer counts. The streak rule remembered the last two, so nine
       right followed by two wrong looked identical to two wrong from cold.
     - A lucky guess is discounted. A correct four-option multiple choice is
       weaker evidence than a correct free-input answer, and the model knows
       the difference.
     - It stops when it is sure. A clear picture at seven questions no longer
       costs a child five more, and an unclear one is not forced to a verdict
       at twelve — it says so instead.

   Sessions live server-side so the client cannot choose its own questions,
   see answers ahead of time, or report its own result. */

import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import * as irt from "./irt.js";

export const TIER_ORDER = ["practice", "challenge", "boss"];
const MAX_QUESTIONS = 12;
const MIN_QUESTIONS = 6;

const sessions = new Map();

export function makeDiagnostic({ questionsByTier, bank, topicId, learnerId }) {
  const id = randomUUID();
  sessions.set(id, {
    learnerId, topicId,
    bank: bank || [],
    asked: [], results: [],
    responses: [],                  // [{ item, correct }] — the model's input
    theta: 0, se: 1,                // the prior, before any evidence
    pool: questionsByTier,
    used: new Set()
  });
  return id;
}

export const getSession = id => sessions.get(id);
export const endSession = id => sessions.delete(id);

/* Pick the most informative unused question at the current ability estimate.

   Selection ranges over the whole bank rather than a current tier, so there
   is no tier to exhaust and no deadlock to fall back out of — an empty tier
   simply contributes no candidates. */
export function nextQuestion(sess) {
  if (sess.asked.length >= MAX_QUESTIONS) return null;

  const candidates = [];
  for (const tier of TIER_ORDER) {
    for (const idx of sess.pool[tier] || []) {
      if (sess.used.has(idx)) continue;
      const q = sess.bank[idx];
      if (!q) continue;
      candidates.push({ idx, tier, item: irt.itemParams(q) });
    }
  }
  if (!candidates.length) return null;   // bank exhausted

  /* Shuffle first so that items the model rates equally do not always come
     out in bank order — two learners of the same ability should not receive
     an identical paper. */
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const chosen = irt.selectNext(sess.theta, candidates);
  if (!chosen) return null;
  sess.used.add(chosen.idx);
  return { idx: chosen.idx, tier: chosen.tier };
}

/* Record an answer and re-estimate ability from the whole history. */
export function record(sess, { idx, tier, sec, correct }) {
  sess.asked.push({ idx, tier, sec });
  sess.results.push({ sec, tier, correct });

  const q = sess.bank[idx];
  if (q) sess.responses.push({ item: irt.itemParams(q), correct });

  const { theta, se } = irt.estimateAbility(sess.responses);
  sess.theta = theta;
  sess.se = se;
}

/* Stop when the bank runs dry, when the estimate is precise enough to place
   on, or at the ceiling — whichever comes first. The precision test is gated
   behind MIN_QUESTIONS: a run of three correct answers can push the standard
   error below target while still resting on very little evidence. */
export function shouldStop(sess, exhausted) {
  if (exhausted) return true;
  if (sess.asked.length >= MAX_QUESTIONS) return true;
  return sess.asked.length >= MIN_QUESTIONS && sess.se <= irt.SE_TARGET;
}

/* Turn the answer history into a per-section skill map plus a placement.
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

  /* Placement comes from the ability estimate, not from the percentage.

     These differ, and the difference is the point of the model: a learner who
     scores 60% on questions the model kept making harder is placed above one
     who scores 60% on questions it kept making easier. A raw percentage
     cannot tell those two apart, because it does not know what was asked. */
  const startTier = skillMap.length ? irt.tierForAbility(sess.theta) : "practice";
  const weakest = skillMap[0] || null;
  const measured = asked >= MIN_QUESTIONS && sess.se <= irt.SE_TARGET;

  return {
    asked, correct, overall,
    reliable: asked >= MIN_QUESTIONS,   // too few answers is a weak signal; say so
    ability: Number(sess.theta.toFixed(2)),
    abilityError: Number(sess.se.toFixed(2)),
    measured,                           // did we reach the precision we wanted?
    skillMap,
    recommendation: {
      topicId: sess.topicId,
      tier: startTier,
      focus: weakest ? weakest.name : null,
      message: !skillMap.length ? "Not enough evidence to place this learner yet."
        : !measured
          ? `Start at ${startTier}. ${weakest.name} needs the most attention — and this placement is a first estimate, so it may move once there is more to go on.`
        : overall >= 80 ? `Strong start — begin at ${startTier}, and keep an eye on ${weakest.name}.`
        : overall >= 50 ? `Begin at ${startTier}. ${weakest.name} needs the most attention.`
        : `Start with ${startTier}. ${weakest.name} is the place to begin.`
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
