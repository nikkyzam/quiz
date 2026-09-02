/* Gamification beyond points and badges (spec 5.3-5.8, 4.1.8, 4.3.5):
   avatar gear, per-subject levels with prestige, streak freezes, the story,
   hidden areas, and class-scoped teams with weekly tournaments. */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { requireAuth } from "./auth.js";
import { audit, requireRole } from "./security.js";
import * as rewards from "./rewards.js";
import { ownLearner } from "./helpers.js";
import { ACCESSORIES, SLOTS, unlockedAccessories } from "../../shared/accessories.mjs";
import { CHAPTERS, renderChapter, epilogue } from "../../shared/story.mjs";
import { AREAS, areaStatus } from "../../shared/unlockables.mjs";
import { PUZZLES, publicPuzzle } from "../../shared/puzzles.mjs";

export const game = Router();

/* ---------------- avatar gear (5.3) ---------------- */
function gearFor(learnerId) {
  const t = rewards.totals(learnerId);
  const unlocked = unlockedAccessories({ badges: t.badges.map(b => b.code), level: t.level });
  const equipped = Object.fromEntries(db.prepare("SELECT slot, item FROM learner_gear WHERE learner_id=?")
    .all(learnerId).map(r => [r.slot, r.item]));
  /* Gear whose unlock has somehow gone (it cannot, badges are permanent) is
     dropped from the equipped set rather than rendered. */
  const ok = new Set(unlocked.map(a => a.id));
  for (const s of Object.keys(equipped)) if (!ok.has(equipped[s])) delete equipped[s];
  return { slots: SLOTS, unlocked, equipped,
           locked: ACCESSORIES.filter(a => !ok.has(a.id)).map(a => ({ id: a.id, slot: a.slot, name: a.name,
             hint: a.unlock.badge ? (rewards.BADGES[a.unlock.badge]?.hint || a.unlock.badge) : `Reach level ${a.unlock.level}` })) };
}

game.get("/learners/:id/avatar", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  res.json(gearFor(req.params.id));
});

game.put("/learners/:id/avatar", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const { slot, item } = req.body || {};
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: "unknown_slot" });
  if (item === null || item === "") {
    db.prepare("DELETE FROM learner_gear WHERE learner_id=? AND slot=?").run(req.params.id, slot);
    return res.json(gearFor(req.params.id));
  }
  const acc = ACCESSORIES.find(a => a.id === item && a.slot === slot);
  if (!acc) return res.status(400).json({ error: "unknown_item" });
  const g = gearFor(req.params.id);
  if (!g.unlocked.some(a => a.id === item)) return res.status(403).json({ error: "not_unlocked" });
  db.prepare(`INSERT INTO learner_gear (learner_id, slot, item) VALUES (?,?,?)
              ON CONFLICT(learner_id, slot) DO UPDATE SET item=excluded.item`).run(req.params.id, slot, item);
  res.json(gearFor(req.params.id));
});

/* ---------------- levels and prestige (5.4) ---------------- */
game.get("/learners/:id/levels", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const t = rewards.totals(req.params.id);
  res.json({ overall: { level: t.level, points: t.points, nextLevelAt: t.nextLevelAt },
             subjects: rewards.subjectLevels(req.params.id),
             prestigeLevel: rewards.PRESTIGE_LEVEL, prestigeSubjects: rewards.PRESTIGE_SUBJECTS });
});

game.post("/learners/:id/prestige", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const r = rewards.prestige(req.params.id, String(req.body?.subject || ""));
  if (r.error) return res.status(r.error === "unknown_subject" ? 400 : 409).json(r);
  audit(req.user.id, "prestige", `${req.params.id}:${r.subject}:${r.stars}`, req);
  res.json(r);
});

/* ---------------- streak and freezes (5.5) ---------------- */
game.get("/learners/:id/streak", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  res.json(rewards.streakStatus(req.params.id));
});

/* ---------------- story (5.6) ---------------- */
function choicesFor(learnerId) {
  return Object.fromEntries(db.prepare("SELECT chapter, choice FROM story_choices WHERE learner_id=?")
    .all(learnerId).map(r => [r.chapter, r.choice]));
}
game.get("/learners/:id/story", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const choices = choicesFor(req.params.id);
  const s = rewards.stats(req.params.id);
  const chapters = CHAPTERS.map(ch => renderChapter(ch, choices, s));
  const finished = CHAPTERS.every(ch => choices[ch.id]);
  res.json({ chapters, choices, epilogue: finished ? epilogue(choices) : null });
});

game.post("/learners/:id/story/:chapter", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const ch = CHAPTERS.find(c => c.id === req.params.chapter);
  if (!ch) return res.status(404).json({ error: "unknown_chapter" });
  const s = rewards.stats(req.params.id);
  if (!ch.unlock(s)) return res.status(403).json({ error: "chapter_locked", unlockHint: ch.unlockHint });
  const idx = CHAPTERS.indexOf(ch);
  const choices = choicesFor(req.params.id);
  if (idx > 0 && !choices[CHAPTERS[idx - 1].id]) return res.status(409).json({ error: "read_previous_chapter_first" });
  const { choice } = req.body || {};
  if (!ch.choice.options.some(o => o.id === choice)) return res.status(400).json({ error: "unknown_choice" });
  if (choices[ch.id]) return res.status(409).json({ error: "already_chosen", chosen: choices[ch.id] });
  db.prepare("INSERT INTO story_choices (learner_id, chapter, choice, at) VALUES (?,?,?,?)")
    .run(req.params.id, ch.id, choice, now());
  const badges = rewards.sweep(req.params.id);
  const next = CHAPTERS[idx + 1];
  const nextChoices = { ...choices, [ch.id]: choice };
  res.json({ chosen: choice, badges,
             next: next ? renderChapter(next, nextChoices, rewards.stats(req.params.id)) : null,
             epilogue: CHAPTERS.every(c => nextChoices[c.id]) ? epilogue(nextChoices) : null });
});

/* ---------------- hidden areas and unlockables (5.7) ---------------- */
export function unlockedAreas(learnerId) {
  const s = rewards.stats(learnerId);
  const areas = areaStatus(s);
  /* Entering an area for the first time grants its badge. */
  for (const a of areas) if (a.unlocked) rewards.award(learnerId, "badge", AREAS.find(x => x.id === a.id).grants.badge);
  return areas;
}

game.get("/learners/:id/unlocks", requireAuth, (req, res) => {
  if (!ownLearner(req, req.params.id)) return res.status(403).json({ error: "not_your_learner" });
  const areas = unlockedAreas(req.params.id);
  const open = new Set(areas.filter(a => a.unlocked).map(a => a.id));
  res.json({
    areas: areas.map(a => ({ ...a, puzzles: a.unlocked ? PUZZLES.filter(p => p.area === a.id).map(publicPuzzle)
                                                       : PUZZLES.filter(p => p.area === a.id).length })),
    hiddenPuzzles: PUZZLES.filter(p => p.hidden && open.has(p.area)).map(publicPuzzle),
    gear: gearFor(req.params.id).unlocked.map(a => a.id)
  });
});

/* ---------------- teams and tournaments (5.8, 4.1.8, 4.3.5) ----------------
   Teams live inside a class, are made by the teacher, and never message.
   A tournament is a week of points, per team and per learner, shown only
   while the teacher has it switched on, anonymised under the same rule as
   the leaderboard. */
const requireTeacher = requireRole("teacher", "admin");
const ownClass = (req, id) => db.prepare("SELECT * FROM classes WHERE id=? AND teacher_id=?").get(id, req.user.id);
const classViewer = (req, cls) => {
  if (cls.teacher_id === req.user.id) return { teacher: true, mine: new Set() };
  const mine = db.prepare(`SELECT l.id FROM class_members m JOIN learners l ON l.id=m.learner_id
                           WHERE m.class_id=? AND l.user_id=?`).all(cls.id, req.user.id).map(r => r.id);
  return mine.length ? { teacher: false, mine: new Set(mine) } : null;
};

game.post("/classes/:id/teams", requireAuth, requireTeacher, (req, res) => {
  if (!ownClass(req, req.params.id)) return res.status(403).json({ error: "not_your_class" });
  const name = String(req.body?.name || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "missing_name" });
  const id = randomUUID();
  db.prepare("INSERT INTO teams (id, class_id, name, created_at) VALUES (?,?,?,?)").run(id, req.params.id, name, now());
  audit(req.user.id, "team.created", id, req);
  res.json({ team: { id, name, members: [] } });
});

game.post("/classes/:id/teams/:teamId/members", requireAuth, requireTeacher, (req, res) => {
  if (!ownClass(req, req.params.id)) return res.status(403).json({ error: "not_your_class" });
  const team = db.prepare("SELECT * FROM teams WHERE id=? AND class_id=?").get(req.params.teamId, req.params.id);
  if (!team) return res.status(404).json({ error: "unknown_team" });
  const { learnerId } = req.body || {};
  const member = db.prepare("SELECT 1 FROM class_members WHERE class_id=? AND learner_id=?").get(req.params.id, learnerId);
  if (!member) return res.status(404).json({ error: "not_in_class" });
  /* One team per learner per class. */
  db.prepare(`DELETE FROM team_members WHERE learner_id=? AND team_id IN (SELECT id FROM teams WHERE class_id=?)`)
    .run(learnerId, req.params.id);
  db.prepare("INSERT INTO team_members (team_id, learner_id) VALUES (?,?)").run(team.id, learnerId);
  res.json({ teamId: team.id, learnerId });
});

game.delete("/classes/:id/teams/:teamId", requireAuth, requireTeacher, (req, res) => {
  if (!ownClass(req, req.params.id)) return res.status(403).json({ error: "not_your_class" });
  const r = db.prepare("DELETE FROM teams WHERE id=? AND class_id=?").run(req.params.teamId, req.params.id);
  res.json({ deleted: r.changes });
});

function weekStart(d = new Date()) {
  const day = (d.getUTCDay() + 6) % 7;                 // Monday = 0
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return start;
}

function teamsFor(cls, viewer, since = null) {
  const settings = db.prepare("SELECT * FROM class_settings WHERE class_id=?").get(cls.id) || {};
  const showNames = !!settings.display_names;
  const teams = db.prepare("SELECT * FROM teams WHERE class_id=? ORDER BY created_at").all(cls.id);
  let anon = 0;
  return teams.map(t => {
    const members = db.prepare(`SELECT l.id, l.name FROM team_members tm JOIN learners l ON l.id=tm.learner_id
                                WHERE tm.team_id=? ORDER BY l.name`).all(t.id);
    const rows = members.map(m => {
      const pts = since
        ? db.prepare("SELECT COALESCE(SUM(amount),0) p FROM awards WHERE learner_id=? AND kind='points' AND at>=?").get(m.id, since).p
        : db.prepare("SELECT COALESCE(SUM(amount),0) p FROM awards WHERE learner_id=? AND kind='points'").get(m.id).p;
      anon++;
      return { learnerId: viewer.teacher || viewer.mine.has(m.id) ? m.id : undefined,
               name: showNames || viewer.teacher || viewer.mine.has(m.id) ? m.name : `Learner ${anon}`,
               you: viewer.mine.has(m.id), points: pts };
    });
    return { id: t.id, name: t.name, members: rows, points: rows.reduce((a, r) => a + r.points, 0) };
  }).sort((a, b) => b.points - a.points);
}

game.get("/classes/:id/teams", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT * FROM classes WHERE id=?").get(req.params.id);
  if (!cls) return res.status(404).json({ error: "unknown_class" });
  const viewer = classViewer(req, cls);
  if (!viewer) return res.status(403).json({ error: "not_in_this_class" });
  res.json({ teams: teamsFor(cls, viewer) });
});

game.get("/classes/:id/tournament", requireAuth, (req, res) => {
  const cls = db.prepare("SELECT * FROM classes WHERE id=?").get(req.params.id);
  if (!cls) return res.status(404).json({ error: "unknown_class" });
  const viewer = classViewer(req, cls);
  if (!viewer) return res.status(403).json({ error: "not_in_this_class" });
  const settings = db.prepare("SELECT * FROM class_settings WHERE class_id=?").get(cls.id);
  if (!settings?.tournament_on)
    return res.json({ enabled: false, reason: "The teacher has not started a tournament for this class." });
  const start = weekStart();
  const end = new Date(start.getTime() + 7 * 86400000);
  const teams = teamsFor(cls, viewer, start.toISOString());
  res.json({ enabled: true, week: { start: start.toISOString(), end: end.toISOString() },
             teams: teams.map((t, i) => ({ rank: i + 1, ...t })),
             messaging: false });
});
