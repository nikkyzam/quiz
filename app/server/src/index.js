import express from "express";
import cookieParser from "cookie-parser";
import { attachUser } from "./auth.js";
import { securityHeaders } from "./security.js";
import { api } from "./routes.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.set("trust proxy", 1);          // correct req.ip behind a proxy
app.use(securityHeaders);
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use(attachUser);
app.use("/api", api);

/* In production the API also serves the built client, so one process and one
   URL cover the whole app. In development Vite serves it instead. */
if (process.env.NODE_ENV === "production") {
  const { existsSync } = await import("node:fs");
  const { join, dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  /* Resolve from this file, not the working directory, so it works whether
     started from the repo root or from app/server. */
  const here = dirname(fileURLToPath(import.meta.url));      // app/server/src
  const dist = resolve(here, "../../web/dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    /* Client-side routing: anything not under /api falls back to the shell. */
    app.get(/^(?!\/api).*/, (_q, s) => s.sendFile(join(dist, "index.html")));
  }
}
/* Liveness vs readiness: /health says the process is up, /ready says the
   database is actually readable. A load balancer needs the difference. */
app.get("/health", (_q, s) => s.json({ ok: true }));
app.get("/ready", async (_q, s) => {
  const { healthy } = await import("./backup.js");
  const h = healthy();
  s.status(h.ok ? 200 : 503).json(h);
});

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
