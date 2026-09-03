import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { encrypt, blindIndex } from "./crypto.js";

/* scrypt is a deliberate choice: it is memory-hard, ships with Node, and needs
   no native build. Params are the Node defaults with a raised cost factor. */
const KEYLEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const attempt = scryptSync(password, salt, KEYLEN, SCRYPT);
  const stored = Buffer.from(hash, "hex");
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (stored.length !== attempt.length) return false;
  return timingSafeEqual(stored, attempt);
}

const SESSION_DAYS = 30;

export function createSession(userId) {
  const id = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)")
    .run(id, userId, now(), expires);
  return { id, expires };
}

export function userForSession(sid) {
  if (!sid) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ?`).get(sid);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role || 'parent' };
}

export function destroySession(sid) {
  if (sid) db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
}

export function createUser({ email, password, name, role = "parent", coppaConsent = false }) {
  const { hash, salt } = hashPassword(password);
  const id = randomUUID();
  /* Email and name are stored encrypted (10.3); the blind index makes the
     address findable without storing it. */
  db.prepare(`INSERT INTO users (id, email, email_hash, pass_hash, pass_salt, name, role, coppa_consent_at, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, encrypt(email.toLowerCase()), blindIndex(email), hash, salt, encrypt(name), role, coppaConsent ? now() : null, now());
  return { id, email: email.toLowerCase(), name, role };
}

export function findUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email_hash = ?").get(blindIndex(email));
}

/* Every place a learner is created goes through here so the name is
   encrypted at rest (10.3). */
export function createLearner({ id, userId, name, beast = "vex", track = "core" }) {
  db.prepare("INSERT INTO learners (id, user_id, name, beast, track, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, userId, encrypt(String(name).trim().slice(0, 40)), beast, track, now());
  return { id, name: String(name).trim().slice(0, 40), beast, track };
}

/* Express middleware */
export function attachUser(req, _res, next) {
  req.user = userForSession(req.cookies?.sid);
  next();
}
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "not_signed_in" });
  next();
}


/* ---------- password reset ----------
   The token is returned to the caller once and only its SHA-256 hash is
   stored, so a stolen database cannot be turned into working reset links.
   Requesting a reset always reports success, whether or not the address
   exists, so the endpoint cannot be used to discover who has an account. */
import { createHash } from "node:crypto";

const RESET_MINUTES = 30;
const hashToken = t => createHash("sha256").update(t).digest("hex");

export function createResetToken(userId) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + RESET_MINUTES * 60_000).toISOString();
  /* Any earlier outstanding token is invalidated, so only the newest works. */
  db.prepare("DELETE FROM reset_tokens WHERE user_id = ? AND used_at IS NULL").run(userId);
  db.prepare("INSERT INTO reset_tokens (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)")
    .run(hashToken(token), userId, now(), expires);
  return { token, expiresAt: expires };
}

export function consumeResetToken(token) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM reset_tokens WHERE token_hash = ?").get(hashToken(String(token)));
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  db.prepare("UPDATE reset_tokens SET used_at = ? WHERE token_hash = ?").run(now(), row.token_hash);
  return row.user_id;
}

export function setPassword(userId, password) {
  const { hash, salt } = hashPassword(password);
  db.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").run(hash, salt, userId);
  /* Every existing session is destroyed: a reset must lock out whoever
     prompted it, otherwise it protects nobody. */
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
