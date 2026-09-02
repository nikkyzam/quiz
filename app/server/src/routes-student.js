/* Student app depth (spec 3.2.1, 4.1.3, 3.2.7, 5.9, 3.3.5, 3.5.4, 8.4, 10.6):
   comic lessons with resume and embedded checks, simulations with
   server-checked tasks, mini-games scored from their seed, contest guides,
   LaTeX rendering, translated content, and offline sync. */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { requireAuth } from "./auth.js";
import { audit } from "./security.js";
import * as rewards from "./rewards.js";
import * as bkt from "./bkt.js";
import { LESSONS, lessonById, publicLesson, lessonsForTopic } from "../../shared/lessons.mjs";
import { SIMULATIONS, simulationById, publicSimulation, checkTask } from "../../shared/simulations.mjs";
import { GAMES, buildRound, scoreRound, publicGame } from "../../shared/games.mjs";
import { GUIDES, guideFor } from "../../shared/guides.mjs";
import { TEMPLATES as PROOF_TEMPLATES } from "../../shared/proofs.mjs";
import { latexToMathML, renderQuestion } from "../../shared/mathml.mjs";
import { LOCALES, STRINGS, DEFAULT_LOCALE } from "../../shared/i18n.mjs";
import { translatedTopics } from "../../shared/translations.mjs";
import { QUESTIONS } from "../../shared/questions.mjs";
import { ownLearner, gradeAnswer, recordRun, describe, resolveQuestion } from "./helpers.js";
import { classify } from "./errors.js";
import * as webhooks from "./webhooks.js";

export const student = Router();

/* ---------------- comic lessons (3.2.1, 4.1.3) ---------------- */
student.get("/lessons", (req, res) => {
  const list = req.query.topicId ? lessonsForTopic(String(req.query.topicId)) : LESSONS;
  res.json({ lessons: list.map(l => ({ id: l.id, topicId: l.topicId, topic: describe(l.topicId).name, grade: l.grade,
    title: l.title, panels: l.panels.length, checks: l.panels.filter(p => p.check).length })) });
});

student.get("/lessons/:id", (req, res) => {
  const l = lessonById(req.params.id);
  if (!l) return res.status(404).json({ error: "unknown_lesson" });
  res.json({ lesson: publicLesson(l) });
});

function lessonProgress(learnerId, lessonId) {
  return db.prepare("SELECT * FROM lesson_progress WHERE learner_id=? AND lesson_id=?").get(learnerId, lessonId);
}

/* Where each lesson stands for this learner: the panel to resume at. */
student.get("/learners/:id/lessons", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare("SELECT * FROM lesson_progress WHERE learner_id=?").all(req.params.id);
  const by = Object.fromEntries(rows.map(r => [r.lesson_id, r]));
  res.json({ lessons: LESSONS.map(l => ({
    id: l.id, title: l.title, topicId: l.topicId, grade: l.grade, panels: l.panels.length,
    resumeAt: by[l.id]?.completed_at ? null : (by[l.id]?.panel ?? 0),
    checksPassed: by[l.id]?.checks_passed || 0, completed: !!by[l.id]?.completed_at
  })) });
});

/* Save position. A panel with a check cannot be passed by moving past it:
   the server only advances to panel N if every check before N is passed. */
student.post("/lessons/:id/progress", requireAuth, (req, res) => {
  const l = lessonById(req.params.id);
  if (!l) return res.status(404).json({ error: "unknown_lesson" });
  const { learnerId, panel } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const target = Math.max(0, Math.min(l.panels.length, Number(panel) || 0));
  const cur = lessonProgress(learnerId, l.id);
  const checksBefore = l.panels.slice(0, target).filter(p => p.check).length;
  const passed = cur?.checks_passed || 0;
  if (checksBefore > passed) return res.status(409).json({ error: "check_not_passed", resumeAt: cur?.panel ?? 0 });
  const completed = target >= l.panels.length;
  db.prepare(`INSERT INTO lesson_progress (learner_id, lesson_id, panel, checks_passed, started_at, completed_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(learner_id, lesson_id) DO UPDATE SET panel=excluded.panel,
                completed_at=COALESCE(lesson_progress.completed_at, excluded.completed_at)`)
    .run(learnerId, l.id, Math.min(target, l.panels.length - 1), passed, now(), completed ? now() : null);
  let badges = [];
  if (completed && !cur?.completed_at) {
    rewards.award(learnerId, "points", `lesson:${l.id}`, 15);
    badges = rewards.sweep(learnerId);
    webhooks.emit(learnerId, "lesson.completed", { lessonId: l.id, title: l.title });
    audit(req.user.id, "lesson.completed", l.id, req);
  }
  res.json({ panel: Math.min(target, l.panels.length - 1), completed, badges });
});

/* An embedded check, graded here. Passing it is what lets the lesson move on. */
student.post("/lessons/:id/check", requireAuth, (req, res) => {
  const l = lessonById(req.params.id);
  if (!l) return res.status(404).json({ error: "unknown_lesson" });
  const { learnerId, panel, answer } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const p = l.panels[Number(panel)];
  if (!p?.check) return res.status(400).json({ error: "no_check_on_panel" });
  const { ok, correctAnswer } = gradeAnswer(p.check, answer);
  const cur = lessonProgress(learnerId, l.id);
  const idxOfCheck = l.panels.slice(0, Number(panel) + 1).filter(x => x.check).length;   // 1-based among checks
  if (ok && (cur?.checks_passed || 0) < idxOfCheck) {
    db.prepare(`INSERT INTO lesson_progress (learner_id, lesson_id, panel, checks_passed, started_at)
                VALUES (?,?,?,?,?)
                ON CONFLICT(learner_id, lesson_id) DO UPDATE SET checks_passed=?, panel=MAX(lesson_progress.panel, ?)`)
      .run(learnerId, l.id, Number(panel), idxOfCheck, now(), idxOfCheck, Number(panel));
    bkt.observe(learnerId, l.topicId, true, bkt.paramsFor({ optionCount: p.check.type === "mc" ? p.check.opts.length : 0 }));
  } else if (!ok) {
    bkt.observe(learnerId, l.topicId, false, bkt.paramsFor({ optionCount: p.check.type === "mc" ? p.check.opts.length : 0 }));
  }
  res.json({ correct: ok, correctAnswer: ok ? correctAnswer : undefined, explanation: ok ? p.check.expl : undefined,
             hint: ok ? undefined : (p.check.hint || "Have another go."), canContinue: ok || (cur?.checks_passed || 0) >= idxOfCheck });
});

/* ---------------- simulations (3.2.7) ---------------- */
student.get("/simulations", (_req, res) => res.json({ simulations: SIMULATIONS.map(publicSimulation) }));

student.post("/simulations/:id/check", requireAuth, (req, res) => {
  const sim = simulationById(req.params.id);
  if (!sim) return res.status(404).json({ error: "unknown_simulation" });
  const { learnerId, taskId, state } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const r = checkTask(sim, String(taskId), state);
  if (r.error) return res.status(400).json({ error: r.error });
  if (r.ok) {
    /* First completion of a task earns a little; later ones are free play. */
    const code = `sim:${sim.id}:${taskId}`;
    const before = db.prepare("SELECT 1 FROM awards WHERE learner_id=? AND kind='points' AND code=?").get(learnerId, code);
    if (!before) rewards.award(learnerId, "points", code, 10);
    bkt.observe(learnerId, sim.topicId, true, bkt.paramsFor({}));
  }
  res.json({ ok: r.ok, message: r.ok ? "Task complete." : "Not there yet — keep exploring." });
});

student.get("/learners/:id/simulations", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const done = db.prepare("SELECT code FROM awards WHERE learner_id=? AND kind='points' AND code LIKE 'sim:%'").all(req.params.id)
    .map(r => r.code.split(":"));
  res.json({ completed: done.map(([, sim, task]) => ({ simulationId: sim, taskId: task })) });
});

/* ---------------- mini-games (5.9) ---------------- */
const gameSessions = new Map();

student.get("/games", (_req, res) => res.json({ games: Object.keys(GAMES).map(publicGame) }));

student.post("/games/:id/start", requireAuth, (req, res) => {
  if (!GAMES[req.params.id]) return res.status(404).json({ error: "unknown_game" });
  const { learnerId } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const seed = Math.floor(Math.random() * 1e9);
  const round = buildRound(req.params.id, seed);
  const id = randomUUID();
  gameSessions.set(id, { learnerId, gameId: req.params.id, seed, startedAt: Date.now(), deadline: Date.now() + (round.seconds + 5) * 1000 });
  res.json({ sessionId: id, ...round });
});

student.post("/games/finish", requireAuth, (req, res) => {
  const { sessionId, responses } = req.body || {};
  const sess = gameSessions.get(sessionId);
  if (!sess) return res.status(404).json({ error: "unknown_session" });
  if (!ownLearner(req, sess.learnerId)) return res.status(403).json({ error: "not_your_learner" });
  gameSessions.delete(sessionId);
  const late = Date.now() > sess.deadline;
  const { score, total } = scoreRound(sess.gameId, sess.seed, responses);
  const g = GAMES[sess.gameId];
  const pts = late ? 0 : score * 2;
  if (pts > 0) rewards.award(sess.learnerId, "points", `game:${g.topicId}`, pts);
  else rewards.award(sess.learnerId, "points", `game:${g.topicId}`, 0);
  const best = db.prepare("SELECT MAX(amount) m FROM awards WHERE learner_id=? AND kind='points' AND code=?").get(sess.learnerId, `game:${g.topicId}`).m;
  const badges = rewards.sweep(sess.learnerId);
  audit(req.user.id, "game.finished", `${sess.gameId}:${score}/${total}`, req);
  res.json({ score, total, points: pts, late, bestPoints: best, badges,
             seconds: Math.round((Date.now() - sess.startedAt) / 1000) });
});

/* ---------------- contest corner guides (3.3.5) ---------------- */
student.get("/contest/guides", (req, res) => {
  res.json({ guides: req.query.format ? guideFor(String(req.query.format)) : GUIDES });
});

/* Proof template library (4.1.10). */
student.get("/proofs/templates", (_req, res) => res.json({ templates: PROOF_TEMPLATES }));

/* ---------------- notation (3.5.4) ---------------- */
student.post("/render/latex", (req, res) => {
  try { res.json(latexToMathML(String(req.body?.src || ""))); }
  catch (e) { res.status(400).json({ error: "unsupported_latex", detail: e.message }); }
});
student.post("/render/text", (req, res) => res.json(renderQuestion(String(req.body?.text || ""))));

/* ---------------- localisation (8.4, 10.8) ---------------- */
student.get("/i18n", (req, res) => {
  const locale = LOCALES[String(req.query.locale)] ? String(req.query.locale) : DEFAULT_LOCALE;
  res.json({ locale, locales: LOCALES, dir: LOCALES[locale].dir, strings: STRINGS[locale],
             translatedTopics: translatedTopics(locale) });
});

/* ---------------- offline sync (10.6) ----------------
   Answers given while offline are queued on the device and marked here on
   reconnect. Each batch carries a client id; a batch already recorded is
   acknowledged again without being counted twice. */
student.post("/sync", requireAuth, (req, res) => {
  const { learnerId, batches } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!Array.isArray(batches) || batches.length > 50) return res.status(400).json({ error: "bad_batches" });
  const results = [];
  for (const b of batches) {
    const clientId = String(b?.clientId || "");
    if (!/^[\w-]{8,64}$/.test(clientId)) { results.push({ clientId, error: "bad_client_id" }); continue; }
    const existing = db.prepare("SELECT pct, score, total FROM runs WHERE learner_id=? AND client_id=?").get(learnerId, clientId);
    if (existing) { results.push({ clientId, duplicate: true, ...existing }); continue; }
    const answers = b.answers && typeof b.answers === "object" ? b.answers : {};
    const ids = Object.keys(answers).slice(0, 50);
    const topicId = String(b.topicId || "");
    if (!QUESTIONS[topicId] || !ids.length) { results.push({ clientId, error: "bad_batch" }); continue; }
    let score = 0;
    const detail = ids.map(qid => {
      const r = resolveQuestion(qid);
      if (!r || r.topicId !== topicId) return { id: qid, correct: false, error: "unknown_question" };
      const { ok, correctAnswer } = gradeAnswer(r.q, answers[qid]);
      if (ok) score++;
      else db.prepare("INSERT INTO mistakes (id, learner_id, topic_id, question_id, category, at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), learnerId, topicId, qid, classify(r.q, answers[qid]), now());
      bkt.observe(learnerId, topicId, ok, bkt.paramsFor({ optionCount: r.q.type === "mc" ? (r.q.opts || []).length : 0 }));
      return { id: qid, correct: ok, correctAnswer, explanation: r.q.expl };
    });
    const finishedAt = b.finishedAt && !isNaN(Date.parse(b.finishedAt)) && Date.parse(b.finishedAt) <= Date.now()
      ? new Date(b.finishedAt).toISOString() : now();
    const pct = recordRun(learnerId, topicId, "offline", score, ids.length,
      { seconds: Math.min(4 * 3600, Number(b.seconds) || 0), at: finishedAt });
    db.prepare("UPDATE runs SET client_id=? WHERE learner_id=? AND topic_id=? AND tier='offline' AND finished_at=? AND client_id IS NULL")
      .run(clientId, learnerId, topicId, finishedAt);
    results.push({ clientId, duplicate: false, score, total: ids.length, pct, detail });
  }
  rewards.sweep(learnerId);
  audit(req.user.id, "offline.synced", `${learnerId}:${results.length}`, req);
  res.json({ results });
});
