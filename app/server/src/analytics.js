/* Analytics pipeline (spec 11.5).

   Raw events are appended as they happen; a daily aggregation rolls them
   into metrics an administrator can read. The raw stream keeps a learner id
   so retention and erasure cascade with the learner, but nothing an admin
   can reach shows it — the admin endpoint reads only the aggregates. */

import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";

export function track(kind, props = {}, { learnerId = null, userId = null } = {}) {
  try {
    db.prepare("INSERT INTO analytics_events (id, kind, learner_id, user_id, props, at) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), String(kind), learnerId, userId, JSON.stringify(props).slice(0, 2000), now());
  } catch { /* analytics never break a request */ }
}

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/* Roll one day (UTC, YYYY-MM-DD) into metrics. Idempotent: re-running a day
   replaces its rows. */
export function aggregateDay(day = new Date().toISOString().slice(0, 10)) {
  const events = db.prepare("SELECT kind, learner_id, props FROM analytics_events WHERE substr(at,1,10)=?").all(day)
    .map(e => ({ ...e, props: JSON.parse(e.props || "{}") }));
  const metrics = {};
  const byKind = {};
  for (const e of events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  for (const [k, v] of Object.entries(byKind)) metrics[`events.${k}`] = v;
  metrics["learners.active"] = new Set(events.filter(e => e.learner_id).map(e => e.learner_id)).size;

  const answers = events.filter(e => e.kind === "answer");
  if (answers.length) {
    metrics["answers.total"] = answers.length;
    metrics["answers.correct_rate"] = Math.round((answers.filter(a => a.props.correct).length / answers.length) * 100);
  }
  const tutor = events.filter(e => e.kind === "tutor.reply");
  if (tutor.length) {
    const lat = tutor.map(t => Number(t.props.latencyMs) || 0);
    metrics["tutor.replies"] = tutor.length;
    metrics["tutor.latency_p50"] = pct(lat, 0.5);
    metrics["tutor.latency_p95"] = pct(lat, 0.95);
    metrics["tutor.under_3s_rate"] = Math.round((lat.filter(x => x < 3000).length / lat.length) * 100);
    metrics["tutor.llm_share"] = Math.round((tutor.filter(t => t.props.source === "llm").length / tutor.length) * 100);
    metrics["tutor.redacted"] = tutor.filter(t => t.props.redacted).length;
  }
  const blocked = events.filter(e => e.kind === "tutor.blocked");
  if (blocked.length) metrics["tutor.blocked"] = blocked.length;

  /* Platform facts from the record itself, for the same day. */
  metrics["runs.recorded"] = db.prepare("SELECT COUNT(*) c FROM runs WHERE substr(finished_at,1,10)=?").get(day).c;
  metrics["accounts.created"] = db.prepare("SELECT COUNT(*) c FROM users WHERE substr(created_at,1,10)=?").get(day).c;

  db.prepare("DELETE FROM analytics_daily WHERE day=?").run(day);
  const ins = db.prepare("INSERT INTO analytics_daily (day, metric, value, computed_at) VALUES (?,?,?,?)");
  for (const [m, v] of Object.entries(metrics)) if (v !== null && v !== undefined) ins.run(day, m, v, now());
  return { day, metrics };
}

export function report(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare("SELECT day, metric, value FROM analytics_daily WHERE day >= ? ORDER BY day").all(since);
  const out = {};
  for (const r of rows) (out[r.day] ||= {})[r.metric] = r.value;
  return { since, days: out };
}

/* Raw events older than the retention window are dropped by the retention job. */
export function pruneEvents(olderThanDays = 90) {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  return db.prepare("DELETE FROM analytics_events WHERE at < ?").run(cutoff).changes;
}
