/* OpenID Connect sign-in (spec 11.6, 9.1 SSO).

   Authorization-code flow with PKCE against any OIDC provider — Google,
   Microsoft, Clever, ClassLink — configured by an admin or from the
   OIDC_PROVIDERS environment variable. The id_token is verified against the
   provider's JWKS (RS256, node:crypto), the nonce is single use, and the
   provider's subject is linked to a local account. A provider can be
   restricted to an email domain and can assign a default role, which is how
   a school's staff SSO lands people as teachers without a signup form. */

import crypto from "node:crypto";
import { db, now } from "./db.js";
import { createUser, createSession, findUserByEmail } from "./auth.js";

const b64u = b => Buffer.from(b).toString("base64url");
const fromB64u = s => Buffer.from(String(s), "base64url");

/* ---------- providers ---------- */
export function registerProvider(p) {
  for (const f of ["id", "name", "issuer", "clientId", "clientSecret", "authUrl", "tokenUrl", "jwksUrl"]) if (!p?.[f]) return { error: `missing_${f}` };
  if (!/^[a-z0-9-]{2,32}$/.test(p.id)) return { error: "bad_id" };
  const role = ["parent", "teacher"].includes(p.defaultRole) ? p.defaultRole : "parent";
  db.prepare(`INSERT INTO oidc_providers (id, name, issuer, client_id, client_secret, auth_url, token_url, jwks_url, scopes, default_role, email_domain, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET name=excluded.name, issuer=excluded.issuer, client_id=excluded.client_id,
                client_secret=excluded.client_secret, auth_url=excluded.auth_url, token_url=excluded.token_url, jwks_url=excluded.jwks_url,
                scopes=excluded.scopes, default_role=excluded.default_role, email_domain=excluded.email_domain`)
    .run(p.id, p.name, p.issuer, p.clientId, p.clientSecret, p.authUrl, p.tokenUrl, p.jwksUrl,
         p.scopes || "openid email profile", role, p.emailDomain || null, now());
  return { id: p.id };
}

/* Providers from the environment are loaded once at boot. */
export function loadFromEnv() {
  if (!process.env.OIDC_PROVIDERS) return 0;
  let list;
  try { list = JSON.parse(process.env.OIDC_PROVIDERS); } catch { throw new Error("OIDC_PROVIDERS is not valid JSON"); }
  let n = 0;
  for (const p of Array.isArray(list) ? list : []) if (!registerProvider(p).error) n++;
  return n;
}

export const publicProviders = () => db.prepare("SELECT id, name, default_role, email_domain FROM oidc_providers ORDER BY name").all()
  .map(p => ({ id: p.id, name: p.name, role: p.default_role, emailDomain: p.email_domain }));
const providerById = id => db.prepare("SELECT * FROM oidc_providers WHERE id=?").get(String(id));

/* ---------- start ---------- */
export function begin(providerId, redirectUri) {
  const p = providerById(providerId);
  if (!p) return { error: "unknown_provider" };
  const state = b64u(crypto.randomBytes(24)), nonce = b64u(crypto.randomBytes(24));
  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash("sha256").update(verifier).digest());
  db.prepare("INSERT INTO oidc_states (state, provider_id, nonce, verifier, redirect_uri, created_at, expires_at) VALUES (?,?,?,?,?,?,?)")
    .run(state, p.id, nonce, verifier, redirectUri, now(), new Date(Date.now() + 10 * 60_000).toISOString());
  const u = new URL(p.auth_url);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: p.client_id, redirect_uri: redirectUri,
    scope: p.scopes, state, nonce, code_challenge: challenge, code_challenge_method: "S256" })) u.searchParams.set(k, v);
  return { redirect: u.toString(), state };
}

/* ---------- JWKS + JWT ---------- */
const jwksCache = new Map();
async function jwks(url, fetchImpl) {
  const hit = jwksCache.get(url);
  if (hit && hit.at > Date.now() - 300_000) return hit.keys;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`jwks fetch failed: ${r.status}`);
  const { keys } = await r.json();
  jwksCache.set(url, { keys, at: Date.now() });
  return keys;
}
export async function verifyIdToken(token, p, { fetchImpl = fetch, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed id_token");
  const header = JSON.parse(fromB64u(parts[0]).toString("utf8"));
  const claims = JSON.parse(fromB64u(parts[1]).toString("utf8"));
  if (header.alg !== "RS256") throw new Error("unsupported alg");
  let keys = await jwks(p.jwks_url, fetchImpl);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { jwksCache.delete(p.jwks_url); keys = await jwks(p.jwks_url, fetchImpl); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) throw new Error("unknown kid");
  if (!crypto.verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ format: "jwk", key: jwk }), fromB64u(parts[2])))
    throw new Error("bad signature");
  if (claims.iss !== p.issuer) throw new Error("issuer mismatch");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(p.client_id)) throw new Error("audience mismatch");
  if (typeof claims.exp !== "number" || claims.exp < nowSec) throw new Error("id_token expired");
  return claims;
}

/* ---------- callback ---------- */
export async function complete({ code, state }, { fetchImpl = fetch } = {}) {
  const row = db.prepare("SELECT * FROM oidc_states WHERE state=?").get(String(state || ""));
  if (!row) throw new Error("unknown state");
  db.prepare("DELETE FROM oidc_states WHERE state=?").run(row.state);
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("state expired");
  const p = providerById(row.provider_id);
  if (!code) throw new Error("missing code");

  const tokenRes = await fetchImpl(p.token_url, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: String(code), redirect_uri: row.redirect_uri,
      client_id: p.client_id, client_secret: p.client_secret, code_verifier: row.verifier }).toString() });
  if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
  const tokens = await tokenRes.json();
  const claims = await verifyIdToken(tokens.id_token, p, { fetchImpl });
  if (claims.nonce !== row.nonce) throw new Error("nonce mismatch");
  const email = String(claims.email || "").toLowerCase();
  if (p.email_domain && !email.endsWith("@" + p.email_domain.toLowerCase())) throw new Error("email domain not allowed");

  let link = db.prepare("SELECT user_id FROM oidc_links WHERE provider_id=? AND subject=?").get(p.id, claims.sub);
  let userId = link?.user_id;
  if (!userId) {
    /* Link to an existing account by verified email, else create one. */
    const existing = email && claims.email_verified !== false ? findUserByEmail(email) : null;
    if (existing) userId = existing.id;
    else {
      if (!email) throw new Error("provider returned no email");
      const user = createUser({ email, password: crypto.randomBytes(24).toString("hex"),
        name: String(claims.name || claims.given_name || email.split("@")[0]).slice(0, 60), role: p.default_role, coppaConsent: true });
      userId = user.id;
    }
    db.prepare("INSERT INTO oidc_links (provider_id, subject, user_id, created_at) VALUES (?,?,?,?)").run(p.id, claims.sub, userId, now());
  }
  return { userId, session: createSession(userId), provider: p.id, created: !link };
}
