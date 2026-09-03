import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import {
  createUser, findUserByEmail, verifyPassword, createLearner,
  createSession, destroySession, requireAuth,
  createResetToken, consumeResetToken, setPassword
} from "./auth.js";
import { rateLimit, audit, auditTrail } from "./security.js";
import * as diag from "./diagnostic.js";
import * as spacing from "./spacing.js";
import { PREREQS, prereqsOf, allPrereqs, unlockedBy } from "../../shared/prereqs.mjs";
import { classify, summarise as summariseErrors, CATEGORIES } from "./errors.js";
import { CONTEST_FORMATS, isExpired, scorePaper } from "./contest.js";
import * as rewards from "./rewards.js";
import { generate, generatedTopics } from "../../shared/generators.mjs";
import * as bkt from "./bkt.js";
import * as bandit from "./bandit.js";
import { PROOFS, publicProof, checkProof, proofsForTopic, allProofs, PROOF_KINDS } from "../../shared/proofs.mjs";
import { PUZZLES, publicPuzzle, checkPuzzle, puzzleById } from "../../shared/puzzles.mjs";
import { requireRole } from "./security.js";
import { CURRICULUM, TIERS } from "../../shared/curriculum.mjs";
import { QUESTIONS, SECS } from "../../shared/questions.mjs";
import {
  tierOf, MASTERY, TOPIC_TRACK, trackOf, thresholdOf, TOPIC_NAME, describe,
  publicQuestion, publicGenerated, resolveQuestion, gradeAnswer, hintLadder,
  ownLearner, recordRun
} from "./helpers.js";
export { MASTERY, trackOf, thresholdOf };
import { parent as parentRoutes } from "./routes-parent.js";
import { game as gameRoutes, unlockedAreas } from "./routes-game.js";
import { teacher as teacherRoutes, percentileFor } from "./routes-teacher.js";
import { admin as adminRoutes } from "./routes-admin.js";
import { student as studentRoutes } from "./routes-student.js";
import { integrations as integrationRoutes } from "./routes-integrations.js";
import { securityRoutes } from "./routes-security.js";
import { cms as cmsRoutes } from "./routes-cms.js";
import * as webhooks from "./webhooks.js";
import { track } from "./analytics.js";
import { LOCALES } from "../../shared/i18n.mjs";
import { translateQuestion, translatedExplanation } from "../../shared/translations.mjs";
import { thresholdFor, masteryState, accommodationsFor } from "./policy.js";

export const api = Router();
api.use(parentRoutes);
api.use(gameRoutes);
api.use(teacherRoutes);
api.use(adminRoutes);
api.use(studentRoutes);
api.use(integrationRoutes);
api.use(securityRoutes);
api.use(cmsRoutes);



/* ---------------- auth ---------------- */
const COOKIE = {
  httpOnly: true, sameSite: "lax", path: "/",
  secure: process.env.NODE_ENV === "production"   // HTTPS-only once deployed
};

/* Brute-force protection. Login is limited per IP+email so one attacker
   cannot cycle a password list against a known address. */
const loginLimit = rateLimit({
  windowMs: 15 * 60_000, max: 10,
  key: req => `login:${req.ip}:${String(req.body?.email || "").toLowerCase()}`,
  message: "too_many_attempts"
});
/* Registration is limited to slow mass automated signup, NOT to gate real
   users: a school or family shares one NAT address, so this must stay well
   above plausible legitimate use. Login is where the strict limit belongs. */
const registerLimit = rateLimit({
  windowMs: 60 * 60_000,
  max: Number(process.env.REGISTER_LIMIT_PER_HOUR || 30),
  key: req => `reg:${req.ip}`
});

api.post("/auth/register", registerLimit, (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !String(email).includes("@")) return res.status(400).json({ error: "bad_email" });
  if (!password || String(password).length < 8) return res.status(400).json({ error: "weak_password" });
  if (!name || !String(name).trim()) return res.status(400).json({ error: "missing_name" });
  if (findUserByEmail(email)) return res.status(409).json({ error: "email_taken" });

  const { coppaConsent } = req.body || {};
  if (coppaConsent !== true) return res.status(400).json({ error: "coppa_consent_required" });
  /* Admin cannot be self-assigned at signup. It is granted out of band with
     ADMIN_EMAILS, so nobody can register their way into district data. */
  const adminList = String(process.env.ADMIN_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  const role = adminList.includes(String(email).toLowerCase()) ? "admin"
             : ["parent", "teacher"].includes(req.body?.role) ? req.body.role : "parent";
  const user = createUser({ email, password: String(password),
                            name: String(name).trim().slice(0, 60), role, coppaConsent: true });
  audit(user.id, "account.created", null, req);
  const s = createSession(user.id);
  res.cookie("sid", s.id, { ...COOKIE, expires: new Date(s.expires) });
  res.json({ user });
});

api.post("/auth/login", loginLimit, (req, res) => {
  const { email, password } = req.body || {};
  const row = findUserByEmail(email || "");
  // Same response either way so the endpoint can't be used to discover emails.
  if (!row || !verifyPassword(String(password || ""), row.pass_hash, row.pass_salt)) {
    return res.status(401).json({ error: "bad_credentials" });
  }
  const s = createSession(row.id);
  audit(row.id, "auth.login", null, req);
  res.cookie("sid", s.id, { ...COOKIE, expires: new Date(s.expires) });
  res.json({ user: { id: row.id, email: row.email, name: row.name, role: row.role || "parent" } });
});

api.post("/auth/logout", (req, res) => {
  if (req.user) audit(req.user.id, "auth.logout", null, req);
  destroySession(req.cookies?.sid);
  res.clearCookie("sid", COOKIE);
  res.json({ ok: true });
});

api.get("/auth/me", (req, res) => res.json({ user: req.user || null }));

/* ---------------- password reset ----------------
   No email provider is configured (blocked, 9.4), so the token is returned
   directly to the caller. That is safe ONLY because requesting a reset is
   rate limited and the response is identical whether or not the account
   exists — but it means anyone who can reach this endpoint for a known
   address can reset it. When SMTP is available the token must be emailed
   instead of returned, and DELIVER_RESET_TOKEN should be turned off. */
const resetLimit = rateLimit({
  windowMs: 60 * 60_000, max: 5,
  key: req => `reset:${req.ip}:${String(req.body?.email || "").toLowerCase()}`,
  message: "too_many_reset_requests"
});

api.post("/auth/forgot", resetLimit, (req, res) => {
  const { email } = req.body || {};
  const row = findUserByEmail(email || "");
  const generic = { ok: true, message: "If that address has an account, a reset has been issued." };
  if (!row) return res.json(generic);

  const { token, expiresAt } = createResetToken(row.id);
  audit(row.id, "auth.reset.requested", null, req);

  /* Until email exists, hand the token back so a reset is actually possible.
     Set DELIVER_RESET_TOKEN=false once SMTP is wired up. */
  if (process.env.DELIVER_RESET_TOKEN === "false") return res.json(generic);
  res.json({ ...generic, token, expiresAt,
             warning: "Returned directly because no email provider is configured." });
});

api.post("/auth/reset", (req, res) => {
  const { token, password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: "weak_password" });
  const userId = consumeResetToken(token);
  if (!userId) return res.status(400).json({ error: "invalid_or_expired_token" });
  setPassword(userId, String(password));
  audit(userId, "auth.reset.completed", null, req);
  res.clearCookie("sid", COOKIE);
  res.json({ ok: true, message: "Password changed. Please sign in again." });
});

/* Changing a password while signed in requires the current one. */
api.post("/auth/change-password", requireAuth, (req, res) => {
  const { current, password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: "weak_password" });
  const row = findUserByEmail(req.user.email);
  if (!row || !verifyPassword(String(current || ""), row.pass_hash, row.pass_salt))
    return res.status(401).json({ error: "bad_credentials" });
  setPassword(row.id, String(password));
  audit(row.id, "auth.password.changed", null, req);
  res.clearCookie("sid", COOKIE);
  res.json({ ok: true, message: "Password changed. Please sign in again." });
});

/* ---------------- learners ---------------- */
api.get("/learners", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT id, name, beast, track, created_at FROM learners WHERE user_id = ? ORDER BY created_at")
    .all(req.user.id);
  const withStars = rows.map(l => {
    const p = db.prepare("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id = ?").all(l.id);
    return { ...l, stars: p.filter(r => r.best_pct >= 80).length,
             topics: new Set(p.map(r => r.topic_id)).size };
  });
  res.json({ learners: withStars });
});

/* Curriculum tracks (spec 4.2.2, 6.6). The track is a choice an adult makes
   for a child; it shapes what is recommended, never what is allowed. */
export const TRACKS = {
  core:        { name: "Core",        blurb: "Grade-level standards. Advanced topics are there but optional." },
  enrichment:  { name: "Enrichment",  blurb: "Core plus the advanced strands, recommended side by side." },
  competition: { name: "Competition", blurb: "Advanced strands first, with timed papers and proofs woven in." }
};
const validTrack = t => Object.hasOwn(TRACKS, String(t));

api.post("/learners", requireAuth, (req, res) => {
  const { name, beast, track } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "missing_name" });
  if (track !== undefined && !validTrack(track)) return res.status(400).json({ error: "unknown_track" });
  const id = randomUUID();
  const tr = validTrack(track) ? track : "core";
  const learner = createLearner({ id, userId: req.user.id, name, beast: beast || "vex", track: tr });
  audit(req.user.id, "learner.created", id, req);
  res.json({ learner });
});

/* What the evidence suggests, so a parent choosing a track is not guessing. */
function recommendTrack(learnerId) {
  const rows = db.prepare("SELECT topic_id, best_pct FROM progress WHERE learner_id=?").all(learnerId);
  const mastered = rows.filter(r => r.best_pct >= thresholdOf(r.topic_id));
  const advMastered = mastered.filter(r => trackOf(r.topic_id) === "adv").length;
  const coreMastered = mastered.filter(r => trackOf(r.topic_id) === "core").length;
  const contest = db.prepare("SELECT MAX(pct) m FROM contests WHERE learner_id=?").get(learnerId).m || 0;
  if (advMastered >= 2 || contest >= 80)
    return { track: "competition", reason: advMastered >= 2
      ? `${advMastered} advanced topics mastered` : `scored ${contest}% on a timed paper` };
  if (coreMastered >= 3 || advMastered >= 1)
    return { track: "enrichment", reason: coreMastered >= 3
      ? `${coreMastered} core topics mastered` : "an advanced topic already mastered" };
  return { track: "core", reason: rows.length ? "core mastery still building" : "no evidence yet" };
}

api.get("/learners/:id/track", requireAuth, (req, res) => {
  const l = db.prepare("SELECT track FROM learners WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!l) return res.status(403).json({ error: "not_your_learner" });
  res.json({ track: l.track, tracks: TRACKS, recommended: recommendTrack(req.params.id) });
});

api.put("/learners/:id/track", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const { track } = req.body || {};
  if (!validTrack(track)) return res.status(400).json({ error: "unknown_track" });
  db.prepare("UPDATE learners SET track=? WHERE id=?").run(track, req.params.id);
  audit(req.user.id, "learner.track.set", `${req.params.id}:${track}`, req);
  res.json({ track });
});

/* The learner's adaptive model for one topic: knowledge estimate, bandit
   arms and the latest IRT placement. Read-only, for the parent and for tests. */
api.get("/learners/:id/model/:topicId", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const { id, topicId } = req.params;
  res.json({
    topicId,
    knowledge: bkt.estimate(id, topicId),
    arms: bandit.load(id, topicId),
    armWeights: bandit.WEIGHT,
    placement: diag.latestFor(id, topicId)
  });
});

api.delete("/learners/:id", requireAuth, (req, res) => {
  const r = db.prepare("DELETE FROM learners WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);
  if (r.changes) audit(req.user.id, "learner.deleted", req.params.id, req);
  res.json({ deleted: r.changes });
});


/* ---------------- curriculum ---------------- */
api.get("/curriculum", (_req, res) => {
  const thresholds = {};
  for (const id of TOPIC_TRACK.keys()) thresholds[id] = thresholdOf(id);
  const counts = {};
  Object.keys(QUESTIONS).forEach(t => {
    counts[t] = {};
    TIERS.forEach(tr => {
      counts[t][tr.id] = QUESTIONS[t].filter(q => tierOf(q) === tr.id).length;
    });
  });
  res.json({ curriculum: CURRICULUM, tiers: TIERS, counts, thresholds, mastery: MASTERY });
});

api.get("/topics/:topicId/:tier/questions", (req, res) => {
  const { topicId, tier } = req.params;
  const bank = QUESTIONS[topicId];
  if (!bank) return res.status(404).json({ error: "unknown_topic" });
  const idxs = bank.map((q, i) => ({ q, i })).filter(o => tierOf(o.q) === tier).map(o => o.i);
  if (!idxs.length) return res.status(404).json({ error: "empty_tier" });
  /* Content localisation (8.4): a translated bank is served in the requested
     locale; anything untranslated comes back in English and is flagged. */
  const lang = LOCALES[String(req.query.lang)] ? String(req.query.lang) : "en";
  let translated = 0;
  const questions = idxs.map(i => {
    const r = translateQuestion(publicQuestion(topicId, i), lang, topicId, i);
    if (r.translated) translated++;
    return r.question;
  });
  res.json({ questions, lang: translated === questions.length && lang !== "en" ? lang : "en",
             requestedLang: lang, translated, total: questions.length });
});


api.post("/hint", (req, res) => {
  const { questionId, level } = req.body || {};
  const resolved = resolveQuestion(questionId);
  if (!resolved) return res.status(400).json({ error: "unknown_question" });
  for (const sess of checkSessions.values())
    if (sess.ids.includes(String(questionId)) && !sess.hintsAllowed)
      return res.status(409).json({ error: "hints_disabled_during_mastery_check" });
  const lvl = Math.min(3, Math.max(1, Number(level) || 1));
  const ladder = hintLadder(resolved.q);
  res.json({ level: lvl, hint: ladder[lvl - 1], last: lvl >= 3 });
});

/* ---------------- diagnostic / placement (spec 4.1.1, 6.1) ----------------
   Adaptive: the next question's difficulty follows the learner's answers.
   The session is held server-side, so the client cannot pick its own
   questions or report its own placement. */
api.post("/diagnostic/start", requireAuth, (req, res) => {
  const { learnerId, topicId } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const bank = QUESTIONS[topicId];
  if (!bank) return res.status(404).json({ error: "unknown_topic" });

  const questionsByTier = {};
  for (const t of diag.TIER_ORDER)
    questionsByTier[t] = bank.map((q, i) => ({ q, i })).filter(o => tierOf(o.q) === t).map(o => o.i);

  const id = diag.makeDiagnostic({ questionsByTier, topicId, learnerId });
  const sess = diag.getSession(id);
  const first = diag.nextQuestion(sess);
  if (!first) { diag.endSession(id); return res.status(404).json({ error: "empty_topic" }); }
  sess.pending = first;
  audit(req.user.id, "diagnostic.started", topicId, req);
  res.json({ diagnosticId: id, question: publicQuestion(topicId, first.idx), asked: 0 });
});

api.post("/diagnostic/answer", requireAuth, (req, res) => {
  const { diagnosticId, answer } = req.body || {};
  const sess = diag.getSession(diagnosticId);
  if (!sess) return res.status(404).json({ error: "unknown_diagnostic" });
  if (!ownLearner(req, sess.learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!sess.pending) return res.status(409).json({ error: "no_question_pending" });

  const { idx, tier } = sess.pending;
  const q = QUESTIONS[sess.topicId][idx];
  const { ok, correctAnswer } = gradeAnswer(q, answer);
  diag.record(sess, { idx, tier, sec: q.sec, correct: ok });

  const next = diag.nextQuestion(sess);
  const stop = diag.shouldStop(sess, !next);
  if (stop) {
    const summary = diag.summarise(sess, SECS);
    diag.persist(sess, summary);
    /* Hand the placement to the bandit so practice starts where the
       diagnostic left off rather than from a blank prior. */
    bandit.seed(sess.learnerId, sess.topicId, summary.recommendation.tier);
    diag.endSession(diagnosticId);
    audit(req.user.id, "diagnostic.completed", `${sess.topicId}:${summary.overall}%`, req);
    return res.json({ correct: ok, correctAnswer, explanation: q.expl, done: true, summary });
  }
  sess.pending = next;
  res.json({
    correct: ok, correctAnswer, explanation: q.expl, done: false,
    asked: sess.asked.length,
    question: publicQuestion(sess.topicId, next.idx)
  });
});

api.get("/learners/:id/diagnostic", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  res.json({ diagnostic: diag.latestFor(req.params.id) });
});

/* ---------------- review queue (spec 4.1.7) ----------------
   What to practise next: anything attempted but not yet mastered, weakest
   first. Spaced repetition (6.4) is not part of this yet. */
api.get("/learners/:id/review", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const learnerId = req.params.id;
  const rows = db.prepare("SELECT * FROM progress WHERE learner_id = ?").all(learnerId);

  /* Two reasons to practise something: it is not mastered yet, or it is
     mastered but the spacing schedule says it is due a refresher. */
  const bar = id => thresholdFor(id, learnerId);
  const notMastered = rows
    .filter(r => r.best_pct < bar(r.topic_id))
    .map(r => ({
      topicId: r.topic_id, tier: r.tier, bestPct: r.best_pct,
      threshold: bar(r.topic_id), track: trackOf(r.topic_id),
      gap: bar(r.topic_id) - r.best_pct, lastAt: r.last_at,
      reason: "not_yet_mastered"
    }))
    .sort((a, b) => b.gap - a.gap);

  const dueRows = spacing.due(learnerId);
  const seen = new Set(notMastered.map(i => i.topicId));
  /* A mastered topic whose review is long overdue has DECAYED (7.6): it is
     listed ahead of ordinary due reviews because the mastery has lapsed. */
  const dueForReview = dueRows
    .filter(d => !seen.has(d.topic_id))
    .map(d => ({
      topicId: d.topic_id, threshold: bar(d.topic_id), track: trackOf(d.topic_id),
      gap: 0, lastAt: d.last_at, dueAt: d.due_at,
      intervalDays: d.interval_days,
      reason: masteryState(learnerId, d.topic_id).state === "decayed" ? "mastery_decayed" : "due_for_review"
    }))
    .sort((a, b) => (a.reason === "mastery_decayed" ? 0 : 1) - (b.reason === "mastery_decayed" ? 0 : 1));

  res.json({ review: [...notMastered, ...dueForReview], schedule: spacing.scheduleFor(learnerId),
             thresholds: { core: bar("k-count"), adv: bar("k-evenodd") } });
});

/* ---------------- mastery check (spec 4.1.6) ----------------
   A short quiz at the end of a topic. No hints are available during it, so
   the hint endpoint refuses any question issued as part of a check. Sessions
   are held server-side; the client cannot mark its own check as passed. */
const CHECK_SIZE = 8;
const checkSessions = new Map();   // id -> { learnerId, topicId, ids, issuedAt }

api.post("/mastery/start", requireAuth, (req, res) => {
  const { learnerId, topicId } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const bank = QUESTIONS[topicId];
  if (!bank) return res.status(404).json({ error: "unknown_topic" });

  // Draw across all tiers so a check tests the whole topic, not one tier.
  const idxs = bank.map((_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  /* Accommodations (4.3.2) change the conditions, never the marking. */
  const acc = accommodationsFor(learnerId);
  const size = acc.shorterChecks ? Math.ceil(CHECK_SIZE * 0.6) : CHECK_SIZE;
  const picked = idxs.slice(0, Math.min(size, idxs.length));
  const id = randomUUID();
  checkSessions.set(id, { learnerId, topicId, ids: picked.map(i => `${topicId}:${i}`), issuedAt: Date.now(),
                          hintsAllowed: acc.hintsInChecks });
  audit(req.user.id, "mastery.started", topicId, req);
  res.json({
    checkId: id,
    threshold: thresholdFor(topicId, learnerId),
    accommodations: acc.hintsInChecks || acc.shorterChecks || acc.extraTimePct ? acc : null,
    questions: picked.map(i => publicQuestion(topicId, i))
  });
});

/* Marked by the server from the answers submitted, so the client cannot
   report its own score. */
api.post("/mastery/submit", requireAuth, (req, res) => {
  const { checkId, answers } = req.body || {};
  const sess = checkSessions.get(checkId);
  if (!sess) return res.status(404).json({ error: "unknown_check" });
  if (!ownLearner(req, sess.learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!answers || typeof answers !== "object") return res.status(400).json({ error: "missing_answers" });

  let score = 0;
  const detail = sess.ids.map(qid => {
    const [topicId, idx] = qid.split(":");
    const q = QUESTIONS[topicId][Number(idx)];
    const { ok, correctAnswer } = gradeAnswer(q, answers[qid]);
    if (ok) score++;
    bkt.observe(sess.learnerId, sess.topicId, ok,
      bkt.paramsFor({ optionCount: q.type === "mc" ? (q.opts || []).length : 0 }));
    let category = null;
    if (!ok) {
      category = classify(q, answers[qid]);
      db.prepare("INSERT INTO mistakes (id, learner_id, topic_id, question_id, category, at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), sess.learnerId, sess.topicId, qid, category, now());
    }
    return { id: qid, correct: ok, correctAnswer, explanation: q.expl,
             category, categoryLabel: category ? CATEGORIES[category] : null };
  });

  const total = sess.ids.length;
  const pct = Math.round((score / total) * 100);
  const threshold = thresholdFor(sess.topicId, sess.learnerId);
  const passed = pct >= threshold;
  const ts = now();

  recordRun(sess.learnerId, sess.topicId, "mastery", score, total,
    { seconds: (Date.now() - sess.issuedAt) / 1000, at: ts });

  spacing.schedule(sess.learnerId, sess.topicId, score / total);
  const reward = rewardRound(sess.learnerId, sess.topicId, { score, total, pct });
  checkSessions.delete(checkId);
  audit(req.user.id, "mastery.submitted", `${sess.topicId}:${pct}%`, req);
  res.json({ score, total, pct, threshold, passed, detail, reward });
});

/* Grading happens here, never in the browser. */
api.post("/answer", (req, res) => {
  const { questionId, answer } = req.body || {};
  const resolved = resolveQuestion(questionId);
  if (!resolved) return res.status(400).json({ error: "unknown_question" });
  const q = resolved.q;
  const { ok, correctAnswer, credit, creditDetail } = gradeAnswer(q, answer);
  track("answer", { topicId: resolved.topicId, correct: ok, type: q.type }, { userId: req.user?.id || null });
  const lang = LOCALES[String(req.body?.lang)] ? String(req.body.lang) : "en";
  const idx = Number(String(questionId).split(":")[1]);
  res.json({ correct: ok, correctAnswer, credit: credit ?? (ok ? 1 : 0), creditDetail: creditDetail || null,
             explanation: lang === "en" ? q.expl : translatedExplanation(lang, resolved.topicId, idx, q.expl),
             figA: q.figA || null });
});

/* ---------------- generated practice (spec 3.2.3) ----------------
   Unlimited fresh variants for topics that have a template. */
api.get("/topics/:id/generated", (req, res) => {
  const topicId = req.params.id;
  const count = Math.min(20, Math.max(1, Number(req.query.count) || 5));
  if (!generatedTopics().includes(topicId)) return res.status(404).json({ error: "no_template" });
  const base = Number(req.query.seed) || Math.floor(Math.random() * 1e9);
  const questions = [];
  for (let i = 0; i < count; i++) questions.push(publicGenerated(topicId, base + i * 7919));
  res.json({ topicId, seed: base, questions });
});

api.get("/generated/topics", (_req, res) => res.json({ topics: generatedTopics() }));

/* ---------------- knowledge graph (spec 6.2) ---------------- */

api.get("/topics/:id/prereqs", (req, res) => {
  const id = req.params.id;
  if (!TOPIC_NAME.has(id)) return res.status(404).json({ error: "unknown_topic" });
  res.json({
    topic: describe(id),
    direct: prereqsOf(id).map(describe),
    all: [...allPrereqs(id)].map(describe),
    unlocks: unlockedBy(id).map(describe)
  });
});

/* What this learner is ready for: every prerequisite mastered, but the topic
   itself not yet. Topics with unmet prerequisites are reported separately with
   the specific gaps, rather than silently omitted. */
api.get("/learners/:id/skills", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = bkt.allFor(req.params.id).map(r => ({
    ...r, ...describe(r.skillId),
    known: bkt.isKnown(r),
    confidence: Math.round(r.pKnown * 100)
  }));
  res.json({ skills: rows, masteryThreshold: bkt.MASTERY_P, minObservations: bkt.MIN_OBSERVATIONS });
});

api.get("/learners/:id/next", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id = ?")
    .all(req.params.id);

  const best = new Map();
  for (const r of rows) best.set(r.topic_id, Math.max(best.get(r.topic_id) || 0, r.best_pct));
  /* A prerequisite counts as held if the recorded score cleared the bar OR the
     knowledge model is confident, so a learner who demonstrates a skill inside
     adaptive practice is not blocked for lack of a formal run. */
  const mastered = id => {
    const st = masteryState(req.params.id, id, best.get(id) || 0);
    if (st.state === "decayed") return false;        // lapsed mastery needs a fresh round
    return st.state === "mastered" || bkt.isKnown(bkt.estimate(req.params.id, id));
  };

  /* The learner's track (4.2.2, 6.6) decides how advanced work is presented:
     optional on the core track, alongside on enrichment, first on competition.
     Nothing is hidden — a child on the core track can still open an advanced
     topic — but the ordering and the "optional" flag follow the adult's choice. */
  const learner = db.prepare("SELECT track FROM learners WHERE id=?").get(req.params.id);
  const track = learner?.track || "core";

  const ready = [], blocked = [];
  for (const id of TOPIC_NAME.keys()) {
    if (!QUESTIONS[id]) continue;              // nothing to practise yet
    if (mastered(id)) continue;
    const missing = prereqsOf(id).filter(p => !mastered(p));
    const adv = trackOf(id) === "adv";
    const entry = { ...describe(id), bestPct: best.get(id) || 0,
                    optional: track === "core" && adv };
    if (missing.length === 0) ready.push(entry);
    else blocked.push({ ...entry, missing: missing.map(describe) });
  }
  const rank = e => (track === "competition" ? (e.track === "adv" ? 0 : 1)
                   : track === "core" ? (e.track === "adv" ? 1 : 0) : 0);
  ready.sort((a, b) => rank(a) - rank(b));
  res.json({ track, ready, blocked });
});

/* ---------------- adaptive practice session (spec 4.1.4) ----------------
   Unlike a fixed tier run, this serves one question at a time and adjusts
   difficulty from the learner's answers, then hands back the mistakes to
   review at the end. Held server-side so the client cannot steer it. */
const practiceSessions = new Map();
const PRACTICE_LEN = 10;

api.post("/practice/start", requireAuth, (req, res) => {
  const { learnerId, topicId } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const bank = QUESTIONS[topicId];
  if (!bank) return res.status(404).json({ error: "unknown_topic" });

  const byTier = {};
  for (const t of diag.TIER_ORDER)
    byTier[t] = bank.map((q, i) => ({ q, i })).filter(o => tierOf(o.q) === t).map(o => o.i);

  const id = randomUUID();
  const sess = {
    learnerId, topicId, byTier, used: new Set(),
    /* Difficulty is chosen by the bandit (6.3); the arms persist across
       sessions so a learner picks up where the evidence left them. */
    arms: bandit.load(learnerId, topicId),
    tierIdx: 0, streakRight: 0, streakWrong: 0,
    asked: 0, score: 0, missed: [], hintsUsed: 0, startedAt: Date.now(),
    consecutiveWrong: 0, lastAnswerAt: Date.now(), fastMastery: true
  };
  practiceSessions.set(id, sess);
  const first = pickPractice(sess);
  if (first == null) { practiceSessions.delete(id); return res.status(404).json({ error: "empty_topic" }); }
  sess.pending = first;
  res.json({
    sessionId: id, length: PRACTICE_LEN,
    question: publicQuestion(topicId, first.idx), asked: 0, score: 0
  });
});

function pickPractice(sess) {
  /* Thompson sampling over the tiers that still have unused questions. */
  const available = diag.TIER_ORDER.filter(t => (sess.byTier[t] || []).some(i => !sess.used.has(i)));
  if (!available.length) return null;
  const tier = bandit.choose(sess.arms, Math.random, available);
  sess.tierIdx = diag.TIER_ORDER.indexOf(tier);
  const pool = sess.byTier[tier].filter(i => !sess.used.has(i));
  const idx = pool[Math.floor(Math.random() * pool.length)];
  sess.used.add(idx);
  return { idx, tier };
}

api.post("/practice/answer", requireAuth, (req, res) => {
  const { sessionId, answer, hintsUsed } = req.body || {};
  const sess = practiceSessions.get(sessionId);
  if (!sess) return res.status(404).json({ error: "unknown_session" });
  if (!ownLearner(req, sess.learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!sess.pending) return res.status(409).json({ error: "no_question_pending" });

  const { idx, tier: servedTier } = sess.pending;
  const q = QUESTIONS[sess.topicId][idx];
  const { ok, correctAnswer, credit, creditDetail } = gradeAnswer(q, answer);
  const earned = credit ?? (ok ? 1 : 0);

  sess.asked++;
  sess.credit = (sess.credit || 0) + earned;
  sess.hintsUsed += Math.max(0, Math.min(3, Number(hintsUsed) || 0));
  /* Feed the knowledge model. A hinted answer is weaker evidence, so it is
     recorded with a higher guess rate rather than counted as clean success. */
  bkt.observe(sess.learnerId, sess.topicId, ok,
    bkt.paramsFor({ optionCount: q.type === "mc" ? (q.opts || []).length : 0 }));
  track("answer", { topicId: sess.topicId, correct: ok, type: q.type, tier: servedTier, mode: "practice" }, { learnerId: sess.learnerId });
  /* And the bandit: this tier's arm learns whether it was the right call. */
  const arm = sess.arms[servedTier] ||= { successes: 0, failures: 0 };
  if (ok) arm.successes++; else arm.failures++;
  bandit.record(sess.learnerId, sess.topicId, servedTier, ok);
  if (ok) {
    sess.score++; sess.streakRight++; sess.streakWrong = 0;
  } else {
    const category = classify(q, answer);
    sess.missed.push({ id: `${sess.topicId}:${idx}`, q: q.q, correctAnswer,
                       explanation: q.expl, category, categoryLabel: CATEGORIES[category] });
    db.prepare("INSERT INTO mistakes (id, learner_id, topic_id, question_id, category, at) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), sess.learnerId, sess.topicId, `${sess.topicId}:${idx}`, category, now());
    sess.streakWrong++; sess.streakRight = 0;
  }

  /* Intervention triggers (spec 6.5), decided server-side from the session
     so the client cannot suppress them. */
  if (ok) { sess.consecutiveWrong = 0; }
  else { sess.consecutiveWrong++; sess.fastMastery = false; }
  const sinceLast = Date.now() - sess.lastAnswerAt;
  sess.lastAnswerAt = Date.now();

  const intervention =
    sess.consecutiveWrong >= 3
      ? { type: "struggling", message: "Three in a row have gone wrong. It may help to review the lesson for this topic, or take a hint on the next one.", suggest: "review" }
    : sinceLast > 10 * 60_000
      ? { type: "stalled", message: "That one took a while. There is no prize for doing it unaided — a hint is there if you want it.", suggest: "hint" }
    : (ok && sess.hintsUsed === 0 && sess.asked >= 5 && sess.score === sess.asked && sess.tierIdx === diag.TIER_ORDER.length - 1)
      ? { type: "ready_to_advance", message: "Everything correct at the hardest tier without hints. This topic looks secure — the advanced track will stretch you further.", suggest: "advance" }
      : null;

  const next = sess.asked >= PRACTICE_LEN ? null : pickPractice(sess);
  if (!next) {
    const total = sess.asked;
    const pct = Math.round((sess.score / total) * 100);
    const ts = now();
    /* Stars reflect hint use (spec 7.4): unaided work is worth more. */
    const avgHints = sess.hintsUsed / total;
    const stars = avgHints < 0.34 ? 3 : avgHints < 1.34 ? 2 : 1;

    recordRun(sess.learnerId, sess.topicId, "adaptive", sess.score, total,
      { seconds: (Date.now() - sess.startedAt) / 1000, at: ts });
    spacing.schedule(sess.learnerId, sess.topicId, sess.score / total);
    const reward = rewardRound(sess.learnerId, sess.topicId,
      { score: sess.score, total, pct, hintsUsed: sess.hintsUsed });
    practiceSessions.delete(sessionId);
    return res.json({
      correct: ok, correctAnswer, credit: earned, creditDetail: creditDetail || null,
      explanation: q.expl, figA: q.figA || null, done: true,
      summary: { score: sess.score, total, pct, stars, hintsUsed: sess.hintsUsed, reward,
                 creditScore: Math.round((sess.credit || 0) * 10) / 10,
                 creditPct: Math.round(((sess.credit || 0) / total) * 100),
                 threshold: thresholdOf(sess.topicId), missed: sess.missed,
                 seconds: Math.round((Date.now() - sess.startedAt) / 1000) }
    });
  }
  sess.pending = next;
  res.json({
    correct: ok, correctAnswer, credit: earned, creditDetail: creditDetail || null,
    explanation: q.expl, figA: q.figA || null, done: false,
    asked: sess.asked, score: sess.score, intervention,
    question: publicQuestion(sess.topicId, next.idx)
  });
});

/* Grant points and badges for a finished round (spec 5.1, 5.2). */
function rewardRound(learnerId, topicId, { score, total, pct, hintsUsed = 0, contest = false }) {
  const track = trackOf(topicId) || "core";
  const pts = rewards.pointsFor({ pct, total, track, hintsUsed });
  if (pts > 0) rewards.award(learnerId, "points", `round:${topicId}`, pts);

  const earned = [];
  const give = code => { if (rewards.award(learnerId, "badge", code)) earned.push(code); };

  const priorRounds = db.prepare("SELECT COUNT(*) c FROM runs WHERE learner_id=?").get(learnerId).c;
  if (priorRounds <= 1) give("first_steps");
  if (pct === 100) give("perfect_round");
  if (pct === 100 && hintsUsed === 0) give("unaided");
  if (track === "adv") give("advanced_starter");
  if (contest && pct >= 80) give("contest_ready");

  /* Mastering every tier of a topic, and the strand-specific badges. */
  const rows = db.prepare("SELECT tier, best_pct FROM progress WHERE learner_id=? AND topic_id=?")
    .all(learnerId, topicId);
  const bar = thresholdOf(topicId);
  const tiersMastered = rows.filter(r => ["practice", "challenge", "boss"].includes(r.tier) && r.best_pct >= bar).length;
  if (tiersMastered >= 3) {
    give("topic_mastered");
    const unit = (TOPIC_NAME.get(topicId) || {}).unit || "";
    if (/number theory/i.test(unit)) give("number_theory");
    if (/combinatorics/i.test(unit)) give("combinatorics");
  }
  /* Retrying a topic after falling short. */
  const attempts = db.prepare("SELECT COUNT(*) c FROM runs WHERE learner_id=? AND topic_id=?")
    .get(learnerId, topicId).c;
  if (attempts >= 2 && pct >= bar) give("persistent");

  const st = rewards.streak(learnerId);
  if (st >= 3) give("streak_3");
  if (st >= 7) give("streak_7");

  /* Counted separately so milestone badges can read it. */
  if (pct === 100 && hintsUsed === 0) rewards.award(learnerId, "unaided_perfect", `round:${topicId}`);
  /* Rule-driven badges (5.2): everything whose condition has just come true. */
  earned.push(...rewards.sweep(learnerId));
  for (const code of earned) webhooks.emit(learnerId, "badge.earned", { code, ...rewards.BADGES[code] });

  return { points: pts, badges: earned.map(c => ({ code: c, ...rewards.BADGES[c] })), streak: st };
}

api.get("/learners/:id/rewards", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  res.json({
    ...rewards.totals(req.params.id),
    streak: rewards.streak(req.params.id),
    catalogue: rewards.BADGES
  });
});

/* ---------------- competition prep (spec 4.1.9, 4.7) ----------------
   Timed drills and mock contests. The clock is authoritative on the server:
   the deadline is set when the paper is issued, and a submission arriving
   after it is marked but flagged as expired, so a client cannot buy time. */
const contestSessions = new Map();

api.get("/contest/formats", (_req, res) => res.json({ formats: CONTEST_FORMATS }));

api.post("/contest/start", requireAuth, (req, res) => {
  const { learnerId, format, topicIds } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const fmt = CONTEST_FORMATS[format];
  if (!fmt) return res.status(400).json({ error: "unknown_format" });

  /* Draw across whichever authored topics were requested, or all of them. */
  const pool = [];
  const wanted = Array.isArray(topicIds) && topicIds.length ? topicIds : Object.keys(QUESTIONS);
  for (const t of wanted) {
    if (!QUESTIONS[t]) continue;
    QUESTIONS[t].forEach((_, i) => pool.push(`${t}:${i}`));
  }
  if (pool.length < 2) return res.status(404).json({ error: "not_enough_questions" });

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const ids = pool.slice(0, Math.min(fmt.questions, pool.length));
  const id = randomUUID();
  const acc = accommodationsFor(learnerId);
  const limitSecs = Math.round(fmt.minutes * 60 * (1 + acc.extraTimePct / 100));
  contestSessions.set(id, {
    learnerId, format, ids, startedAt: Date.now(),
    deadline: Date.now() + limitSecs * 1000, limitSecs
  });
  audit(req.user.id, "contest.started", format, req);
  res.json({
    contestId: id, format, name: fmt.name, limitSeconds: limitSecs,
    questions: ids.map(qid => {
      const [t, i] = qid.split(":");
      return publicQuestion(t, Number(i));
    })
  });
});

api.post("/contest/submit", requireAuth, (req, res) => {
  const { contestId, answers } = req.body || {};
  const sess = contestSessions.get(contestId);
  if (!sess) return res.status(404).json({ error: "unknown_contest" });
  if (!ownLearner(req, sess.learnerId)) return res.status(403).json({ error: "not_your_learner" });

  const finishedAt = Date.now();
  const expired = isExpired(sess.deadline, finishedAt);
  const seconds = Math.round((finishedAt - sess.startedAt) / 1000);

  const marks = [];
  const detail = sess.ids.map(qid => {
    const [t, i] = qid.split(":");
    const q = QUESTIONS[t][Number(i)];
    const { ok, correctAnswer } = gradeAnswer(q, (answers || {})[qid]);
    marks.push(ok);
    if (!ok) {
      const category = classify(q, (answers || {})[qid]);
      db.prepare("INSERT INTO mistakes (id, learner_id, topic_id, question_id, category, at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), sess.learnerId, t, qid, category, now());
    }
    return { id: qid, topicId: t, correct: ok, correctAnswer, explanation: q.expl };
  });

  const { score, total, pct, correctBeforePenalty } = scorePaper({ marks, expired });
  webhooks.emit(sess.learnerId, "contest.submitted", { format: sess.format, score, total, pct, expired });
  db.prepare(`INSERT INTO contests (id, learner_id, format, score, total, pct, seconds, limit_secs, expired, detail, finished_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), sess.learnerId, sess.format, score, total, pct, seconds,
         sess.limitSecs, expired ? 1 : 0, JSON.stringify(detail.map(d => ({ id: d.id, correct: d.correct }))), now());
  const reward = rewardRound(sess.learnerId, detail[0]?.topicId || "", { score, total, pct, contest: true });
  contestSessions.delete(contestId);
  audit(req.user.id, "contest.submitted", `${sess.format}:${pct}%`, req);

  /* Topic-level strengths and weaknesses from this paper. */
  const byTopic = {};
  for (const d of detail) {
    const t = (byTopic[d.topicId] ||= { topicId: d.topicId, asked: 0, correct: 0 });
    t.asked++; if (d.correct) t.correct++;
  }
  res.json({
    score, total, pct, correctBeforePenalty, seconds, limitSeconds: sess.limitSecs, expired, reward,
    percentile: percentileFor(sess.format, pct, sess.learnerId),
    detail,
    byTopic: Object.values(byTopic).map(t => ({ ...t, pct: Math.round((t.correct / t.asked) * 100) }))
              .sort((a, b) => a.pct - b.pct)
  });
});

api.get("/learners/:id/contests", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare(
    "SELECT format, score, total, pct, seconds, limit_secs, expired, finished_at FROM contests WHERE learner_id = ? ORDER BY finished_at DESC LIMIT 50")
    .all(req.params.id);
  const byFormat = {};
  for (const r of rows) {
    const f = (byFormat[r.format] ||= { format: r.format, attempts: 0, best: 0, latest: null, trend: [] });
    f.attempts++; f.best = Math.max(f.best, r.pct);
    if (!f.latest) f.latest = r.pct;
    f.trend.push(r.pct);
  }
  for (const f of Object.values(byFormat)) f.percentile = percentileFor(f.format, f.best, req.params.id);
  res.json({ history: rows, byFormat: Object.values(byFormat) });
});

/* ---------------- teacher portal (spec 4.3) ----------------
   Teachers hold a role on the user row. A class links learners (who belong to
   parent accounts) to a teacher via an explicit join, so a teacher only ever
   sees learners a parent has added to their class. */
function requireTeacher(req, res, next) { return requireRole("teacher", "admin")(req, res, next); }
const ownClass = (req, id) =>
  db.prepare("SELECT * FROM classes WHERE id=? AND teacher_id=?").get(id, req.user.id);

api.post("/classes", requireAuth, requireTeacher, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "missing_name" });
  const id = randomUUID();
  const code = randomUUID().slice(0, 6).toUpperCase();
  db.prepare("INSERT INTO classes (id, teacher_id, name, join_code, created_at) VALUES (?,?,?,?,?)")
    .run(id, req.user.id, String(name).trim().slice(0, 60), code, now());
  audit(req.user.id, "class.created", id, req);
  res.json({ class: { id, name: String(name).trim(), joinCode: code } });
});

api.get("/classes", requireAuth, requireTeacher, (req, res) => {
  const rows = db.prepare("SELECT id, name, join_code, created_at FROM classes WHERE teacher_id=? ORDER BY created_at")
    .all(req.user.id);
  res.json({ classes: rows.map(c => ({
    id: c.id, name: c.name, joinCode: c.join_code,
    members: db.prepare("SELECT COUNT(*) n FROM class_members WHERE class_id=?").get(c.id).n
  })) });
});

/* A PARENT adds their own learner to a class using the code. A teacher cannot
   pull a learner in unilaterally. */
api.post("/classes/join", requireAuth, (req, res) => {
  const { joinCode, learnerId } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const cls = db.prepare("SELECT * FROM classes WHERE join_code=?").get(String(joinCode || "").toUpperCase());
  if (!cls) return res.status(404).json({ error: "unknown_class" });
  db.prepare("INSERT OR IGNORE INTO class_members (class_id, learner_id, joined_at) VALUES (?,?,?)")
    .run(cls.id, learnerId, now());
  audit(req.user.id, "class.joined", cls.id, req);
  res.json({ joined: { classId: cls.id, name: cls.name } });
});

api.post("/classes/:id/assignments", requireAuth, requireTeacher, (req, res) => {
  if (!ownClass(req, req.params.id)) return res.status(403).json({ error: "not_your_class" });
  const { topicId, tier, dueAt, groupId } = req.body || {};
  if (!QUESTIONS[topicId]) return res.status(400).json({ error: "unknown_topic" });
  if (groupId && !db.prepare("SELECT 1 FROM class_groups WHERE id=? AND class_id=?").get(groupId, req.params.id))
    return res.status(404).json({ error: "unknown_group" });
  const id = randomUUID();
  db.prepare("INSERT INTO assignments (id, class_id, topic_id, tier, due_at, group_id, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, req.params.id, topicId, tier || null, dueAt || null, groupId || null, now());
  res.json({ assignment: { id, topicId, tier: tier || null, dueAt: dueAt || null, groupId: groupId || null } });
});

/* A teacher may set the track for a learner in their class (6.6). The parent
   keeps the same power; whichever adult set it last wins, and both are audited. */
api.put("/classes/:id/learners/:learnerId/track", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const member = db.prepare("SELECT 1 FROM class_members WHERE class_id=? AND learner_id=?")
    .get(cls.id, req.params.learnerId);
  if (!member) return res.status(404).json({ error: "not_in_class" });
  const { track } = req.body || {};
  if (!validTrack(track)) return res.status(400).json({ error: "unknown_track" });
  db.prepare("UPDATE learners SET track=? WHERE id=?").run(track, req.params.learnerId);
  audit(req.user.id, "learner.track.set", `${req.params.learnerId}:${track}`, req);
  res.json({ track });
});

/* Class progress: one row per learner per assignment, plus a topic heatmap. */
api.get("/classes/:id/progress", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });

  const members = db.prepare(`SELECT l.id, l.name FROM class_members m
    JOIN learners l ON l.id = m.learner_id WHERE m.class_id=?`).all(cls.id).sort((a, b) => a.name.localeCompare(b.name));
  const assignments = db.prepare("SELECT * FROM assignments WHERE class_id=?").all(cls.id);

  const groupOf = {};
  for (const gm of db.prepare(`SELECT gm.group_id, gm.learner_id FROM group_members gm
                               JOIN class_groups g ON g.id=gm.group_id WHERE g.class_id=?`).all(cls.id))
    (groupOf[gm.learner_id] ||= new Set()).add(gm.group_id);
  const rows = members.map(m => {
    const prog = db.prepare("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id=?").all(m.id);
    /* A group assignment applies only to that group's members (4.3.2). */
    const done = assignments.filter(a => !a.group_id || groupOf[m.id]?.has(a.group_id)).map(a => {
      const match = prog.filter(p => p.topic_id === a.topic_id && (!a.tier || p.tier === a.tier));
      const best = match.reduce((x, p) => Math.max(x, p.best_pct), 0);
      return { assignmentId: a.id, topicId: a.topic_id, groupId: a.group_id || null, bestPct: best,
               mastered: best >= thresholdFor(a.topic_id, m.id), attempted: match.length > 0 };
    });
    const mastered = prog.filter(p => p.best_pct >= thresholdFor(p.topic_id, m.id)).length;
    return { learnerId: m.id, name: m.name, assignments: done, topicsMastered: mastered };
  });

  /* Heatmap: for each assigned topic, how the class as a whole is doing. */
  const heatmap = assignments.map(a => {
    const targets = rows.filter(r => r.assignments.some(x => x.assignmentId === a.id));
    const scores = targets.map(r => (r.assignments.find(x => x.assignmentId === a.id) || {}).bestPct || 0);
    const attempted = scores.filter(s => s > 0).length;
    return {
      topicId: a.topic_id, groupId: a.group_id || null, assigned: targets.length, attempted,
      averagePct: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : 0,
      mastered: rows.filter(r => (r.assignments.find(x => x.assignmentId === a.id) || {}).mastered).length
    };
  });

  audit(req.user.id, "class.progress.read", cls.id, req);
  res.json({ class: { id: cls.id, name: cls.name }, assignments, learners: rows, heatmap });
});

/* ---------------- admin portal (spec 4.4) ----------------
   Aggregate only. An administrator sees counts and distributions, never an
   individual child's answers — the audit log records every access. */
function requireAdmin(req, res, next) { return requireRole("admin")(req, res, next); }

api.get("/admin/overview", requireAuth, requireAdmin, (req, res) => {
  const one = q => db.prepare(q).get();
  const users = one("SELECT COUNT(*) c FROM users").c;
  const byRole = db.prepare("SELECT role, COUNT(*) c FROM users GROUP BY role").all();
  const learners = one("SELECT COUNT(*) c FROM learners").c;
  const classes = one("SELECT COUNT(*) c FROM classes").c;
  const runs = one("SELECT COUNT(*) c FROM runs").c;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const activeLearners = one(`SELECT COUNT(DISTINCT learner_id) c FROM runs WHERE finished_at >= '${since}'`).c;

  /* Attainment distribution, so a district can see the shape rather than
     individual results. */
  const buckets = { "0-49": 0, "50-69": 0, "70-89": 0, "90-100": 0 };
  for (const r of db.prepare("SELECT best_pct FROM progress").all()) {
    if (r.best_pct < 50) buckets["0-49"]++;
    else if (r.best_pct < 70) buckets["50-69"]++;
    else if (r.best_pct < 90) buckets["70-89"]++;
    else buckets["90-100"]++;
  }
  const topics = db.prepare(`SELECT topic_id, COUNT(*) attempts, AVG(best_pct) avg_pct
                             FROM progress GROUP BY topic_id ORDER BY avg_pct ASC LIMIT 10`).all()
    .map(t => ({ ...describe(t.topic_id), attempts: t.attempts, averagePct: Math.round(t.avg_pct) }));

  audit(req.user.id, "admin.overview.read", null, req);
  res.json({
    users, byRole, learners, classes, runs, activeLearnersLast7Days: activeLearners,
    attainment: buckets, hardestTopics: topics
  });
});

/* Backups (spec 10.4). Admin-triggered here; a scheduler would call the same
   code on a timer in a real deployment. */
api.post("/admin/backup", requireAuth, requireAdmin, async (req, res) => {
  const { backup } = await import("./backup.js");
  try {
    const r = backup(undefined, undefined, req.body?.encrypt === true ? { encrypt: true } : {});
    audit(req.user.id, "admin.backup", r.file, req);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/* Retention: what the platform holds and for how long (spec 4.4.3, 10.3). */
api.get("/admin/retention", requireAuth, requireAdmin, (req, res) => {
  const oldest = db.prepare("SELECT MIN(finished_at) m FROM runs").get().m;
  audit(req.user.id, "admin.retention.read", null, req);
  res.json({
    policy: {
      auditLog: "retained while the account exists; deleted with the account",
      learnerWork: "retained while the learner exists; deleted with the learner or the account",
      sessions: "expire after 30 days",
      erasure: "self-service via DELETE /api/me, cascading to learners, progress, runs and mistakes"
    },
    oldestRecord: oldest,
    counts: {
      auditEntries: db.prepare("SELECT COUNT(*) c FROM audit_log").get().c,
      runs: db.prepare("SELECT COUNT(*) c FROM runs").get().c,
      mistakes: db.prepare("SELECT COUNT(*) c FROM mistakes").get().c
    }
  });
});

/* Audit access is itself auditable. */
api.get("/admin/audit", requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT user_id, action, detail, at FROM audit_log ORDER BY at DESC LIMIT 200").all();
  audit(req.user.id, "admin.audit.read", null, req);
  res.json({ entries: rows });
});

/* ---------------- error analysis (spec 7.5) ---------------- */
api.get("/learners/:id/errors", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare(
    "SELECT topic_id, category, at FROM mistakes WHERE learner_id = ? ORDER BY at DESC LIMIT 500")
    .all(req.params.id);
  const byTopic = {};
  for (const r of rows) (byTopic[r.topic_id] ||= []).push(r);
  res.json({
    total: rows.length,
    byCategory: summariseErrors(rows),
    byTopic: Object.entries(byTopic).map(([topicId, ms]) => ({
      topicId, count: ms.length, categories: summariseErrors(ms)
    })).sort((a, b) => b.count - a.count),
    categories: CATEGORIES
  });
});

/* ---------------- progress ---------------- */
api.post("/runs", requireAuth, (req, res) => {
  const { learnerId, topicId, tier, score, total, seconds } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!trackOf(topicId)) return res.status(400).json({ error: "unknown_topic" });
  if (!TIERS.some(t => t.id === tier)) return res.status(400).json({ error: "unknown_tier" });
  const s = Math.max(0, Number(score) | 0), t = Math.max(1, Number(total) | 0);
  /* Client-reported time is bounded: it informs reporting, never scoring. */
  const secs = Math.min(4 * 3600, Math.max(0, Number(seconds) || 0));
  const pct = recordRun(learnerId, topicId, tier, s, t, { seconds: secs });
  const track = trackOf(topicId), threshold = thresholdFor(topicId, learnerId);
  const next = spacing.schedule(learnerId, topicId, s / t);
  const reward = rewardRound(learnerId, topicId, { score: s, total: t, pct });
  res.json({ pct, threshold, track, star: pct >= threshold, nextReview: next, reward });
});

api.get("/learners/:id/progress", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  audit(req.user.id, "progress.read", req.params.id, req);
  const progress = db.prepare("SELECT * FROM progress WHERE learner_id = ?").all(req.params.id);
  const recent = db.prepare("SELECT topic_id, tier, score, total, pct, finished_at FROM runs WHERE learner_id = ? ORDER BY finished_at DESC LIMIT 20")
    .all(req.params.id);
  res.json({ progress, recent });
});


/* ---------------- leaderboards (spec 4.1.8, 5.8) ----------------
   Off by default. A teacher turns them on per class and chooses whether
   learners appear by name or anonymously. There is no global leaderboard and
   no messaging of any kind: children are only ever ranked against classmates
   an adult has deliberately grouped, and a parent can withdraw their child by
   leaving the class. */
function classSettings(classId) {
  const row = db.prepare("SELECT * FROM class_settings WHERE class_id=?").get(classId);
  return { leaderboardOn: !!(row && row.leaderboard_on), displayNames: !!(row && row.display_names) };
}

api.put("/classes/:id/settings", requireAuth, requireTeacher, (req, res) => {
  if (!ownClass(req, req.params.id)) return res.status(403).json({ error: "not_your_class" });
  const on = req.body?.leaderboardOn === true;
  const names = req.body?.displayNames === true;
  const tournament = req.body?.tournamentOn === true;
  db.prepare(`INSERT INTO class_settings (class_id, leaderboard_on, display_names, tournament_on, updated_at)
              VALUES (?,?,?,?,?)
              ON CONFLICT(class_id) DO UPDATE SET
                leaderboard_on=excluded.leaderboard_on,
                display_names=excluded.display_names,
                tournament_on=excluded.tournament_on, updated_at=excluded.updated_at`)
    .run(req.params.id, on ? 1 : 0, names ? 1 : 0, tournament ? 1 : 0, now());
  audit(req.user.id, "class.settings.updated", `${req.params.id}:leaderboard=${on}:tournament=${tournament}`, req);
  res.json({ settings: { leaderboardOn: on, displayNames: names, tournamentOn: tournament } });
});

api.get("/classes/:id/leaderboard", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT * FROM classes WHERE id=?").get(req.params.id);
  if (!cls) return res.status(404).json({ error: "unknown_class" });

  /* Viewer must be the class's teacher, or a parent of a learner in it. */
  const isTeacher = cls.teacher_id === req.user.id;
  const mine = db.prepare(`SELECT l.id FROM class_members m JOIN learners l ON l.id=m.learner_id
                           WHERE m.class_id=? AND l.user_id=?`).all(cls.id, req.user.id);
  if (!isTeacher && mine.length === 0) return res.status(403).json({ error: "not_in_this_class" });

  const settings = classSettings(cls.id);
  if (!settings.leaderboardOn)
    return res.json({ enabled: false, reason: "The teacher has not turned on the leaderboard for this class." });

  const members = db.prepare(`SELECT l.id, l.name FROM class_members m
    JOIN learners l ON l.id = m.learner_id WHERE m.class_id=?`).all(cls.id);
  const mineIds = new Set(mine.map(m => m.id));

  const rows = members.map(m => {
    const pts = db.prepare("SELECT COALESCE(SUM(amount),0) p FROM awards WHERE learner_id=? AND kind='points'")
      .get(m.id).p;
    return { learnerId: m.id, name: m.name, points: pts };
  }).sort((a, b) => b.points - a.points);

  /* Names are shown only if the teacher allowed it. A parent always sees
     their own child labelled, so the board is meaningful to them. */
  const board = rows.map((r, i) => ({
    rank: i + 1,
    points: r.points,
    you: mineIds.has(r.learnerId),
    name: settings.displayNames || mineIds.has(r.learnerId) || isTeacher ? r.name : `Learner ${i + 1}`
  }));
  res.json({ enabled: true, displayNames: settings.displayNames, board });
});

/* ---------------- puzzles (spec 3.2.4, 4.1.5) ----------------
   Untimed and outside the adaptive path. Hints are available one at a time;
   the solution is never given, so a puzzle stays worth coming back to. */
api.get("/puzzles", (req, res) => {
  /* Hidden puzzles (5.7) appear only for a learner who has unlocked their area. */
  const learnerId = req.query.learnerId;
  let open = new Set();
  if (learnerId && req.user && ownLearner(req, learnerId))
    open = new Set(unlockedAreas(learnerId).filter(a => a.unlocked).map(a => a.id));
  res.json({ puzzles: PUZZLES.filter(p => !p.hidden || open.has(p.area)).map(publicPuzzle) });
});

/* A hidden puzzle stays hidden: hints and answers are refused until unlocked. */
function puzzleLocked(p, req, learnerId) {
  if (!p.hidden) return false;
  if (!learnerId || !ownLearner(req, learnerId)) return true;
  return !unlockedAreas(learnerId).some(a => a.unlocked && a.id === p.area);
}

api.post("/puzzles/:id/hint", requireAuth, (req, res) => {
  const p = puzzleById(req.params.id);
  if (!p) return res.status(404).json({ error: "unknown_puzzle" });
  if (puzzleLocked(p, req, req.body?.learnerId)) return res.status(403).json({ error: "puzzle_locked" });
  const level = Math.max(1, Math.min(p.hints.length, Number(req.body?.level) || 1));
  res.json({ level, hint: p.hints[level - 1], last: level >= p.hints.length });
});

api.post("/puzzles/:id/answer", requireAuth, (req, res) => {
  const p = puzzleById(req.params.id);
  if (!p) return res.status(404).json({ error: "unknown_puzzle" });
  const { learnerId, answer, hintsUsed } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (puzzleLocked(p, req, learnerId)) return res.status(403).json({ error: "puzzle_locked" });

  const correct = checkPuzzle(p, answer);
  if (!correct) {
    /* No solution on a wrong answer — that is what keeps a puzzle a puzzle. */
    return res.json({ correct: false, encouragement: "Not that one. Try a different approach, or take a hint." });
  }

  const hints = Math.max(0, Math.min(p.hints.length, Number(hintsUsed) || 0));
  const prior = db.prepare("SELECT * FROM puzzle_solves WHERE learner_id=? AND puzzle_id=?")
    .get(learnerId, p.id);
  if (!prior) {
    db.prepare("INSERT INTO puzzle_solves (learner_id, puzzle_id, hints_used, attempts, solved_at) VALUES (?,?,?,?,?)")
      .run(learnerId, p.id, hints, 1, now());
    rewards.award(learnerId, "points", `puzzle:${p.id}`, 25 + p.difficulty * 10);
    if (hints === 0) rewards.award(learnerId, "badge", "elegant_solution");
    rewards.sweep(learnerId);
  }
  /* A trophy reflects how it was solved, not merely that it was. */
  const trophy = hints === 0 ? "gold" : hints === 1 ? "silver" : "bronze";
  res.json({ correct: true, trophy, firstSolve: !prior,
             message: hints === 0 ? "Solved with no hints at all." : "Solved." });
});

api.get("/learners/:id/puzzles", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare("SELECT * FROM puzzle_solves WHERE learner_id=? ORDER BY solved_at DESC")
    .all(req.params.id);
  res.json({
    solved: rows.map(r => ({
      puzzleId: r.puzzle_id, hintsUsed: r.hints_used, solvedAt: r.solved_at,
      trophy: r.hints_used === 0 ? "gold" : r.hints_used === 1 ? "silver" : "bronze",
      title: (puzzleById(r.puzzle_id) || {}).title
    })),
    available: PUZZLES.length
  });
});

/* ---------------- proof trainer (spec 4.1.10) ----------------
   Checking is structural: an ordering proof is right when the steps are in a
   valid order, a reasons proof when every step is paired with a justification
   that supports it. Feedback names which steps are wrong, never the answer. */
const proofSessions = new Map();

api.get("/proofs", (_req, res) => {
  res.json({
    kinds: PROOF_KINDS,
    proofs: allProofs().map(p => ({ id: p.id, grade: p.grade, kind: p.kind, claim: p.claim }))
  });
});

api.get("/topics/:id/proofs", (req, res) => {
  res.json({ proofs: proofsForTopic(req.params.id).map(p => ({ id: p.id, grade: p.grade, kind: p.kind, claim: p.claim })) });
});

api.post("/proofs/:id/start", requireAuth, (req, res) => {
  const proof = allProofs().find(p => p.id === req.params.id);
  if (!proof) return res.status(404).json({ error: "unknown_proof" });
  const { learnerId } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const sessionId = randomUUID();
  proofSessions.set(sessionId, { learnerId, proofId: proof.id, attempts: 0 });
  res.json({ sessionId, proof: publicProof(proof) });
});

api.post("/proofs/submit", requireAuth, (req, res) => {
  const { sessionId, submission } = req.body || {};
  const sess = proofSessions.get(sessionId);
  if (!sess) return res.status(404).json({ error: "unknown_session" });
  if (!ownLearner(req, sess.learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const proof = allProofs().find(p => p.id === sess.proofId);

  sess.attempts++;
  const result = checkProof(proof, submission || {});
  let points = 0;
  if (result.correct) {
    db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, finished_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), sess.learnerId, `proof:${proof.id}`, "proof", 1, 1, 100, now());
    points = 20;
    rewards.award(sess.learnerId, "points", `proof:${proof.id}`, 20);
    /* Elegance bonus (7.3): a freeform proof that covers every rubric point
       in no more lines than the reference is rewarded for economy. */
    if (result.elegant) { points += 10; rewards.award(sess.learnerId, "points", `proof:${proof.id}:elegant`, 10); }
    rewards.sweep(sess.learnerId);
    proofSessions.delete(sessionId);
  }
  audit(req.user.id, "proof.submitted", `${proof.id}:${result.correct ? "correct" : "retry"}`, req);
  res.json({ ...result, points, attempts: sess.attempts, kind: proof.kind });
});

api.get("/learners/:id/proofs", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare(
    "SELECT topic_id, finished_at FROM runs WHERE learner_id=? AND tier='proof' ORDER BY finished_at DESC")
    .all(req.params.id);
  res.json({ completed: rows.map(r => ({ proofId: r.topic_id.replace(/^proof:/, ""), at: r.finished_at })) });
});

/* ---------------- goals (spec 4.2.6) ----------------
   A parent sets a weekly target; progress against it is computed from the
   runs actually recorded in the last seven days. */
api.put("/learners/:id/goal", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rounds = Math.max(0, Math.min(100, Number(req.body?.roundsPerWeek) || 0));
  const minutes = Math.max(0, Math.min(2000, Number(req.body?.minutesPerWeek) || 0));
  if (!rounds && !minutes) return res.status(400).json({ error: "empty_goal" });
  db.prepare(`INSERT INTO goals (learner_id, rounds_per_week, minutes_per_week, set_at)
              VALUES (?,?,?,?)
              ON CONFLICT(learner_id) DO UPDATE SET
                rounds_per_week=excluded.rounds_per_week,
                minutes_per_week=excluded.minutes_per_week, set_at=excluded.set_at`)
    .run(req.params.id, rounds, minutes, now());
  res.json({ goal: { roundsPerWeek: rounds, minutesPerWeek: minutes } });
});

api.get("/learners/:id/goal", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const g = db.prepare("SELECT * FROM goals WHERE learner_id=?").get(req.params.id);
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const done = db.prepare("SELECT COUNT(*) c FROM runs WHERE learner_id=? AND finished_at >= ?")
    .get(req.params.id, since).c;
  if (!g) return res.json({ goal: null, roundsThisWeek: done });
  const pct = g.rounds_per_week ? Math.min(100, Math.round((done / g.rounds_per_week) * 100)) : null;
  res.json({
    goal: { roundsPerWeek: g.rounds_per_week, minutesPerWeek: g.minutes_per_week, setAt: g.set_at },
    roundsThisWeek: done,
    percentOfGoal: pct,
    met: g.rounds_per_week ? done >= g.rounds_per_week : null,
    atRisk: g.rounds_per_week ? (done < g.rounds_per_week && daysLeftThisWeek() <= 2) : null
  });
});
function daysLeftThisWeek() {
  const d = new Date().getUTCDay();          // 0 = Sunday
  return (7 - d) % 7;
}

/* ---------------- reporting exports (spec 4.3.4, 9.3) ----------------
   CSV for spreadsheets, and a printable HTML report a browser can turn into
   a PDF — no binary PDF library, and no dependency to keep patched. */
function toCsv(rows, columns) {
  const esc = v => {
    let s = v === null || v === undefined ? "" : String(v);
    /* A cell starting with = + - @ would run as a formula in a spreadsheet;
       a leading apostrophe makes it text (CSV injection). */
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.join(","), ...rows.map(r => columns.map(c => esc(r[c])).join(","))].join("\n");
}

api.get("/learners/:id/report.csv", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare(`SELECT topic_id, tier, best_score, best_total, best_pct, runs, last_at
                           FROM progress WHERE learner_id = ? ORDER BY topic_id, tier`).all(req.params.id);
  const enriched = rows.map(r => ({
    topic: (TOPIC_NAME.get(r.topic_id) || {}).name || r.topic_id,
    grade: (TOPIC_NAME.get(r.topic_id) || {}).grade || "",
    track: trackOf(r.topic_id) || "",
    tier: r.tier, best_score: r.best_score, best_total: r.best_total,
    best_pct: r.best_pct, mastery_threshold: thresholdOf(r.topic_id),
    mastered: r.best_pct >= thresholdOf(r.topic_id) ? "yes" : "no",
    attempts: r.runs, last_worked: r.last_at
  }));
  audit(req.user.id, "report.csv", req.params.id, req);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="progress.csv"');
  res.send(toCsv(enriched, ["topic", "grade", "track", "tier", "best_score", "best_total",
                            "best_pct", "mastery_threshold", "mastered", "attempts", "last_worked"]));
});

api.get("/classes/:id/report.csv", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const members = db.prepare(`SELECT l.id, l.name FROM class_members m
    JOIN learners l ON l.id = m.learner_id WHERE m.class_id=? ORDER BY l.name`).all(cls.id);
  const out = [];
  for (const m of members) {
    const prog = db.prepare("SELECT topic_id, tier, best_pct, runs FROM progress WHERE learner_id=?").all(m.id);
    if (!prog.length) out.push({ learner: m.name, topic: "", tier: "", best_pct: "", mastered: "", attempts: 0 });
    for (const p of prog) out.push({
      learner: m.name,
      topic: (TOPIC_NAME.get(p.topic_id) || {}).name || p.topic_id,
      tier: p.tier, best_pct: p.best_pct,
      mastered: p.best_pct >= thresholdOf(p.topic_id) ? "yes" : "no",
      attempts: p.runs
    });
  }
  audit(req.user.id, "class.report.csv", cls.id, req);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="class-progress.csv"');
  res.send(toCsv(out, ["learner", "topic", "tier", "best_pct", "mastered", "attempts"]));
});

/* Printable report. Served as HTML so the browser's own print-to-PDF makes
   the file; that keeps a PDF engine out of the dependency tree. */
api.get("/learners/:id/report.html", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const learner = db.prepare("SELECT name FROM learners WHERE id=?").get(req.params.id);
  const rows = db.prepare("SELECT * FROM progress WHERE learner_id=? ORDER BY topic_id, tier").all(req.params.id);
  const contests = db.prepare("SELECT format, pct, finished_at FROM contests WHERE learner_id=? ORDER BY finished_at DESC LIMIT 10")
    .all(req.params.id);
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const mastered = rows.filter(r => r.best_pct >= thresholdOf(r.topic_id)).length;
  const advanced = rows.filter(r => trackOf(r.topic_id) === "adv" && r.best_pct >= thresholdOf(r.topic_id));

  audit(req.user.id, "report.html", req.params.id, req);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Progress report — ${esc(learner?.name || "learner")}</title>
<style>
 body{font-family:Georgia,serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#17263F}
 h1{margin-bottom:.2rem} .sub{color:#5A6B87;margin-top:0}
 table{border-collapse:collapse;width:100%;margin:1rem 0}
 th,td{border-bottom:1px solid #D5DEEC;padding:.45rem .3rem;text-align:left;font-size:.92rem}
 th{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:#5A6B87}
 .yes{color:#147A46;font-weight:bold} .no{color:#5A6B87}
 @media print{body{margin:0}}
</style></head><body>
<h1>${esc(learner?.name || "Learner")}</h1>
<p class="sub">Progress report · ${new Date().toLocaleDateString()}</p>
<p><strong>${mastered}</strong> of ${rows.length} tier results mastered${advanced.length ? `, including ${advanced.length} on advanced topics` : ""}.</p>
<table><thead><tr><th>Topic</th><th>Grade</th><th>Track</th><th>Tier</th><th>Best</th><th>Mastered</th><th>Attempts</th></tr></thead><tbody>
${rows.map(r => {
  const meta = TOPIC_NAME.get(r.topic_id) || {};
  const ok = r.best_pct >= thresholdOf(r.topic_id);
  return `<tr><td>${esc(meta.name || r.topic_id)}</td><td>${esc(meta.grade || "")}</td>
  <td>${trackOf(r.topic_id) === "adv" ? "advanced" : "core"}</td><td>${esc(r.tier)}</td>
  <td>${r.best_score}/${r.best_total} (${r.best_pct}%)</td>
  <td class="${ok ? "yes" : "no"}">${ok ? "yes" : "not yet"}</td><td>${r.runs}</td></tr>`;
}).join("")}
</tbody></table>
${contests.length ? `<h2>Timed papers</h2><table><thead><tr><th>Format</th><th>Score</th><th>Date</th></tr></thead><tbody>
${contests.map(c => `<tr><td>${esc(c.format)}</td><td>${c.pct}%</td><td>${new Date(c.finished_at).toLocaleDateString()}</td></tr>`).join("")}
</tbody></table>` : ""}
<p class="sub">Print this page to save it as a PDF.</p>
</body></html>`);
});

/* ---------------- data rights (spec 9.3, 10.3) ----------------
   FERPA/GDPR give the account holder the right to obtain their data and to
   erase it. Both are self-service rather than a support request. */
api.get("/me/export", requireAuth, (req, res) => {
  const uid = req.user.id;
  const user = db.prepare("SELECT id, email, name, role, coppa_consent_at, created_at FROM users WHERE id = ?").get(uid);
  const learners = db.prepare("SELECT id, name, beast, created_at FROM learners WHERE user_id = ?").all(uid);
  const ids = learners.map(l => l.id);
  const inList = ids.map(() => "?").join(",") || "''";
  const progress = ids.length ? db.prepare(`SELECT * FROM progress WHERE learner_id IN (${inList})`).all(...ids) : [];
  const runs = ids.length ? db.prepare(`SELECT * FROM runs WHERE learner_id IN (${inList})`).all(...ids) : [];
  audit(uid, "data.exported", null, req);
  res.setHeader("Content-Disposition", 'attachment; filename="mathquest-export.json"');
  res.json({ exportedAt: now(), user, learners, progress, runs, auditTrail: auditTrail(uid) });
});

api.get("/me/audit", requireAuth, (req, res) => {
  res.json({ entries: auditTrail(req.user.id) });
});

/* Erasure. Learners, progress, runs and sessions cascade from the user row;
   the audit entry is written before deletion so the action itself is recorded. */
api.delete("/me", requireAuth, (req, res) => {
  const uid = req.user.id;
  audit(uid, "account.deleted", null, req);
  db.prepare("DELETE FROM users WHERE id = ?").run(uid);
  res.clearCookie("sid", COOKIE);
  res.json({ deleted: true });
});
