/* Background jobs (spec 9.4, 4.2.4, 9.2, 11.5, 10.3): draining the
   notification outbox to email and push, the weekly summary, webhook
   delivery, analytics aggregation and retention pruning.

   Every job is a plain function so a test or an operator can run it on
   demand; the scheduler in index.js only decides how often. */

import { db, now } from "./db.js";
import * as notify from "./notify.js";
import * as mailer from "./mailer.js";
import * as push from "./push.js";
import * as webhooks from "./webhooks.js";
import * as analytics from "./analytics.js";
import * as rewards from "./rewards.js";
import { getSetting, setSetting } from "./policy.js";
import { describe } from "./helpers.js";

export function prefsFor(userId) {
  const r = db.prepare("SELECT * FROM user_prefs WHERE user_id=?").get(userId);
  return { emailAlerts: r ? !!r.email_alerts : true, emailSummary: r ? !!r.email_summary : true,
           push: r ? !!r.push : true, locale: r?.locale || "en" };
}
export function setPrefs(userId, p) {
  const cur = prefsFor(userId);
  const next = { emailAlerts: p.emailAlerts ?? cur.emailAlerts, emailSummary: p.emailSummary ?? cur.emailSummary,
                 push: p.push ?? cur.push, locale: ["en", "es", "ar"].includes(p.locale) ? p.locale : cur.locale };
  db.prepare(`INSERT INTO user_prefs (user_id, email_alerts, email_summary, push, locale, updated_at) VALUES (?,?,?,?,?,?)
              ON CONFLICT(user_id) DO UPDATE SET email_alerts=excluded.email_alerts, email_summary=excluded.email_summary,
                push=excluded.push, locale=excluded.locale, updated_at=excluded.updated_at`)
    .run(userId, next.emailAlerts ? 1 : 0, next.emailSummary ? 1 : 0, next.push ? 1 : 0, next.locale, now());
  return next;
}

/* ---------- notification delivery ---------- */
export async function deliverNotifications({ limit = 100, fetchImpl = fetch } = {}) {
  const rows = notify.undelivered(limit);
  const out = { email: 0, push: 0, inApp: 0, errors: [] };
  for (const n of rows) {
    const prefs = prefsFor(n.user_id);
    const via = [];
    const wantsEmail = n.kind === "weekly_summary" ? prefs.emailSummary : prefs.emailAlerts;
    if (mailer.configured() && wantsEmail && !/@lti\.invalid$/.test(n.email)) {
      try {
        await mailer.sendMail({ to: n.email, subject: `BeastForge: ${n.title}`,
          text: `${n.title}\n\n${n.body}\n\nYou can change what we email you in Settings.` });
        via.push("email"); out.email++;
      } catch (e) { out.errors.push(`${n.id}: ${e.message}`); }
    }
    if (prefs.push) {
      for (const sub of push.subscriptionsFor(n.user_id)) {
        try {
          const r = await push.sendPush(sub, { title: n.title, body: n.body, kind: n.kind, learnerId: n.learner_id }, { fetchImpl });
          if (r.ok) { if (!via.includes("push")) via.push("push"); out.push++; }
        } catch (e) { out.errors.push(`${n.id}: push ${e.message}`); }
      }
    }
    if (!via.length) { via.push("in-app"); out.inApp++; }
    notify.markDelivered(n.id, via.join("+"));
  }
  return out;
}

/* ---------- weekly summary (4.2.4) ----------
   One notification per account per ISO week, summarising every learner. */
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}

export function summaryFor(userId) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const learners = db.prepare("SELECT id, name FROM learners WHERE user_id=?").all(userId);
  const lines = learners.map(l => {
    const runs = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(seconds),0) s FROM runs WHERE learner_id=? AND finished_at>=?").get(l.id, since);
    const mastered = db.prepare("SELECT topic_id FROM progress WHERE learner_id=? AND last_at>=? AND best_pct>=80").all(l.id, since)
      .map(r => describe(r.topic_id).name);
    const badges = db.prepare("SELECT code FROM awards WHERE learner_id=? AND kind='badge' AND at>=?").all(l.id, since)
      .map(b => rewards.BADGES[b.code]?.name || b.code);
    const streak = rewards.streak(l.id);
    return { learnerId: l.id, name: l.name, rounds: runs.c, minutes: Math.round(runs.s / 60), mastered, badges, streak,
      text: `${l.name}: ${runs.c} round${runs.c === 1 ? "" : "s"}, ${Math.round(runs.s / 60)} min` +
            (mastered.length ? `, mastered ${mastered.slice(0, 3).join(", ")}` : "") +
            (badges.length ? `, earned ${badges.slice(0, 3).join(", ")}` : "") +
            (streak ? `, ${streak}-day streak` : "") + "." };
  });
  return { week: weekKey(), learners: lines, text: lines.map(l => l.text).join("\n") || "No learners yet." };
}

export function weeklySummaries({ force = false } = {}) {
  const wk = weekKey();
  const sent = getSetting("weekly_summary_sent", {});
  let created = 0;
  for (const u of db.prepare("SELECT id FROM users").all()) {
    if (!force && sent[u.id] === wk) continue;
    const s = summaryFor(u.id);
    if (!s.learners.length) continue;
    const n = notify.notify(u.id, { kind: "weekly_summary", title: `Weekly summary (${wk})`, body: s.text, dedupe: !force });
    if (n) created++;
    sent[u.id] = wk;
  }
  setSetting("weekly_summary_sent", sent);
  return { week: wk, created };
}

/* ---------- retention (10.3) ----------
   Raw analytics events and audit rows older than the configured window are
   deleted; accounts inactive for the window are erased with everything
   under them. Off unless an admin sets retentionDays. */
export function retentionSweep() {
  const days = getSetting("retentionDays", null);
  if (!days) return { skipped: true };
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const audit = db.prepare("DELETE FROM audit_log WHERE at < ?").run(cutoff).changes;
  const events = analytics.pruneEvents(days);
  const stale = db.prepare(`SELECT u.id FROM users u WHERE u.created_at < ? AND u.role <> 'admin'
     AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.created_at >= ?)
     AND NOT EXISTS (SELECT 1 FROM learners l JOIN runs r ON r.learner_id=l.id WHERE l.user_id=u.id AND r.finished_at >= ?)`)
    .all(cutoff, cutoff, cutoff).map(r => r.id);
  for (const id of stale) db.prepare("DELETE FROM users WHERE id=?").run(id);
  return { days, auditDeleted: audit, eventsDeleted: events, accountsErased: stale.length };
}

/* ---------- scheduler ---------- */
export function schedule({ everyMs = 60_000 } = {}) {
  const timers = [];
  const tick = async () => {
    try { await webhooks.drain(); } catch {}
    try { await deliverNotifications(); } catch {}
  };
  timers.push(setInterval(tick, everyMs));
  timers.push(setInterval(() => {
    try { analytics.aggregateDay(new Date(Date.now() - 86400000).toISOString().slice(0, 10)); analytics.aggregateDay(); } catch {}
    try { weeklySummaries(); } catch {}
    try { retentionSweep(); } catch {}
  }, 60 * 60_000));
  for (const t of timers) t.unref?.();
  return () => timers.forEach(clearInterval);
}
