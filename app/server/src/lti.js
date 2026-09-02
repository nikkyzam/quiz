/* LTI 1.3 Advantage tool (spec 9.5, 13.7).

   The core launch: OIDC third-party-initiated login, then a signed id_token
   POSTed to the launch URL, verified against the platform's JWKS with RS256
   from node:crypto. An instructor launch provisions a teacher and a class
   bound to the LMS context; a learner launch provisions a guardian-style
   account holding one learner and enrols that learner in the context's
   class. Nothing here trusts the browser: the platform's signature, the
   nonce and the deployment id are all checked before a session is issued.

   Platforms are registered by an admin (issuer, client id, endpoints). The
   tool's own key pair signs client-credentials requests for the Advantage
   services and is published at /api/lti/jwks. */

import crypto from "node:crypto";
import { db, now } from "./db.js";
import { getSetting, setSetting } from "./policy.js";
import { createUser, createSession, findUserByEmail } from "./auth.js";

const b64u = b => Buffer.from(b).toString("base64url");
const fromB64u = s => Buffer.from(String(s), "base64url");

/* ---------- tool key pair ---------- */
export function toolKeys() {
  let k = getSetting("lti_keys", null);
  if (!k) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    k = { kid: crypto.randomUUID(), publicJwk: publicKey.export({ format: "jwk" }),
          privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) };
    setSetting("lti_keys", k);
  }
  return k;
}
export const toolJwks = () => ({ keys: [{ ...toolKeys().publicJwk, kid: toolKeys().kid, use: "sig", alg: "RS256" }] });

/* ---------- platforms ---------- */
export function registerPlatform(p) {
  for (const f of ["issuer", "clientId", "authLoginUrl", "jwksUrl", "deploymentId"]) if (!p?.[f]) return { error: `missing_${f}` };
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO lti_platforms (id, issuer, client_id, auth_login_url, token_url, jwks_url, deployment_id, name, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, p.issuer, p.clientId, p.authLoginUrl, p.tokenUrl || null, p.jwksUrl, p.deploymentId, p.name || p.issuer, now());
  return { id };
}
export const platforms = () => db.prepare("SELECT id, issuer, client_id, name, deployment_id, created_at FROM lti_platforms").all();
const platformFor = (iss, clientId) => clientId
  ? db.prepare("SELECT * FROM lti_platforms WHERE issuer=? AND client_id=?").get(iss, clientId)
  : db.prepare("SELECT * FROM lti_platforms WHERE issuer=?").get(iss);

/* ---------- OIDC login initiation ---------- */
export function beginLogin(params, launchUrl) {
  const { iss, login_hint, target_link_uri, lti_message_hint, client_id } = params || {};
  const platform = platformFor(iss, client_id);
  if (!platform) return { error: "unknown_platform" };
  if (!login_hint) return { error: "missing_login_hint" };
  const state = b64u(crypto.randomBytes(24)), nonce = b64u(crypto.randomBytes(24));
  db.prepare("INSERT INTO lti_nonces (state, nonce, platform_id, created_at, expires_at) VALUES (?,?,?,?,?)")
    .run(state, nonce, platform.id, now(), new Date(Date.now() + 10 * 60_000).toISOString());
  const u = new URL(platform.auth_login_url);
  const q = { scope: "openid", response_type: "id_token", response_mode: "form_post", prompt: "none",
              client_id: platform.client_id, redirect_uri: launchUrl, login_hint, state, nonce };
  if (lti_message_hint) q.lti_message_hint = lti_message_hint;
  if (target_link_uri) q.target_link_uri = target_link_uri;
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return { redirect: u.toString(), state, nonce };
}

/* ---------- JWT verification ---------- */
const jwksCache = new Map();
async function fetchJwks(url, fetchImpl) {
  const hit = jwksCache.get(url);
  if (hit && hit.at > Date.now() - 300_000) return hit.keys;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const { keys } = await res.json();
  jwksCache.set(url, { keys, at: Date.now() });
  return keys;
}

export async function verifyIdToken(token, platform, { fetchImpl = fetch, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = JSON.parse(fromB64u(parts[0]).toString("utf8"));
  const claims = JSON.parse(fromB64u(parts[1]).toString("utf8"));
  if (header.alg !== "RS256") throw new Error("unsupported alg");
  let keys = await fetchJwks(platform.jwks_url, fetchImpl);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { jwksCache.delete(platform.jwks_url); keys = await fetchJwks(platform.jwks_url, fetchImpl); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) throw new Error("unknown kid");
  const ok = crypto.verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ format: "jwk", key: jwk }), fromB64u(parts[2]));
  if (!ok) throw new Error("bad signature");
  if (claims.iss !== platform.issuer) throw new Error("issuer mismatch");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(platform.client_id)) throw new Error("audience mismatch");
  if (typeof claims.exp !== "number" || claims.exp < nowSec) throw new Error("token expired");
  if (typeof claims.iat !== "number" || claims.iat > nowSec + 300) throw new Error("token from the future");
  return claims;
}

const CLAIM = s => `https://purl.imsglobal.org/spec/lti/claim/${s}`;

/* ---------- launch ---------- */
export async function completeLaunch({ id_token, state }, { fetchImpl = fetch } = {}) {
  const row = db.prepare("SELECT * FROM lti_nonces WHERE state=?").get(String(state || ""));
  if (!row) throw new Error("unknown state");
  db.prepare("DELETE FROM lti_nonces WHERE state=?").run(row.state);          // single use
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("state expired");
  const platform = db.prepare("SELECT * FROM lti_platforms WHERE id=?").get(row.platform_id);
  const claims = await verifyIdToken(id_token, platform, { fetchImpl });
  if (claims.nonce !== row.nonce) throw new Error("nonce mismatch");
  if (claims[CLAIM("message_type")] !== "LtiResourceLinkRequest") throw new Error("unsupported message type");
  if (claims[CLAIM("version")] !== "1.3.0") throw new Error("unsupported version");
  if (claims[CLAIM("deployment_id")] !== platform.deployment_id) throw new Error("deployment mismatch");
  const roles = claims[CLAIM("roles")] || [];
  const instructor = roles.some(r => /#Instructor|#Administrator|#TeachingAssistant/.test(r));
  const context = claims[CLAIM("context")] || null;

  /* Provision or find the user for this platform subject. */
  let link = db.prepare("SELECT user_id FROM lti_links WHERE platform_id=? AND subject=?").get(platform.id, claims.sub);
  let userId = link?.user_id;
  if (!userId) {
    const display = String(claims.name || claims.given_name || (instructor ? "Teacher" : "Student")).slice(0, 60);
    const email = claims.email && !findUserByEmail(claims.email) ? claims.email
      : `lti-${platform.id.slice(0, 8)}-${crypto.createHash("sha256").update(claims.sub).digest("hex").slice(0, 16)}@lti.invalid`;
    const user = createUser({ email, password: crypto.randomBytes(24).toString("hex"), name: display,
                              role: instructor ? "teacher" : "parent", coppaConsent: true });
    userId = user.id;
    db.prepare("INSERT INTO lti_links (platform_id, subject, user_id, created_at) VALUES (?,?,?,?)").run(platform.id, claims.sub, userId, now());
    if (!instructor)
      db.prepare("INSERT INTO learners (id, user_id, name, beast, track, created_at) VALUES (?,?,?,?,?,?)")
        .run(crypto.randomUUID(), userId, display, "vex", "core", now());
  }

  /* Bind the LMS context to a class. An instructor creates it; a learner
     joins it if it exists. */
  let classId = null;
  if (context?.id) {
    const ctx = db.prepare("SELECT class_id FROM lti_contexts WHERE platform_id=? AND context_id=?").get(platform.id, context.id);
    if (ctx) classId = ctx.class_id;
    else if (instructor) {
      classId = crypto.randomUUID();
      db.prepare("INSERT INTO classes (id, teacher_id, name, join_code, created_at) VALUES (?,?,?,?,?)")
        .run(classId, userId, String(context.title || context.label || "LMS class").slice(0, 60), crypto.randomUUID().slice(0, 6).toUpperCase(), now());
      db.prepare("INSERT INTO lti_contexts (platform_id, context_id, class_id, created_at) VALUES (?,?,?,?)").run(platform.id, context.id, classId, now());
    }
    if (classId && !instructor) {
      const learner = db.prepare("SELECT id FROM learners WHERE user_id=? ORDER BY created_at LIMIT 1").get(userId);
      if (learner) db.prepare("INSERT OR IGNORE INTO class_members (class_id, learner_id, joined_at) VALUES (?,?,?)").run(classId, learner.id, now());
    }
  }
  const session = createSession(userId);
  const target = claims[CLAIM("target_link_uri")] || "/";
  return { userId, instructor, classId, session, target, subject: claims.sub };
}

/* Tool configuration a platform administrator pastes into the LMS. */
export function toolConfig(base) {
  return {
    title: "BeastForge", description: "K-8 maths practice with adaptive tiers, puzzles and proofs.",
    oidc_initiation_url: `${base}/api/lti/login`, target_link_uri: `${base}/api/lti/launch`,
    public_jwk_url: `${base}/api/lti/jwks`,
    scopes: ["https://purl.imsglobal.org/spec/lti-ags/scope/lineitem", "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly"],
    extensions: [{ platform: "canvas.instructure.com", settings: { placements: [{ placement: "course_navigation", message_type: "LtiResourceLinkRequest", target_link_uri: `${base}/api/lti/launch` }] } }],
    custom_fields: {}
  };
}

/* Sign a client-credentials assertion for the Advantage services (AGS/NRPS). */
export function clientAssertion(platform, tokenUrl) {
  const k = toolKeys();
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: k.kid }));
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ iss: platform.client_id, sub: platform.client_id, aud: tokenUrl, iat: nowSec, exp: nowSec + 300, jti: crypto.randomUUID() }));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), k.privatePem);
  return `${header}.${payload}.${b64u(sig)}`;
}
