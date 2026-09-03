/* Teacher portal depth (spec 4.3.1, 4.3.2, 4.3.4, 4.3.5, 7.2, 7.6, 13.12, 4.1.9):
   roster import with parent-claimed codes, groups and accommodations,
   configurable thresholds, the gifted-and-talented report, unit tests across
   a whole unit, contest leaderboards and percentiles. */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { requireAuth, createLearner } from "./auth.js";
import { encrypt } from "./crypto.js";
import { audit, requireRole } from "./security.js";
import * as bkt from "./bkt.js";
import * as rewards from "./rewards.js";
import { CURRICULUM } from "../../shared/curriculum.mjs";
import { QUESTIONS } from "../../shared/questions.mjs";
import { CONTEST_FORMATS } from "./contest.js";
import { ownLearner, trackOf, TOPIC_NAME, describe, publicQuestion, gradeAnswer, recordRun, tierOf } from "./helpers.js";
import { thresholdFor, thresholdsFor, validThreshold, masteryState, accommodationsFor, ACCOMMODATION_DEFAULTS } from "./policy.js";
import { readinessFor } from "./routes-parent.js";

export const teacher = Router();
const requireTeacher = requireRole("teacher", "admin");
const ownClass = (req, id) => db.prepare("SELECT * FROM classes WHERE id=? AND teacher_id=?").get(id, req.user.id);
const inClass = (classId, learnerId) => db.prepare("SELECT 1 FROM class_members WHERE class_id=? AND learner_id=?").get(classId, learnerId);

/* ---------------- roster import (4.3.1) ----------------
   A CSV of names becomes roster entries, each with a claim code. The PARENT
   claims the entry against their own learner (or creates one from it), so
   a teacher still never pulls a child in unilaterally — the import saves
   typing and gives the parent a code instead of a class join code. Accepts a
   plain "name" column or OneRoster's givenName/familyName, plus optional
   external id and guardian email. */
export function parseRosterCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { error: "csv_needs_header_and_rows" };
  const cell = line => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const header = cell(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...names) => names.map(n => header.indexOf(n)).find(i => i >= 0);
  const iName = col("name", "studentname", "learner"), iGiven = col("givenname", "firstname"), iFamily = col("familyname", "lastname", "surname");
  const iExt = col("sourcedid", "externalid", "studentid", "id"), iEmail = col("guardianemail", "parentemail", "email");
  if (iName === undefined && iGiven === undefined) return { error: "no_name_column" };
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = cell(line);
    const name = iName !== undefined ? c[iName] : [c[iGiven], iFamily !== undefined ? c[iFamily] : ""].filter(Boolean).join(" ");
    if (!name) continue;
    rows.push({ name: name.slice(0, 40), externalId: iExt !== undefined ? c[iExt] || null : null,
                guardianEmail: iEmail !== undefined ? (c[iEmail] || null) : null });
  }
  return { rows };
}

const claimCode = () => randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

teacher.post("/classes/:id/roster/import", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const parsed = parseRosterCsv(req.body?.csv);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (parsed.rows.length > 200) return res.status(400).json({ error: "too_many_rows" });
  const ins = db.prepare(`INSERT INTO roster_entries (id, class_id, name, external_id, guardian_email, claim_code, created_at)
                          VALUES (?,?,?,?,?,?,?)`);
  const entries = [];
  for (const r of parsed.rows) {
    /* Re-importing the same external id updates the name rather than duplicating. */
    const existing = r.externalId
      ? db.prepare("SELECT id, claim_code FROM roster_entries WHERE class_id=? AND external_id=?").get(cls.id, r.externalId) : null;
    if (existing) {
      db.prepare("UPDATE roster_entries SET name=?, guardian_email=? WHERE id=?").run(encrypt(r.name), encrypt(r.guardianEmail), existing.id);
      entries.push({ id: existing.id, name: r.name, claimCode: existing.claim_code, updated: true });
      continue;
    }
    const id = randomUUID(), code = claimCode();
    ins.run(id, cls.id, encrypt(r.name), r.externalId, encrypt(r.guardianEmail), code, now());
    entries.push({ id, name: r.name, claimCode: code, updated: false });
  }
  audit(req.user.id, "roster.imported", `${cls.id}:${entries.length}`, req);
  res.json({ imported: entries.length, entries });
});

teacher.get("/classes/:id/roster", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const rows = db.prepare(`SELECT r.*, l.name learner_name FROM roster_entries r LEFT JOIN learners l ON l.id=r.learner_id
                           WHERE r.class_id=?`).all(cls.id).sort((x, y) => x.name.localeCompare(y.name));
  res.json({ roster: rows.map(r => ({ id: r.id, name: r.name, externalId: r.external_id, guardianEmail: r.guardian_email,
    claimCode: r.claimed_at ? null : r.claim_code, claimed: !!r.claimed_at, learnerName: r.learner_name })) });
});

/* A parent claims a roster entry: with a learnerId it links an existing
   learner; without one it creates a learner from the roster name. */
teacher.post("/classes/claim", requireAuth, (req, res) => {
  const { claimCode: code, learnerId, beast } = req.body || {};
  const entry = db.prepare("SELECT * FROM roster_entries WHERE claim_code=?").get(String(code || "").toUpperCase());
  if (!entry) return res.status(404).json({ error: "unknown_claim_code" });
  if (entry.claimed_at) return res.status(409).json({ error: "already_claimed" });
  let lid = learnerId;
  if (lid) { if (!ownLearner(req, lid)) return res.status(403).json({ error: "not_your_learner" }); }
  else {
    lid = randomUUID();
    createLearner({ id: lid, userId: req.user.id, name: entry.name, beast: beast || "vex" });
  }
  db.prepare("UPDATE roster_entries SET learner_id=?, claimed_at=? WHERE id=?").run(lid, now(), entry.id);
  db.prepare("INSERT OR IGNORE INTO class_members (class_id, learner_id, joined_at) VALUES (?,?,?)").run(entry.class_id, lid, now());
  const cls = db.prepare("SELECT id, name FROM classes WHERE id=?").get(entry.class_id);
  audit(req.user.id, "roster.claimed", entry.id, req);
  res.json({ joined: { classId: cls.id, name: cls.name }, learnerId: lid, created: !learnerId });
});

/* ---------------- groups (4.3.2) ---------------- */
teacher.post("/classes/:id/groups", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const name = String(req.body?.name || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "missing_name" });
  const track = ["core", "enrichment", "competition"].includes(req.body?.track) ? req.body.track : null;
  const id = randomUUID();
  db.prepare("INSERT INTO class_groups (id, class_id, name, track, created_at) VALUES (?,?,?,?,?)").run(id, cls.id, name, track, now());
  res.json({ group: { id, name, track, members: [] } });
});

teacher.post("/classes/:id/groups/:groupId/members", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const g = db.prepare("SELECT * FROM class_groups WHERE id=? AND class_id=?").get(req.params.groupId, cls.id);
  if (!g) return res.status(404).json({ error: "unknown_group" });
  const { learnerId } = req.body || {};
  if (!inClass(cls.id, learnerId)) return res.status(404).json({ error: "not_in_class" });
  db.prepare("INSERT OR IGNORE INTO group_members (group_id, learner_id) VALUES (?,?)").run(g.id, learnerId);
  /* A group with a track sets the track for the learners placed in it. */
  if (g.track) db.prepare("UPDATE learners SET track=? WHERE id=?").run(g.track, learnerId);
  res.json({ groupId: g.id, learnerId, track: g.track });
});

teacher.get("/classes/:id/groups", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const groups = db.prepare("SELECT * FROM class_groups WHERE class_id=? ORDER BY created_at").all(cls.id).map(g => ({
    id: g.id, name: g.name, track: g.track,
    members: db.prepare("SELECT l.id, l.name FROM group_members gm JOIN learners l ON l.id=gm.learner_id WHERE gm.group_id=?").all(g.id)
  }));
  res.json({ groups });
});

/* ---------------- accommodations (4.3.2) ---------------- */
teacher.put("/classes/:id/learners/:learnerId/accommodations", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  if (!inClass(cls.id, req.params.learnerId)) return res.status(404).json({ error: "not_in_class" });
  const b = req.body || {};
  const extra = Math.max(0, Math.min(100, Number(b.extraTimePct) || 0));
  db.prepare(`INSERT INTO accommodations (learner_id, class_id, extra_time_pct, hints_in_checks, shorter_checks, read_aloud, notes, updated_at)
              VALUES (?,?,?,?,?,?,?,?)
              ON CONFLICT(learner_id, class_id) DO UPDATE SET extra_time_pct=excluded.extra_time_pct,
                hints_in_checks=excluded.hints_in_checks, shorter_checks=excluded.shorter_checks,
                read_aloud=excluded.read_aloud, notes=excluded.notes, updated_at=excluded.updated_at`)
    .run(req.params.learnerId, cls.id, extra, b.hintsInChecks === true ? 1 : 0, b.shorterChecks === true ? 1 : 0,
         b.readAloud === true ? 1 : 0, String(b.notes || "").slice(0, 500), now());
  audit(req.user.id, "accommodations.set", req.params.learnerId, req);
  res.json({ accommodations: accommodationsFor(req.params.learnerId) });
});

/* The learner's own account can read (not set) what applies to them. */
teacher.get("/learners/:id/accommodations", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  res.json({ accommodations: accommodationsFor(req.params.id), defaults: ACCOMMODATION_DEFAULTS });
});

/* ---------------- configurable thresholds (7.6) ---------------- */
teacher.put("/classes/:id/thresholds", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const { core, adv } = req.body || {};
  for (const v of [core, adv]) if (v != null && !validThreshold(v)) return res.status(400).json({ error: "threshold_out_of_range" });
  db.prepare(`INSERT INTO class_settings (class_id, threshold_core, threshold_adv, updated_at) VALUES (?,?,?,?)
              ON CONFLICT(class_id) DO UPDATE SET threshold_core=excluded.threshold_core,
                threshold_adv=excluded.threshold_adv, updated_at=excluded.updated_at`)
    .run(cls.id, core ?? null, adv ?? null, now());
  audit(req.user.id, "class.thresholds.set", `${cls.id}:${core}/${adv}`, req);
  res.json({ thresholds: { core: core ?? null, adv: adv ?? null } });
});

teacher.get("/learners/:id/thresholds", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  res.json(thresholdsFor(req.params.id));
});

/* Mastery with decay, per topic, for the learner's own account. */
teacher.get("/learners/:id/mastery", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const rows = db.prepare("SELECT topic_id, MAX(best_pct) b FROM progress WHERE learner_id=? GROUP BY topic_id").all(req.params.id);
  res.json({ topics: rows.map(r => ({ ...describe(r.topic_id), ...masteryState(req.params.id, r.topic_id, r.b) })) });
});

/* ---------------- gifted and talented report (4.3.4) ---------------- */
function giftedRows(cls) {
  const members = db.prepare(`SELECT l.id, l.name, l.track FROM class_members m JOIN learners l ON l.id=m.learner_id
                              WHERE m.class_id=? ORDER BY l.name`).all(cls.id);
  return members.map(m => {
    const r = readinessFor(m.id);
    const known = bkt.allFor(m.id).filter(bkt.isKnown).length;
    const best = db.prepare("SELECT MAX(pct) p FROM contests WHERE learner_id=?").get(m.id).p || 0;
    const pctl = best ? percentileFor(null, best, m.id) : null;
    const score = r.mastery.advanced * 3 + known + (best >= 80 ? 3 : 0) + (r.mastery.core >= 5 ? 2 : 0);
    return {
      learnerId: m.id, name: m.name, track: m.track,
      advancedMastered: r.mastery.advanced, coreMastered: r.mastery.core, knownSkills: known,
      contestBest: best, contestPercentile: pctl, level: r.level,
      indicator: score >= 8 ? "strong" : score >= 4 ? "emerging" : "none",
      recommendation: score >= 8 ? "Nominate for the competition track and a mentor."
        : score >= 4 ? "Offer enrichment: advanced strands alongside core."
        : "Keep on core; revisit next term."
    };
  }).sort((a, b) => (b.advancedMastered - a.advancedMastered) || (b.knownSkills - a.knownSkills));
}

teacher.get("/classes/:id/gifted.csv", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const rows = giftedRows(cls);
  const cols = ["name", "track", "advancedMastered", "coreMastered", "knownSkills", "contestBest", "contestPercentile", "level", "indicator", "recommendation"];
  const esc = v => { let s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  audit(req.user.id, "class.gifted.csv", cls.id, req);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="gifted-report.csv"');
  res.send([cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n"));
});

teacher.get("/classes/:id/gifted.html", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const rows = giftedRows(cls);
  const esc = t => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  audit(req.user.id, "class.gifted.html", cls.id, req);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gifted and talented report — ${esc(cls.name)}</title>
<style>body{font-family:Georgia,serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#17263F}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #D5DEEC;padding:.4rem .3rem;text-align:left;font-size:.9rem}
th{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#5A6B87}.strong{color:#147A46;font-weight:bold}.emerging{color:#9A6300}
@media print{body{margin:0}}</style></head><body>
<h1>Gifted and talented report</h1><p>${esc(cls.name)} · ${new Date().toLocaleDateString()}</p>
<p>Indicators rest on evidence in the record: advanced topics mastered, skills the knowledge model is confident in, and timed-paper results. They are a prompt for a conversation, not a verdict.</p>
<table><thead><tr><th>Learner</th><th>Track</th><th>Advanced mastered</th><th>Core mastered</th><th>Known skills</th><th>Best paper</th><th>Percentile</th><th>Indicator</th><th>Recommendation</th></tr></thead><tbody>
${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.track)}</td><td>${r.advancedMastered}</td><td>${r.coreMastered}</td><td>${r.knownSkills}</td><td>${r.contestBest ? r.contestBest + "%" : "—"}</td><td>${r.contestPercentile ?? "—"}</td><td class="${r.indicator}">${r.indicator}</td><td>${esc(r.recommendation)}</td></tr>`).join("")}
</tbody></table><p>Print this page to save it as a PDF.</p></body></html>`);
});

/* ---------------- competition team detail (4.3.5) ---------------- */
teacher.get("/classes/:id/teams/:teamId", requireAuth, requireTeacher, (req, res) => {
  const cls = ownClass(req, req.params.id);
  if (!cls) return res.status(403).json({ error: "not_your_class" });
  const team = db.prepare("SELECT * FROM teams WHERE id=? AND class_id=?").get(req.params.teamId, cls.id);
  if (!team) return res.status(404).json({ error: "unknown_team" });
  const members = db.prepare("SELECT l.id, l.name FROM team_members tm JOIN learners l ON l.id=tm.learner_id WHERE tm.team_id=?").all(team.id)
    .map(m => {
      const byFormat = {};
      for (const c of db.prepare("SELECT format, pct FROM contests WHERE learner_id=?").all(m.id))
        byFormat[c.format] = Math.max(byFormat[c.format] || 0, c.pct);
      const strengths = db.prepare("SELECT topic_id, MAX(best_pct) b FROM progress WHERE learner_id=? GROUP BY topic_id").all(m.id)
        .filter(r => trackOf(r.topic_id) === "adv" && r.b >= thresholdFor(r.topic_id, m.id)).map(r => describe(r.topic_id).name);
      return { learnerId: m.id, name: m.name, bestByFormat: byFormat, advancedStrengths: strengths };
    });
  /* Suggested lineup per format: best two by that format's best score. */
  const lineup = {};
  for (const f of Object.keys(CONTEST_FORMATS))
    lineup[f] = [...members].filter(m => m.bestByFormat[f] != null).sort((a, b) => b.bestByFormat[f] - a.bestByFormat[f]).slice(0, 2).map(m => m.name);
  res.json({ team: { id: team.id, name: team.name }, members, lineup });
});

/* ---------------- unit tests (7.2) ----------------
   A summative test across every authored topic in one unit. Server-held like
   the mastery check: no hints, marked here, recorded per topic so the
   knowledge model and the progress view both learn from it. */
const unitSessions = new Map();
const UNIT_SIZE = 12;

function unitTopics(grade, unitName) {
  const g = CURRICULUM[grade];
  const u = g?.units.find(x => x.name === unitName);
  return u ? u.topics.map(t => t.id).filter(id => QUESTIONS[id]) : null;
}

teacher.get("/units", (_req, res) => {
  const units = [];
  for (const [grade, g] of Object.entries(CURRICULUM))
    for (const u of g.units) {
      const authored = u.topics.filter(t => QUESTIONS[t.id]).length;
      if (authored >= 2) units.push({ grade, label: g.label, unit: u.name, track: u.track, topics: authored });
    }
  res.json({ units });
});

teacher.post("/unit-test/start", requireAuth, (req, res) => {
  const { learnerId, grade, unit } = req.body || {};
  if (!ownLearner(req, learnerId)) return res.status(403).json({ error: "not_your_learner" });
  const topics = unitTopics(String(grade), String(unit));
  if (!topics || topics.length < 2) return res.status(404).json({ error: "unit_not_testable" });
  /* Spread the paper across topics, then tiers, so it tests the unit. */
  const per = Math.max(2, Math.floor(UNIT_SIZE / topics.length));
  const ids = [];
  for (const t of topics) {
    const bank = QUESTIONS[t].map((q, i) => ({ q, i }));
    for (let k = bank.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [bank[k], bank[j]] = [bank[j], bank[k]]; }
    bank.slice(0, per).forEach(o => ids.push(`${t}:${o.i}`));
  }
  const id = randomUUID();
  unitSessions.set(id, { learnerId, grade: String(grade), unit: String(unit), topics, ids, issuedAt: Date.now() });
  audit(req.user.id, "unit_test.started", `${grade}:${unit}`, req);
  res.json({ testId: id, grade, unit, topics: topics.map(describe),
             questions: ids.map(qid => { const [t, i] = qid.split(":"); return publicQuestion(t, Number(i)); }) });
});

teacher.post("/unit-test/submit", requireAuth, (req, res) => {
  const { testId, answers } = req.body || {};
  const sess = unitSessions.get(testId);
  if (!sess) return res.status(404).json({ error: "unknown_test" });
  if (!ownLearner(req, sess.learnerId)) return res.status(403).json({ error: "not_your_learner" });
  if (!answers || typeof answers !== "object") return res.status(400).json({ error: "missing_answers" });
  const byTopic = {};
  const detail = sess.ids.map(qid => {
    const [t, i] = qid.split(":");
    const q = QUESTIONS[t][Number(i)];
    const { ok, correctAnswer } = gradeAnswer(q, answers[qid]);
    const b = (byTopic[t] ||= { topicId: t, asked: 0, correct: 0 });
    b.asked++; if (ok) b.correct++;
    bkt.observe(sess.learnerId, t, ok, bkt.paramsFor({ optionCount: q.type === "mc" ? (q.opts || []).length : 0 }));
    return { id: qid, topicId: t, correct: ok, correctAnswer, explanation: q.expl };
  });
  const score = detail.filter(d => d.correct).length, total = detail.length;
  const secs = (Date.now() - sess.issuedAt) / 1000;
  /* One run per topic keeps the progress view honest about which topic the
     evidence came from; the whole-unit result is a run of its own. */
  for (const b of Object.values(byTopic)) recordRun(sess.learnerId, b.topicId, "unit", b.correct, b.asked, { seconds: secs / Object.keys(byTopic).length });
  const pct = Math.round((score / total) * 100);
  db.prepare("INSERT INTO runs (id, learner_id, topic_id, tier, score, total, pct, seconds, finished_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), sess.learnerId, `unit:${sess.grade}:${sess.unit}`, "unit", score, total, pct, Math.round(secs), now());
  const bar = thresholdFor(sess.topics[0], sess.learnerId);
  unitSessions.delete(testId);
  audit(req.user.id, "unit_test.submitted", `${sess.grade}:${sess.unit}:${pct}%`, req);
  res.json({ score, total, pct, threshold: bar, passed: pct >= bar, detail,
             byTopic: Object.values(byTopic).map(b => ({ ...b, ...describe(b.topicId), pct: Math.round((b.correct / b.asked) * 100) })) });
});

/* ---------------- contest percentiles and leaderboards (4.1.9, 13.12) ----------------
   Percentile against every other learner's best paper in the same format,
   platform-wide and anonymous: no names, no ids, just where a score sits. */
export function percentileFor(format, pct, learnerId) {
  const others = format
    ? db.prepare("SELECT MAX(pct) p FROM contests WHERE format=? AND learner_id<>? GROUP BY learner_id").all(format, learnerId)
    : db.prepare("SELECT MAX(pct) p FROM contests WHERE learner_id<>? GROUP BY learner_id").all(learnerId);
  if (!others.length) return null;
  const below = others.filter(o => o.p < pct).length;
  const equal = others.filter(o => o.p === pct).length;
  return Math.round(((below + 0.5 * equal) / others.length) * 100);
}

teacher.get("/classes/:id/contest-leaderboard", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT * FROM classes WHERE id=?").get(req.params.id);
  if (!cls) return res.status(404).json({ error: "unknown_class" });
  const isTeacher = cls.teacher_id === req.user.id;
  const mine = new Set(db.prepare(`SELECT l.id FROM class_members m JOIN learners l ON l.id=m.learner_id WHERE m.class_id=? AND l.user_id=?`)
    .all(cls.id, req.user.id).map(r => r.id));
  if (!isTeacher && !mine.size) return res.status(403).json({ error: "not_in_this_class" });
  const settings = db.prepare("SELECT * FROM class_settings WHERE class_id=?").get(cls.id);
  if (!settings?.leaderboard_on) return res.json({ enabled: false, reason: "The teacher has not turned on the leaderboard for this class." });
  const format = String(req.query.format || "");
  if (format && !CONTEST_FORMATS[format]) return res.status(400).json({ error: "unknown_format" });
  const members = db.prepare("SELECT l.id, l.name FROM class_members m JOIN learners l ON l.id=m.learner_id WHERE m.class_id=?").all(cls.id);
  const rows = members.map(m => {
    const r = format ? db.prepare("SELECT MAX(pct) p, COUNT(*) n FROM contests WHERE learner_id=? AND format=?").get(m.id, format)
                     : db.prepare("SELECT MAX(pct) p, COUNT(*) n FROM contests WHERE learner_id=?").get(m.id);
    return { learnerId: m.id, name: m.name, best: r.p || 0, papers: r.n };
  }).filter(r => r.papers > 0).sort((a, b) => b.best - a.best);
  res.json({ enabled: true, format: format || "all",
    board: rows.map((r, i) => ({ rank: i + 1, best: r.best, papers: r.papers, you: mine.has(r.learnerId),
      name: settings.display_names || mine.has(r.learnerId) || isTeacher ? r.name : `Learner ${i + 1}` })) });
});
