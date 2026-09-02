/* Notifications (spec 4.2.5, 4.2.6, 9.4).

   Every alert the platform raises lands here first, as an in-app notification
   the account holder sees on their next visit. Delivery channels (email, push)
   drain the same rows, so a notification is never lost for want of a
   provider — it just waits in the app until one exists.

   De-duplication is per (learner, kind, day): a struggling child produces one
   alert a day, not one per wrong answer. */

import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";

export const KINDS = {
  struggling:       "Struggling with a topic",
  inactive:         "No practice for a while",
  ready_to_advance: "Ready for more",
  goal_met:         "Weekly goal met",
  goal_at_risk:     "Weekly goal at risk",
  challenge:        "Challenge of the day",
  badge:            "New badge",
  streak_freeze:    "Streak freeze used",
  contest:          "Timed paper result",
  weekly_summary:   "Weekly summary"
};

const dayOf = iso => iso.slice(0, 10);

/* Returns the notification if one was created, null if today's already exists. */
export function notify(userId, { learnerId = null, kind, title, body, dedupe = true }) {
  if (!KINDS[kind]) throw new Error(`unknown notification kind ${kind}`);
  const today = dayOf(now());
  if (dedupe) {
    const dup = db.prepare(`SELECT id FROM notifications
      WHERE user_id=? AND COALESCE(learner_id,'')=COALESCE(?,'') AND kind=? AND substr(created_at,1,10)=?`)
      .get(userId, learnerId, kind, today);
    if (dup) return null;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO notifications (id, user_id, learner_id, kind, title, body, created_at)
              VALUES (?,?,?,?,?,?,?)`).run(id, userId, learnerId, kind, title, body, now());
  return { id, kind, title, body };
}

export function listFor(userId, { unreadOnly = false, limit = 50 } = {}) {
  return db.prepare(`SELECT n.id, n.learner_id, l.name learner_name, n.kind, n.title, n.body, n.created_at, n.read_at, n.delivered_via
                     FROM notifications n LEFT JOIN learners l ON l.id = n.learner_id
                     WHERE n.user_id=? ${unreadOnly ? "AND n.read_at IS NULL" : ""}
                     ORDER BY n.created_at DESC LIMIT ?`).all(userId, limit)
    .map(r => ({ id: r.id, learnerId: r.learner_id, learnerName: r.learner_name, kind: r.kind,
                 kindLabel: KINDS[r.kind], title: r.title, body: r.body,
                 createdAt: r.created_at, readAt: r.read_at, deliveredVia: r.delivered_via }));
}

export function markRead(userId, id) {
  return db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL")
    .run(now(), id, userId).changes;
}

export function markAllRead(userId) {
  return db.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL")
    .run(now(), userId).changes;
}

/* Rows a delivery channel has not yet handled. */
export function undelivered(limit = 100) {
  return db.prepare(`SELECT n.*, u.email FROM notifications n JOIN users u ON u.id = n.user_id
                     WHERE n.delivered_via IS NULL ORDER BY n.created_at LIMIT ?`).all(limit);
}
export function markDelivered(id, via) {
  db.prepare("UPDATE notifications SET delivered_via=? WHERE id=?").run(via, id);
}

/* ---------- goal evaluation (4.2.6) ----------
   Called after a round is recorded. Raises "met" the moment the weekly target
   is reached, and "at risk" when the week is nearly over with the target
   still short. Both de-duplicate per day. */
export function checkGoal(learnerId) {
  const g = db.prepare("SELECT * FROM goals WHERE learner_id=?").get(learnerId);
  if (!g || !g.rounds_per_week) return null;
  const learner = db.prepare("SELECT user_id, name FROM learners WHERE id=?").get(learnerId);
  if (!learner) return null;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const done = db.prepare("SELECT COUNT(*) c FROM runs WHERE learner_id=? AND finished_at >= ?")
    .get(learnerId, since).c;
  if (done >= g.rounds_per_week)
    return notify(learner.user_id, { learnerId, kind: "goal_met",
      title: `${learner.name} met this week's goal`,
      body: `${done} rounds this week against a target of ${g.rounds_per_week}.` });
  const daysLeft = (7 - new Date().getUTCDay()) % 7;
  if (daysLeft <= 2)
    return notify(learner.user_id, { learnerId, kind: "goal_at_risk",
      title: `${learner.name}'s weekly goal is at risk`,
      body: `${done} of ${g.rounds_per_week} rounds done with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.` });
  return null;
}
