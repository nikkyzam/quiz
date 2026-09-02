/* Admin depth (spec 4.4.1, 7.6): school and district hierarchy with
   aggregates at each level, and platform-wide settings. Aggregate only —
   an administrator never sees an individual child's work. */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { requireAuth } from "./auth.js";
import { audit, requireRole } from "./security.js";
import { getSetting, setSetting, validThreshold } from "./policy.js";
import { MASTERY } from "./helpers.js";

export const admin = Router();
const requireAdmin = requireRole("admin");

/* ---------------- hierarchy ---------------- */
admin.post("/admin/districts", requireAuth, requireAdmin, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "missing_name" });
  const id = randomUUID();
  db.prepare("INSERT INTO districts (id, name, created_at) VALUES (?,?,?)").run(id, name, now());
  audit(req.user.id, "district.created", id, req);
  res.json({ district: { id, name } });
});

admin.post("/admin/schools", requireAuth, requireAdmin, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "missing_name" });
  const districtId = req.body?.districtId || null;
  if (districtId && !db.prepare("SELECT 1 FROM districts WHERE id=?").get(districtId))
    return res.status(404).json({ error: "unknown_district" });
  const id = randomUUID();
  db.prepare("INSERT INTO schools (id, district_id, name, created_at) VALUES (?,?,?,?)").run(id, districtId, name, now());
  audit(req.user.id, "school.created", id, req);
  res.json({ school: { id, name, districtId } });
});

/* A teacher is placed in a school by an admin, by email — the admin never
   needs to browse a list of people. */
admin.put("/admin/users/school", requireAuth, requireAdmin, (req, res) => {
  const { email, schoolId } = req.body || {};
  const user = db.prepare("SELECT id, role FROM users WHERE email=?").get(String(email || "").toLowerCase());
  if (!user) return res.status(404).json({ error: "unknown_user" });
  if (schoolId && !db.prepare("SELECT 1 FROM schools WHERE id=?").get(schoolId)) return res.status(404).json({ error: "unknown_school" });
  db.prepare("UPDATE users SET school_id=? WHERE id=?").run(schoolId || null, user.id);
  audit(req.user.id, "user.school.set", `${user.id}:${schoolId}`, req);
  res.json({ userId: user.id, schoolId: schoolId || null });
});

/* Aggregates for one school: teachers, classes, learners enrolled, rounds,
   attainment shape. Learners are counted through class membership. */
function schoolStats(schoolId) {
  const teachers = db.prepare("SELECT id FROM users WHERE school_id=? AND role IN ('teacher','admin')").all(schoolId).map(r => r.id);
  if (!teachers.length) return { teachers: 0, classes: 0, learners: 0, rounds: 0, masteredPct: null };
  const inT = teachers.map(() => "?").join(",");
  const classes = db.prepare(`SELECT id FROM classes WHERE teacher_id IN (${inT})`).all(...teachers).map(r => r.id);
  if (!classes.length) return { teachers: teachers.length, classes: 0, learners: 0, rounds: 0, masteredPct: null };
  const inC = classes.map(() => "?").join(",");
  const learners = db.prepare(`SELECT DISTINCT learner_id FROM class_members WHERE class_id IN (${inC})`).all(...classes).map(r => r.learner_id);
  if (!learners.length) return { teachers: teachers.length, classes: classes.length, learners: 0, rounds: 0, masteredPct: null };
  const inL = learners.map(() => "?").join(",");
  const rounds = db.prepare(`SELECT COUNT(*) c FROM runs WHERE learner_id IN (${inL})`).get(...learners).c;
  const prog = db.prepare(`SELECT best_pct FROM progress WHERE learner_id IN (${inL})`).all(...learners);
  const masteredPct = prog.length ? Math.round((prog.filter(p => p.best_pct >= 80).length / prog.length) * 100) : null;
  return { teachers: teachers.length, classes: classes.length, learners: learners.length, rounds, masteredPct };
}

admin.get("/admin/hierarchy", requireAuth, requireAdmin, (req, res) => {
  const districts = db.prepare("SELECT * FROM districts ORDER BY name").all();
  const schools = db.prepare("SELECT * FROM schools ORDER BY name").all();
  const withStats = schools.map(s => ({ id: s.id, name: s.name, districtId: s.district_id, ...schoolStats(s.id) }));
  const roll = list => list.reduce((a, s) => ({
    teachers: a.teachers + s.teachers, classes: a.classes + s.classes, learners: a.learners + s.learners, rounds: a.rounds + s.rounds
  }), { teachers: 0, classes: 0, learners: 0, rounds: 0 });
  audit(req.user.id, "admin.hierarchy.read", null, req);
  res.json({
    districts: districts.map(d => {
      const mine = withStats.filter(s => s.districtId === d.id);
      return { id: d.id, name: d.name, schools: mine, totals: roll(mine) };
    }),
    unassignedSchools: withStats.filter(s => !s.districtId),
    totals: roll(withStats)
  });
});

/* ---------------- platform settings (7.6) ---------------- */
admin.get("/admin/settings", requireAuth, requireAdmin, (req, res) => {
  res.json({ mastery: getSetting("mastery", MASTERY), defaults: MASTERY,
             retentionDays: getSetting("retentionDays", null) });
});

admin.put("/admin/settings", requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  if (b.mastery) {
    const { core, adv } = b.mastery;
    if (!validThreshold(core) || !validThreshold(adv)) return res.status(400).json({ error: "threshold_out_of_range" });
    setSetting("mastery", { core, adv });
  }
  if (b.retentionDays !== undefined) {
    const d = b.retentionDays === null ? null : Number(b.retentionDays);
    if (d !== null && (!Number.isInteger(d) || d < 30)) return res.status(400).json({ error: "retention_too_short" });
    setSetting("retentionDays", d);
  }
  audit(req.user.id, "admin.settings.updated", JSON.stringify(b).slice(0, 200), req);
  res.json({ mastery: getSetting("mastery", MASTERY), retentionDays: getSetting("retentionDays", null) });
});
