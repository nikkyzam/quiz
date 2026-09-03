/* Security surface (spec 10.3, 11.6): OpenID Connect sign-in, key status for
   the operator, and the admin's view of what is encrypted. */

import { Router } from "express";
import { db } from "./db.js";
import { requireAuth } from "./auth.js";
import { audit, requireRole } from "./security.js";
import * as oidc from "./oidc.js";
import { keyReport, currentKeyId } from "./crypto.js";

export const securityRoutes = Router();
const requireAdmin = requireRole("admin");
const publicBase = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;

/* ---------------- OIDC (11.6, 9.1) ---------------- */
securityRoutes.get("/auth/oidc/providers", (_req, res) => res.json({ providers: oidc.publicProviders() }));

securityRoutes.get("/auth/oidc/:id/start", (req, res) => {
  const r = oidc.begin(req.params.id, `${publicBase(req)}/api/auth/oidc/${encodeURIComponent(req.params.id)}/callback`);
  if (r.error) return res.status(404).json({ error: r.error });
  res.redirect(302, r.redirect);
});

securityRoutes.get("/auth/oidc/:id/callback", async (req, res) => {
  try {
    const r = await oidc.complete({ code: req.query.code, state: req.query.state });
    res.cookie("sid", r.session.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/",
                                      expires: new Date(r.session.expires) });
    audit(r.userId, "auth.oidc.login", `${r.provider}:${r.created ? "linked" : "returning"}`, req);
    res.redirect(302, "/");
  } catch (e) {
    audit(null, "auth.oidc.rejected", String(e.message).slice(0, 120), req);
    res.status(401).json({ error: "oidc_login_rejected", detail: e.message });
  }
});

securityRoutes.post("/admin/oidc/providers", requireAuth, requireAdmin, (req, res) => {
  const r = oidc.registerProvider(req.body || {});
  if (r.error) return res.status(400).json(r);
  audit(req.user.id, "oidc.provider.registered", r.id, req);
  res.json({ provider: { id: r.id } });
});

/* ---------------- key management (10.3, 11.6) ----------------
   What is encrypted, under which key, and whether anything is still in
   clear — the numbers an operator needs before and after a rotation. */
securityRoutes.get("/admin/keys", requireAuth, requireAdmin, (req, res) => {
  audit(req.user.id, "admin.keys.read", null, req);
  res.json({ ...keyReport(db), currentKeyId: currentKeyId(),
             rotation: "Set DATA_KEY to the new key and DATA_KEY_PREVIOUS to the old one, restart, then POST /api/admin/jobs/rekey." });
});
