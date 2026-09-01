import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import {
  createUser, findUserByEmail, verifyPassword,
  createSession, destroySession, requireAuth
} from "./auth.js";
import { rateLimit, audit, auditTrail } from "./security.js";
import * as diag from "./diagnostic.js";
import * as spacing from "./spacing.js";
import { PREREQS, prereqsOf, allPrereqs, unlockedBy } from "../../shared/prereqs.mjs";
import { classify, summarise as summariseErrors, CATEGORIES } from "./errors.js";
import { CONTEST_FORMATS, isExpired, scorePaper } from "./contest.js";
import * as rewards from "./rewards.js";
import { requireRole } from "./security.js";
import { CURRICULUM, TIERS } from "../../shared/curriculum.mjs";
import { QUESTIONS, SECS } from "../../shared/questions.mjs";

export const api = Router();

const TIER_BY_LVL = { 1: "practice", 2: "challenge", 3: "boss" };
const tierOf = q => TIER_BY_LVL[q.lvl || 1];

/* Topic -> track index, built once from the curriculum. Spec 7.6: mastery is
   90% for core skills and 80% for advanced, so the threshold is a property of
   the topic, decided server-side rather than trusted from the client. */
export const MASTERY = { core: 90, adv: 80 };
const TOPIC_TRACK = (() => {
  const map = new Map();
  for (const g of Object.values(CURRICULUM))
    for (const u of g.units)
      for (const t of u.topics) map.set(t.id, u.track === "adv" ? "adv" : "core");
  return map;
})();
export const trackOf = topicId => TOPIC_TRACK.get(topicId) || null;
export const thresholdOf = topicId => MASTERY[trackOf(topicId) || "core"];

/* Strip everything that would give the answer away. The client never sees
   `a`, `ans`, `ansP` or `expl` until it has submitted. */
function publicQuestion(topicId, idx) {
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
    fig: q.fig || null
  };
}

/* Fisher-Yates on a copy; the caller's array is never mutated. */
function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gradeAnswer(q, raw) {
  /* Ordering: the submitted sequence must match exactly. */
  if (q.type === "order") {
    const got = Array.isArray(raw) ? raw.map(String) : [];
    const ok = got.length === q.ansOrder.length && got.every((v, i) => v === q.ansOrder[i]);
    return { ok, correctAnswer: q.ansOrder.join("  →  ") };
  }
  /* Select-all: set equality, so neither a missing nor an extra pick passes. */
  if (q.type === "multi") {
    const got = Array.isArray(raw) ? [...new Set(raw.map(Number))].sort((a, b) => a - b) : [];
    const want = [...q.aMulti].sort((a, b) => a - b);
    const ok = got.length === want.length && got.every((v, i) => v === want[i]);
    return { ok, correctAnswer: want.map(i => q.opts[i]).join(", ") };
  }
  if (q.type === "mc") {
    const ok = Number(raw) === q.a;
    return { ok, correctAnswer: q.opts[q.a] };
  }
  if (q.type === "pair") {
    const p = String(raw).replace(/−/g, "-").replace(/[^0-9.,\-]/g, "")
      .split(",").filter(s => s !== "");
    const ok = p.length === 2 &&
      Math.abs(parseFloat(p[0]) - q.ansP[0]) < 1e-9 &&
      Math.abs(parseFloat(p[1]) - q.ansP[1]) < 1e-9;
    return { ok, correctAnswer: `(${q.ansP[0]}, ${q.ansP[1]})` };
  }
  const n = parseFloat(String(raw).replace(/−/g, "-").replace(/[^0-9.\-]/g, ""));
  return { ok: !isNaN(n) && Math.abs(n - q.ans) < 1e-9, correctAnswer: String(q.ans) };
}

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
  const role = ["parent", "teacher"].includes(req.body?.role) ? req.body.role : "parent";
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

/* ---------------- learners ---------------- */
api.get("/learners", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT id, name, beast, created_at FROM learners WHERE user_id = ? ORDER BY created_at")
    .all(req.user.id);
  const withStars = rows.map(l => {
    const p = db.prepare("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id = ?").all(l.id);
    return { ...l, stars: p.filter(r => r.best_pct >= 80).length,
             topics: new Set(p.map(r => r.topic_id)).size };
  });
  res.json({ learners: withStars });
});

api.post("/learners", requireAuth, (req, res) => {
  const { name, beast } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "missing_name" });
  const id = randomUUID();
  db.prepare("INSERT INTO learners (id, user_id, name, beast, created_at) VALUES (?,?,?,?,?)")
    .run(id, req.user.id, String(name).trim().slice(0, 40), beast || "vex", now());
  audit(req.user.id, "learner.created", id, req);
  res.json({ learner: { id, name: String(name).trim(), beast: beast || "vex" } });
});

api.delete("/learners/:id", requireAuth, (req, res) => {
  const r = db.prepare("DELETE FROM learners WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);
  if (r.changes) audit(req.user.id, "learner.deleted", req.params.id, req);
  res.json({ deleted: r.changes });
});

function ownLearner(req, id) {
  return db.prepare("SELECT id FROM learners WHERE id = ? AND user_id = ?").get(id, req.user.id);
}

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
  res.json({ questions: idxs.map(i => publicQuestion(topicId, i)) });
});

/* Hint ladder (spec 4.1.4): three levels, served one at a time so the client
   cannot read ahead. Level 3 is the worked solution. Questions may supply a
   `hints` array; otherwise we fall back to what the bank has authored. */
function hintLadder(q) {
  if (Array.isArray(q.hints) && q.hints.length) return q.hints.slice(0, 3);
  const ladder = [];
  if (q.hint) ladder.push(q.hint);
  else ladder.push("Read the question again and name what you are being asked to find.");
  ladder.push("Work out what you know first, then take it one step at a time.");
  ladder.push(q.expl);
  return ladder;
}

api.post("/hint", (req, res) => {
  const { questionId, level } = req.body || {};
  const [topicId, idxRaw] = String(questionId || "").split(":");
  const bank = QUESTIONS[topicId];
  const idx = Number(idxRaw);
  if (!bank || !bank[idx]) return res.status(400).json({ error: "unknown_question" });
  for (const sess of checkSessions.values())
    if (sess.ids.includes(String(questionId)))
      return res.status(409).json({ error: "hints_disabled_during_mastery_check" });
  const lvl = Math.min(3, Math.max(1, Number(level) || 1));
  const ladder = hintLadder(bank[idx]);
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
  const notMastered = rows
    .filter(r => r.best_pct < thresholdOf(r.topic_id))
    .map(r => ({
      topicId: r.topic_id, tier: r.tier, bestPct: r.best_pct,
      threshold: thresholdOf(r.topic_id), track: trackOf(r.topic_id),
      gap: thresholdOf(r.topic_id) - r.best_pct, lastAt: r.last_at,
      reason: "not_yet_mastered"
    }))
    .sort((a, b) => b.gap - a.gap);

  const dueRows = spacing.due(learnerId);
  const seen = new Set(notMastered.map(i => i.topicId));
  const dueForReview = dueRows
    .filter(d => !seen.has(d.topic_id))
    .map(d => ({
      topicId: d.topic_id, threshold: thresholdOf(d.topic_id), track: trackOf(d.topic_id),
      gap: 0, lastAt: d.last_at, dueAt: d.due_at,
      intervalDays: d.interval_days, reason: "due_for_review"
    }));

  res.json({ review: [...notMastered, ...dueForReview], schedule: spacing.scheduleFor(learnerId) });
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
  const picked = idxs.slice(0, Math.min(CHECK_SIZE, idxs.length));
  const id = randomUUID();
  checkSessions.set(id, { learnerId, topicId, ids: picked.map(i => `${topicId}:${i}`), issuedAt: Date.now() });
  audit(req.user.id, "mastery.started", topicId, req);
  res.json({
    checkId: id,
    threshold: thresholdOf(topicId),
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
  const threshold = thresholdOf(sess.topicId);
  const passed = pct >= threshold;
  const ts = now();

  db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, finished_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(randomUUID(), sess.learnerId, sess.topicId, "mastery", score, total, pct, ts);
  const prev = db.prepare("SELECT * FROM progress WHERE learner_id=? AND topic_id=? AND tier=?")
    .get(sess.learnerId, sess.topicId, "mastery");
  if (!prev) {
    db.prepare(`INSERT INTO progress (learner_id, topic_id, tier, best_score, best_total, best_pct, runs, last_at)
                VALUES (?,?,?,?,?,?,1,?)`).run(sess.learnerId, sess.topicId, "mastery", score, total, pct, ts);
  } else if (pct > prev.best_pct) {
    db.prepare(`UPDATE progress SET best_score=?, best_total=?, best_pct=?, runs=runs+1, last_at=?
                WHERE learner_id=? AND topic_id=? AND tier=?`)
      .run(score, total, pct, ts, sess.learnerId, sess.topicId, "mastery");
  } else {
    db.prepare(`UPDATE progress SET runs=runs+1, last_at=? WHERE learner_id=? AND topic_id=? AND tier=?`)
      .run(ts, sess.learnerId, sess.topicId, "mastery");
  }

  spacing.schedule(sess.learnerId, sess.topicId, score / total);
  const reward = rewardRound(sess.learnerId, sess.topicId, { score, total, pct });
  checkSessions.delete(checkId);
  audit(req.user.id, "mastery.submitted", `${sess.topicId}:${pct}%`, req);
  res.json({ score, total, pct, threshold, passed, detail, reward });
});

/* Grading happens here, never in the browser. */
api.post("/answer", (req, res) => {
  const { questionId, answer } = req.body || {};
  const [topicId, idxRaw] = String(questionId || "").split(":");
  const bank = QUESTIONS[topicId];
  const idx = Number(idxRaw);
  if (!bank || !Number.isInteger(idx) || !bank[idx]) return res.status(400).json({ error: "unknown_question" });
  const q = bank[idx];
  const { ok, correctAnswer } = gradeAnswer(q, answer);
  res.json({ correct: ok, correctAnswer, explanation: q.expl, figA: q.figA || null });
});

/* ---------------- knowledge graph (spec 6.2) ---------------- */
const TOPIC_NAME = (() => {
  const m = new Map();
  for (const g of Object.values(CURRICULUM))
    for (const u of g.units)
      for (const t of u.topics) m.set(t.id, { name: t.name, grade: g.label, unit: u.name, track: u.track });
  return m;
})();
const describe = id => ({ topicId: id, ...(TOPIC_NAME.get(id) || { name: id }) });

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
api.get("/learners/:id/next", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id = ?")
    .all(req.params.id);

  const best = new Map();
  for (const r of rows) best.set(r.topic_id, Math.max(best.get(r.topic_id) || 0, r.best_pct));
  const mastered = id => (best.get(id) || 0) >= thresholdOf(id);

  const ready = [], blocked = [];
  for (const id of TOPIC_NAME.keys()) {
    if (!QUESTIONS[id]) continue;              // nothing to practise yet
    if (mastered(id)) continue;
    const missing = prereqsOf(id).filter(p => !mastered(p));
    const entry = { ...describe(id), bestPct: best.get(id) || 0 };
    if (missing.length === 0) ready.push(entry);
    else blocked.push({ ...entry, missing: missing.map(describe) });
  }
  res.json({ ready, blocked });
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
  const order = [sess.tierIdx, ...diag.TIER_ORDER.map((_, i) => i).filter(i => i !== sess.tierIdx)];
  for (const ti of order) {
    const pool = (sess.byTier[diag.TIER_ORDER[ti]] || []).filter(i => !sess.used.has(i));
    if (pool.length) {
      const idx = pool[Math.floor(Math.random() * pool.length)];
      sess.used.add(idx);
      return { idx, tier: diag.TIER_ORDER[ti] };
    }
  }
  return null;
}

api.post("/practice/answer", requireAuth, (req, res) => {
  const { sessionId, answer, hintsUsed } = req.body || {};
  const sess = practiceSessions.get(sessionId);
  if (!sess) return res.status(404).json({ error: "unknown_session" });
  if (!ownLearner(req, sess.learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!sess.pending) return res.status(409).json({ error: "no_question_pending" });

  const { idx } = sess.pending;
  const q = QUESTIONS[sess.topicId][idx];
  const { ok, correctAnswer } = gradeAnswer(q, answer);

  sess.asked++;
  sess.hintsUsed += Math.max(0, Math.min(3, Number(hintsUsed) || 0));
  if (ok) {
    sess.score++; sess.streakRight++; sess.streakWrong = 0;
    if (sess.streakRight >= 2 && sess.tierIdx < diag.TIER_ORDER.length - 1) { sess.tierIdx++; sess.streakRight = 0; }
  } else {
    const category = classify(q, answer);
    sess.missed.push({ id: `${sess.topicId}:${idx}`, q: q.q, correctAnswer,
                       explanation: q.expl, category, categoryLabel: CATEGORIES[category] });
    db.prepare("INSERT INTO mistakes (id, learner_id, topic_id, question_id, category, at) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), sess.learnerId, sess.topicId, `${sess.topicId}:${idx}`, category, now());
    sess.streakWrong++; sess.streakRight = 0;
    if (sess.streakWrong >= 2 && sess.tierIdx > 0) { sess.tierIdx--; sess.streakWrong = 0; }
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

    db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, finished_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), sess.learnerId, sess.topicId, "adaptive", sess.score, total, pct, ts);
    const prev = db.prepare("SELECT * FROM progress WHERE learner_id=? AND topic_id=? AND tier=?")
      .get(sess.learnerId, sess.topicId, "adaptive");
    if (!prev) {
      db.prepare(`INSERT INTO progress (learner_id, topic_id, tier, best_score, best_total, best_pct, runs, last_at)
                  VALUES (?,?,?,?,?,?,1,?)`).run(sess.learnerId, sess.topicId, "adaptive", sess.score, total, pct, ts);
    } else if (pct > prev.best_pct) {
      db.prepare(`UPDATE progress SET best_score=?, best_total=?, best_pct=?, runs=runs+1, last_at=?
                  WHERE learner_id=? AND topic_id=? AND tier=?`)
        .run(sess.score, total, pct, ts, sess.learnerId, sess.topicId, "adaptive");
    } else {
      db.prepare("UPDATE progress SET runs=runs+1, last_at=? WHERE learner_id=? AND topic_id=? AND tier=?")
        .run(ts, sess.learnerId, sess.topicId, "adaptive");
    }
    spacing.schedule(sess.learnerId, sess.topicId, sess.score / total);
    const reward = rewardRound(sess.learnerId, sess.topicId,
      { score: sess.score, total, pct, hintsUsed: sess.hintsUsed });
    practiceSessions.delete(sessionId);
    return res.json({
      correct: ok, correctAnswer, explanation: q.expl, figA: q.figA || null, done: true,
      summary: { score: sess.score, total, pct, stars, hintsUsed: sess.hintsUsed, reward,
                 threshold: thresholdOf(sess.topicId), missed: sess.missed,
                 seconds: Math.round((Date.now() - sess.startedAt) / 1000) }
    });
  }
  sess.pending = next;
  res.json({
    correct: ok, correctAnswer, explanation: q.expl, figA: q.figA || null, done: false,
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
  const limitSecs = fmt.minutes * 60;
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
  const { topicId, tier, dueAt } = req.body || {};
  if (!QUESTIONS[topicId]) return res.status(400).json({ error: "unknown_topic" });
  const id = randomUUID();
  db.prepare("INSERT INTO assignments (id, class_id, topic_id, tier, due_at, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, req.params.id, topicId, tier || null, dueAt || null, now());
  res.json({ assignment: { id, topicId, tier: tier || null, dueAt: dueAt || null } });
});

/* Class progress: one row per learner per assignment, plus a topic heatmap. */
api.get("/classes/:id/progress", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });

  const members = db.prepare(`SELECT l.id, l.name FROM class_members m
    JOIN learners l ON l.id = m.learner_id WHERE m.class_id=? ORDER BY l.name`).all(cls.id);
  const assignments = db.prepare("SELECT * FROM assignments WHERE class_id=?").all(cls.id);

  const rows = members.map(m => {
    const prog = db.prepare("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id=?").all(m.id);
    const done = assignments.map(a => {
      const match = prog.filter(p => p.topic_id === a.topic_id && (!a.tier || p.tier === a.tier));
      const best = match.reduce((x, p) => Math.max(x, p.best_pct), 0);
      return { assignmentId: a.id, topicId: a.topic_id, bestPct: best,
               mastered: best >= thresholdOf(a.topic_id), attempted: match.length > 0 };
    });
    const mastered = prog.filter(p => p.best_pct >= thresholdOf(p.topic_id)).length;
    return { learnerId: m.id, name: m.name, assignments: done, topicsMastered: mastered };
  });

  /* Heatmap: for each assigned topic, how the class as a whole is doing. */
  const heatmap = assignments.map(a => {
    const scores = rows.map(r => (r.assignments.find(x => x.assignmentId === a.id) || {}).bestPct || 0);
    const attempted = scores.filter(s => s > 0).length;
    return {
      topicId: a.topic_id, assigned: rows.length, attempted,
      averagePct: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : 0,
      mastered: rows.filter(r => (r.assignments.find(x => x.assignmentId === a.id) || {}).mastered).length
    };
  });

  audit(req.user.id, "class.progress.read", cls.id, req);
  res.json({ class: { id: cls.id, name: cls.name }, assignments, learners: rows, heatmap });
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
  const { learnerId, topicId, tier, score, total } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!trackOf(topicId)) return res.status(400).json({ error: "unknown_topic" });
  if (!TIERS.some(t => t.id === tier)) return res.status(400).json({ error: "unknown_tier" });
  const s = Math.max(0, Number(score) | 0), t = Math.max(1, Number(total) | 0);
  const pct = Math.round((s / t) * 100);
  const ts = now();

  db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, finished_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(randomUUID(), learnerId, topicId, tier, s, t, pct, ts);

  const prev = db.prepare("SELECT * FROM progress WHERE learner_id=? AND topic_id=? AND tier=?")
    .get(learnerId, topicId, tier);
  if (!prev) {
    db.prepare(`INSERT INTO progress (learner_id, topic_id, tier, best_score, best_total, best_pct, runs, last_at)
                VALUES (?,?,?,?,?,?,1,?)`).run(learnerId, topicId, tier, s, t, pct, ts);
  } else {
    const better = pct > prev.best_pct;
    db.prepare(`UPDATE progress SET best_score=?, best_total=?, best_pct=?, runs=runs+1, last_at=?
                WHERE learner_id=? AND topic_id=? AND tier=?`)
      .run(better ? s : prev.best_score, better ? t : prev.best_total,
           better ? pct : prev.best_pct, ts, learnerId, topicId, tier);
  }
  const track = trackOf(topicId), threshold = thresholdOf(topicId);
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
