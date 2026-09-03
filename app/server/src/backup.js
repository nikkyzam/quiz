/* Backups and integrity (spec 10.4).

   SQLite's own VACUUM INTO produces a consistent snapshot while the server
   keeps running, so a backup never captures a half-written transaction. */

import { db } from "./db.js";
import { mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encryptFile, decryptFile } from "./crypto.js";

/* With BACKUP_ENCRYPT=1 (the production default in the Dockerfile) the
   snapshot is sealed under the data key: personal data inside is already
   ciphertext, and the file as a whole is useless without DATA_KEY (10.3). */
export function backup(dir = "./data/backups", keep = 7, { encrypt = process.env.BACKUP_ENCRYPT === "1" } = {}) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  /* Absolute, so a caller with a different working directory can find it. */
  const file = resolve(join(dir, `mathquest-${stamp}.db`));
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  let out = file;
  if (encrypt) { out = file + ".enc"; encryptFile(file, out); unlinkSync(file); }
  prune(dir, keep);
  return { file: out, encrypted: encrypt, at: new Date().toISOString() };
}

/* Turn a snapshot (sealed or not) back into a plain SQLite file. */
export function restoreFile(src, dst) {
  if (src.endsWith(".enc")) return decryptFile(src, dst);
  copyFileSync(src, dst);
  return dst;
}

/* Keep the most recent N, so a scheduled backup cannot fill the disk. */
export function prune(dir, keep) {
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith(".db") || f.endsWith(".db.enc")); } catch { return []; }
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
