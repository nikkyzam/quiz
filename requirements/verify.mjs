/* Verifies the register against reality.
   - runs every automated check
   - fails if a requirement claims `done` without a passing check
   - prints a status report

   Usage: node requirements/verify.mjs [--report]
*/
import { readFileSync, writeFileSync } from "node:fs";
import { CHECKS, withServer } from "./checks.mjs";

const register = JSON.parse(readFileSync("requirements/register.json", "utf8"));
const reqs = register.requirements;

const results = await withServer(async () => {
  const out = {};
  for (const [id, fn] of Object.entries(CHECKS)) {
    try { out[id] = { pass: true, detail: await fn() }; }
    catch (e) { out[id] = { pass: false, detail: e.message }; }
  }
  return out;
});

/* --- integrity: `done` must be backed by a passing check --- */
const violations = [];
for (const r of reqs) {
  if (r.status !== "done") continue;
  const key = (r.evidence || "").replace(/^check:/, "");
  if (!key) { violations.push(`${r.id} is done with no evidence`); continue; }
  if (!results[key]) { violations.push(`${r.id} references unknown check "${key}"`); continue; }
  if (!results[key].pass) violations.push(`${r.id} is done but check "${key}" FAILED: ${results[key].detail}`);
}

/* --- report --- */
const tally = {};
for (const r of reqs) tally[r.status] = (tally[r.status] || 0) + 1;
const total = reqs.length;
const pct = n => Math.round((n / total) * 100);

const lines = [];
lines.push("BeastForge — requirements status");
lines.push("=".repeat(52));
lines.push(`Total requirements: ${total}`);
for (const s of ["done", "partial", "todo", "blocked", "deferred"]) {
  if (tally[s]) lines.push(`  ${s.padEnd(9)} ${String(tally[s]).padStart(3)}  (${pct(tally[s])}%)`);
}
lines.push("");
lines.push("Automated checks");
lines.push("-".repeat(52));
for (const [id, r] of Object.entries(results)) {
  lines.push(`  ${r.pass ? "PASS" : "FAIL"}  ${id.padEnd(18)} ${r.detail}`);
}
lines.push("");

if (violations.length) {
  lines.push("INTEGRITY FAILURES");
  lines.push("-".repeat(52));
  violations.forEach(v => lines.push("  " + v));
  lines.push("");
}

/* next actionable work: highest priority, not done, not blocked */
const next = reqs
  .filter(r => r.status === "todo" || r.status === "partial")
  .sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id))
  .slice(0, 8);
lines.push("Next up (priority 1 first, blocked excluded)");
lines.push("-".repeat(52));
next.forEach(r => lines.push(`  [${r.status.padEnd(7)}] ${r.id.padEnd(7)} ${r.title}`));
lines.push("");

const blocked = reqs.filter(r => r.status === "blocked");
if (blocked.length) {
  lines.push("Blocked — needs something only you can provide");
  lines.push("-".repeat(52));
  blocked.forEach(r => lines.push(`  ${r.id.padEnd(7)} ${r.title}\n           ↳ ${r.notes || ""}`));
}

const report = lines.join("\n");
console.log(report);
if (process.argv.includes("--report")) writeFileSync("requirements/STATUS.txt", report + "\n");

const failed = Object.values(results).filter(r => !r.pass).length;
process.exit(failed || violations.length ? 1 : 0);
