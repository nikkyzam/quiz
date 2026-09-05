import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import {
  createUser, findUserByEmail, verifyPassword,
  createSession, destroySession, requireAuth,
  createResetToken, consumeResetToken, setPassword
} from "./auth.js";
import { rateLimit, audit, auditTrail } from "./security.js";
import * as diag from "./diagnostic.js";
import * as spacing from "./spacing.js";
import * as bandit from "./bandit.js";
import { PREREQS, prereqsOf, allPrereqs, unlockedBy } from "../../shared/prereqs.mjs";
import { classify, summarise as summariseErrors, CATEGORIES } from "./errors.js";
import { CONTEST_FORMATS, isExpired, scorePaper } from "./contest.js";
import * as rewards from "./rewards.js";
import { generate, generatedTopics } from "../../shared/generators.mjs";
import * as bkt from "./bkt.js";
import { PROOFS, publicProof, checkProof, proofsForTopic, allProofs, PROOF_KINDS } from "../../shared/proofs.mjs";
import { PUZZLES, publicPuzzle, checkPuzzle, puzzleById } from "../../shared/puzzles.mjs";
import { LESSONS, publicLesson, checkPanel, lessonForTopic, allLessons } from "../../shared/lessons.mjs";
import { STANDARDS, standardsFor, coverage } from "../../shared/standards.mjs";
import { requireRole } from "./security.js";
import { CURRICULUM, TIERS } from "../../shared/curriculum.mjs";
import { QUESTIONS, SECS } from "../../shared/questions.mjs";
import * as units_ from "./units.js";

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
    fig: q.fig || null,
    /* The grid a plot question is answered on: its extent and how many points
       to place. `ansPlot` and `plotRule` stay server-side — this object is
       built field by field rather than spread, so the answer cannot arrive
       here by someone adding a field to the question later. */
    plot: q.type === "plot"
      ? {
          xMin: q.plot?.xMin ?? -5, xMax: q.plot?.xMax ?? 5,
          yMin: q.plot?.yMin ?? -5, yMax: q.plot?.yMax ?? 5,
          need: q.plotRule?.need ?? (q.ansPlot ? q.ansPlot.length : 1)
        }
      : undefined
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

/* A generated question's id carries its seed, so the server can rebuild the
   exact same problem when marking it — no session storage, and a learner
   returning to a review item sees the identical question. */
function resolveQuestion(questionId) {
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

function publicGenerated(topicId, seed) {
  const g = generate(topicId, seed);
  if (!g) return null;
  return {
    id: `gen:${topicId}:${seed}`,
    sec: g.sec, secName: SECS[g.sec] || "Problem",
    type: g.type, q: g.q, mono: false, hint: g.hint || null, fig: null, generated: true
  };
}

function gradeAnswer(q, raw) {
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
    const p = String(raw).replace(/−/g, "-").replace(/[^0-9.,\-]/g, "")
      .split(",").filter(s => s !== "");
    const ok = p.length === 2 &&
      Math.abs(parseFloat(p[0]) - q.ansP[0]) < 1e-9 &&
      Math.abs(parseFloat(p[1]) - q.ansP[1]) < 1e-9;
    return { ok, correctAnswer: `(${q.ansP[0]}, ${q.ansP[1]})`, credit: ok ? 1 : 0 };
  }
  /* Points plotted on a grid (spec 3.2.2).

     Two modes, and the second is the reason the type earns its place. With
     `ansPlot` the answer is a specific set of points, marked without regard
     to the order they were placed in — the plane does not care which corner
     of the rectangle the child clicked first. With `plotRule` the answer is
     any set of points satisfying a relation, so "plot two points on
     y = 2x + 1" has infinitely many correct answers and cannot be marked by
     comparing against a stored one at all. That is a question a text box
     cannot ask.

     Partial credit follows the same shape as select-all: points on target
     count for, points off target count against, so covering the grid in
     points scores nothing. */
  if (q.type === "plot") {
    const got = (Array.isArray(raw) ? raw : [])
      .filter(p => Array.isArray(p) && p.length === 2)
      .map(p => [Number(p[0]), Number(p[1])])
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    /* Placing the same point twice is one point, not two — otherwise a
       learner could satisfy "plot two points on the line" with one. */
    const unique = got.filter((p, i) =>
      got.findIndex(o => Math.abs(o[0] - p[0]) < 1e-9 && Math.abs(o[1] - p[1]) < 1e-9) === i);

    if (q.plotRule) {
      const { m, c, need } = q.plotRule;
      const wanted = need || 2;
      const onLine = unique.filter(p => Math.abs(p[1] - (m * p[0] + c)) < 1e-9);
      const ok = unique.length === wanted && onLine.length === wanted;
      const credit = wanted ? Math.max(0, (onLine.length - (unique.length - onLine.length)) / wanted) : 0;
      const sign = c === 0 ? "" : c > 0 ? ` + ${c}` : ` − ${Math.abs(c)}`;
      return {
        ok,
        correctAnswer: `any ${wanted} different points on y = ${m}x${sign} — for example (0, ${c}) and (1, ${m + c})`,
        credit: Math.min(1, credit),
        creditDetail: `${onLine.length} of ${wanted} on the line`
      };
    }

    const want = q.ansPlot || [];
    const claimed = new Set();
    let hits = 0;
    for (const p of unique) {
      const i = want.findIndex((w, wi) =>
        !claimed.has(wi) && Math.abs(w[0] - p[0]) < 1e-9 && Math.abs(w[1] - p[1]) < 1e-9);
      if (i >= 0) { claimed.add(i); hits++; }
    }
    const strays = unique.length - hits;
    const ok = hits === want.length && strays === 0;
    const credit = want.length ? Math.max(0, (hits - strays) / want.length) : 0;
    return {
      ok,
      correctAnswer: want.map(p => `(${p[0]}, ${p[1]})`).join(", "),
      credit: Math.min(1, credit),
      creditDetail: `${hits} of ${want.length} placed correctly${strays ? `, ${strays} in the wrong place` : ""}`
    };
  }
  const n = parseFloat(String(raw).replace(/−/g, "-").replace(/[^0-9.\-]/g, ""));
  const numOk = !isNaN(n) && Math.abs(n - q.ans) < 1e-9;
  return { ok: numOk, correctAnswer: String(q.ans), credit: numOk ? 1 : 0 };
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

/* 4.2.3 — how long a round took.
   Server-measured wherever a session exists, because that is the only number
   nobody can inflate. Sessions held in memory carry startedAt; a round with no
   session reports its own duration and is clamped, since a browser tab left
   open overnight would otherwise register eight hours of study. */
const MAX_ROUND_SECONDS = 2 * 60 * 60;
function elapsedSeconds(sess) {
  // null, not 0, when there is nothing to measure — see the migration note.
  if (!sess || !sess.startedAt) return null;
  return Math.min(MAX_ROUND_SECONDS, Math.max(0, Math.round((Date.now() - sess.startedAt) / 1000)));
}
function reportedSeconds(value) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(MAX_ROUND_SECONDS, Math.round(n));
}

/* ---------------- learners ---------------- */
/* 4.2.2 — the three curricula a child can be following.
   core        standards coverage only
   enrichment  core plus the advanced/extended units
   competition enrichment, aimed at contest preparation
   Stored per learner and used to filter what the curriculum endpoint returns,
   so the setting changes what the child is actually offered rather than
   sitting on the record as a label. */
const TRACKS = new Set(["core", "enrichment", "competition"]);
const UNIT_TRACKS = {
  core: new Set(["core"]),
  enrichment: new Set(["core", "adv"]),
  competition: new Set(["core", "adv"])
};

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

api.post("/learners", requireAuth, (req, res) => {
  const { name, beast, track } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "missing_name" });
  // An unrecognised track is refused rather than silently coerced to core: a
  // typo would otherwise quietly narrow a child's curriculum, which is exactly
  // the kind of wrong nobody notices.
  if (track !== undefined && !TRACKS.has(track)) return res.status(400).json({ error: "unknown_track" });
  const chosen = track || "core";
  const id = randomUUID();
  db.prepare("INSERT INTO learners (id, user_id, name, beast, track, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, req.user.id, String(name).trim().slice(0, 40), beast || "vex", chosen, now());
  audit(req.user.id, "learner.created", id, req);
  res.json({ learner: { id, name: String(name).trim(), beast: beast || "vex", track: chosen } });
});

/* Changing the track later. Audited like every other change to a child's
   record, because a parent and a teacher can both be looking at the same
   learner and "who widened this to competition" is a real question. */
api.patch("/learners/:id", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(404).json({ error: "not_found" });
  const { track, name, beast } = req.body || {};
  if (track !== undefined && !TRACKS.has(track)) return res.status(400).json({ error: "unknown_track" });
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: "missing_name" });
  if (track !== undefined)
    db.prepare("UPDATE learners SET track = ? WHERE id = ?").run(track, req.params.id);
  if (name !== undefined)
    db.prepare("UPDATE learners SET name = ? WHERE id = ?").run(String(name).trim().slice(0, 40), req.params.id);
  if (beast !== undefined)
    db.prepare("UPDATE learners SET beast = ? WHERE id = ?").run(String(beast), req.params.id);
  audit(req.user.id, "learner.updated", req.params.id, req);
  const row = db.prepare("SELECT id, name, beast, track FROM learners WHERE id = ?").get(req.params.id);
  res.json({ learner: row });
});

/* The curriculum this particular child is following.
   A core learner is not shown advanced units at all — offering a map full of
   material that is not part of their plan is how a nine-year-old concludes
   they are behind. */
api.get("/learners/:id/curriculum", requireAuth, (req, res) => {
  const learner = db.prepare("SELECT track FROM learners WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!learner) return res.status(404).json({ error: "not_found" });
  const allowed = UNIT_TRACKS[learner.track] || UNIT_TRACKS.core;
  // CURRICULUM is keyed by grade ("K", "1", ...), not a list.
  const curriculum = {};
  for (const [grade, body] of Object.entries(CURRICULUM)) {
    const units = (body.units || []).filter(u => allowed.has(u.track));
    if (units.length) curriculum[grade] = { ...body, units };
  }
  res.json({ track: learner.track, curriculum, tiers: TIERS, mastery: MASTERY });
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
api.get("/standards", (_req, res) => {
  const authored = Object.keys(QUESTIONS);
  res.json({ standards: STANDARDS, coverage: coverage(authored) });
});

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
  const standards = {};
  for (const id of Object.keys(QUESTIONS)) standards[id] = standardsFor(id);
  res.json({ curriculum: CURRICULUM, tiers: TIERS, counts, thresholds, mastery: MASTERY, standards });
});

/* Parent-facing overview: what a topic covers, a sample problem to see the
   style, and the standard it maps to if any (spec 4.2.7). No login required
   -- a parent deciding whether to sign up should be able to look first. */
api.get("/topics/:id/overview", (req, res) => {
  const id = req.params.id;
  const bank = QUESTIONS[id];
  if (!bank) return res.status(404).json({ error: "no_content" });
  const meta = TOPIC_NAME.get(id) || {};
  const sampleIdx = bank.findIndex(q => (q.lvl || 1) === 1) ;
  const sample = bank[sampleIdx >= 0 ? sampleIdx : 0];
  res.json({
    topicId: id, name: meta.name, grade: meta.grade, unit: meta.unit,
    track: trackOf(id), standards: standardsFor(id),
    totalQuestions: bank.length,
    sample: { q: sample.q, type: sample.type, secName: SECS[sample.sec] || "Problem" }
  });
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
  const resolved = resolveQuestion(questionId);
  if (!resolved) return res.status(400).json({ error: "unknown_question" });
  for (const sess of checkSessions.values())
    if (sess.ids.includes(String(questionId)))
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

  const id = diag.makeDiagnostic({ questionsByTier, bank, topicId, learnerId });
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
  checkSessions.set(id, { learnerId, topicId, ids: picked.map(i => `${topicId}:${i}`),
                          issuedAt: Date.now(), startedAt: Date.now() });
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
  const threshold = thresholdOf(sess.topicId);
  const passed = pct >= threshold;
  const ts = now();

  db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, seconds, finished_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), sess.learnerId, sess.topicId, "mastery", score, total, pct,
         elapsedSeconds(sess), ts);
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

/* ---------------- unit tests (spec 7.2) ----------------
   Summative assessment across a whole unit rather than one topic. Sessions
   are held server-side for the same reason mastery checks are: the client
   must not be able to choose its own questions or report its own score. */
const unitSessions = new Map();

api.get("/learners/:id/units", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const learner = db.prepare("SELECT track FROM learners WHERE id = ?").get(req.params.id);
  if (!learner) return res.status(404).json({ error: "unknown_learner" });
  const units = units_.testableUnits(learner.track).map(u => ({
    key: u.key, grade: u.grade, name: u.name, track: u.track,
    topics: u.topics, questionCount: u.size
  }));
  res.json({ units });
});

api.post("/unit-test/start", requireAuth, (req, res) => {
  const { learnerId, unitKey } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const unit = units_.findUnit(unitKey);
  if (!unit) return res.status(404).json({ error: "unknown_unit" });

  /* Refused by name rather than served in a degraded form: a unit with one
     authored topic would produce a "unit test" that is a mastery check, and
     the result would then be recorded as unit-level evidence it is not. */
  if (!unit.testable)
    return res.status(409).json({
      error: "unit_not_testable",
      message: `${unit.name} has questions for ${unit.authoredCount} of its ${unit.topicCount} topics; a unit test needs at least ${units_.MIN_TOPICS}.`
    });

  const picked = units_.drawQuestions(unit);
  const id = randomUUID();
  unitSessions.set(id, {
    learnerId, unitKey: unit.key,
    ids: picked.map(p => `${p.topicId}:${p.idx}`),
    startedAt: Date.now()
  });
  audit(req.user.id, "unitTest.started", unit.key, req);
  res.json({
    testId: id,
    unit: { key: unit.key, name: unit.name, grade: unit.grade },
    threshold: MASTERY[unit.track === "adv" ? "adv" : "core"],
    questions: picked.map(p => publicQuestion(p.topicId, p.idx))
  });
});

api.post("/unit-test/submit", requireAuth, (req, res) => {
  const { testId, answers } = req.body || {};
  const sess = unitSessions.get(testId);
  if (!sess) return res.status(404).json({ error: "unknown_test" });
  if (!ownLearner(req, sess.learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!answers || typeof answers !== "object") return res.status(400).json({ error: "missing_answers" });

  const unit = units_.findUnit(sess.unitKey);
  let score = 0;
  const results = [];
  const detail = sess.ids.map(qid => {
    const [topicId, idx] = qid.split(":");
    const q = QUESTIONS[topicId][Number(idx)];
    const { ok, correctAnswer } = gradeAnswer(q, answers[qid]);
    if (ok) score++;
    results.push({ topicId, correct: ok });

    /* Evidence is per topic, so it is credited per topic — a unit test tells
       the knowledge model about each topic it touched, not about the unit as
       an undifferentiated whole. */
    bkt.observe(sess.learnerId, topicId, ok,
      bkt.paramsFor({ optionCount: q.type === "mc" ? (q.opts || []).length : 0 }));
    let category = null;
    if (!ok) {
      category = classify(q, answers[qid]);
      db.prepare("INSERT INTO mistakes (id, learner_id, topic_id, question_id, category, at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), sess.learnerId, topicId, qid, category, now());
    }
    return { id: qid, topicId, correct: ok, correctAnswer, explanation: q.expl,
             category, categoryLabel: category ? CATEGORIES[category] : null };
  });

  const total = sess.ids.length;
  const pct = Math.round((score / total) * 100);
  const threshold = MASTERY[unit.track === "adv" ? "adv" : "core"];
  const passed = pct >= threshold;
  const parts = units_.breakdown(results, unit);
  const ts = now();

  db.prepare(`INSERT INTO unit_tests (id, learner_id, unit_key, unit_name, score, total, pct,
                                      threshold, passed, breakdown, seconds, finished_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), sess.learnerId, unit.key, unit.name, score, total, pct,
         threshold, passed ? 1 : 0, JSON.stringify(parts), elapsedSeconds(sess), ts);

  unitSessions.delete(testId);
  audit(req.user.id, "unitTest.submitted", `${unit.key}:${pct}%`, req);
  res.json({
    unit: { key: unit.key, name: unit.name },
    score, total, pct, threshold, passed,
    breakdown: parts,
    weakest: parts.length ? parts[0] : null,
    detail
  });
});

api.get("/learners/:id/unit-tests", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare(`SELECT unit_key, unit_name, score, total, pct, threshold, passed, breakdown, finished_at
                           FROM unit_tests WHERE learner_id = ? ORDER BY finished_at DESC LIMIT 50`)
    .all(req.params.id);
  res.json({
    tests: rows.map(r => ({
      unitKey: r.unit_key, unitName: r.unit_name,
      score: r.score, total: r.total, pct: r.pct,
      threshold: r.threshold, passed: !!r.passed,
      breakdown: JSON.parse(r.breakdown), finishedAt: r.finished_at
    }))
  });
});

/* Grading happens here, never in the browser. */
api.post("/answer", (req, res) => {
  const { questionId, answer } = req.body || {};
  const resolved = resolveQuestion(questionId);
  if (!resolved) return res.status(400).json({ error: "unknown_question" });
  const q = resolved.q;
  const { ok, correctAnswer, credit, creditDetail } = gradeAnswer(q, answer);
  res.json({ correct: ok, correctAnswer, credit: credit ?? (ok ? 1 : 0), creditDetail: creditDetail || null,
             explanation: q.expl, figA: q.figA || null });
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
  const mastered = id =>
    (best.get(id) || 0) >= thresholdOf(id) || bkt.isKnown(bkt.estimate(req.params.id, id));

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
  const { ok, correctAnswer, credit, creditDetail } = gradeAnswer(q, answer);
  const earned = credit ?? (ok ? 1 : 0);

  sess.asked++;
  sess.credit = (sess.credit || 0) + earned;
  sess.hintsUsed += Math.max(0, Math.min(3, Number(hintsUsed) || 0));
  /* Feed the knowledge model. A hinted answer is weaker evidence, so it is
     recorded with a higher guess rate rather than counted as clean success. */
  bkt.observe(sess.learnerId, sess.topicId, ok,
    bkt.paramsFor({ optionCount: q.type === "mc" ? (q.opts || []).length : 0 }));
  /* 6.3 — the bandit sees the outcome at the tier that produced it. Recorded
     before the next tier is chosen, so the choice reflects this answer. */
  bandit.observe(sess.learnerId, sess.topicId, diag.TIER_ORDER[sess.tierIdx], ok);

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

  /* Difficulty now comes from the bandit rather than a two-in-a-row rule.
     The streak counters are kept because the session summary reports them, but
     they no longer decide anything. */
  const chosen = bandit.selectTier(sess.learnerId, sess.topicId, sess.rand);
  const chosenIdx = diag.TIER_ORDER.indexOf(chosen);
  if (chosenIdx >= 0) sess.tierIdx = chosenIdx;

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

    db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, seconds, finished_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), sess.learnerId, sess.topicId, "adaptive", sess.score, total, pct,
           elapsedSeconds(sess), ts);
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
  /* Parameterized even though `since` is server-generated, not user input:
     string-interpolated SQL is the pattern that becomes exploitable the
     moment someone later copies it and feeds it a request value. */
  const activeLearners = db.prepare(
    "SELECT COUNT(DISTINCT learner_id) c FROM runs WHERE finished_at >= ?").get(since).c;

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
    const r = backup();
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
  const { learnerId, topicId, tier, score, total } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!trackOf(topicId)) return res.status(400).json({ error: "unknown_topic" });
  if (!TIERS.some(t => t.id === tier)) return res.status(400).json({ error: "unknown_tier" });
  const s = Math.max(0, Number(score) | 0), t = Math.max(1, Number(total) | 0);
  const pct = Math.round((s / t) * 100);
  const ts = now();

  db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, seconds, finished_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), learnerId, topicId, tier, s, t, pct, reportedSeconds(req.body?.seconds), ts);

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
  const recent = db.prepare("SELECT topic_id, tier, score, total, pct, seconds, finished_at FROM runs WHERE learner_id = ? ORDER BY finished_at DESC LIMIT 20")
    .all(req.params.id);
  res.json({ progress, recent });
});

/* 4.2.3 — time on task, aggregated.
   Rounds recorded before durations were kept carry 0 seconds. Those are counted
   as unmeasured rather than as instant: averaging them in as zero understates
   every total, and a parent comparing weeks would see study time "drop" purely
   because older rounds predate the column. */
api.get("/learners/:id/time", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const id = req.params.id;
  const runs = db.prepare("SELECT topic_id, tier, seconds, finished_at FROM runs WHERE learner_id = ?").all(id);
  const contests = db.prepare("SELECT seconds, finished_at FROM contests WHERE learner_id = ?").all(id);

  const measured = runs.filter(r => r.seconds !== null);
  const byTopic = {}, byDay = {};
  for (const r of measured) {
    byTopic[r.topic_id] = (byTopic[r.topic_id] || 0) + r.seconds;
    const day = String(r.finished_at).slice(0, 10);
    byDay[day] = (byDay[day] || 0) + r.seconds;
  }
  for (const c of contests) {
    const day = String(c.finished_at).slice(0, 10);
    byDay[day] = (byDay[day] || 0) + (c.seconds || 0);
  }

  const practiceSeconds = measured.reduce((a, r) => a + r.seconds, 0);
  const contestSeconds = contests.reduce((a, c) => a + (c.seconds || 0), 0);
  const topics = Object.entries(byTopic)
    .map(([topicId, seconds]) => ({ topicId, seconds, track: trackOf(topicId) }))
    .sort((a, b) => b.seconds - a.seconds);

  res.json({
    totalSeconds: practiceSeconds + contestSeconds,
    practiceSeconds, contestSeconds,
    rounds: runs.length,
    measuredRounds: measured.length,
    unmeasuredRounds: runs.length - measured.length,
    averageRoundSeconds: measured.length ? Math.round(practiceSeconds / measured.length) : 0,
    byTopic: topics,
    byDay: Object.entries(byDay).map(([day, seconds]) => ({ day, seconds })).sort((a, b) => a.day.localeCompare(b.day))
  });
});

/* 4.2.3 — is this child ready for competition work?
   Deliberately several signals rather than one number. A child can ace timed
   arithmetic and have met no advanced material at all, and calling that "ready"
   sends them to a contest to be discouraged. Each signal is reported with the
   evidence behind it so a parent can disagree with the summary. */
api.get("/learners/:id/readiness", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const id = req.params.id;
  const learner = db.prepare("SELECT track FROM learners WHERE id = ?").get(id);
  const progress = db.prepare("SELECT topic_id, tier, best_pct FROM progress WHERE learner_id = ?").all(id);
  const contests = db.prepare("SELECT pct, expired, seconds, limit_secs FROM contests WHERE learner_id = ? ORDER BY finished_at DESC LIMIT 10").all(id);

  const advMastered = progress.filter(p => trackOf(p.topic_id) === "adv" && p.best_pct >= MASTERY.adv);
  const coreMastered = progress.filter(p => trackOf(p.topic_id) === "core" && p.best_pct >= MASTERY.core);
  const contestsRun = contests.length;
  const contestAvg = contestsRun ? Math.round(contests.reduce((a, c) => a + c.pct, 0) / contestsRun) : 0;
  // Running out of time is a different problem from getting things wrong, and
  // the advice for it is different too, so it is reported separately.
  const timedOut = contests.filter(c => c.expired).length;

  const signals = [
    { id: "core-foundation", label: "Core topics mastered", value: coreMastered.length,
      met: coreMastered.length >= 5,
      detail: "Contest problems assume the core is automatic." },
    { id: "advanced-exposure", label: "Advanced topics mastered", value: advMastered.length,
      met: advMastered.length >= 3,
      detail: "Competition material lives on the advanced track." },
    { id: "contest-practice", label: "Mock contests taken", value: contestsRun,
      met: contestsRun >= 2,
      detail: "Working under a clock is its own skill." },
    { id: "contest-accuracy", label: "Average mock contest score", value: contestAvg,
      met: contestsRun >= 2 && contestAvg >= 60,
      detail: "Measured only once there are a couple of papers to average." },
    { id: "pacing", label: "Papers finished inside the limit", value: contestsRun - timedOut,
      met: contestsRun > 0 && timedOut === 0,
      detail: "Running out of time is a pacing problem, not a maths one." }
  ];
  const met = signals.filter(s => s.met).length;

  res.json({
    track: learner ? learner.track : "core",
    ready: met >= 4,
    signalsMet: met,
    signalsTotal: signals.length,
    signals,
    // Named rather than implied: "not ready" without a next step is just a
    // closed door.
    nextStep: met >= 4 ? "Enter a timed mock contest."
      : !signals[0].met ? "Keep going on core topics until five are mastered."
      : !signals[1].met ? "Try the advanced units — switch the track to enrichment or competition."
      : !signals[2].met ? "Take a mock contest to see how the clock feels."
      : timedOut ? "Practise pacing: finish a paper inside the time limit."
      : "Keep practising contest papers to lift the average."
  });
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
  db.prepare(`INSERT INTO class_settings (class_id, leaderboard_on, display_names, updated_at)
              VALUES (?,?,?,?)
              ON CONFLICT(class_id) DO UPDATE SET
                leaderboard_on=excluded.leaderboard_on,
                display_names=excluded.display_names, updated_at=excluded.updated_at`)
    .run(req.params.id, on ? 1 : 0, names ? 1 : 0, now());
  audit(req.user.id, "class.settings.updated", `${req.params.id}:leaderboard=${on}`, req);
  res.json({ settings: { leaderboardOn: on, displayNames: names } });
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

/* ---------------- comic lessons (spec 3.2.1, 4.1.3) ----------------
   A short panel sequence with inline checks. Progress is saved after every
   panel, so leaving mid-lesson and coming back resumes rather than restarts. */
function findLesson(id) { return allLessons().find(l => l.id === id) || null; }

api.get("/lessons", (_req, res) => {
  res.json({ lessons: allLessons().map(l => ({ id: l.id, topicId: l.topicId, title: l.title, blurb: l.blurb, panelCount: l.panels.length })) });
});

api.get("/topics/:id/lesson", (req, res) => {
  const l = lessonForTopic(req.params.id);
  if (!l) return res.status(404).json({ error: "no_lesson" });
  res.json({ lesson: publicLesson(l) });
});

api.get("/learners/:id/lessons/:lessonId", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const l = findLesson(req.params.lessonId);
  if (!l) return res.status(404).json({ error: "unknown_lesson" });
  const row = db.prepare("SELECT * FROM lesson_progress WHERE learner_id=? AND lesson_id=?")
    .get(req.params.id, req.params.lessonId);
  res.json({
    lesson: publicLesson(l),
    progress: row ? { panelIndex: row.panel_index, completed: !!row.completed } : { panelIndex: 0, completed: false }
  });
});

api.post("/lessons/:id/panel", requireAuth, (req, res) => {
  const l = findLesson(req.params.id);
  if (!l) return res.status(404).json({ error: "unknown_lesson" });
  const { learnerId, panelIndex, answer } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const idx = Number(panelIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= l.panels.length)
    return res.status(400).json({ error: "bad_panel_index" });

  const panel = l.panels[idx];
  let result = null;
  if (panel.check) {
    result = checkPanel(l, idx, answer);
    /* A lesson does not gate on getting it right; it just tells the truth
       and lets the learner carry on, the same way a comic would. */
  }

  const completed = idx >= l.panels.length - 1;
  const already = db.prepare("SELECT completed FROM lesson_progress WHERE learner_id=? AND lesson_id=?")
    .get(learnerId, l.id);
  const ts = now();
  db.prepare(`INSERT INTO lesson_progress (learner_id, lesson_id, panel_index, completed, updated_at)
              VALUES (?,?,?,?,?)
              ON CONFLICT(learner_id, lesson_id) DO UPDATE SET
                panel_index=MAX(lesson_progress.panel_index, excluded.panel_index),
                completed=MAX(lesson_progress.completed, excluded.completed),
                updated_at=excluded.updated_at`)
    .run(learnerId, l.id, idx, completed ? 1 : 0, ts);

  /* Points only on the FIRST completion. Awarding "points" has no unique
     constraint (unlike badges), so without this check finishing the same
     lesson twice would pay out twice. */
  if (completed && !(already && already.completed))
    rewards.award(learnerId, "points", `lesson:${l.id}`, 15);
  audit(req.user.id, "lesson.panel", `${l.id}:${idx}`, req);
  res.json({ result, completed, nextIndex: Math.min(idx + 1, l.panels.length - 1) });
});

/* ---------------- puzzles (spec 3.2.4, 4.1.5) ----------------
   Untimed and outside the adaptive path. Hints are available one at a time;
   the solution is never given, so a puzzle stays worth coming back to. */
api.get("/puzzles", (req, res) => {
  res.json({ puzzles: PUZZLES.map(publicPuzzle) });
});

api.post("/puzzles/:id/hint", requireAuth, (req, res) => {
  const p = puzzleById(req.params.id);
  if (!p) return res.status(404).json({ error: "unknown_puzzle" });
  const level = Math.max(1, Math.min(p.hints.length, Number(req.body?.level) || 1));
  res.json({ level, hint: p.hints[level - 1], last: level >= p.hints.length });
});

api.post("/puzzles/:id/answer", requireAuth, (req, res) => {
  const p = puzzleById(req.params.id);
  if (!p) return res.status(404).json({ error: "unknown_puzzle" });
  const { learnerId, answer, hintsUsed } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });

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
  proofSessions.set(sessionId, { learnerId, proofId: proof.id, attempts: 0, startedAt: Date.now() });
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
  if (result.correct) {
    db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, seconds, finished_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), sess.learnerId, `proof:${proof.id}`, "proof", 1, 1, 100,
           elapsedSeconds(sess), now());
    rewards.award(sess.learnerId, "points", `proof:${proof.id}`, 20);
    proofSessions.delete(sessionId);
  }
  audit(req.user.id, "proof.submitted", `${proof.id}:${result.correct ? "correct" : "retry"}`, req);
  res.json({ ...result, attempts: sess.attempts, kind: proof.kind });
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
    const s = v === null || v === undefined ? "" : String(v);
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
