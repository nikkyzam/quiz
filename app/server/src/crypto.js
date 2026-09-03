/* Encryption at rest for personal data (spec 10.3, 11.6).

   Names and email addresses — the columns that identify a family — are
   stored as AES-256-GCM ciphertext. Lookups by email go through a keyed
   blind index (HMAC-SHA256), so the plaintext address is never in the
   database at all. Everything else (scores, topics, timestamps) is not
   personal data and stays queryable.

   Keys come from the environment, which is where a KMS or secrets manager
   puts them: DATA_KEY (current, 32 bytes base64) and DATA_KEY_PREVIOUS
   (optional, for rotation). Each ciphertext names the key that made it, so
   after a rotation old rows still decrypt, and `rekey` rewrites them under
   the current key at the operator's pace. In production the key is required
   and the server refuses to start without it; in development one is
   generated once next to the database, so nothing is ever stored in clear
   by accident.

   Reads are decrypted transparently by wrapping the statement objects: any
   value that carries the ciphertext prefix comes back as plaintext, whatever
   table or query produced it. Writes encrypt at the few sites that store
   these columns. */

import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const PREFIX = "enc:v1:";
const keys = new Map();          // kid -> Buffer
let currentKid = null;
let hmacKey = null;

const kidOf = key => crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);

function loadKey(b64) {
  const buf = Buffer.from(String(b64), "base64");
  if (buf.length !== 32) throw new Error("DATA_KEY must be 32 bytes, base64-encoded");
  return buf;
}

export function initKeys({ dbFile = process.env.DB_FILE || "./data/mathquest.db" } = {}) {
  keys.clear();
  let current = process.env.DATA_KEY;
  if (!current) {
    if (process.env.NODE_ENV === "production") throw new Error("DATA_KEY is required in production: personal data is encrypted at rest");
    /* Development: a key generated once beside the database. */
    const file = dbFile === ":memory:" ? null : join(dirname(dbFile), ".datakey");
    if (file && existsSync(file)) current = readFileSync(file, "utf8").trim();
    else {
      current = crypto.randomBytes(32).toString("base64");
      if (file) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, current + "\n", { mode: 0o600 }); }
    }
  }
  const cur = loadKey(current);
  currentKid = kidOf(cur);
  keys.set(currentKid, cur);
  if (process.env.DATA_KEY_PREVIOUS) { const prev = loadKey(process.env.DATA_KEY_PREVIOUS); keys.set(kidOf(prev), prev); }
  /* The blind index uses a key derived from the current key, so rotating
     DATA_KEY also means re-indexing — which `rekey` does. */
  hmacKey = crypto.hkdfSync("sha256", cur, "beastforge-blind-index", "email", 32);
  return { currentKid, keyIds: [...keys.keys()] };
}

export const currentKeyId = () => currentKid;
export const isEncrypted = v => typeof v === "string" && v.startsWith(PREFIX);

export function encrypt(plain) {
  if (plain === null || plain === undefined) return plain;
  if (isEncrypted(plain)) return plain;
  if (!currentKid) initKeys();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keys.get(currentKid), iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final(), c.getAuthTag()]);
  return `${PREFIX}${currentKid}:${iv.toString("base64url")}:${ct.toString("base64url")}`;
}

export function decrypt(value) {
  if (!isEncrypted(value)) return value;
  if (!currentKid) initKeys();
  const [, , kid, ivB, ctB] = value.split(":");
  const key = keys.get(kid);
  if (!key) throw new Error(`no key for ciphertext made with key ${kid}; set DATA_KEY_PREVIOUS`);
  const ct = Buffer.from(ctB, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  d.setAuthTag(ct.subarray(ct.length - 16));
  return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString("utf8");
}

export const keyIdOf = value => (isEncrypted(value) ? value.split(":")[2] : null);

/* Blind index for equality lookups on email. */
export function blindIndex(email) {
  if (!hmacKey) initKeys();
  return crypto.createHmac("sha256", hmacKey).update(String(email).trim().toLowerCase()).digest("hex");
}

export function decryptRow(row) {
  if (!row || typeof row !== "object") return row;
  for (const k of Object.keys(row)) if (isEncrypted(row[k])) row[k] = decrypt(row[k]);
  return row;
}

/* Wrap a DatabaseSync so every get()/all() result is decrypted. */
export function wrapDatabase(db) {
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    const st = prepare(sql);
    const get = st.get.bind(st), all = st.all.bind(st);
    st.get = (...a) => decryptRow(get(...a));
    st.all = (...a) => all(...a).map(decryptRow);
    return st;
  };
  return db;
}

/* Columns that hold personal data, for migration and rotation. */
export const ENCRYPTED_COLUMNS = [
  { table: "users", columns: ["email", "name"], key: "id" },
  { table: "learners", columns: ["name"], key: "id" },
  { table: "roster_entries", columns: ["name", "guardian_email"], key: "id" }
];

/* Encrypt any plaintext rows (first boot with a key, or a table added later)
   and, when `all` is set, rewrite every row under the current key. Returns
   how many rows changed. The raw statements deliberately bypass the
   decrypting wrapper so key ids can be inspected. */
export function rekey(db, { all = false } = {}) {
  const raw = Object.getPrototypeOf(db).prepare.bind(db);
  let changed = 0;
  for (const spec of ENCRYPTED_COLUMNS) {
    const rows = raw(`SELECT ${spec.key}, ${spec.columns.join(", ")} FROM ${spec.table}`).all();
    for (const r of rows) {
      const updates = {};
      for (const col of spec.columns) {
        const v = r[col];
        if (v === null || v === undefined) continue;
        if (!isEncrypted(v)) updates[col] = encrypt(v);
        else if (all && keyIdOf(v) !== currentKid) updates[col] = encrypt(decrypt(v));
      }
      if (spec.table === "users") {
        const email = decrypt(r.email);
        if (email) updates.email_hash = blindIndex(email);
      }
      if (Object.keys(updates).length) {
        raw(`UPDATE ${spec.table} SET ${Object.keys(updates).map(k => `${k}=?`).join(", ")} WHERE ${spec.key}=?`)
          .run(...Object.values(updates), r[spec.key]);
        changed++;
      }
    }
  }
  return changed;
}

/* For checks and the admin status endpoint: how many rows sit under which key. */
export function keyReport(db) {
  const raw = Object.getPrototypeOf(db).prepare.bind(db);
  const out = { currentKeyId: currentKid, byKey: {}, plaintext: 0 };
  for (const spec of ENCRYPTED_COLUMNS)
    for (const r of raw(`SELECT ${spec.columns.join(", ")} FROM ${spec.table}`).all())
      for (const col of spec.columns) {
        const v = r[col];
        if (v === null || v === undefined) continue;
        if (isEncrypted(v)) out.byKey[keyIdOf(v)] = (out.byKey[keyIdOf(v)] || 0) + 1; else out.plaintext++;
      }
  return out;
}

/* Whole-file encryption for backups (10.3, 10.4): AES-256-GCM under the
   current key, so a snapshot copied off the box is useless without it. */
export function encryptFile(src, dst) {
  if (!currentKid) initKeys();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keys.get(currentKid), iv);
  const data = readFileSync(src);
  const ct = Buffer.concat([c.update(data), c.final()]);
  writeFileSync(dst, Buffer.concat([Buffer.from("BFENC1"), Buffer.from(currentKid, "utf8"), iv, c.getAuthTag(), ct]));
  return dst;
}
export function decryptFile(src, dst) {
  const buf = readFileSync(src);
  if (buf.subarray(0, 6).toString() !== "BFENC1") throw new Error("not an encrypted backup");
  const kid = buf.subarray(6, 14).toString("utf8");
  const key = keys.get(kid);
  if (!key) throw new Error(`no key ${kid} for this backup`);
  const iv = buf.subarray(14, 26), tag = buf.subarray(26, 42), ct = buf.subarray(42);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  writeFileSync(dst, Buffer.concat([d.update(ct), d.final()]));
  return dst;
}
