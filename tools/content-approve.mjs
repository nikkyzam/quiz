#!/usr/bin/env node
/* Content versioning and approval (spec 3.5.5, 8.5, 3.5.1).

   Every unit of content — a question bank, the puzzle set, each proof, each
   lesson, each generator template — has a canonical hash. content/approvals.json
   records, per unit, the hash that was approved, by whom, in what role, when,
   and a version number that increases on every re-approval. The linter
   refuses content whose current hash differs from its approved hash: a change
   to a question is not live until someone has signed it off again.

   Roles: "author" (the person who wrote it), "educator" (a reviewer with
   competition or classroom experience, requirement 3.5.1), "editor". With
   --require-educator the status also fails for units no educator has signed.

   Usage:
     node tools/content-approve.mjs --status [--require-educator] [--json]
     node tools/content-approve.mjs --approve <unit|all> --by "Name" --role educator [--note "..."]
     node tools/content-approve.mjs --diff        # what changed since approval */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { QUESTIONS } from "../app/shared/questions.mjs";
import { PUZZLES } from "../app/shared/puzzles.mjs";
import { allProofs } from "../app/shared/proofs.mjs";
import { LESSONS } from "../app/shared/lessons.mjs";
import { TEMPLATES, generate } from "../app/shared/generators.mjs";
import { SIMULATIONS } from "../app/shared/simulations.mjs";
import { CHAPTERS } from "../app/shared/story.mjs";
import { fileURLToPath } from "node:url";

/* Resolved from this file, not the working directory, so the server (which
   runs from app/server) and the CLI (from the repo root) read the same file. */
export const FILE = fileURLToPath(new URL("../content/approvals.json", import.meta.url));

/* Canonical JSON: sorted keys, functions rendered by source, so a hash is
   stable across property order and catches a changed rule. */
function canon(v) {
  if (typeof v === "function") return v.toString();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]));
  return v;
}
export const hashOf = v => createHash("sha256").update(JSON.stringify(canon(v))).digest("hex").slice(0, 16);

export function units() {
  const out = [];
  for (const [topic, bank] of Object.entries(QUESTIONS)) out.push({ id: `bank:${topic}`, kind: "bank", hash: hashOf(bank), items: bank.length });
  out.push({ id: "puzzles", kind: "puzzles", hash: hashOf(PUZZLES), items: PUZZLES.length });
  for (const p of allProofs()) out.push({ id: `proof:${p.id}`, kind: "proof", hash: hashOf(p), items: 1 });
  for (const l of LESSONS) out.push({ id: `lesson:${l.id}`, kind: "lesson", hash: hashOf(l), items: l.panels.length });
  for (const t of Object.keys(TEMPLATES)) out.push({ id: `template:${t}`, kind: "template", hash: hashOf([TEMPLATES[t], ...Array.from({ length: 5 }, (_, s) => generate(t, s))]), items: 1 });
  for (const s of SIMULATIONS) out.push({ id: `simulation:${s.id}`, kind: "simulation", hash: hashOf(s), items: s.tasks.length });
  out.push({ id: "story", kind: "story", hash: hashOf(CHAPTERS), items: CHAPTERS.length });
  return out;
}

export function loadApprovals() {
  if (!existsSync(FILE)) return { version: 1, units: {} };
  return JSON.parse(readFileSync(FILE, "utf8"));
}
export function saveApprovals(a) {
  mkdirSync(fileURLToPath(new URL("../content", import.meta.url)), { recursive: true });
  writeFileSync(FILE, JSON.stringify(a, null, 2) + "\n");
}

/* Status of every unit against the approvals file. Pure, so the linter and
   the check can call it with an approvals object of their own. */
export function status(approvals = loadApprovals(), { requireEducator = false } = {}) {
  const rows = units().map(u => {
    const a = approvals.units[u.id];
    let state = "unapproved";
    if (a && a.hash === u.hash) state = "approved";
    else if (a) state = "changed";
    const educator = !!(a && a.hash === u.hash && a.history?.some(h => h.hash === u.hash && h.role === "educator"));
    return { ...u, state, version: a?.version || 0, approvedBy: a?.by || null, role: a?.role || null, at: a?.at || null, educator };
  });
  const problems = rows.filter(r => r.state !== "approved" || (requireEducator && !r.educator));
  return { rows, problems, ok: problems.length === 0 };
}

export function approve(approvals, unitId, { by, role = "author", note = "" }) {
  const list = units();
  const targets = unitId === "all" ? list : list.filter(u => u.id === unitId);
  if (!targets.length) throw new Error(`unknown unit ${unitId}`);
  if (!by) throw new Error("--by is required");
  if (!["author", "educator", "editor"].includes(role)) throw new Error("role must be author, educator or editor");
  const at = new Date().toISOString();
  for (const u of targets) {
    const prev = approvals.units[u.id];
    const changed = !prev || prev.hash !== u.hash;
    const version = prev ? (changed ? prev.version + 1 : prev.version) : 1;
    approvals.units[u.id] = { hash: u.hash, version, by, role, at, note: note || prev?.note || "",
      history: [...(prev?.history || []), { hash: u.hash, version, by, role, at, note }].slice(-20) };
  }
  return targets.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  if (args.includes("--approve")) {
    const a = loadApprovals();
    const n = approve(a, opt("--approve"), { by: opt("--by"), role: opt("--role", "author"), note: opt("--note", "") });
    saveApprovals(a);
    console.log(`approved ${n} unit(s) as ${opt("--role", "author")} by ${opt("--by")}`);
  } else {
    const s = status(loadApprovals(), { requireEducator: args.includes("--require-educator") });
    if (args.includes("--json")) console.log(JSON.stringify(s, null, 2));
    else {
      const show = args.includes("--diff") ? s.problems : s.rows;
      for (const r of show) console.log(`${r.state.padEnd(10)} v${r.version} ${r.id.padEnd(28)} ${r.hash} ${r.role ? `${r.role}:${r.by}` : ""}${r.educator ? " [educator]" : ""}`);
      console.log(`\n${s.rows.length} units, ${s.problems.length} needing approval${args.includes("--require-educator") ? " (educator sign-off required)" : ""}`);
    }
    process.exit(s.ok ? 0 : 1);
  }
}
