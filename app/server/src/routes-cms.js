/* Content management (spec 8.1, 8.2, 8.5, 3.5.5): drafts from the web
   authoring tool, validated by the same linter as shipped content, previewed
   exactly as a student would see them, and reviewed by an admin. Shipped
   content is source under review; the approvals file records who signed it.
   This module never writes to the live banks. */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { requireAuth } from "./auth.js";
import { audit, requireRole } from "./security.js";
import { lintQuestion, lintLesson, lintDiversity } from "../../../tools/lint-content.mjs";
import { status as approvalStatus, loadApprovals } from "../../../tools/content-approve.mjs";
import { ASSETS, LICENCES } from "../../shared/assets.mjs";
import { ART_KINDS } from "../../shared/lessons.mjs";
import { SECS } from "../../shared/questions.mjs";
import { TOPIC_NAME, gradeAnswer, hintLadder } from "./helpers.js";
import { checkPuzzle } from "../../shared/puzzles.mjs";

export const cms = Router();
const requireAuthor = requireRole("teacher", "admin");
const requireAdmin = requireRole("admin");
const KINDS = ["question", "puzzle", "lesson"];

/* Validate a draft body of a given kind. Same rules as the CLI linter. */
export function lintDraft(kind, body, topicId) {
  const grade = topicId ? TOPIC_NAME.get(topicId)?.gradeKey || null : null;
  if (kind === "question") {
    const r = lintQuestion(body, "draft", grade, new Map());
    if (topicId && !TOPIC_NAME.has(topicId)) r.errors.push("draft: unknown topic");
    const d = lintDiversity([{ where: "draft", text: [body.q, body.expl, body.hint, ...(body.opts || [])].join(" ") }]);
    return { errors: [...r.errors, ...d.errors], warnings: [...r.warnings, ...d.warnings] };
  }
  if (kind === "puzzle") {
    const errors = [], warnings = [];
    if (!body.title) errors.push("draft: no title");
    if (!body.prompt || body.prompt.length < 20) errors.push("draft: prompt too short");
    if (!Array.isArray(body.accepts) || !body.accepts.length || !body.accepts.every(Number.isFinite)) errors.push("draft: accepts must list numeric answers");
    if (!Array.isArray(body.hints) || body.hints.length < 2) errors.push("draft: at least two hints");
    if (Array.isArray(body.hints) && Array.isArray(body.accepts) && body.hints.some(h => body.accepts.some(a => String(h).includes(String(a))))) warnings.push("draft: a hint contains the answer");
    if (![1, 2, 3, 4].includes(body.difficulty)) errors.push("draft: difficulty must be 1-4");
    const d = lintDiversity([{ where: "draft", text: [body.prompt, ...(body.hints || [])].join(" ") }]);
    return { errors: [...errors, ...d.errors], warnings: [...warnings, ...d.warnings] };
  }
  if (kind === "lesson") {
    const r = lintLesson({ id: body.id || "draft", grade, panels: body.panels || [] }, ART_KINDS);
    if (!body.title) r.errors.push("draft: no title");
    return r;
  }
  return { errors: ["unknown kind"], warnings: [] };
}

cms.get("/cms/meta", requireAuth, requireAuthor, (_req, res) => {
  res.json({ kinds: KINDS, sections: SECS, artKinds: ART_KINDS,
             types: ["in", "mc", "multi", "order", "pair", "plot"],
             topics: [...TOPIC_NAME].map(([id, t]) => ({ id, name: t.name, grade: t.grade, unit: t.unit })) });
});

cms.post("/cms/lint", requireAuth, requireAuthor, (req, res) => {
  const { kind, body, topicId } = req.body || {};
  if (!KINDS.includes(kind) || !body || typeof body !== "object") return res.status(400).json({ error: "bad_draft" });
  res.json(lintDraft(kind, body, topicId));
});

/* Preview as a student: the public form of the draft plus a grading endpoint
   so the author can try answers the way a learner would. */
cms.post("/cms/preview", requireAuth, requireAuthor, (req, res) => {
  const { kind, body } = req.body || {};
  if (kind === "question") {
    const q = body || {};
    return res.json({ question: { id: "draft", sec: q.sec, secName: SECS[q.sec] || "Problem", type: q.type, q: q.q,
      opts: ["mc", "multi"].includes(q.type) ? q.opts : undefined, items: q.type === "order" ? q.items : undefined,
      mono: !!q.mono, hint: q.hint || null, fig: q.fig || null, grid: q.type === "plot" ? (q.grid || { min: -10, max: 10 }) : undefined },
      hints: (() => { try { return hintLadder(q); } catch { return []; } })() });
  }
  if (kind === "puzzle") return res.json({ puzzle: { id: "draft", title: body.title, prompt: body.prompt, difficulty: body.difficulty, hintCount: (body.hints || []).length } });
  if (kind === "lesson") return res.json({ lesson: { ...body, panelList: (body.panels || []).map((p, i) => ({ index: i, art: p.art, alt: p.alt, text: p.text,
    check: p.check ? { type: p.check.type, q: p.check.q, opts: p.check.type === "mc" ? p.check.opts : undefined } : null })) } });
  res.status(400).json({ error: "bad_draft" });
});

cms.post("/cms/preview/answer", requireAuth, requireAuthor, (req, res) => {
  const { kind, body, answer } = req.body || {};
  try {
    if (kind === "question") { const r = gradeAnswer(body, answer); return res.json({ correct: r.ok, correctAnswer: r.correctAnswer, explanation: body.expl }); }
    if (kind === "puzzle") return res.json({ correct: checkPuzzle(body, answer) });
  } catch (e) { return res.status(400).json({ error: "cannot_grade", detail: e.message }); }
  res.status(400).json({ error: "bad_draft" });
});

/* ---------- drafts ---------- */
const own = (req, id) => db.prepare("SELECT * FROM content_drafts WHERE id=? AND author_id=?").get(id, req.user.id);
const publicDraft = d => ({ id: d.id, kind: d.kind, topicId: d.topic_id, body: JSON.parse(d.body), status: d.status, version: d.version,
  reviewNote: d.review_note, reviewedBy: d.reviewed_by, createdAt: d.created_at, updatedAt: d.updated_at });

cms.get("/cms/drafts", requireAuth, requireAuthor, (req, res) => {
  const rows = req.user.role === "admin" && req.query.all === "1"
    ? db.prepare("SELECT * FROM content_drafts ORDER BY updated_at DESC LIMIT 200").all()
    : db.prepare("SELECT * FROM content_drafts WHERE author_id=? ORDER BY updated_at DESC LIMIT 200").all(req.user.id);
  res.json({ drafts: rows.map(publicDraft) });
});

cms.post("/cms/drafts", requireAuth, requireAuthor, (req, res) => {
  const { kind, body, topicId } = req.body || {};
  if (!KINDS.includes(kind) || !body || typeof body !== "object") return res.status(400).json({ error: "bad_draft" });
  const lint = lintDraft(kind, body, topicId);
  const id = randomUUID();
  db.prepare(`INSERT INTO content_drafts (id, author_id, kind, topic_id, body, status, version, created_at, updated_at) VALUES (?,?,?,?,?,'draft',1,?,?)`)
    .run(id, req.user.id, kind, topicId || null, JSON.stringify(body).slice(0, 60_000), now(), now());
  audit(req.user.id, "cms.draft.created", `${kind}:${id}`, req);
  res.json({ draft: publicDraft(own(req, id)), lint });
});

cms.put("/cms/drafts/:id", requireAuth, requireAuthor, (req, res) => {
  const d = own(req, req.params.id);
  if (!d) return res.status(404).json({ error: "unknown_draft" });
  if (d.status === "approved") return res.status(409).json({ error: "approved_drafts_are_frozen" });
  const { body, topicId } = req.body || {};
  if (!body || typeof body !== "object") return res.status(400).json({ error: "bad_draft" });
  db.prepare("UPDATE content_drafts SET body=?, topic_id=?, version=version+1, status='draft', updated_at=? WHERE id=?")
    .run(JSON.stringify(body).slice(0, 60_000), topicId || d.topic_id, now(), d.id);
  res.json({ draft: publicDraft(own(req, d.id)), lint: lintDraft(d.kind, body, topicId || d.topic_id) });
});

/* Submitting for review requires a clean lint: the automated checks are the
   first gate of the QA workflow (8.5). */
cms.post("/cms/drafts/:id/submit", requireAuth, requireAuthor, (req, res) => {
  const d = own(req, req.params.id);
  if (!d) return res.status(404).json({ error: "unknown_draft" });
  const lint = lintDraft(d.kind, JSON.parse(d.body), d.topic_id);
  if (lint.errors.length) return res.status(400).json({ error: "lint_errors", lint });
  db.prepare("UPDATE content_drafts SET status='submitted', updated_at=? WHERE id=?").run(now(), d.id);
  audit(req.user.id, "cms.draft.submitted", d.id, req);
  res.json({ draft: publicDraft(own(req, d.id)), lint });
});

cms.post("/cms/drafts/:id/review", requireAuth, requireAdmin, (req, res) => {
  const d = db.prepare("SELECT * FROM content_drafts WHERE id=?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "unknown_draft" });
  const { decision, note } = req.body || {};
  if (!["approved", "changes_requested"].includes(decision)) return res.status(400).json({ error: "bad_decision" });
  if (d.status !== "submitted") return res.status(409).json({ error: "not_submitted" });
  db.prepare("UPDATE content_drafts SET status=?, review_note=?, reviewed_by=?, updated_at=? WHERE id=?")
    .run(decision, String(note || "").slice(0, 1000), req.user.id, now(), d.id);
  audit(req.user.id, "cms.draft.reviewed", `${d.id}:${decision}`, req);
  res.json({ draft: publicDraft(db.prepare("SELECT * FROM content_drafts WHERE id=?").get(d.id)) });
});

/* Export an approved draft as source a maintainer can paste into a bank. */
cms.get("/cms/drafts/:id/export", requireAuth, requireAuthor, (req, res) => {
  const d = req.user.role === "admin" ? db.prepare("SELECT * FROM content_drafts WHERE id=?").get(req.params.id) : own(req, req.params.id);
  if (!d) return res.status(404).json({ error: "unknown_draft" });
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${d.kind}-${d.id.slice(0, 8)}.json"`);
  res.send(JSON.stringify({ kind: d.kind, topicId: d.topic_id, status: d.status, version: d.version, body: JSON.parse(d.body) }, null, 2));
});

/* ---------- assets and approvals (8.2, 3.5.5) ---------- */
cms.get("/cms/assets", requireAuth, requireAuthor, (req, res) => {
  const tag = req.query.tag ? String(req.query.tag) : null;
  res.json({ assets: ASSETS.filter(a => !tag || a.tags.includes(tag)), licences: LICENCES });
});
cms.get("/cms/approvals", requireAuth, requireAuthor, (req, res) => {
  const s = approvalStatus(loadApprovals(), { requireEducator: req.query.educator === "1" });
  res.json({ ok: s.ok, units: s.rows, problems: s.problems.length });
});
