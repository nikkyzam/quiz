import { db, now } from "./db.js";
import { randomUUID } from "node:crypto";

/* ---------- security headers ----------
   Hand-rolled rather than pulling in helmet: this is the whole set that
   applies to a JSON API plus a same-origin SPA. */
export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), interest-cohort=()");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (process.env.NODE_ENV === "production")
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.removeHeader("X-Powered-By");
  next();
}

/* ---------- rate limiting ----------
   Fixed-window counter per key. In-memory is correct for a single node;
   a multi-node deployment would move this to Redis. */
const buckets = new Map();
export function rateLimit({ windowMs, max, key = req => req.ip, message = "too_many_requests" }) {
  return (req, res, next) => {
    const k = key(req);
    const nowMs = Date.now();
    let b = buckets.get(k);
    if (!b || nowMs > b.resetAt) { b = { count: 0, resetAt: nowMs + windowMs }; buckets.set(k, b); }
    b.count++;
    const remaining = Math.max(0, max - b.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((b.resetAt - nowMs) / 1000)));
    if (b.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - nowMs) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
/* Tests need a way to start clean. */
export const resetRateLimits = () => buckets.clear();

/* ---------- audit log ----------
   Spec 4.4.3 and 10.3 require an audit trail for data access. Records who
   did what, when, and from where — never what the payload contained. */
export function audit(userId, action, detail = null, req = null) {
  try {
    db.prepare(`INSERT INTO audit_log (id, user_id, action, detail, ip, at)
                VALUES (?,?,?,?,?,?)`)
      .run(randomUUID(), userId, action, detail, req?.ip || null, now());
  } catch { /* auditing must never break the request */ }
}

export function auditTrail(userId, limit = 100) {
  return db.prepare("SELECT action, detail, ip, at FROM audit_log WHERE user_id = ? ORDER BY at DESC LIMIT ?")
    .all(userId, limit);
}

/* ---------- roles (RBAC) ---------- */
export const ROLES = ["parent", "teacher", "admin"];
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "not_signed_in" });
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}
