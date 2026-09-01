import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { db, now } from "./db.js";

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
  db.prepare(`INSERT INTO users (id, email, pass_hash, pass_salt, name, role, coppa_consent_at, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, email.toLowerCase(), hash, salt, name, role, coppaConsent ? now() : null, now());
  return { id, email: email.toLowerCase(), name, role };
}

export function findUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase());
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
