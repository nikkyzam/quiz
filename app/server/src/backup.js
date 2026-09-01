/* Backups and integrity (spec 10.4).

   SQLite's own VACUUM INTO produces a consistent snapshot while the server
   keeps running, so a backup never captures a half-written transaction. */

import { db } from "./db.js";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

export function backup(dir = "./data/backups", keep = 7) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  /* Absolute, so a caller with a different working directory can find it. */
  const file = resolve(join(dir, `mathquest-${stamp}.db`));
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  prune(dir, keep);
  return { file, at: new Date().toISOString() };
}

/* Keep the most recent N, so a scheduled backup cannot fill the disk. */
export function prune(dir, keep) {
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith(".db")); } catch { return []; }
  const sorted = files
    .map(f => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const removed = sorted.slice(keep);
  for (const r of removed) { try { unlinkSync(join(dir, r.f)); } catch {} }
  return removed.map(r => r.f);
}

/* Cheap integrity probe, so a health check can tell whether the database is
   readable rather than only whether the process is alive. */
export function healthy() {
  try {
    const r = db.prepare("PRAGMA integrity_check").get();
    const ok = String(Object.values(r)[0]).toLowerCase() === "ok";
    const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
    return { ok, users };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
