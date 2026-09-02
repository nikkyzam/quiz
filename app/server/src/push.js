/* Web Push (spec 9.4), implemented on node:crypto.

   RFC 8291 (message encryption) and RFC 8292 (VAPID) with the aes128gcm
   content coding of RFC 8188. Written out rather than pulled in as a
   dependency so the whole path from a notification row to bytes on the wire
   is in this repository and provable by the check, which decrypts what we
   send with the subscriber's private key.

   VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url raw
   P-256 point and scalar); if absent a pair is generated once and kept in
   the settings table so subscriptions survive restarts. */

import crypto from "node:crypto";
import { db, now } from "./db.js";
import { getSetting, setSetting } from "./policy.js";

const b64u = buf => Buffer.from(buf).toString("base64url");
const fromB64u = s => Buffer.from(String(s), "base64url");

/* ---------- keys ---------- */
export function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com" };
  let stored = getSetting("vapid", null);
  if (!stored) { stored = generateVapidKeys(); setSetting("vapid", stored); }
  return { ...stored, subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com" };
}

export function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }), priv = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), fromB64u(pub.x), fromB64u(pub.y)]);
  return { publicKey: b64u(raw), privateKey: priv.d };
}

function privateKeyObject(keys) {
  const raw = fromB64u(keys.publicKey);
  return crypto.createPrivateKey({ format: "jwk", key: {
    kty: "EC", crv: "P-256", x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)), d: keys.privateKey } });
}

/* ---------- VAPID authorization header ---------- */
export function vapidHeader(endpoint, keys = vapidKeys(), { expiresIn = 12 * 3600 } = {}) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + expiresIn, sub: keys.subject }));
  const data = `${header}.${payload}`;
  const sig = crypto.sign("sha256", Buffer.from(data), { key: privateKeyObject(keys), dsaEncoding: "ieee-p1363" });
  return `vapid t=${data}.${b64u(sig)}, k=${keys.publicKey}`;
}

/* ---------- encryption (RFC 8291 + RFC 8188) ---------- */
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));

export function encryptPayload(plaintext, { p256dh, auth }) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("bad subscription keys");
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();                       // uncompressed, 65 bytes
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const padded = Buffer.concat([Buffer.from(plaintext, "utf8"), Buffer.from([2])]);   // 0x02: last record
  const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, body]);
}

/* The receiver's side, kept here so the check can prove the sender against
   it rather than trusting that the bytes look right. */
export function decryptPayload(bytes, { privateKey, p256dh, auth }) {
  const buf = Buffer.from(bytes);
  const salt = buf.subarray(0, 16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const body = buf.subarray(21 + idlen);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(fromB64u(privateKey));
  const uaPublic = fromB64u(p256dh);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = hkdf(fromB64u(auth), shared, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  const end = plain.lastIndexOf(2);
  return plain.subarray(0, end).toString("utf8");
}

/* A subscriber for tests: the browser's half of the key exchange. */
export function makeSubscriber() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(crypto.randomBytes(16)), privateKey: b64u(ecdh.getPrivateKey()) };
}

/* ---------- subscriptions ---------- */
export function subscribe(userId, sub) {
  let u;
  try { u = new URL(String(sub?.endpoint)); } catch { return { error: "bad_endpoint" }; }
  if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) return { error: "https_required" };
  const p256dh = String(sub?.keys?.p256dh || ""), auth = String(sub?.keys?.auth || "");
  if (fromB64u(p256dh).length !== 65 || fromB64u(auth).length !== 16) return { error: "bad_keys" };
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`)
    .run(u.toString(), userId, p256dh, auth, now());
  return { ok: true };
}
export function unsubscribe(userId, endpoint) {
  return db.prepare("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?").run(userId, String(endpoint)).changes;
}
export function subscriptionsFor(userId) {
  return db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?").all(userId);
}

/* Send one notification to one subscription. A 404/410 means the
   subscription is gone and is removed. */
export async function sendPush(sub, payload, { fetchImpl = fetch, ttl = 86400 } = {}) {
  const body = encryptPayload(JSON.stringify(payload), sub);
  const res = await fetchImpl(sub.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm", TTL: String(ttl),
               Urgency: "normal", Authorization: vapidHeader(sub.endpoint) },
    body
  });
  if (res.status === 404 || res.status === 410) db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(sub.endpoint);
  return { ok: res.ok, status: res.status };
}
