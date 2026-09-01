import express from "express";
import cookieParser from "cookie-parser";
import { attachUser } from "./auth.js";
import { api } from "./routes.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use(attachUser);
app.use("/api", api);
app.get("/health", (_q, s) => s.json({ ok: true }));

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
