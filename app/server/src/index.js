import express from "express";
import cookieParser from "cookie-parser";
import { attachUser } from "./auth.js";
import { securityHeaders } from "./security.js";
import { api } from "./routes.js";
import { backup } from "./backup.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.set("trust proxy", 1);          // correct req.ip behind a proxy
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use(attachUser);
app.use("/api", api);

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
   production. */
const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 0);
let backupTimer = null;
if (hours > 0) {
  const ms = hours * 3_600_000;
  backupTimer = setInterval(() => {
    try {
      const r = backup(process.env.BACKUP_DIR || "./data/backups",
                       Number(process.env.BACKUP_KEEP || 7));
      console.log("[backup]", r.file);
    } catch (e) {
      console.error("[backup] failed:", e.message);
    }
  }, ms);
  backupTimer.unref?.();
  console.log(`Scheduled backups every ${hours}h`);
}

/* ---------- background jobs (9.2, 9.4, 11.5, 10.3) ----------
   Webhook delivery, the notification outbox, weekly summaries, analytics
   and retention. JOBS_INTERVAL_MS=0 disables the scheduler (tests run the
   jobs on demand through /api/admin/jobs). */
const jobsEvery = Number(process.env.JOBS_INTERVAL_MS ?? 60_000);
let stopJobs = null;
if (jobsEvery > 0) {
  const { schedule } = await import("./jobs.js");
  stopJobs = schedule({ everyMs: jobsEvery });
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
  if (stopJobs) stopJobs();
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
