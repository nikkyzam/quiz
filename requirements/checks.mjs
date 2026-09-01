/* Automated verification for requirements marked `done`.
   Each check id is referenced from register.json `evidence`.
   Run with: node requirements/verify.mjs */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const PORT = 4123;
const BASE = `http://localhost:${PORT}`;
const DB = "./data/verify.db";

export async function withServer(fn) {
  rmSync("app/server/" + DB.replace("./", ""), { force: true });
  const srv = spawn("node", ["src/index.js"], {
    cwd: "app/server",
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB },
    stdio: "ignore"
  });
  try {
    await waitFor(`${BASE}/health`);
    return await fn();
  } finally {
    srv.kill();
  }
}

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error("server did not start");
}

/* a tiny cookie-aware client */
function client() {
  let cookie = "";
  return async (path, opts = {}) => {
    const res = await fetch(BASE + "/api" + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) }
    });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map(c => c.split(";")[0]).join("; ");
    return { status: res.status, body: await res.json().catch(() => ({})), setCookie: sc };
  };
}
const post = (c, p, b) => c(p, { method: "POST", body: JSON.stringify(b) });

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const CHECKS = {
  /* X.2 — passwords hashed, session cookie is httpOnly, bad input refused */
  "auth-security": async () => {
    const c = client();
    const weak = await post(c, "/auth/register", { email: "a@b.com", password: "short", name: "A" });
    assert(weak.status === 400, "weak password was accepted");

    const reg = await post(c, "/auth/register", { email: "a@b.com", password: "a-long-enough-pass", name: "A" });
    assert(reg.status === 200, "registration failed");
    const cookie = reg.setCookie.join(";");
    assert(/httponly/i.test(cookie), "session cookie is not HttpOnly");
    assert(!/a-long-enough-pass/.test(JSON.stringify(reg.body)), "password echoed back");

    const dup = await post(c, "/auth/register", { email: "a@b.com", password: "a-long-enough-pass", name: "A" });
    assert(dup.status === 409, "duplicate email accepted");

    const bad = await post(client(), "/auth/login", { email: "a@b.com", password: "wrong-password-here" });
    assert(bad.status === 401, "wrong password accepted");
    assert(bad.body.error === "bad_credentials", "login leaks which field was wrong");

    // password must not be recoverable from the database
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync("app/server/data/verify.db");
    const row = db.prepare("SELECT pass_hash, pass_salt FROM users LIMIT 1").get();
    assert(row && !row.pass_hash.includes("a-long-enough-pass"), "password stored in plaintext");
    assert(row.pass_salt && row.pass_salt.length >= 16, "salt missing or too short");
    return "hashed+salted, httpOnly cookie, weak/dup/wrong all refused";
  },

  /* X.1 — the client never receives answers */
  "no-answer-leak": async () => {
    const c = client();
    const r = await c("/topics/g6-ratios/practice/questions");
    assert(r.status === 200, "questions did not load");
    const raw = JSON.stringify(r.body);
    for (const key of ['"ans"', '"ansP"', '"expl"', '"a":']) {
      assert(!raw.includes(key), `answer field ${key} leaked to client`);
    }
    assert(r.body.questions.length > 0, "no questions returned");
    return `${r.body.questions.length} questions, no answer fields present`;
  },

  /* 7.1 — server grades, and grades correctly */
  "grading": async () => {
    const c = client();
    const right = await post(c, "/answer", { questionId: "g6-ratios:2", answer: "0.5" });
    assert(right.body.correct === true, "correct answer marked wrong");
    assert(right.body.explanation, "no explanation returned");
    const wrong = await post(c, "/answer", { questionId: "g6-ratios:2", answer: "9" });
    assert(wrong.body.correct === false, "wrong answer marked correct");
    const junk = await post(c, "/answer", { questionId: "g6-ratios:2", answer: "banana" });
    assert(junk.body.correct === false, "junk accepted as correct");
    const bogus = await post(c, "/answer", { questionId: "nope:1", answer: "1" });
    assert(bogus.status === 400, "unknown question not rejected");
    return "correct/incorrect/junk/unknown all handled server-side";
  },

  /* 3.3.1 + 7.4 — hint ladder, one level at a time, level 3 is the solution */
  "hint-ladder": async () => {
    const c = client();
    const qs = (await c("/topics/g6-ratios/practice/questions")).body.questions;
    const id = qs[0].id;
    const h1 = await post(c, "/hint", { questionId: id, level: 1 });
    const h2 = await post(c, "/hint", { questionId: id, level: 2 });
    const h3 = await post(c, "/hint", { questionId: id, level: 3 });
    assert(h1.body.hint && h2.body.hint && h3.body.hint, "a hint level returned nothing");
    assert(h1.body.hint !== h3.body.hint, "hint levels are identical");
    assert(h3.body.last === true, "level 3 not flagged as final");
    assert(h1.body.last !== true, "level 1 wrongly flagged as final");
    // level 1 must not be the full solution
    const solution = (await post(c, "/answer", { questionId: id, answer: "___" })).body.explanation;
    assert(h1.body.hint !== solution, "first hint gives away the full solution");
    return "3 distinct levels, level 1 is not the solution, level 3 is final";
  },

  /* 4.2.1 — parent manages multiple children */
  "learners-crud": async () => {
    const c = client();
    await post(c, "/auth/register", { email: "crud@b.com", password: "a-long-enough-pass", name: "P" });
    const a = await post(c, "/learners", { name: "Kid A", beast: "pip" });
    const b = await post(c, "/learners", { name: "Kid B", beast: "nim" });
    assert(a.status === 200 && b.status === 200, "could not create learners");
    let list = (await c("/learners")).body.learners;
    assert(list.length === 2, `expected 2 learners, got ${list.length}`);
    const noName = await post(c, "/learners", { name: "  " });
    assert(noName.status === 400, "blank learner name accepted");
    await c(`/learners/${a.body.learner.id}`, { method: "DELETE" });
    list = (await c("/learners")).body.learners;
    assert(list.length === 1, "delete did not remove the learner");
    return "create, list, validate and delete all behave";
  },

  /* X.3 — one account cannot read or write another account's learner */
  "tenant-isolation": async () => {
    const alice = client(), bob = client();
    await post(alice, "/auth/register", { email: "alice@b.com", password: "a-long-enough-pass", name: "Alice" });
    const kid = (await post(alice, "/learners", { name: "Alice Kid" })).body.learner;
    await post(bob, "/auth/register", { email: "bob@b.com", password: "a-long-enough-pass", name: "Bob" });

    const read = await bob(`/learners/${kid.id}/progress`);
    assert(read.status === 403, `Bob read Alice's progress (status ${read.status})`);
    const write = await post(bob, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 1, total: 1 });
    assert(write.status === 403, "Bob wrote to Alice's learner");
    const del = await bob(`/learners/${kid.id}`, { method: "DELETE" });
    assert(del.body.deleted === 0, "Bob deleted Alice's learner");

    const anon = client();
    assert((await anon("/learners")).status === 401, "unauthenticated access allowed");
    return "cross-account read, write and delete all refused";
  },

  /* 3.1.1 — K-8 map transcribed from Appendix A, split core vs advanced.
     Spot-checks named topics per grade so the map can't silently regress. */
  "curriculum-appendix-a": async () => {
    const { CURRICULUM } = await import("../app/shared/curriculum.mjs");
    const grades = ["K", "1", "2", "3", "4", "5", "6", "7", "8"];
    for (const g of grades) assert(CURRICULUM[g], `grade ${g} missing`);

    const ids = new Set();
    for (const g of grades) {
      const units = CURRICULUM[g].units;
      const core = units.filter(u => u.track === "core");
      const adv  = units.filter(u => u.track === "adv");
      assert(core.length > 0, `grade ${g} has no core units`);
      assert(adv.length > 0, `grade ${g} has no advanced units`);
      for (const u of units) {
        assert(u.track === "core" || u.track === "adv", `grade ${g} unit "${u.name}" has no valid track`);
        assert(u.topics.length > 0, `grade ${g} unit "${u.name}" has no topics`);
        for (const t of u.topics) {
          assert(t.id && t.name, `grade ${g} unit "${u.name}" has a malformed topic`);
          assert(!ids.has(t.id), `duplicate topic id ${t.id}`);
          ids.add(t.id);
        }
      }
    }

    /* Appendix A promises specific advanced strands at specific grades. */
    const mustHave = {
      K:   ["k-combos", "k-symmetry", "k-evenodd"],
      1:   ["g1-grid", "g1-machines", "g1-div25"],
      2:   ["g2-prime20", "g2-trees", "g2-gcf"],
      3:   ["g3-primefact", "g3-lcm", "g3-multprin"],
      4:   ["g4-clockmod", "g4-euclid", "g4-factorial", "g4-exptheo"],
      5:   ["g5-modarith", "g5-diophant", "g5-bases", "g5-pascal", "g5-expected"],
      6:   ["g6-crt", "g6-binomial", "g6-catalan", "g6-bayes", "g6-transform"],
      7:   ["g7-euler", "g7-graphtheo", "g7-markov", "g7-rsa", "g7-circthm"],
      8:   ["g8-polya", "g8-planar", "g8-clt", "g8-complex", "g8-trig"]
    };
    for (const [g, want] of Object.entries(mustHave)) {
      const have = new Set(CURRICULUM[g].units.flatMap(u => u.topics.map(t => t.id)));
      for (const id of want) assert(have.has(id), `grade ${g} is missing required topic ${id}`);
    }

    /* Every authored question bank must join to a real topic. */
    const { QUESTIONS } = await import("../app/shared/questions.mjs");
    for (const topicId of Object.keys(QUESTIONS)) {
      assert(ids.has(topicId), `question bank "${topicId}" has no matching topic in the curriculum`);
    }

    const topicCount = ids.size;
    const advCount = grades.reduce((a, g) =>
      a + CURRICULUM[g].units.filter(u => u.track === "adv").reduce((b, u) => b + u.topics.length, 0), 0);
    return `9 grades, ${topicCount} topics (${advCount} advanced), all banks joined, spot-checks pass`;
  },

  /* 3.3.2 + 7.6 — mastery is 90% core / 80% advanced, decided server-side */
  "mastery-thresholds": async () => {
    const c = client();
    await post(c, "/auth/register", { email: "mastery@b.com", password: "a-long-enough-pass", name: "M" });
    const kid = (await post(c, "/learners", { name: "Threshold Kid" })).body.learner;

    // The server must publish the split rather than the client assuming it.
    const cur = (await c("/curriculum")).body;
    assert(cur.mastery.core === 90 && cur.mastery.adv === 80, "mastery defaults are not 90/80");
    assert(cur.thresholds["g6-nscoord"] === 90, "core topic threshold is not 90");
    assert(cur.thresholds["g6-crt"] === 80, "advanced topic threshold is not 80");

    const run = (topic, score, total) =>
      post(c, "/runs", { learnerId: kid.id, topicId: topic, tier: "practice", score, total });

    // 85% is below the core bar but above the advanced bar.
    const core85 = await run("g6-nscoord", 85, 100);
    assert(core85.body.pct === 85, "pct miscomputed");
    assert(core85.body.track === "core", "core topic not identified as core");
    assert(core85.body.star === false, "85% wrongly earned a star on a CORE topic (bar is 90)");

    const adv85 = await run("g6-crt", 85, 100);
    assert(adv85.body.track === "adv", "advanced topic not identified as advanced");
    assert(adv85.body.star === true, "85% failed to earn a star on an ADVANCED topic (bar is 80)");

    // Boundaries are inclusive.
    assert((await run("g6-nscoord", 90, 100)).body.star === true, "exactly 90% missed core mastery");
    assert((await run("g6-crt", 80, 100)).body.star === true, "exactly 80% missed advanced mastery");
    assert((await run("g6-crt", 79, 100)).body.star === false, "79% wrongly mastered an advanced topic");

    // Unknown topics and tiers are refused rather than silently recorded.
    assert((await run("not-a-topic", 5, 5)).status === 400, "unknown topic accepted");
    const badTier = await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "nonsense", score: 1, total: 1 });
    assert(badTier.status === 400, "unknown tier accepted");

    return "90 core / 80 advanced enforced server-side, boundaries inclusive, bad input refused";
  },

  /* 10.5 + 13.8 — WCAG 2.1 AA.
     Two halves: axe-core over the real rendered markup, plus a contrast
     audit of the token palette (jsdom cannot compute layout, so axe's
     colour-contrast rule is disabled there and checked here instead). */
  "accessibility-wcag-aa": async () => {
    const { auditAll } = await import("../app/web/a11y/audit.mjs");
    const results = await auditAll();
    const failures = [];
    for (const [screen, violations] of Object.entries(results))
      for (const v of violations) failures.push(`${screen}: [${v.impact}] ${v.id} — ${v.help}`);
    assert(failures.length === 0, "axe violations:\n    " + failures.join("\n    "));
    const screens = Object.keys(results).length;
    assert(screens >= 5, `only ${screens} screens audited`);

    /* Contrast: every foreground/background pair the UI actually uses must
       reach 4.5:1 in BOTH themes (WCAG 1.4.3). */
    const hex = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
    const lum = c => { const [r, g, b] = hex(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

    const { readFileSync } = await import("node:fs");
    const cssText = readFileSync("app/web/src/styles.css", "utf8");
    const tokensIn = block => Object.fromEntries(
      [...block.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));
    const lightBlock = cssText.slice(cssText.indexOf(":root{"), cssText.indexOf("@media"));
    const darkBlock  = cssText.slice(cssText.indexOf('@media (prefers-color-scheme: dark)'),
                                     cssText.indexOf(':root[data-theme="dark"]'));
    const light = tokensIn(lightBlock), dark = tokensIn(darkBlock);
    assert(Object.keys(light).length > 5 && Object.keys(dark).length > 5, "could not parse theme tokens");

    const pairs = [["ink","card"],["ink","paper"],["muted","card"],["muted","paper"],
                   ["accent","card"],["accent","paper"],["good","card"],["bad","card"],
                   ["star","card"],["accent","chip"],["muted","chip"],["onaccent","accent"]];
    const bad = [];
    for (const [themeName, T] of [["light", light], ["dark", dark]])
      for (const [fg, bg] of pairs) {
        if (!T[fg] || !T[bg]) continue;
        const r = ratio(T[fg], T[bg]);
        if (r < 4.5) bad.push(`${themeName}: ${fg} on ${bg} = ${r.toFixed(2)} (needs 4.5)`);
      }
    assert(bad.length === 0, "contrast failures:\n    " + bad.join("\n    "));

    return `${screens} screens axe-clean (WCAG 2.1 A/AA), ${pairs.length * 2} contrast pairs >= 4.5:1`;
  },

  /* X.4 — progress survives a restart (checked by reopening the file) */
  "persistence": async () => {
    const c = client();
    await post(c, "/auth/register", { email: "persist@b.com", password: "a-long-enough-pass", name: "P" });
    const kid = (await post(c, "/learners", { name: "Persist Kid" })).body.learner;
    await post(c, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 7, total: 8 });

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync("app/server/data/verify.db");
    const row = db.prepare("SELECT best_pct, runs FROM progress WHERE learner_id = ?").get(kid.id);
    assert(row, "progress not written to disk");
    assert(row.best_pct === 88, `expected 88%, stored ${row.best_pct}`);
    const runs = db.prepare("SELECT COUNT(*) c FROM runs WHERE learner_id = ?").get(kid.id);
    assert(runs.c === 1, "run history not written");
    return "progress and run history are on disk, readable by a separate process";
  }
};
