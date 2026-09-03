#!/usr/bin/env node
/* Content quality checks (spec 8.5).

   Runs over every authored question, puzzle, proof and generator template and
   reports what an author would want to know before publishing: mathematical
   inconsistency, unreachable answers, wording that gives the answer away,
   reading level far above the grade, and duplicates.

   The rules are exported so they can be tested against deliberately broken
   content — a linter nobody has seen fire is not evidence of anything.

   Usage: node tools/lint-content.mjs [--json]
*/

import { QUESTIONS, SECS } from "../app/shared/questions.mjs";
import { CURRICULUM } from "../app/shared/curriculum.mjs";
import { PUZZLES } from "../app/shared/puzzles.mjs";
import { allProofs } from "../app/shared/proofs.mjs";
import { TEMPLATES, generate } from "../app/shared/generators.mjs";

/* Crude on purpose: it flags a Kindergarten question written like a legal
   notice, not subtle differences of style. */
function readingHeaviness(text) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const long = words.filter(w => w.replace(/[^a-z]/gi, "").length >= 9).length;
  return { words: words.length, longShare: words.length ? long / words.length : 0 };
}

function gradeOfTopic(id) {
  for (const [g, v] of Object.entries(CURRICULUM))
    for (const u of v.units) for (const t of u.topics) if (t.id === id) return g;
  return null;
}

/* All per-question rules live here so the CLI and the tests share them. */
function applyRules(q, where, grade, seenText, err, warn) {
  if (!q.expl) err(where, "no explanation");
  if (!SECS[q.sec]) err(where, `unknown section "${q.sec}"`);
  if (!q.q || q.q.trim().length < 8) err(where, "question text is empty or too short");

  if (q.q) {
    const key = q.q.trim().toLowerCase();
    if (seenText.has(key)) err(where, `duplicates ${seenText.get(key)}`);
    else seenText.set(key, where);
  }

  if (q.expl && q.q && q.expl.trim().toLowerCase() === q.q.trim().toLowerCase())
    err(where, "explanation merely repeats the question");
  if (q.hint && q.expl && q.hint.trim() === q.expl.trim())
    err(where, "hint is identical to the full explanation");

  if (q.type === "mc") {
    if (!q.opts || q.opts[q.a] === undefined) err(where, "answer index does not point at an option");
    if (q.opts && new Set(q.opts).size !== q.opts.length) err(where, "duplicate options");
    if (q.opts && q.opts.length < 2) err(where, "fewer than two options");
    if (q.opts && q.opts.length > 2 && q.opts[q.a] !== undefined) {
      const lens = q.opts.map(o => String(o).length);
      const answerLen = lens[q.a];
      const maxOther = Math.max(...lens.filter((_, k) => k !== q.a));
      if (answerLen > maxOther * 2 && answerLen > 25)
        warn(where, "the correct option is much longer than the others");
    }
  }
  if (q.type === "in" && typeof q.ans !== "number") err(where, "numeric answer is not a number");
  if (q.type === "pair" && (!Array.isArray(q.ansP) || q.ansP.length !== 2))
    err(where, "ordered pair answer malformed");
  if (q.type === "multi") {
    if (!q.aMulti || !q.aMulti.length) err(where, "no correct selections");
    else if (q.opts && q.aMulti.length === q.opts.length) err(where, "every option marked correct");
  }
  if (q.type === "order") {
    const a = [...(q.items || [])].sort().join("|");
    const b = [...(q.ansOrder || [])].sort().join("|");
    if (a !== b) err(where, "ansOrder is not a permutation of items");
    if ((q.items || []).length < 3) err(where, "too few items to order");
  }

  if (q.q && ["K", "1", "2"].includes(grade)) {
    const { words, longShare } = readingHeaviness(q.q);
    if (words > 30) warn(where, `${words} words is long for grade ${grade}`);
    if (longShare > 0.15) warn(where, `heavy vocabulary for grade ${grade}`);
  }
}

/* Public: lint one question in isolation. */
export function lintQuestion(q, where = "q", grade = null, seenText = new Map()) {
  const errors = [], warnings = [];
  applyRules(q, where, grade,
    seenText, (w, m) => errors.push(`${w}: ${m}`), (w, m) => warnings.push(`${w}: ${m}`));
  return { errors, warnings };
}

/* Diversity and stereotype scan (spec 3.5.2). Automated pattern-matching is
   a first pass, not a substitute for human editorial review -- it catches
   the crude, common failure modes (a name pool that skews overwhelmingly to
   one cultural background, a role tied to a gendered pronoun) but cannot
   judge nuance. Findings are reported for a human to weigh, not auto-fixed. */
const STEREOTYPE_PATTERNS = [
  { re: /\bhe\b[^.?!]*\b(builds?|fixes?|drives?|plays?\s+(football|soccer|basketball))/i,
    msg: "a male pronoun paired with a stereotypically 'boy' activity" },
  { re: /\bshe\b[^.?!]*\b(bakes?|sews?|shops?|cooks?)/i,
    msg: "a female pronoun paired with a stereotypically 'girl' activity" },
  { re: /\b(fireman|policeman|mailman|stewardess|chairman)\b/i,
    msg: "a gendered job title where a neutral one exists" }
];

export function scanDiversity(questions) {
  const findings = [];
  const names = new Map();
  for (const [where, q] of questions) {
    for (const p of STEREOTYPE_PATTERNS)
      if (p.re.test(q.q)) findings.push(`${where}: ${p.msg}`);
    const caps = q.q.match(/\b[A-Z][a-z]{2,}\b/g) || [];
    const SKIP = new Set(["The","What","How","Which","Find","Write","A","An","In","On","If",
      "Order","Put","Select","Compare","Round","Circle","Type","Choose","Start","Where","You",
      "There","Can","Two","Three","One","Using","That","Quadrant","Look","Move","Points","Point",
      "Reflect","When","Working","After","Count"]);
    for (const c of caps) if (!SKIP.has(c)) names.set(c, (names.get(c) || 0) + 1);
  }
  /* A cast of characters concentrated in fewer than 3 names suggests the
     content leans on the same one or two people rather than a varied cast.
     This cannot detect cultural skew reliably without a name-origin
     database, which would itself be a bias risk -- so it is left to the
     human note below rather than automated. */
  if (names.size > 0 && names.size < 3)
    findings.push(`cast of characters is only ${names.size} name(s): ${[...names.keys()].join(", ")}`);
  return { findings, castSize: names.size, names: Object.fromEntries(names) };
}

/* Public: lint everything. */
export function runAll() {
  const errors = [], warnings = [];
  const err = (w, m) => errors.push(`${w}: ${m}`);
  const warn = (w, m) => warnings.push(`${w}: ${m}`);

  for (const [topic, bank] of Object.entries(QUESTIONS)) {
    const grade = gradeOfTopic(topic);
    const seenText = new Map();
    bank.forEach((q, i) => applyRules(q, `${topic}#${i + 1}`, grade, seenText, err, warn));
    const tiers = new Set(bank.map(q => q.lvl || 1));
    if (bank.length < 5) err(topic, `only ${bank.length} questions`);
    if (tiers.size < 2) err(topic, "questions sit at a single difficulty tier");
  }

  for (const p of PUZZLES) {
    if (!p.hints || !p.hints.length) err(`puzzle:${p.id}`, "no hints");
    if (!p.accepts || !p.accepts.length) err(`puzzle:${p.id}`, "no accepted answer");
    if (p.hints && p.accepts &&
        p.hints.some(h => p.accepts.some(a => String(h).includes(String(a)))))
      warn(`puzzle:${p.id}`, "a hint contains the answer");
  }

  for (const pr of allProofs()) {
    if (!pr.steps || !pr.steps.length) err(`proof:${pr.id}`, "no steps");
    if (pr.kind === "reasons") {
      if (pr.steps.some(s => !s.reason)) err(`proof:${pr.id}`, "a step has no reason");
      if (pr.reasonBank && pr.steps.some(s => s.reason && !pr.reasonBank.includes(s.reason)))
        err(`proof:${pr.id}`, "a correct reason is missing from the reason bank");
    }
  }

  for (const topic of Object.keys(TEMPLATES)) {
    for (let seed = 0; seed < 25; seed++) {
      const g = generate(topic, seed);
      if (!g) { err(`template:${topic}`, `seed ${seed} produced nothing`); break; }
      if (g.type === "in" && !Number.isFinite(g.ans))
        err(`template:${topic}`, `seed ${seed} produced a non-finite answer`);
      if (!g.expl) err(`template:${topic}`, `seed ${seed} produced no explanation`);
    }
  }

  const named = [];
  for (const [topic, bank] of Object.entries(QUESTIONS))
    bank.forEach((q, i) => named.push([`${topic}#${i + 1}`, q]));
  const diversity = scanDiversity(named);
  diversity.findings.forEach(f => warn("diversity", f));

  return {
    errors, warnings, diversity,
    banks: Object.keys(QUESTIONS).length,
    questions: Object.values(QUESTIONS).reduce((a, b) => a + b.length, 0),
    puzzles: PUZZLES.length,
    proofs: allProofs().length,
    templates: Object.keys(TEMPLATES).length
  };
}

/* Only run when invoked directly, so importing the rules does not execute the
   scan or exit the process. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runAll();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`Content lint: ${r.questions} questions in ${r.banks} banks, ` +
                `${r.puzzles} puzzles, ${r.proofs} proofs, ${r.templates} templates`);
    if (r.errors.length) { console.log("\nERRORS"); r.errors.forEach(e => console.log("  " + e)); }
    if (r.warnings.length) { console.log("\nWARNINGS"); r.warnings.forEach(w => console.log("  " + w)); }
    if (!r.errors.length && !r.warnings.length) console.log("\nNo problems found.");
  }
  process.exit(r.errors.length ? 1 : 0);
}
