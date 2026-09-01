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
app.get("/health", (_q, s) => s.json({ ok: true }));

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
