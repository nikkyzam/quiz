/* Outbound webhooks (spec 9.2).

   An account registers a URL and receives signed JSON when things happen to
   its own learners — a round recorded, a badge earned, a paper submitted, a
   goal met. Deliveries are queued, signed with HMAC-SHA256 over the exact
   body, and retried with backoff; a receiver that is down for an hour still
   gets every event, in order, once it is back. */

import { randomUUID, createHmac, randomBytes } from "node:crypto";
import { db, now } from "./db.js";

export const EVENTS = ["run.recorded", "badge.earned", "contest.submitted", "goal.met", "lesson.completed"];
const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [0, 30_000, 120_000, 600_000, 3_600_000, 14_400_000];

export function register(userId, { url, events }) {
  let u;
  try { u = new URL(String(url)); } catch { return { error: "bad_url" }; }
  if (!["http:", "https:"].includes(u.protocol)) return { error: "bad_url" };
  /* Production receivers must be HTTPS; plain HTTP is allowed only on loopback for development. */
  if (u.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && process.env.NODE_ENV === "production")
    return { error: "https_required" };
  const wanted = Array.isArray(events) && events.length ? events.filter(e => EVENTS.includes(e)) : EVENTS;
  if (!wanted.length) return { error: "no_valid_events" };
  const id = randomUUID(), secret = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO webhooks (id, user_id, url, secret, events, active, created_at) VALUES (?,?,?,?,?,1,?)")
    .run(id, userId, u.toString(), secret, JSON.stringify(wanted), now());
  return { id, url: u.toString(), events: wanted, secret };
}

export function listFor(userId) {
  return db.prepare("SELECT id, url, events, active, created_at FROM webhooks WHERE user_id=?").all(userId)
    .map(w => ({ ...w, events: JSON.parse(w.events), active: !!w.active,
      pending: db.prepare("SELECT COUNT(*) c FROM webhook_deliveries WHERE webhook_id=? AND status='pending'").get(w.id).c,
      failed: db.prepare("SELECT COUNT(*) c FROM webhook_deliveries WHERE webhook_id=? AND status='failed'").get(w.id).c }));
}

export function remove(userId, id) {
  return db.prepare("DELETE FROM webhooks WHERE id=? AND user_id=?").run(id, userId).changes;
}

/* Queue an event for every active hook of the learner's account that wants it. */
export function emit(learnerId, event, payload) {
  const learner = db.prepare("SELECT user_id FROM learners WHERE id=?").get(learnerId);
  if (!learner) return 0;
  const hooks = db.prepare("SELECT id, events FROM webhooks WHERE user_id=? AND active=1").all(learner.user_id)
    .filter(h => JSON.parse(h.events).includes(event));
  const body = JSON.stringify({ id: randomUUID(), event, learnerId, at: now(), data: payload });
  for (const h of hooks)
    db.prepare(`INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, attempts, next_at, created_at)
                VALUES (?,?,?,?, 'pending', 0, ?, ?)`).run(randomUUID(), h.id, event, body, now(), now());
  return hooks.length;
}

export const sign = (secret, body) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

/* Attempt every due delivery once. Returns what happened, for the caller
   (scheduler or test) to inspect. */
export async function drain({ limit = 50, fetchImpl = fetch } = {}) {
  const due = db.prepare(`SELECT d.*, w.url, w.secret FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id
                          WHERE d.status='pending' AND d.next_at <= ? AND w.active=1 ORDER BY d.created_at LIMIT ?`)
    .all(now(), limit);
  const out = { delivered: 0, retried: 0, failed: 0 };
  for (const d of due) {
    const attempt = d.attempts + 1;
    let ok = false, err = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetchImpl(d.url, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "X-Event": d.event, "X-Delivery": d.id,
                   "X-Signature": sign(d.secret, d.payload), "User-Agent": "BeastForge-Webhooks/1" },
        body: d.payload
      });
      clearTimeout(timer);
      ok = res.ok; if (!ok) err = `HTTP ${res.status}`;
    } catch (e) { err = String(e.message || e); }
    if (ok) {
      db.prepare("UPDATE webhook_deliveries SET status='delivered', attempts=?, delivered_at=?, last_error=NULL WHERE id=?").run(attempt, now(), d.id);
      out.delivered++;
    } else if (attempt >= MAX_ATTEMPTS) {
      db.prepare("UPDATE webhook_deliveries SET status='failed', attempts=?, last_error=? WHERE id=?").run(attempt, err, d.id);
      out.failed++;
    } else {
      const next = new Date(Date.now() + BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]).toISOString();
      db.prepare("UPDATE webhook_deliveries SET attempts=?, next_at=?, last_error=? WHERE id=?").run(attempt, next, err, d.id);
      out.retried++;
    }
  }
  return out;
}

export function deliveriesFor(userId, webhookId, limit = 50) {
  return db.prepare(`SELECT d.id, d.event, d.status, d.attempts, d.next_at, d.last_error, d.created_at, d.delivered_at
                     FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id
                     WHERE w.user_id=? AND w.id=? ORDER BY d.created_at DESC LIMIT ?`).all(userId, webhookId, limit);
}
