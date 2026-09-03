#!/usr/bin/env node
/* Restore drill (spec 10.4).

   A backup that has never been restored is a hope, not a backup. This takes
   the newest snapshot (sealed with the data key or plain), restores it to a
   fresh file, boots a server against that file on a spare port, and proves
   the restored service answers /ready and serves the accounts the snapshot
   contained. Run it on a schedule; the check runs it on every push.

   Usage: node tools/restore-drill.mjs [--dir app/server/data/backups] [--port 4177] [--json]
   Exported: drill(opts) for the check. */

import { readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

export async function drill({ dir = "app/server/data/backups", port = 4177, serverDir = "app/server", env = {} } = {}) {
  const files = readdirSync(dir).filter(f => /\.db(\.enc)?$/.test(f))
    .map(f => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error(`no backups in ${dir}`);
  const newest = join(dir, files[0].f);
  const scratch = resolve(serverDir, "data", "restore-drill");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const restored = join(scratch, "restored.db");

  /* Restoration itself runs inside a child with the server's environment,
     so it uses the same key material the server would. */
  /* Only the crypto module is imported here — never the server's database
     module, which would open (and create a WAL for) the very file being
     restored. */
  const restoreScript = `
    import { decryptFile, initKeys } from "${resolve(serverDir, "src/crypto.js").replace(/\\\\/g, "/")}";
    import { copyFileSync } from "node:fs";
    import { DatabaseSync } from "node:sqlite";
    initKeys({ dbFile: ${JSON.stringify(restored)} });
    const src = ${JSON.stringify(resolve(newest))}, dst = ${JSON.stringify(restored)};
    if (src.endsWith(".enc")) decryptFile(src, dst); else copyFileSync(src, dst);
    const db = new DatabaseSync(dst, { readOnly: true });
    const ok = String(Object.values(db.prepare("PRAGMA integrity_check").get())[0]);
    const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
    db.close();
    console.log(JSON.stringify({ ok, users }));`;
  const restoreOut = await run("node", ["--input-type=module", "-e", restoreScript], { cwd: serverDir, env: { ...process.env, ...env } });
  for (const suffix of ["-wal", "-shm"]) rmSync(restored + suffix, { force: true });
  const restoreInfo = JSON.parse(restoreOut.trim().split("\n").pop());
  if (restoreInfo.ok !== "ok") throw new Error(`restored database failed integrity check: ${restoreInfo.ok}`);

  const t0 = Date.now();
  const srv = spawn("node", ["src/index.js"], { cwd: serverDir, stdio: "ignore",
    env: { ...process.env, PORT: String(port), DB_FILE: restored, JOBS_INTERVAL_MS: "0", BACKUP_INTERVAL_HOURS: "0", ...env } });
  try {
    let ready = null;
    for (let i = 0; i < 60 && !ready; i++) {
      try { const r = await fetch(`http://localhost:${port}/ready`); if (r.ok) ready = await r.json(); } catch {}
      if (!ready) await new Promise(r => setTimeout(r, 150));
    }
    if (!ready) throw new Error("restored server never became ready");
    const cur = await fetch(`http://localhost:${port}/api/curriculum`);
    if (!cur.ok) throw new Error("restored server does not serve the API");
    return { backup: newest, encrypted: newest.endsWith(".enc"), integrity: restoreInfo.ok, users: restoreInfo.users,
             readyUsers: ready.users, secondsToServe: Math.round((Date.now() - t0) / 100) / 10, restoredFile: restored };
  } finally {
    srv.kill();
    await new Promise(r => setTimeout(r, 100));
  }
}

function run(cmd, args, opts) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => { out += d; }); p.stderr.on("data", d => { err += d; });
    p.on("exit", code => (code === 0 ? res(out) : rej(new Error(err || `exit ${code}`))));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  try {
    const r = await drill({ dir: opt("--dir", "app/server/data/backups"), port: Number(opt("--port", 4177)) });
    if (args.includes("--json")) console.log(JSON.stringify(r, null, 2));
    else console.log(`Restore drill OK: ${r.backup} (${r.encrypted ? "sealed" : "plain"}) -> integrity ${r.integrity}, ${r.users} users, serving in ${r.secondsToServe}s`);
  } catch (e) { console.error("Restore drill FAILED:", e.message); process.exit(1); }
}
