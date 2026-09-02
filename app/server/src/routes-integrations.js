/* Integrations (spec 9.1, 9.2, 9.4, 9.5, 4.1.11, 4.2.4, 11.5): webhooks,
   GraphQL, LTI 1.3, push and email preferences, the AI tutor, analytics,
   OneRoster import and sync, and the jobs that drive them. */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { requireAuth } from "./auth.js";
import { audit, requireRole, rateLimit } from "./security.js";
import * as webhooks from "./webhooks.js";
import { execute as graphqlExecute } from "./graphql.js";
import * as lti from "./lti.js";
import * as push from "./push.js";
import * as tutor from "./tutor.js";
import * as analytics from "./analytics.js";
import * as jobs from "./jobs.js";
import * as notify from "./notify.js";
import { ownLearner, resolveQuestion, onRunRecorded, describe } from "./helpers.js";

export const integrations = Router();
const requireAdmin = requireRole("admin");
const requireTeacher = requireRole("teacher", "admin");

/* Events flow out through webhooks and into analytics. */
onRunRecorded((learnerId, r) => {
  webhooks.emit(learnerId, "run.recorded", { topicId: r.topicId, topic: describe(r.topicId).name, tier: r.tier, score: r.score, total: r.total, pct: r.pct });
  analytics.track("run", { topicId: r.topicId, tier: r.tier, pct: r.pct }, { learnerId });
});

/* ---------------- webhooks (9.2) ---------------- */
integrations.get("/webhooks/events", (_req, res) => res.json({ events: webhooks.EVENTS }));
integrations.get("/webhooks", requireAuth, (req, res) => res.json({ webhooks: webhooks.listFor(req.user.id) }));
integrations.post("/webhooks", requireAuth, (req, res) => {
  if (webhooks.listFor(req.user.id).length >= 10) return res.status(400).json({ error: "too_many_webhooks" });
  const r = webhooks.register(req.user.id, req.body || {});
  if (r.error) return res.status(400).json(r);
  audit(req.user.id, "webhook.created", r.id, req);
  res.json({ webhook: r });      // the secret is shown once, here
});
integrations.delete("/webhooks/:id", requireAuth, (req, res) => res.json({ deleted: webhooks.remove(req.user.id, req.params.id) }));
integrations.get("/webhooks/:id/deliveries", requireAuth, (req, res) => res.json({ deliveries: webhooks.deliveriesFor(req.user.id, req.params.id) }));
integrations.post("/webhooks/test", requireAuth, (req, res) => {
  const l = db.prepare("SELECT id FROM learners WHERE user_id=? LIMIT 1").get(req.user.id);
  if (!l) return res.status(400).json({ error: "no_learner" });
  res.json({ queued: webhooks.emit(l.id, "run.recorded", { test: true, topicId: "k-count", pct: 100 }) });
});

/* ---------------- GraphQL (9.2) ---------------- */
integrations.post("/graphql", rateLimit({ windowMs: 60_000, max: 120 }), async (req, res) => {
  const { query, variables } = req.body || {};
  const result = await graphqlExecute({ query, variables, user: req.user });
  res.json(result);
});
integrations.get("/graphql", (_req, res) => res.json({ ok: true, hint: "POST { query, variables } here. Read-only; sign in for learner data." }));

/* ---------------- LTI 1.3 (9.5) ---------------- */
const publicBase = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
integrations.get("/lti/jwks", (_req, res) => res.json(lti.toolJwks()));
integrations.get("/lti/config", (req, res) => res.json(lti.toolConfig(publicBase(req))));
const ltiLogin = (req, res) => {
  const r = lti.beginLogin({ ...req.query, ...(req.body || {}) }, `${publicBase(req)}/api/lti/launch`);
  if (r.error) return res.status(400).json({ error: r.error });
  res.redirect(302, r.redirect);
};
integrations.get("/lti/login", ltiLogin);
integrations.post("/lti/login", ltiLogin);
integrations.post("/lti/launch", async (req, res) => {
  try {
    const r = await lti.completeLaunch(req.body || {});
    res.cookie("sid", r.session.id, { httpOnly: true, sameSite: "none", secure: process.env.NODE_ENV === "production", path: "/",
                                      expires: new Date(r.session.expires) });
    audit(r.userId, "lti.launch", `${r.instructor ? "instructor" : "learner"}:${r.classId || "-"}`, req);
    const target = /^https?:/.test(r.target) ? new URL(r.target).pathname : r.target;
    res.redirect(302, target.startsWith("/") ? target : "/");
  } catch (e) {
    audit(null, "lti.launch.rejected", String(e.message).slice(0, 120), req);
    res.status(401).json({ error: "lti_launch_rejected", detail: e.message });
  }
});
integrations.post("/admin/lti/platforms", requireAuth, requireAdmin, (req, res) => {
  const r = lti.registerPlatform(req.body || {});
  if (r.error) return res.status(400).json(r);
  audit(req.user.id, "lti.platform.registered", r.id, req);
  res.json({ platform: { id: r.id } });
});
integrations.get("/admin/lti/platforms", requireAuth, requireAdmin, (_req, res) => res.json({ platforms: lti.platforms() }));

/* ---------------- push and email preferences (9.4) ---------------- */
integrations.get("/push/vapid-public-key", (_req, res) => res.json({ publicKey: push.vapidKeys().publicKey }));
integrations.post("/me/push/subscribe", requireAuth, (req, res) => {
  const r = push.subscribe(req.user.id, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true, subscriptions: push.subscriptionsFor(req.user.id).length });
});
integrations.delete("/me/push/subscribe", requireAuth, (req, res) => res.json({ deleted: push.unsubscribe(req.user.id, req.body?.endpoint) }));
integrations.get("/me/preferences", requireAuth, (req, res) => res.json({ preferences: jobs.prefsFor(req.user.id),
  channels: { email: !!process.env.SMTP_HOST, push: true, inApp: true } }));
integrations.put("/me/preferences", requireAuth, (req, res) => res.json({ preferences: jobs.setPrefs(req.user.id, req.body || {}) }));
integrations.get("/me/weekly-summary", requireAuth, (req, res) => res.json(jobs.summaryFor(req.user.id)));

/* ---------------- AI tutor (4.1.11) ---------------- */
const tutorLimit = rateLimit({ windowMs: 60_000, max: 30, key: req => `tutor:${req.user?.id || req.ip}` });
integrations.post("/tutor/chat", requireAuth, tutorLimit, async (req, res) => {
  const { learnerId, questionId, message, lastAnswer, history } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const resolved = resolveQuestion(questionId);
  if (!resolved) return res.status(400).json({ error: "unknown_question" });
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "empty_message" });
  const hist = Array.isArray(history) ? history.slice(-10).filter(h => h && ["tutor", "learner"].includes(h.role) && typeof h.text === "string") : [];
  const r = await tutor.chat({ learnerId, q: resolved.q, message, lastAnswer, history: hist });
  audit(req.user.id, "tutor.chat", `${questionId}:${r.source}`, req);
  res.json(r);
});
integrations.get("/tutor/status", (_req, res) => res.json({
  provider: process.env.ANTHROPIC_API_KEY ? "anthropic" : "rules", model: process.env.TUTOR_MODEL || "claude-opus-5",
  timeoutMs: tutor.TIMEOUT_MS, safety: ["input filter", "answer redaction", "no personal data sent"] }));

/* ---------------- analytics (11.5) ---------------- */
integrations.get("/admin/analytics", requireAuth, requireAdmin, (req, res) => {
  audit(req.user.id, "admin.analytics.read", null, req);
  res.json(analytics.report(Number(req.query.days) || 30));
});

/* ---------------- jobs, runnable on demand by an admin ---------------- */
integrations.post("/admin/jobs/:job", requireAuth, requireAdmin, async (req, res) => {
  const job = req.params.job;
  try {
    let r;
    if (job === "webhooks") r = await webhooks.drain();
    else if (job === "deliver") r = await jobs.deliverNotifications();
    else if (job === "weekly-summary") r = jobs.weeklySummaries({ force: req.body?.force === true });
    else if (job === "analytics") r = analytics.aggregateDay(req.body?.day || undefined);
    else if (job === "retention") r = jobs.retentionSweep();
    else return res.status(404).json({ error: "unknown_job" });
    audit(req.user.id, "admin.job", job, req);
    res.json({ job, result: r });
  } catch (e) { res.status(500).json({ error: "job_failed", detail: String(e.message || e) }); }
});

/* ---------------- OneRoster (9.1) ----------------
   The standard Clever and ClassLink both speak. A CSV bundle (classes.csv,
   users.csv, enrollments.csv) or a REST sync with client-credentials OAuth2
   provisions classes and roster entries under a teacher's account; parents
   still claim their child with the code, as with any roster import. */
function provisionRoster(teacherId, { classes, users, enrollments }) {
  const byUser = new Map(users.map(u => [u.sourcedId, u]));
  const made = [];
  for (const cls of classes) {
    let row = db.prepare("SELECT id FROM classes WHERE teacher_id=? AND name=?").get(teacherId, cls.title);
    let classId = row?.id;
    if (!classId) {
      classId = randomUUID();
      db.prepare("INSERT INTO classes (id, teacher_id, name, join_code, created_at) VALUES (?,?,?,?,?)")
        .run(classId, teacherId, String(cls.title).slice(0, 60), randomUUID().slice(0, 6).toUpperCase(), now());
    }
    let students = 0;
    for (const e of enrollments.filter(e => e.classSourcedId === cls.sourcedId && /student/i.test(e.role))) {
      const u = byUser.get(e.userSourcedId);
      if (!u) continue;
      const name = [u.givenName, u.familyName].filter(Boolean).join(" ").slice(0, 40) || u.username || u.sourcedId;
      const existing = db.prepare("SELECT id FROM roster_entries WHERE class_id=? AND external_id=?").get(classId, u.sourcedId);
      if (existing) db.prepare("UPDATE roster_entries SET name=? WHERE id=?").run(name, existing.id);
      else db.prepare("INSERT INTO roster_entries (id, class_id, name, external_id, guardian_email, claim_code, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(randomUUID(), classId, name, u.sourcedId, null, randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(), now());
      students++;
    }
    made.push({ classId, name: cls.title, students });
  }
  return made;
}

const csvRows = text => {
  const lines = String(text || "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const split = l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()).filter((_, i, a) => i < a.length - 1 || a[i] !== "");
  const header = split(lines[0]);
  return lines.slice(1).map(l => { const c = split(l); return Object.fromEntries(header.map((h, i) => [h, c[i] ?? ""])); });
};

integrations.post("/classes/import/oneroster", requireAuth, requireTeacher, (req, res) => {
  const { classes, users, enrollments } = req.body || {};
  if (!classes || !users || !enrollments) return res.status(400).json({ error: "need_classes_users_enrollments" });
  const bundle = { classes: csvRows(classes), users: csvRows(users), enrollments: csvRows(enrollments) };
  if (!bundle.classes.length || !bundle.classes[0].sourcedId || !bundle.classes[0].title) return res.status(400).json({ error: "bad_classes_csv" });
  const made = provisionRoster(req.user.id, bundle);
  audit(req.user.id, "oneroster.imported", `${made.length} classes`, req);
  res.json({ classes: made });
});

/* REST sync: OAuth2 client credentials, then the three collections. */
export async function oneRosterSync({ baseUrl, clientId, clientSecret, fetchImpl = fetch }) {
  const tokenRes = await fetchImpl(`${baseUrl}/token`, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64") },
    body: "grant_type=client_credentials&scope=https://purl.imsglobal.org/spec/or/v1p1/scope/roster-core.readonly" });
  if (!tokenRes.ok) throw new Error(`token request failed: ${tokenRes.status}`);
  const { access_token } = await tokenRes.json();
  const get = async path => {
    const r = await fetchImpl(`${baseUrl}/ims/oneroster/v1p1/${path}`, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  };
  const [c, u, e] = await Promise.all([get("classes"), get("users"), get("enrollments")]);
  return {
    classes: (c.classes || []).map(x => ({ sourcedId: x.sourcedId, title: x.title })),
    users: (u.users || []).map(x => ({ sourcedId: x.sourcedId, givenName: x.givenName, familyName: x.familyName, username: x.username, role: x.role })),
    enrollments: (e.enrollments || []).map(x => ({ classSourcedId: x.class?.sourcedId, userSourcedId: x.user?.sourcedId, role: x.role }))
  };
}

integrations.post("/admin/oneroster/sync", requireAuth, requireAdmin, async (req, res) => {
  const { baseUrl, clientId, clientSecret, teacherEmail } = req.body || {};
  const teacher = db.prepare("SELECT id FROM users WHERE email=? AND role IN ('teacher','admin')").get(String(teacherEmail || "").toLowerCase());
  if (!teacher) return res.status(404).json({ error: "unknown_teacher" });
  try {
    const bundle = await oneRosterSync({ baseUrl: String(baseUrl).replace(/\/$/, ""), clientId, clientSecret });
    const made = provisionRoster(teacher.id, bundle);
    audit(req.user.id, "oneroster.synced", `${made.length} classes`, req);
    res.json({ classes: made, pulled: { classes: bundle.classes.length, users: bundle.users.length, enrollments: bundle.enrollments.length } });
  } catch (e) { res.status(502).json({ error: "sync_failed", detail: String(e.message || e) }); }
});
