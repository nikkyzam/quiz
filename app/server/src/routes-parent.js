/* Parent portal (spec 4.2) and the learner home screen (spec 4.1.2):
   time on task, readiness, alerts, notifications, a curriculum overview with
   sample problems, and the daily dashboard with its challenge of the day. */

import { Router } from "express";
import { createHash } from "node:crypto";
import { db, now } from "./db.js";
import { requireAuth } from "./auth.js";
import { audit } from "./security.js";
import * as bkt from "./bkt.js";
import * as rewards from "./rewards.js";
import * as notify from "./notify.js";
import { CURRICULUM } from "../../shared/curriculum.mjs";
import { QUESTIONS } from "../../shared/questions.mjs";
import { STANDARDS, standardsFor } from "../../shared/standards.mjs";
import { ownLearner, trackOf, thresholdOf, TOPIC_NAME, describe, publicQuestion,
         resolveQuestion, gradeAnswer, onRunRecorded, tierOf } from "./helpers.js";

export const parent = Router();

/* Goals are re-evaluated whenever a round lands (4.2.6). */
onRunRecorded(learnerId => notify.checkGoal(learnerId));

/* ---------------- time on task (4.2.3) ---------------- */
parent.get("/learners/:id/time", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare("SELECT topic_id, seconds, finished_at FROM runs WHERE learner_id=?").all(req.params.id);
  const since7 = Date.now() - 7 * 86400000;
  const byDay = {};
  for (let i = 6; i >= 0; i--) byDay[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = 0;
  const byTopic = {};
  let total = 0, last7 = 0;
  for (const r of rows) {
    total += r.seconds;
    const t = new Date(r.finished_at).getTime();
    if (t >= since7) { last7 += r.seconds; const d = r.finished_at.slice(0, 10); if (d in byDay) byDay[d] += r.seconds; }
    byTopic[r.topic_id] = (byTopic[r.topic_id] || 0) + r.seconds;
  }
  res.json({
    totalSeconds: total, last7DaysSeconds: last7, rounds: rows.length,
    byDay: Object.entries(byDay).map(([day, seconds]) => ({ day, seconds })),
    byTopic: Object.entries(byTopic).map(([topicId, seconds]) => ({ ...describe(topicId), seconds }))
      .sort((a, b) => b.seconds - a.seconds)
  });
});

/* ---------------- readiness (4.2.3) ----------------
   Level, mastery by track, what the knowledge model is confident about, and
   whether the evidence says the learner is ready for the advanced strands or
   for a timed paper. Every claim names the evidence it rests on. */
export function readinessFor(learnerId) {
  const prog = db.prepare("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id=?").all(learnerId);
  const best = new Map();
  for (const r of prog) best.set(r.topic_id, Math.max(best.get(r.topic_id) || 0, r.best_pct));
  const mastered = [...best].filter(([id, pct]) => pct >= thresholdOf(id)).map(([id]) => id);
  const core = mastered.filter(id => trackOf(id) === "core");
  const adv = mastered.filter(id => trackOf(id) === "adv");
  const known = bkt.allFor(learnerId).filter(bkt.isKnown).length;
  const contests = db.prepare("SELECT format, pct, expired FROM contests WHERE learner_id=? ORDER BY finished_at DESC").all(learnerId);
  const bestContest = contests.reduce((m, c) => Math.max(m, c.pct), 0);
  const totals = rewards.totals(learnerId);
  const hardest = [...best].filter(([id]) => trackOf(id) === "adv").length;

  const advancedReady = core.length >= 2 || adv.length >= 1;
  const competitionReady = adv.length >= 2 && bestContest >= 70;
  return {
    level: totals.level, points: totals.points, title: totals.title.current,
    mastery: { core: core.length, advanced: adv.length, started: best.size },
    knownSkills: known,
    contests: { papers: contests.length, best: bestContest },
    readiness: {
      advanced: { ready: advancedReady,
        reason: advancedReady
          ? (adv.length ? `already mastered ${adv.length} advanced topic${adv.length === 1 ? "" : "s"}`
                        : `${core.length} core topics mastered`)
          : `master ${2 - core.length} more core topic${2 - core.length === 1 ? "" : "s"} first` },
      competition: { ready: competitionReady,
        reason: competitionReady ? `${adv.length} advanced topics mastered and ${bestContest}% on a timed paper`
          : adv.length < 2 ? `needs ${2 - adv.length} more advanced topic${2 - adv.length === 1 ? "" : "s"} mastered`
          : contests.length ? `best timed paper is ${bestContest}%; aim for 70%`
          : "no timed paper attempted yet" },
      advancedTopicsTried: hardest
    }
  };
}

parent.get("/learners/:id/readiness", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  audit(req.user.id, "readiness.read", req.params.id, req);
  res.json(readinessFor(req.params.id));
});

/* ---------------- alerts (4.2.5) ----------------
   Computed from the record, then written to the notification feed so the
   parent sees them without opening this screen. */
export function alertsFor(learnerId) {
  const learner = db.prepare("SELECT id, user_id, name, track, created_at FROM learners WHERE id=?").get(learnerId);
  if (!learner) return [];
  const alerts = [];
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();

  /* Struggling: three or more mistakes in one topic this week with no pass yet,
     or the last two rounds on a topic both below half marks. */
  const mistakes = db.prepare(`SELECT topic_id, COUNT(*) c FROM mistakes WHERE learner_id=? AND at >= ?
                               GROUP BY topic_id HAVING c >= 3`).all(learnerId, since7);
  for (const m of mistakes) {
    const bestRow = db.prepare("SELECT MAX(best_pct) b FROM progress WHERE learner_id=? AND topic_id=?").get(learnerId, m.topic_id);
    if ((bestRow?.b || 0) < thresholdOf(m.topic_id))
      alerts.push({ kind: "struggling", topicId: m.topic_id, topic: describe(m.topic_id).name,
        detail: `${m.c} mistakes this week on ${describe(m.topic_id).name}` });
  }
  const recent = db.prepare(`SELECT topic_id, pct FROM runs WHERE learner_id=? ORDER BY finished_at DESC LIMIT 20`).all(learnerId);
  const byTopic = {};
  for (const r of recent) (byTopic[r.topic_id] ||= []).push(r.pct);
  for (const [topicId, pcts] of Object.entries(byTopic))
    if (pcts.length >= 2 && pcts[0] < 50 && pcts[1] < 50 && !alerts.some(a => a.topicId === topicId))
      alerts.push({ kind: "struggling", topicId, topic: describe(topicId).name,
        detail: `the last two rounds on ${describe(topicId).name} scored ${pcts[1]}% and ${pcts[0]}%` });

  /* Inactive: no round in seven days, for a learner who has been around that long. */
  const last = db.prepare("SELECT MAX(finished_at) m FROM runs WHERE learner_id=?").get(learnerId).m;
  const ageDays = (Date.now() - new Date(learner.created_at).getTime()) / 86400000;
  if (!last && ageDays >= 7) alerts.push({ kind: "inactive", detail: "no practice recorded yet" });
  else if (last && last < since7) {
    const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    alerts.push({ kind: "inactive", detail: `last practised ${days} days ago` });
  }

  /* Ready to advance: on the core track with the evidence for enrichment, or
     the model confident on a topic whose next step is unlocked. */
  const r = readinessFor(learnerId);
  if (learner.track === "core" && r.readiness.advanced.ready)
    alerts.push({ kind: "ready_to_advance", detail: `${r.readiness.advanced.reason}; consider the enrichment track` });
  else if (learner.track !== "competition" && r.readiness.competition.ready)
    alerts.push({ kind: "ready_to_advance", detail: `${r.readiness.competition.reason}; consider the competition track` });

  /* Write each to the feed; de-duplication keeps it to one per kind per day. */
  for (const a of alerts) {
    const title = a.kind === "struggling" ? `${learner.name} is finding ${a.topic} hard`
                : a.kind === "inactive" ? `${learner.name} has not practised lately`
                : `${learner.name} is ready for more`;
    notify.notify(learner.user_id, { learnerId, kind: a.kind, title, body: a.detail });
  }
  return alerts;
}

parent.get("/learners/:id/alerts", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  res.json({ alerts: alertsFor(req.params.id) });
});

/* ---------------- notification feed (4.2.5, 4.2.6, 9.4) ---------------- */
parent.get("/me/notifications", requireAuth, (req, res) => {
  /* Refresh alerts for every learner first, so the feed is current. */
  for (const l of db.prepare("SELECT id FROM learners WHERE user_id=?").all(req.user.id)) alertsFor(l.id);
  const items = notify.listFor(req.user.id, { unreadOnly: req.query.unread === "1" });
  res.json({ notifications: items, unread: items.filter(n => !n.readAt).length, kinds: notify.KINDS });
});
parent.post("/me/notifications/:id/read", requireAuth, (req, res) => {
  res.json({ updated: notify.markRead(req.user.id, req.params.id) });
});
parent.post("/me/notifications/read-all", requireAuth, (req, res) => {
  res.json({ updated: notify.markAllRead(req.user.id) });
});

/* ---------------- curriculum overview with sample problems (4.2.7) ----------------
   A parent can see what each unit covers, which standards it maps to, and one
   real problem per topic — served in its public form, so no answers leak. */
parent.get("/curriculum/overview/:grade", (req, res) => {
  const g = CURRICULUM[req.params.grade];
  if (!g) return res.status(404).json({ error: "unknown_grade" });
  const units = g.units.map(u => ({
    name: u.name, track: u.track,
    topics: u.topics.map(t => {
      const bank = QUESTIONS[t.id];
      /* The sample is the first practice-tier question: the gentlest entry point. */
      const idx = bank ? bank.findIndex(q => tierOf(q) === "practice") : -1;
      return {
        id: t.id, name: t.name, threshold: thresholdOf(t.id),
        questions: bank ? bank.length : 0,
        standards: standardsFor(t.id),
        sample: idx >= 0 ? publicQuestion(t.id, idx) : null
      };
    })
  }));
  res.json({ grade: req.params.grade, label: g.label, units, standardsCatalogue: STANDARDS.catalogue });
});

/* ---------------- learner home (4.1.2) ----------------
   Streak, a daily goal derived from the weekly one, the challenge of the day,
   and a dual-track map: per grade, how far along the core and advanced
   strands the learner is. */
const dayKey = () => new Date().toISOString().slice(0, 10);

/* Deterministic per learner per day, so refreshing the page does not roll a
   new challenge, but every child gets a different one. */
export function challengeFor(learnerId, day = dayKey()) {
  const tried = db.prepare("SELECT DISTINCT topic_id FROM progress WHERE learner_id=?").all(learnerId).map(r => r.topic_id)
    .filter(t => QUESTIONS[t]);
  const pool = tried.length ? tried : Object.keys(QUESTIONS);
  const h = createHash("sha256").update(`${learnerId}:${day}`).digest();
  const topicId = pool[h[0] % pool.length];
  const bank = QUESTIONS[topicId];
  /* Prefer a challenge or boss question: it is meant to be a stretch. */
  const hard = bank.map((q, i) => ({ q, i })).filter(o => tierOf(o.q) !== "practice");
  const pick = (hard.length ? hard : bank.map((q, i) => ({ q, i })))[h[1] % (hard.length || bank.length)];
  return { topicId, idx: pick.i, id: `${topicId}:${pick.i}`, day };
}

parent.get("/learners/:id/home", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const learnerId = req.params.id;
  const learner = db.prepare("SELECT name, beast, track FROM learners WHERE id=?").get(learnerId);
  const today = dayKey();

  const goal = db.prepare("SELECT * FROM goals WHERE learner_id=?").get(learnerId);
  const roundsToday = db.prepare("SELECT COUNT(*) c FROM runs WHERE learner_id=? AND substr(finished_at,1,10)=?")
    .get(learnerId, today).c;
  const dailyTarget = goal?.rounds_per_week ? Math.max(1, Math.ceil(goal.rounds_per_week / 7)) : 1;

  const ch = challengeFor(learnerId);
  const done = db.prepare("SELECT amount FROM awards WHERE learner_id=? AND kind='points' AND code=?")
    .get(learnerId, `challenge:${today}`);

  const prog = db.prepare("SELECT topic_id, best_pct FROM progress WHERE learner_id=?").all(learnerId);
  const best = new Map();
  for (const r of prog) best.set(r.topic_id, Math.max(best.get(r.topic_id) || 0, r.best_pct));
  const map = Object.entries(CURRICULUM).map(([key, g]) => {
    const strand = track => {
      const topics = g.units.filter(u => u.track === track).flatMap(u => u.topics);
      const withContent = topics.filter(t => QUESTIONS[t.id]);
      return {
        topics: topics.length, available: withContent.length,
        started: withContent.filter(t => best.has(t.id)).length,
        mastered: withContent.filter(t => (best.get(t.id) || 0) >= thresholdOf(t.id)).length
      };
    };
    return { grade: key, label: g.label, core: strand("core"), advanced: strand("adv") };
  });

  const streak = rewards.streak(learnerId);
  res.json({
    learner: { id: learnerId, ...learner },
    streak: { days: streak, ...rewards.streakStatus?.(learnerId) },
    dailyGoal: { target: dailyTarget, done: roundsToday, met: roundsToday >= dailyTarget,
                 weeklyTarget: goal?.rounds_per_week || null },
    challenge: { ...publicQuestion(ch.topicId, ch.idx), topic: describe(ch.topicId).name,
                 done: !!done, bonus: 30 },
    map,
    rewards: rewards.totals(learnerId)
  });
});

/* Answering the challenge of the day. Graded server-side; the bonus is paid
   once per day and only for a correct first answer. */
parent.post("/learners/:id/challenge", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const learnerId = req.params.id;
  const today = dayKey();
  const ch = challengeFor(learnerId);
  const { questionId, answer } = req.body || {};
  if (questionId !== ch.id) return res.status(400).json({ error: "not_todays_challenge" });
  const already = db.prepare("SELECT 1 FROM awards WHERE learner_id=? AND kind='points' AND code=?")
    .get(learnerId, `challenge:${today}`);
  if (already) return res.status(409).json({ error: "challenge_already_done" });
  const { q } = resolveQuestion(questionId);
  const { ok, correctAnswer } = gradeAnswer(q, answer);
  /* Right or wrong, the day's challenge is spent: it is one attempt. */
  rewards.award(learnerId, "points", `challenge:${today}`, ok ? 30 : 0);
  if (ok) rewards.award(learnerId, "badge", "daily_challenger");
  audit(req.user.id, "challenge.answered", `${ch.id}:${ok}`, req);
  res.json({ correct: ok, correctAnswer, explanation: q.expl, bonus: ok ? 30 : 0 });
});
