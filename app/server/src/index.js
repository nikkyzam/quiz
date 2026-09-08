import express from "express";
import cookieParser from "cookie-parser";
import { attachUser } from "./auth.js";
import { securityHeaders } from "./security.js";
import { api } from "./routes.js";
import { backup } from "./backup.js";
import { backupDue, markBackedUp, sweep, isDue } from "./retention.js";

function periodFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[schedule] ${name}="${raw}" is not a number of hours; using ${fallback}`);
    return fallback;
  }
  return n;
}

const app = express();
const PORT = process.env.PORT || 4000;

app.set("trust proxy", 1);          // correct req.ip behind a proxy
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use(attachUser);
app.use("/api", api);

/* Periodic jobs are also nudged by traffic, and on this host that is the only
   thing that reliably runs them.

   Fly is configured to SUSPEND an idle machine, which snapshots memory and
   restores the same process on the next request — it does not restart it. So
   module top-level code (the boot checks below) does not run on resume, and
   Node's timers are scheduled against monotonic time that does not advance
   while the vCPU is paused: a one-hour tick needs an hour of AWAKE time. A
   lightly-used app could therefore go weeks without sweeping while both the
   boot check and the timer looked correct.

   A request is the one thing that definitely happens on a resumed machine.
   This checks at most once a minute, does the due test off the request path
   so nothing blocks the response, and is a no-op whenever nothing is due. */
let lastDueCheck = 0;
app.use((_req, _res, next) => {
  const now = Date.now();
  if (now - lastDueCheck >= 60_000) {
    lastDueCheck = now;
    setImmediate(() => {
      try { runSweepIfDue("request"); runBackupIfDue("request"); } catch { /* logged inside */ }
    });
  }
  next();
});

/* Liveness vs readiness: /health says the process is up, /ready says the
   database is actually readable. A load balancer needs the difference. */
app.get("/health", (_q, s) => s.json({ ok: true }));
app.get("/ready", async (_q, s) => {
  const { healthy } = await import("./backup.js");
  const h = healthy();
  s.status(h.ok ? 200 : 503).json(h);
});

/* In production the API also serves the built client, so one process and one
   URL cover the whole app. In development Vite serves it instead. */
if (process.env.NODE_ENV === "production") {
  const { existsSync } = await import("node:fs");
  const { join, dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  /* Resolve from this file, not the working directory, so it works whether
     started from the repo root or from app/server. */
  const here = dirname(fileURLToPath(import.meta.url));      // app/server/src
  const dist = resolve(here, "../../web/dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    /* Client-side routing: anything not under /api falls back to the shell. */
    app.get(/^(?!\/api).*/, (_q, s) => s.sendFile(join(dist, "index.html")));
  }
}

/* Malformed JSON and anything thrown downstream land here. A stack trace is
   logged for us and never sent to the client. */
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("[error]", req.method, req.originalUrl, err);
  if (res.headersSent) return;
  res.status(status).json({
    error: status === 400 ? "bad_request" : status === 413 ? "payload_too_large" : "server_error"
  });
});

const server = app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));

/* ---------- scheduled backups ----------
   A backup nobody remembers to take is not a backup. Off by default so tests
   and development do not litter the disk; set BACKUP_INTERVAL_HOURS in
   production.

   Due-based for the same reason as the retention sweep below: this host
   suspends the machine when it is idle, so an interval timer alone would be
   destroyed before a six-hour backup ever fired, and the volume holding the
   only copy of the database would go unbacked while the config said
   otherwise. The last-run time is persisted, so a boot checks whether one is
   overdue and a crash loop cannot take a backup on every restart. */
const hours = periodFromEnv("BACKUP_INTERVAL_HOURS", 0);
let backupTimer = null;

function runBackupIfDue(reason) {
  try {
    if (!backupDue(hours)) return;
    const r = backup(process.env.BACKUP_DIR || "./data/backups",
                     Number(process.env.BACKUP_KEEP || 7));
    markBackedUp();
    console.log(`[backup] ${r.file} (${reason})`);
  } catch (e) {
    console.error("[backup] failed:", e.message);
  }
}

if (hours > 0) {
  runBackupIfDue("boot");
  backupTimer = setInterval(() => runBackupIfDue("timer"), Math.min(hours, 1) * 3_600_000);
  backupTimer.unref?.();
  console.log(`Scheduled backups every ${hours}h (checked on boot and hourly)`);
}

/* ---------- scheduled retention sweep ----------
   The retention policy is only a policy if something enforces it. On by
   default rather than opt-in like backups: holding data past its stated
   retention is a compliance failure, so an operator has to opt OUT.

   Due-based rather than purely interval-based, because a timer alone does not
   survive this deployment. Fly is configured to suspend the machine when it
   is idle, so a 24-hour setInterval is destroyed long before it fires and the
   sweep would never run at all. Checking at boot whether a sweep is OVERDUE
   makes the schedule hold however often the machine stops and starts.

   The persisted timestamp is also what makes a boot-time sweep safe: a
   crash-looping container cannot sweep on every restart, because the record
   says it already swept minutes ago. That was the reason the first run used
   to be deferred, and it is handled properly now rather than by hoping the
   process lives long enough. */
/* `??` only guards undefined, so an env var that is PRESENT but empty —
   easy to produce in a Fly or Compose env block — used to read as 0 and turn
   the sweep off with no log line at all, defeating the "on by default, opt
   out explicitly" intent. Anything unparseable falls back to the default, and
   a deliberate 0 says so out loud. */
const retentionHours = periodFromEnv("RETENTION_SWEEP_HOURS", 24);
let retentionTimer = null;

function runSweepIfDue(reason) {
  try {
    if (!isDue(retentionHours)) return;
    const { removed } = sweep();
    const summary = Object.entries(removed)
      .filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`[retention] swept (${reason})${summary ? ": " + summary : ": nothing to remove"}`);
  } catch (e) {
    console.error("[retention] sweep failed:", e.message);
  }
}

if (retentionHours > 0) {
  runSweepIfDue("boot");
  /* Still ticks for a machine that stays up, so a long-running host does not
     wait for a restart to enforce the policy. Checked hourly at most, and the
     due test makes the extra wake-ups no-ops. */
  const tick = Math.min(retentionHours, 1) * 3_600_000;
  retentionTimer = setInterval(() => runSweepIfDue("timer"), tick);
  retentionTimer.unref?.();
  console.log(`Retention sweep every ${retentionHours}h (checked on boot and hourly)`);
}



/* ---------- graceful shutdown ----------
   A redeploy sends SIGTERM. Without this the process dies mid-request and
   in-flight writes are lost; with it, open requests finish first. */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, draining connections`);
  if (backupTimer) clearInterval(backupTimer);
  if (retentionTimer) clearInterval(retentionTimer);
  server.close(() => {
    console.log("closed cleanly");
    process.exit(0);
  });
  /* Do not hang forever if a connection refuses to close. */
  setTimeout(() => {
    console.error("forced exit after 10s drain timeout");
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* Last resort. Log properly rather than dying silently, then leave: a process
   in an unknown state should not keep serving children's data. */
process.on("uncaughtException", err => {
  console.error("[fatal] uncaught exception", err);
  shutdown("uncaughtException");
});
process.on("unhandledRejection", reason => {
  console.error("[fatal] unhandled rejection", reason);
});

export { app, server };
