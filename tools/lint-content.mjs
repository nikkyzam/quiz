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
import { allProofs, checkFreeform } from "../app/shared/proofs.mjs";
import { TEMPLATES, generate } from "../app/shared/generators.mjs";
import { LESSONS } from "../app/shared/lessons.mjs";
import { lintAssets, sceneKinds } from "../app/shared/assets.mjs";
import { figureDescribable } from "../app/shared/figures.mjs";
import { LOCALES, missingKeys } from "../app/shared/i18n.mjs";
import { status as approvalStatus, loadApprovals } from "./content-approve.mjs";

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
  if (q.type === "plot") {
    if (!Array.isArray(q.ansPt) || q.ansPt.length !== 2 || !q.ansPt.every(Number.isInteger))
      err(where, "plot answer is not an integer point");
    else if (q.grid && (q.ansPt[0] < q.grid.min || q.ansPt[0] > q.grid.max || q.ansPt[1] < q.grid.min || q.ansPt[1] > q.grid.max))
      err(where, "plot answer lies outside its grid");
  }
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

  /* Accessibility (3.5.3): a figure must be describable, or it is a picture
     with no alt text. */
  for (const key of ["fig", "figA"])
    if (q[key] && !figureDescribable(q[key])) err(where, `${key} has nothing to describe it (label a point or add alt)`);

  if (q.q && ["K", "1", "2"].includes(grade)) {
    const { words, longShare } = readingHeaviness(q.q);
    if (words > 30) warn(where, `${words} words is long for grade ${grade}`);
    if (longShare > 0.15) warn(where, `heavy vocabulary for grade ${grade}`);
  }
}

/* ---------- diversity and inclusivity (3.5.2) ----------
   Automated screening, run over every piece of learner-facing text:
   stereotype and demeaning-language patterns are errors; an imbalance in who
   appears (pronouns, names) is a warning with the numbers, so a reviewer can
   see it rather than guess. */
const STEREOTYPES = [
  { re: /\b(girls?|boys?|women|men) (are|is) (better|worse|bad|good) at\b/i, why: "gendered ability stereotype" },
  { re: /\b(girls?|women|boys?|men) (can't|cannot|don't|do not) (do|understand) (maths?|math|science)\b/i, why: "gendered ability stereotype" },
  { re: /\b(housewife|stay-at-home mum|the wife cooks|mummy cooks|daddy works)\b/i, why: "role stereotype" },
  { re: /\b(stupid|dumb|idiot|retard(ed)?|crazy|lame|fat|ugly|spaz)\b/i, why: "demeaning or ableist language" },
  { re: /\b(normal|real) (boys|girls|families)\b/i, why: "othering language" },
  { re: /\b(chinaman|gypsy|eskimo|oriental)\b/i, why: "ethnic slur or outdated term" }
];
const NAME_RE = /\b([A-Z][a-z]{2,})\b(?= (has|have|had|buys|bought|shares|shared|eats|ate|found|finds|counts|counted|builds|built|gives|gave|gets|got|makes|made|cuts|cut|walks|runs|is|was|puts|packs|says|said|reads|draws|drew|picks|picked|plants|sells|sold|earns|owns|needs|wants|jumps|throws|threw|sees|saw|takes|took)\b)/g;
const NON_NAMES = new Set(["The", "This", "That", "There", "Each", "Every", "Which", "What", "How", "Who", "Many", "Some", "All", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Pip", "Nim", "Vex", "It", "She", "He", "They", "You", "Then", "Now", "So", "If", "When", "Point", "Start", "Person", "Someone", "Nobody", "Everyone", "Max", "Ms", "Mr"]);

export function lintDiversity(texts) {
  const errors = [], warnings = [];
  let he = 0, she = 0, they = 0;
  const names = new Map();
  for (const { where, text } of texts) {
    const t = String(text || "");
    for (const s of STEREOTYPES) if (s.re.test(t)) errors.push(`${where}: ${s.why} — "${t.match(s.re)[0]}"`);
    he += (t.match(/\b(he|his|him)\b/gi) || []).length;
    she += (t.match(/\b(she|her|hers)\b/gi) || []).length;
    they += (t.match(/\b(they|their|them)\b/gi) || []).length;
    for (const m of t.matchAll(NAME_RE)) if (!NON_NAMES.has(m[1])) names.set(m[1], (names.get(m[1]) || 0) + 1);
  }
  const total = he + she;
  if (total >= 10 && (he / total > 0.75 || she / total > 0.75))
    warnings.push(`pronoun balance: he/him ${he} vs she/her ${she} (${they} they/them) — one gender carries more than 75% of gendered pronouns`);
  const top = [...names].sort((a, b) => b[1] - a[1]);
  const uses = top.reduce((a, [, n]) => a + n, 0);
  if (uses >= 10 && top.length < 6) warnings.push(`name diversity: only ${top.length} distinct names across ${uses} uses (${top.slice(0, 5).map(([n, c]) => `${n}×${c}`).join(", ")})`);
  if (uses >= 10 && top[0][1] / uses > 0.5) warnings.push(`name diversity: "${top[0][0]}" is ${Math.round(top[0][1] / uses * 100)}% of all named characters`);
  return { errors, warnings, pronouns: { he, she, they }, names: Object.fromEntries(top) };
}

/* ---------- lessons (3.2.1, 3.5.3, 8.2) ---------- */
export function lintLesson(l, registeredKinds = sceneKinds()) {
  const errors = [], warnings = [];
  const where = `lesson:${l.id}`;
  if (!l.panels?.length || l.panels.length < 3) errors.push(`${where}: too few panels`);
  if (!l.panels?.some(p => p.check)) errors.push(`${where}: no interactive check`);
  (l.panels || []).forEach((p, i) => {
    const w = `${where}#${i + 1}`;
    if (!p.alt || String(p.alt).trim().length < 10) errors.push(`${w}: missing or trivial alt text`);
    if (!p.art?.kind) errors.push(`${w}: no art`);
    else if (!registeredKinds.includes(p.art.kind)) errors.push(`${w}: art kind "${p.art.kind}" is not in the asset registry`);
    if (!p.text || p.text.length < 10) errors.push(`${w}: no narration`);
    if (p.check) {
      const r = lintQuestion({ sec: "N", ...p.check }, w + ":check", l.grade, new Map());
      errors.push(...r.errors); warnings.push(...r.warnings);
    }
  });
  return { errors, warnings };
}

/* Public: lint one question in isolation. */
export function lintQuestion(q, where = "q", grade = null, seenText = new Map()) {
  const errors = [], warnings = [];
  applyRules(q, where, grade,
    seenText, (w, m) => errors.push(`${w}: ${m}`), (w, m) => warnings.push(`${w}: ${m}`));
  return { errors, warnings };
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
    if (pr.kind === "freeform") {
      /* A rubric proof must carry a reference proof that its own rubric
         accepts, or the rubric may be unsatisfiable. */
      if (!pr.rubric?.length || pr.rubric.some(r => !r.accept?.length || !r.must)) err(`proof:${pr.id}`, "rubric incomplete");
      if (!pr.reference?.length) err(`proof:${pr.id}`, "no reference proof");
      else {
        const r = checkFreeform(pr, { lines: pr.reference });
        if (!r.correct) err(`proof:${pr.id}`, `reference proof fails its own rubric (missing ${r.missing.map(m => m.key).join(", ")})`);
        if (checkFreeform(pr, { lines: ["This is obviously true."] }).correct) err(`proof:${pr.id}`, "rubric accepts a non-proof");
      }
      continue;
    }
    if (!pr.steps || !pr.steps.length) err(`proof:${pr.id}`, "no steps");
    if (pr.kind === "reasons") {
      if (pr.steps.some(s => !s.reason)) err(`proof:${pr.id}`, "a step has no reason");
      if (pr.reasonBank && pr.steps.some(s => s.reason && !pr.reasonBank.includes(s.reason)))
        err(`proof:${pr.id}`, "a correct reason is missing from the reason bank");
    }
  }

  /* Lessons, assets, localisation, diversity and approvals. */
  for (const l of LESSONS) { const r = lintLesson(l); errors.push(...r.errors); warnings.push(...r.warnings); }
  errors.push(...lintAssets().map(e => `assets: ${e}`));
  for (const loc of Object.keys(LOCALES)) { const m = missingKeys(loc); if (m.length) err(`i18n:${loc}`, `missing ${m.length} keys: ${m.slice(0, 3).join(", ")}`); }
  const texts = [];
  for (const [topic, bank] of Object.entries(QUESTIONS)) bank.forEach((q, i) => texts.push({ where: `${topic}#${i + 1}`, text: [q.q, q.expl, q.hint, ...(q.opts || [])].join(" ") }));
  for (const p of PUZZLES) texts.push({ where: `puzzle:${p.id}`, text: [p.prompt, ...p.hints].join(" ") });
  for (const l of LESSONS) l.panels.forEach((p, i) => texts.push({ where: `lesson:${l.id}#${i + 1}`, text: [p.text, p.alt, p.check?.q].join(" ") }));
  const div = lintDiversity(texts);
  errors.push(...div.errors); warnings.push(...div.warnings);
  /* Approval workflow (3.5.5): content whose hash differs from its approved
     hash is an error; it goes live only after re-approval. */
  const ap = approvalStatus(loadApprovals());
  for (const u of ap.problems) err(`approval:${u.id}`, u.state === "changed" ? `changed since approval v${u.version} by ${u.by}; re-approve with tools/content-approve.mjs` : "never approved");

  for (const topic of Object.keys(TEMPLATES)) {
    for (let seed = 0; seed < 25; seed++) {
      const g = generate(topic, seed);
      if (!g) { err(`template:${topic}`, `seed ${seed} produced nothing`); break; }
      if (g.type === "in" && !Number.isFinite(g.ans))
        err(`template:${topic}`, `seed ${seed} produced a non-finite answer`);
      if (!g.expl) err(`template:${topic}`, `seed ${seed} produced no explanation`);
    }
  }

  return {
    errors, warnings,
    banks: Object.keys(QUESTIONS).length,
    questions: Object.values(QUESTIONS).reduce((a, b) => a + b.length, 0),
    puzzles: PUZZLES.length,
    proofs: allProofs().length,
    templates: Object.keys(TEMPLATES).length,
    lessons: LESSONS.length,
    approvals: { units: ap.rows.length, approved: ap.rows.filter(r => r.state === "approved").length, educator: ap.rows.filter(r => r.educator).length },
    diversity: { pronouns: div.pronouns, distinctNames: Object.keys(div.names).length }
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
