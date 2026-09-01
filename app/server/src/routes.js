import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import {
  createUser, findUserByEmail, verifyPassword,
  createSession, destroySession, requireAuth
} from "./auth.js";
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
    opts: q.type === "mc" ? q.opts : undefined,
    mono: q.mono || false,
    hint: q.hint || null,
    fig: q.fig || null
  };
}

function gradeAnswer(q, raw) {
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
const COOKIE = { httpOnly: true, sameSite: "lax", path: "/" };

api.post("/auth/register", (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !String(email).includes("@")) return res.status(400).json({ error: "bad_email" });
  if (!password || String(password).length < 8) return res.status(400).json({ error: "weak_password" });
  if (!name || !String(name).trim()) return res.status(400).json({ error: "missing_name" });
  if (findUserByEmail(email)) return res.status(409).json({ error: "email_taken" });

  const user = createUser({ email, password: String(password), name: String(name).trim().slice(0, 60) });
  const s = createSession(user.id);
  res.cookie("sid", s.id, { ...COOKIE, expires: new Date(s.expires) });
  res.json({ user });
});

api.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const row = findUserByEmail(email || "");
  // Same response either way so the endpoint can't be used to discover emails.
  if (!row || !verifyPassword(String(password || ""), row.pass_hash, row.pass_salt)) {
    return res.status(401).json({ error: "bad_credentials" });
  }
  const s = createSession(row.id);
  res.cookie("sid", s.id, { ...COOKIE, expires: new Date(s.expires) });
  res.json({ user: { id: row.id, email: row.email, name: row.name } });
});

api.post("/auth/logout", (req, res) => {
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
  res.json({ learner: { id, name: String(name).trim(), beast: beast || "vex" } });
});

api.delete("/learners/:id", requireAuth, (req, res) => {
  const r = db.prepare("DELETE FROM learners WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);
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
  const lvl = Math.min(3, Math.max(1, Number(level) || 1));
  const ladder = hintLadder(bank[idx]);
  res.json({ level: lvl, hint: ladder[lvl - 1], last: lvl >= 3 });
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
  res.json({ pct, threshold, track, star: pct >= threshold });
});

api.get("/learners/:id/progress", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const progress = db.prepare("SELECT * FROM progress WHERE learner_id = ?").all(req.params.id);
  const recent = db.prepare("SELECT topic_id, tier, score, total, pct, finished_at FROM runs WHERE learner_id = ? ORDER BY finished_at DESC LIMIT 20")
    .all(req.params.id);
  res.json({ progress, recent });
});
