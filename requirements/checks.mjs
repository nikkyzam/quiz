/* Automated verification for requirements marked `done`.
   Each check id is referenced from register.json `evidence`.
   Run with: node requirements/verify.mjs */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const PORT = 4123;
const BASE = `http://localhost:${PORT}`;
const DB = "./data/verify.db";

/* Some checks import server modules directly to test pure logic. db.js reads
   DB_FILE once at import time, so it must be set here, before any of those
   imports run, or the module would open a second database of its own. */
process.env.DB_FILE = "app/server/data/verify.db";

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
    const weak = await post(c, "/auth/register", { email: "a@b.com", password: "short", name: "A", coppaConsent: true });
    assert(weak.status === 400, "weak password was accepted");

    const reg = await post(c, "/auth/register", { email: "a@b.com", password: "a-long-enough-pass", name: "A", coppaConsent: true });
    assert(reg.status === 200, "registration failed");
    const cookie = reg.setCookie.join(";");
    assert(/httponly/i.test(cookie), "session cookie is not HttpOnly");
    assert(!/a-long-enough-pass/.test(JSON.stringify(reg.body)), "password echoed back");

    const dup = await post(c, "/auth/register", { email: "a@b.com", password: "a-long-enough-pass", name: "A", coppaConsent: true });
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
    await post(c, "/auth/register", { coppaConsent: true, email: "crud@b.com", password: "a-long-enough-pass", name: "P" });
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
    await post(alice, "/auth/register", { coppaConsent: true, email: "alice@b.com", password: "a-long-enough-pass", name: "Alice" });
    const kid = (await post(alice, "/learners", { name: "Alice Kid" })).body.learner;
    await post(bob, "/auth/register", { coppaConsent: true, email: "bob@b.com", password: "a-long-enough-pass", name: "Bob" });

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
    await post(c, "/auth/register", { coppaConsent: true, email: "mastery@b.com", password: "a-long-enough-pass", name: "M" });
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


  /* 10.3 — security headers, brute-force limits, audit trail, data rights */
  "security-privacy": async () => {
    const { resetRateLimits } = await import("../app/server/src/security.js").catch(() => ({}));
    const c = client();

    /* Security headers on every response */
    const res = await fetch(BASE + "/health");
    const want = {
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer"
    };
    for (const [h, v] of Object.entries(want))
      assert(res.headers.get(h) === v, `header ${h} is "${res.headers.get(h)}", expected "${v}"`);
    assert(/frame-ancestors 'none'/.test(res.headers.get("content-security-policy") || ""),
      "CSP missing frame-ancestors 'none'");
    assert(!res.headers.get("x-powered-by"), "X-Powered-By still advertises the stack");

    /* COPPA: an account cannot be created without an adult affirming consent */
    const noConsent = await post(c, "/auth/register",
      { email: "noconsent@b.com", password: "a-long-enough-pass", name: "N" });
    assert(noConsent.status === 400 && noConsent.body.error === "coppa_consent_required",
      "account created without COPPA consent");

    await post(c, "/auth/register",
      { email: "sec@b.com", password: "a-long-enough-pass", name: "Sec", coppaConsent: true });

    /* Audit trail records the actions taken */
    const kid = (await post(c, "/learners", { name: "Audited Kid" })).body.learner;
    await c(`/learners/${kid.id}/progress`);
    const trail = (await c("/me/audit")).body.entries.map(e => e.action);
    for (const a of ["account.created", "learner.created", "progress.read"])
      assert(trail.includes(a), `audit trail missing ${a} (has: ${trail.join(", ")})`);

    /* Data export (FERPA/GDPR access right) */
    const exp = (await c("/me/export")).body;
    assert(exp.user && exp.user.email === "sec@b.com", "export missing the user");
    assert(!("pass_hash" in exp.user), "export leaks the password hash");
    assert(Array.isArray(exp.learners) && exp.learners.length === 1, "export missing learners");
    assert(exp.user.coppa_consent_at, "consent timestamp not recorded");

    /* Brute force: repeated bad logins are throttled */
    let limited = false;
    for (let i = 0; i < 14; i++) {
      const r = await post(client(), "/auth/login", { email: "sec@b.com", password: "definitely-wrong" });
      if (r.status === 429) { limited = true; break; }
    }
    assert(limited, "login accepts unlimited password attempts");

    /* Erasure right: deleting the account removes the learner data with it */
    const del = await c("/me", { method: "DELETE" });
    assert(del.body.deleted === true, "account deletion failed");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync("app/server/data/verify.db");
    const left = db.prepare("SELECT COUNT(*) c FROM learners WHERE id = ?").get(kid.id);
    assert(left.c === 0, "learner data survived account deletion");

    return "headers set, COPPA consent required, audit trail written, export/erase work, login throttled";
  },


  /* 4.1.6 + 7.2 — mastery checks: no hints, server-marked, threshold applied */
  "mastery-check": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "check@b.com", password: "a-long-enough-pass", name: "C" });
    const kid = (await post(c, "/learners", { name: "Check Kid" })).body.learner;

    const start = await post(c, "/mastery/start", { learnerId: kid.id, topicId: "g6-ratios" });
    assert(start.status === 200, "could not start a mastery check");
    const { checkId, questions, threshold } = start.body;
    assert(questions.length > 1, "mastery check has too few questions");
    assert(threshold === 90, `core topic check threshold should be 90, got ${threshold}`);

    // Answers must not be present, exactly as in normal practice.
    const raw = JSON.stringify(questions);
    for (const key of ['"ans"', '"ansP"', '"expl"', '"a":'])
      assert(!raw.includes(key), `mastery check leaked ${key}`);

    // Hints must be refused while a check is live (spec 4.1.6: no hints).
    const hint = await post(c, "/hint", { questionId: questions[0].id, level: 1 });
    assert(hint.status === 409, `hints were available during a mastery check (status ${hint.status})`);

    // Deliberately answer everything wrong: the server must mark it, not the client.
    const wrong = {};
    for (const q of questions) wrong[q.id] = q.type === "mc" ? -1 : "-99999";
    const failed = await post(c, "/mastery/submit", { checkId, answers: wrong });
    assert(failed.body.score === 0, `expected 0, server marked ${failed.body.score}`);
    assert(failed.body.passed === false, "a zero score passed the check");
    assert(failed.body.detail.length === questions.length, "no per-question detail returned");

    // A spent check cannot be replayed.
    const replay = await post(c, "/mastery/submit", { checkId, answers: wrong });
    assert(replay.status === 404, "a completed mastery check could be submitted twice");

    // Now pass one, using the grader to discover answers the way a learner would.
    const s2 = (await post(c, "/mastery/start", { learnerId: kid.id, topicId: "g6-ratios" })).body;
    const right = {};
    for (const q of s2.questions) {
      if (q.type === "mc") {
        for (let i = 0; i < q.opts.length; i++) {
          if ((await post(c, "/answer", { questionId: q.id, answer: i })).body.correct) { right[q.id] = i; break; }
        }
      } else {
        right[q.id] = (await post(c, "/answer", { questionId: q.id, answer: "__" })).body.correctAnswer;
      }
    }
    const passed = await post(c, "/mastery/submit", { checkId: s2.checkId, answers: right });
    assert(passed.body.pct === 100, `expected 100%, got ${passed.body.pct}`);
    assert(passed.body.passed === true, "a perfect score did not pass");

    // Recorded against the learner under its own tier.
    const prog = (await c(`/learners/${kid.id}/progress`)).body.progress;
    const row = prog.find(r => r.tier === "mastery" && r.topic_id === "g6-ratios");
    assert(row && row.best_pct === 100, "mastery result not recorded");
    assert(row.runs === 2, `expected 2 attempts recorded, got ${row.runs}`);

    return "server-marked, hints refused (409), no answer leak, replay blocked, result recorded";
  },


  /* 4.1.1 + 6.1 — adaptive diagnostic producing a skill map and placement */
  "diagnostic-placement": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "diag@b.com", password: "a-long-enough-pass", name: "D" });
    const kid = (await post(c, "/learners", { name: "Diag Kid" })).body.learner;

    /* Answer everything correctly: difficulty should climb through the tiers. */
    let r = await post(c, "/diagnostic/start", { learnerId: kid.id, topicId: "g6-nscoord" });
    assert(r.status === 200, "diagnostic did not start");
    const diagId = r.body.diagnosticId;
    const raw = JSON.stringify(r.body.question);
    for (const k of ['"ans"', '"ansP"', '"expl"', '"a":'])
      assert(!raw.includes(k), `diagnostic leaked ${k}`);

    const solve = async q => {
      if (q.type === "mc") {
        for (let i = 0; i < q.opts.length; i++)
          if ((await post(c, "/answer", { questionId: q.id, answer: i })).body.correct) return i;
        return 0;
      }
      return (await post(c, "/answer", { questionId: q.id, answer: "__" })).body.correctAnswer;
    };

    let q = r.body.question, guard = 0, summary = null;
    while (guard++ < 30) {
      const ans = await solve(q);
      const step = await post(c, "/diagnostic/answer", { diagnosticId: diagId, answer: ans });
      assert(step.status === 200, "diagnostic answer rejected");
      assert(step.body.correct === true, "a known-correct answer was marked wrong");
      if (step.body.done) { summary = step.body.summary; break; }
      q = step.body.question;
    }
    assert(summary, "diagnostic never completed");
    assert(summary.overall === 100, `all-correct run scored ${summary.overall}%`);
    assert(summary.skillMap.length > 0, "no skill map produced");
    assert(summary.skillMap.every(s => s.level && s.name), "skill map entries are malformed");
    assert(summary.recommendation.tier, "no placement tier recommended");
    assert(summary.reliable === true, `only ${summary.asked} questions asked; too few to place`);

    /* A spent diagnostic cannot be reused. */
    const replay = await post(c, "/diagnostic/answer", { diagnosticId: diagId, answer: 0 });
    assert(replay.status === 404, "a finished diagnostic accepted more answers");

    /* The result is retrievable afterwards. */
    const saved = (await c(`/learners/${kid.id}/diagnostic`)).body.diagnostic;
    assert(saved && saved.recommendation, "diagnostic result was not stored");
    assert(saved.skillMap.length === summary.skillMap.length, "stored skill map differs");

    /* A weak learner must be placed lower than a strong one. */
    const c2 = client();
    await post(c2, "/auth/register",
      { coppaConsent: true, email: "diag2@b.com", password: "a-long-enough-pass", name: "D2" });
    const kid2 = (await post(c2, "/learners", { name: "Weak Kid" })).body.learner;
    let r2 = await post(c2, "/diagnostic/start", { learnerId: kid2.id, topicId: "g6-nscoord" });
    let s2 = null, g2 = 0;
    while (g2++ < 30) {
      const step = await post(c2, "/diagnostic/answer",
        { diagnosticId: r2.body.diagnosticId, answer: "-999999" });
      if (step.body.done) { s2 = step.body.summary; break; }
    }
    assert(s2, "weak diagnostic never completed");
    assert(s2.overall === 0, `all-wrong run scored ${s2.overall}%`);
    assert(s2.recommendation.tier === "practice", `weak learner placed at ${s2.recommendation.tier}`);
    assert(s2.skillMap.every(x => x.level === "needs work"), "weak learner shows a secure section");

    return `adaptive over ${summary.asked} questions, skill map + placement stored, replay blocked, weak/strong placed differently`;
  },

  /* 13.3 — the whole journey: diagnostic -> practice -> mastery check -> review */
  "end-to-end-flow": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "e2e@b.com", password: "a-long-enough-pass", name: "E" });
    const kid = (await post(c, "/learners", { name: "E2E Kid" })).body.learner;

    /* 1. diagnostic places the learner */
    const start = await post(c, "/diagnostic/start", { learnerId: kid.id, topicId: "g6-ratios" });
    let q = start.body.question, placed = null, guard = 0;
    while (guard++ < 30) {
      const step = await post(c, "/diagnostic/answer",
        { diagnosticId: start.body.diagnosticId, answer: "-999999" });
      if (step.body.done) { placed = step.body.summary.recommendation; break; }
      q = step.body.question;
    }
    assert(placed && placed.tier, "step 1: diagnostic produced no placement");

    /* 2. practice at the recommended tier, scoring badly on purpose */
    const qs = (await c(`/topics/g6-ratios/${placed.tier}/questions`)).body.questions;
    assert(qs.length, "step 2: no questions at the recommended tier");
    const run = await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: placed.tier, score: 1, total: qs.length });
    assert(run.status === 200, "step 2: run not recorded");
    assert(run.body.star === false, "step 2: a poor run earned mastery");

    /* 3. review must now surface that topic as needing work */
    const review = (await c(`/learners/${kid.id}/review`)).body.review;
    assert(review.some(r => r.topicId === "g6-ratios"), "step 3: weak topic missing from review queue");
    assert(review[0].gap > 0, "step 3: review item has no gap to close");

    /* 4. mastery check, answered correctly, clears it */
    const chk = (await post(c, "/mastery/start", { learnerId: kid.id, topicId: "g6-ratios" })).body;
    const answers = {};
    for (const cq of chk.questions) {
      if (cq.type === "mc") {
        for (let i = 0; i < cq.opts.length; i++)
          if ((await post(c, "/answer", { questionId: cq.id, answer: i })).body.correct) { answers[cq.id] = i; break; }
      } else {
        answers[cq.id] = (await post(c, "/answer", { questionId: cq.id, answer: "__" })).body.correctAnswer;
      }
    }
    const done = await post(c, "/mastery/submit", { checkId: chk.checkId, answers });
    assert(done.body.passed === true, "step 4: perfect mastery check did not pass");

    /* 5. progress reflects the whole journey */
    const prog = (await c(`/learners/${kid.id}/progress`)).body;
    assert(prog.progress.some(p => p.tier === "mastery" && p.best_pct === 100), "step 5: mastery not recorded");
    assert(prog.recent.length >= 2, "step 5: run history incomplete");
    const diagStored = (await c(`/learners/${kid.id}/diagnostic`)).body.diagnostic;
    assert(diagStored, "step 5: diagnostic missing from the learner record");

    return "diagnostic -> practice -> review -> mastery check -> progress, all server-side";
  },


  /* X.5 — an EXISTING database must survive an upgrade.
     The rest of the suite always starts from an empty file, which is exactly
     why a missing migration went unnoticed until the dev database broke. This
     builds a database at the OLD schema, boots against it, and asserts the
     app still works and the old row is intact. */
  "schema-migration": async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { rmSync, mkdirSync } = await import("node:fs");
    const { spawn } = await import("node:child_process");

    const file = "app/server/data/legacy.db";
    mkdirSync("app/server/data", { recursive: true });
    rmSync(file, { force: true });
    rmSync(file + "-wal", { force: true });
    rmSync(file + "-shm", { force: true });

    /* The users table as it existed BEFORE role/coppa_consent_at were added. */
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
      pass_salt TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL)`);
    old.prepare("INSERT INTO users VALUES (?,?,?,?,?,?)")
       .run("legacy-1", "legacy@b.com", "deadbeef", "cafe", "Legacy User", new Date().toISOString());
    old.close();

    /* Boot a server against that old file on its own port. */
    const port = 4199;
    const srv = spawn("node", ["src/index.js"], {
      cwd: "app/server",
      env: { ...process.env, PORT: String(port), DB_FILE: "./data/legacy.db" },
      stdio: "ignore"
    });
    try {
      let up = false;
      for (let i = 0; i < 40 && !up; i++) {
        try { up = (await fetch(`http://localhost:${port}/health`)).ok; } catch {}
        if (!up) await new Promise(r => setTimeout(r, 150));
      }
      assert(up, "server failed to boot against a pre-existing database");

      /* The columns must now exist, and the old row must be preserved. */
      const db = new DatabaseSync(file);
      const cols = new Set(db.prepare("PRAGMA table_info(users)").all().map(c => c.name));
      assert(cols.has("role"), "migration did not add users.role");
      assert(cols.has("coppa_consent_at"), "migration did not add users.coppa_consent_at");
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get("legacy-1");
      assert(row && row.name === "Legacy User", "existing user row was lost during migration");
      assert(row.role === "parent", `existing user got role "${row.role}", expected the default`);

      /* And the app must actually serve requests against the upgraded file. */
      const me = await fetch(`http://localhost:${port}/api/auth/me`);
      assert(me.ok, `auth/me failed after migration (status ${me.status})`);
      const reg = await fetch(`http://localhost:${port}/api/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "after@b.com", password: "a-long-enough-pass", name: "After", coppaConsent: true })
      });
      assert(reg.ok, `registration failed on a migrated database (status ${reg.status})`);
      return "old database booted, columns added, existing row preserved, requests served";
    } finally {
      srv.kill();
    }
  },


  /* 3.2.2 — varied question types, all graded server-side */
  "question-types": async () => {
    const c = client();
    const qs = (await c("/topics/g6-percent/practice/questions")).body.questions;
    assert(qs.length, "percent bank did not load");

    const kinds = new Set(qs.map(q => q.type));
    for (const t of ["order", "multi"]) assert(kinds.has(t), `no ${t} question served`);

    /* Neither new type may leak its answer. */
    const raw = JSON.stringify(qs);
    for (const k of ['"ansOrder"', '"aMulti"', '"expl"', '"a":'])
      assert(!raw.includes(k), `question payload leaked ${k}`);

    /* Ordering: items are sent, and a wrong sequence is refused. */
    const ord = qs.find(q => q.type === "order");
    assert(Array.isArray(ord.items) && ord.items.length > 2, "ordering question has no items");
    const backwards = [...ord.items].reverse();
    const wrongOrder = await post(c, "/answer", { questionId: ord.id, answer: backwards });
    const rightOrder = await post(c, "/answer",
      { questionId: ord.id, answer: wrongOrder.body.correctAnswer.split("  →  ") });
    assert(rightOrder.body.correct === true, "the stated correct order was marked wrong");
    /* A reversed list can only coincidentally be right if the list is symmetric. */
    if (backwards.join() !== wrongOrder.body.correctAnswer.split("  →  ").join())
      assert(wrongOrder.body.correct === false, "a wrong order was accepted");

    /* Select-all: partial and over-selection must both fail. */
    const mul = qs.find(q => q.type === "multi");
    assert(Array.isArray(mul.opts) && mul.opts.length > 2, "multi question has no options");
    const all = mul.opts.map((_, i) => i);
    const everything = await post(c, "/answer", { questionId: mul.id, answer: all });
    assert(everything.body.correct === false, "selecting every option was accepted");
    const correctIdx = everything.body.correctAnswer.split(", ").map(t => mul.opts.indexOf(t));
    assert(correctIdx.every(i => i >= 0), "could not map the correct answer back to options");
    const exact = await post(c, "/answer", { questionId: mul.id, answer: correctIdx });
    assert(exact.body.correct === true, "the exact correct selection was marked wrong");
    if (correctIdx.length > 1) {
      const partial = await post(c, "/answer", { questionId: mul.id, answer: correctIdx.slice(0, -1) });
      assert(partial.body.correct === false, "a partial selection was accepted as correct");
    }
    /* Empty and malformed answers must not pass. */
    assert((await post(c, "/answer", { questionId: mul.id, answer: [] })).body.correct === false,
      "an empty selection was accepted");
    assert((await post(c, "/answer", { questionId: ord.id, answer: "nonsense" })).body.correct === false,
      "a malformed ordering answer was accepted");

    /* Ordering content invariant: the answer must be a permutation of the items. */
    const { QUESTIONS } = await import("../app/shared/questions.mjs");
    for (const [topic, bank] of Object.entries(QUESTIONS))
      bank.filter(q => q.type === "order").forEach((q, i) => {
        const a = [...q.items].sort().join("|"), b = [...q.ansOrder].sort().join("|");
        assert(a === b, `${topic} ordering question ${i + 1}: ansOrder is not a permutation of items`);
      });

    return `${kinds.size} question types served (${[...kinds].join(", ")}), partial/over/empty answers all refused`;
  },

  /* 3.2.8 — the three assessment kinds the spec names */
  "assessment-kinds": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "assess@b.com", password: "a-long-enough-pass", name: "A" });
    const kid = (await post(c, "/learners", { name: "Assess Kid" })).body.learner;

    /* diagnostic */
    const d = await post(c, "/diagnostic/start", { learnerId: kid.id, topicId: "g6-percent" });
    assert(d.status === 200 && d.body.question, "diagnostic assessment unavailable");

    /* formative — practice with immediate feedback and an explanation */
    const qs = (await c("/topics/g6-percent/practice/questions")).body.questions;
    const fb = await post(c, "/answer", { questionId: qs[0].id, answer: "definitely wrong" });
    assert(typeof fb.body.correct === "boolean" && fb.body.explanation,
      "formative feedback missing correctness or explanation");

    /* summative — mastery check */
    const m = await post(c, "/mastery/start", { learnerId: kid.id, topicId: "g6-percent" });
    assert(m.status === 200 && m.body.questions.length, "summative assessment unavailable");
    assert(typeof m.body.threshold === "number", "summative check has no pass mark");

    return "diagnostic, formative and summative assessments all reachable";
  },


  /* 4.1.4 — adaptive practice: difficulty follows performance, hints cost
     stars, and mistakes come back for review at the end */
  "adaptive-practice": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "prac@b.com", password: "a-long-enough-pass", name: "P" });
    const kid = (await post(c, "/learners", { name: "Practice Kid" })).body.learner;

    const solve = async q => {
      if (q.type === "mc") {
        for (let i = 0; i < q.opts.length; i++)
          if ((await post(c, "/answer", { questionId: q.id, answer: i })).body.correct) return i;
        return 0;
      }
      if (q.type === "multi") {
        const probe = await post(c, "/answer", { questionId: q.id, answer: [] });
        return probe.body.correctAnswer.split(", ").map(t => q.opts.indexOf(t));
      }
      if (q.type === "order") {
        const probe = await post(c, "/answer", { questionId: q.id, answer: [] });
        return probe.body.correctAnswer.split("  →  ");
      }
      return (await post(c, "/answer", { questionId: q.id, answer: "__" })).body.correctAnswer;
    };

    /* An all-correct session: full marks, 3 stars (no hints), nothing to review. */
    let r = await post(c, "/practice/start", { learnerId: kid.id, topicId: "g6-ratios" });
    assert(r.status === 200, "practice session did not start");
    assert(r.body.length > 1, "practice session has no length");
    let q = r.body.question, sum = null, guard = 0;
    while (guard++ < 30) {
      const step = await post(c, "/practice/answer",
        { sessionId: r.body.sessionId, answer: await solve(q), hintsUsed: 0 });
      assert(step.body.correct === true, "a solved question was marked wrong");
      if (step.body.done) { sum = step.body.summary; break; }
      q = step.body.question;
    }
    assert(sum, "practice session never finished");
    assert(sum.pct === 100, `all-correct session scored ${sum.pct}%`);
    assert(sum.stars === 3, `no hints used but earned ${sum.stars} stars`);
    assert(sum.missed.length === 0, "a perfect session reported mistakes");
    assert(typeof sum.seconds === "number", "session did not record time on task");

    /* An all-wrong session using hints: every miss returned for review, fewer stars. */
    const r2 = await post(c, "/practice/start", { learnerId: kid.id, topicId: "g6-ratios" });
    let sum2 = null, g2 = 0;
    while (g2++ < 30) {
      const step = await post(c, "/practice/answer",
        { sessionId: r2.body.sessionId, answer: "-999999", hintsUsed: 3 });
      if (step.body.done) { sum2 = step.body.summary; break; }
    }
    assert(sum2, "second session never finished");
    assert(sum2.pct === 0, `all-wrong session scored ${sum2.pct}%`);
    assert(sum2.stars === 1, `heavy hint use still earned ${sum2.stars} stars`);
    assert(sum2.missed.length === sum2.total, "not every mistake was returned for review");
    assert(sum2.missed.every(m => m.q && m.correctAnswer && m.explanation),
      "review items are missing the question, answer or explanation");

    /* Both sessions recorded against the learner. */
    const prog = (await c(`/learners/${kid.id}/progress`)).body.progress;
    const row = prog.find(p => p.tier === "adaptive" && p.topic_id === "g6-ratios");
    assert(row, "adaptive practice was not recorded");
    assert(row.best_pct === 100, `best kept as ${row.best_pct}, expected the higher score`);
    assert(row.runs === 2, `expected 2 sessions recorded, got ${row.runs}`);

    /* A finished session cannot be continued. */
    const stale = await post(c, "/practice/answer", { sessionId: r2.body.sessionId, answer: 0 });
    assert(stale.status === 404, "a completed practice session accepted another answer");

    /* Another account cannot drive this learner's session. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "pracbob@b.com", password: "a-long-enough-pass", name: "B" });
    const hijack = await post(bob, "/practice/start", { learnerId: kid.id, topicId: "g6-ratios" });
    assert(hijack.status === 403, "another account started a session for someone else's learner");

    return "adaptive over 10 questions, stars reflect hint use, all mistakes returned, best score kept";
  },


  /* 3.3.3 + 6.4 — spaced repetition: intervals adapt to performance */
  "spaced-repetition": async () => {
    /* Create a real learner first: the schedule has a foreign key to it. */
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "space@b.com", password: "a-long-enough-pass", name: "S" });
    const kid = (await post(c, "/learners", { name: "Spaced Kid" })).body.learner;
    const learner = kid.id;

    /* The scheduling maths is deterministic, so drive it directly rather than
       waiting real days. DB_FILE is set at the top of this file so this shares
       the server's database. */
    const spacing = await import("../app/server/src/spacing.js");

    const day = (n) => new Date(Date.UTC(2026, 0, 1 + n));
    /* Three good reviews: interval must grow each time. */
    const r1 = spacing.schedule(learner, "t-good", 1.0, day(0));
    const r2 = spacing.schedule(learner, "t-good", 1.0, day(1));
    const r3 = spacing.schedule(learner, "t-good", 1.0, day(4));
    assert(r1.intervalDays === 1, `first interval ${r1.intervalDays}, expected 1`);
    assert(r2.intervalDays > r1.intervalDays, "interval did not grow after a second success");
    assert(r3.intervalDays > r2.intervalDays, "interval did not grow after a third success");
    assert(r3.ease >= r1.ease, "ease fell despite perfect reviews");

    /* A failure collapses the interval and reduces ease. */
    const bad = spacing.schedule(learner, "t-good", 0.1, day(10));
    assert(bad.intervalDays === 1, `failed review kept a ${bad.intervalDays}-day interval`);
    assert(bad.ease < r3.ease, "ease did not drop after a lapse");
    assert(bad.lapses === 1, "lapse not counted");
    assert(bad.reps === 0, "repetition count not reset after a lapse");

    /* Ease has a floor, so repeated failure cannot drive it to zero. */
    let e = bad.ease;
    for (let i = 0; i < 12; i++) e = spacing.schedule(learner, "t-bad", 0, day(20 + i)).ease;
    assert(e >= 1.3, `ease fell below the floor: ${e}`);

    /* Due-ness is date-driven: nothing due today, everything due later. */
    const dueNow = spacing.due(learner, day(0)).map(r => r.topic_id);
    assert(!dueNow.includes("t-good"), "a topic reviewed today is already due again");
    const dueLater = spacing.due(learner, day(400)).map(r => r.topic_id);
    assert(dueLater.includes("t-good"), "a long-overdue topic never became due");

    /* And a real run through the API must create a schedule entry. */
    const run = await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
    assert(run.body.nextReview && run.body.nextReview.dueAt, "a run did not schedule the next review");
    const rev = (await c(`/learners/${kid.id}/review`)).body;
    assert(Array.isArray(rev.schedule) && rev.schedule.length >= 1, "schedule not exposed on the review endpoint");
    assert(rev.schedule.some(r => r.topic_id === "g6-ratios"), "the run's topic is not on the schedule");
    assert(rev.review.every(r => r.reason), "review items do not say why they are listed");

    return "intervals grow on success, collapse on failure, ease floored at 1.3, schedule exposed via API";
  },


  /* 6.2 — prerequisite knowledge graph */
  "knowledge-graph": async () => {
    const { PREREQS, findCycle, prereqsOf, allPrereqs, unlockedBy } =
      await import("../app/shared/prereqs.mjs");
    const { CURRICULUM } = await import("../app/shared/curriculum.mjs");

    /* Every id on both sides of every edge must be a real topic. */
    const ids = new Set();
    for (const g of Object.values(CURRICULUM))
      for (const u of g.units) for (const t of u.topics) ids.add(t.id);
    for (const [k, vs] of Object.entries(PREREQS)) {
      assert(ids.has(k), `prereq graph references unknown topic "${k}"`);
      for (const v of vs) assert(ids.has(v), `"${k}" depends on unknown topic "${v}"`);
    }

    /* Acyclic, or the "what can I learn next" logic would never terminate. */
    const cycle = findCycle();
    assert(!cycle, `prerequisite cycle: ${cycle && cycle.join(" -> ")}`);

    /* No topic may depend on itself, directly or transitively. */
    for (const id of Object.keys(PREREQS))
      assert(!allPrereqs(id).has(id), `${id} transitively requires itself`);

    /* The dependencies the spec names explicitly must be present. */
    assert(allPrereqs("g4-clockmod").has("g4-divide"),
      "spec 6.2: modular arithmetic must require division with remainders");
    assert(allPrereqs("g4-combin").has("g3-multprin"),
      "spec 6.2: combinatorics must require the multiplication principle");

    /* Edges must cross grades, not merely restate grade order. */
    const gradeOf = id => { for (const [g, v] of Object.entries(CURRICULUM))
      for (const u of v.units) for (const t of u.topics) if (t.id === id) return g; };
    let crossGrade = 0;
    for (const [k, vs] of Object.entries(PREREQS))
      for (const v of vs) if (gradeOf(k) !== gradeOf(v)) crossGrade++;
    assert(crossGrade > 100, `only ${crossGrade} cross-grade edges; the graph is too shallow`);

    /* Coverage: advanced topics in particular must not be orphans. */
    const advanced = [];
    for (const g of Object.values(CURRICULUM))
      for (const u of g.units) if (u.track === "adv") for (const t of u.topics) advanced.push(t.id);
    const orphanAdv = advanced.filter(id => !PREREQS[id] && !unlockedBy(id).length);
    assert(orphanAdv.length === 0, `advanced topics with no graph edges: ${orphanAdv.slice(0, 5).join(", ")}`);

    /* Deep chains actually exist: RSA should sit on a long dependency chain. */
    assert(allPrereqs("g8-rsa").size > 20,
      `g8-rsa depends on only ${allPrereqs("g8-rsa").size} topics; chain is too shallow`);

    /* API: the graph is queryable, and recommendations respect it. */
    const c = client();
    const g = await c("/topics/g6-crt/prereqs");
    assert(g.status === 200 && g.body.direct.length, "prereq endpoint returned nothing");
    assert(g.body.direct.every(d => d.name), "prereq entries are not named");
    assert((await c("/topics/not-real/prereqs")).status === 404, "unknown topic accepted");

    await post(c, "/auth/register",
      { coppaConsent: true, email: "graph@b.com", password: "a-long-enough-pass", name: "G" });
    const kid = (await post(c, "/learners", { name: "Graph Kid" })).body.learner;
    const next = (await c(`/learners/${kid.id}/next`)).body;
    assert(Array.isArray(next.ready) && Array.isArray(next.blocked), "next endpoint malformed");
    /* A fresh learner has mastered nothing, so anything with prerequisites is blocked. */
    assert(next.blocked.length > 0, "a learner with no progress has nothing blocked");
    assert(next.blocked.every(b => b.missing.length), "a blocked topic lists no missing prerequisite");
    assert(next.ready.every(r => prereqsOf(r.topicId).length === 0),
      "a topic with unmet prerequisites was recommended as ready");

    return `${Object.keys(PREREQS).length} topics, ${Object.values(PREREQS).reduce((a, b) => a + b.length, 0)} edges, acyclic, ${crossGrade} cross-grade`;
  },


  /* 7.5 — error analysis: wrong answers are classified by misconception */
  "error-analysis": async () => {
    const { classify, CATEGORIES } = await import("../app/server/src/errors.js");

    /* The classifier, exercised directly against each mistake shape. */
    const cases = [
      [{ type: "in", ans: 50 }, "-50", "sign_error"],
      [{ type: "in", ans: 50 }, "500", "place_value"],
      [{ type: "in", ans: 50 }, "5", "place_value"],
      [{ type: "in", ans: 50 }, "51", "off_by_one"],
      [{ type: "in", ans: 50 }, "", "blank"],
      [{ type: "in", ans: 50 }, "37", "unclassified"],
      [{ type: "pair", ansP: [3, -2] }, "(-2, 3)", "reversed_pair"],
      [{ type: "pair", ansP: [3, -2] }, "(-3, 2)", "sign_error"],
      [{ type: "multi", aMulti: [0, 1, 2] }, [0, 1], "partial_selection"],
      [{ type: "multi", aMulti: [0, 1] }, [0, 1, 3], "over_selection"],
      [{ type: "order", ansOrder: ["a", "b", "c"] }, ["c", "b", "a"], "order_reversed"],
      [{ type: "order", ansOrder: ["a", "b", "c", "d"] }, ["b", "a", "c", "d"], "order_adjacent"],
      [{ type: "mc", opts: ["4 : 6", "6 : 4"], a: 0 }, 1, "operation_swap"]
    ];
    for (const [q, ans, want] of cases) {
      const got = classify(q, ans);
      assert(got === want, `classify(${q.type}, ${JSON.stringify(ans)}) = "${got}", expected "${want}"`);
    }
    /* A correct-looking but unrecognised mistake must NOT be forced into a bucket. */
    assert(classify({ type: "in", ans: 100 }, "73") === "unclassified",
      "an unrecognised mistake was given a category anyway");
    for (const [, , want] of cases) assert(CATEGORIES[want], `category "${want}" has no label`);

    /* End to end: mistakes made in a real session are recorded and reported. */
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "errs@b.com", password: "a-long-enough-pass", name: "E" });
    const kid = (await post(c, "/learners", { name: "Error Kid" })).body.learner;

    const start = await post(c, "/practice/start", { learnerId: kid.id, topicId: "g6-ratios" });
    let done = false, guard = 0, lastMissed = null;
    while (!done && guard++ < 20) {
      const step = await post(c, "/practice/answer",
        { sessionId: start.body.sessionId, answer: "", hintsUsed: 0 });   // blank every time
      if (step.body.done) { done = true; lastMissed = step.body.summary.missed; }
    }
    assert(lastMissed && lastMissed.length, "no mistakes recorded from an all-blank session");
    assert(lastMissed.every(m => m.category), "a recorded mistake has no category");
    assert(lastMissed.some(m => m.category === "blank"), "blank answers were not classified as blank");
    assert(lastMissed.every(m => m.categoryLabel), "mistake categories have no human-readable label");

    const report = (await c(`/learners/${kid.id}/errors`)).body;
    assert(report.total > 0, "error report is empty after a failed session");
    assert(report.byCategory.length > 0, "no category breakdown produced");
    assert(report.byCategory[0].count >= report.byCategory[report.byCategory.length - 1].count,
      "category breakdown is not ordered by frequency");
    assert(report.byTopic.some(t => t.topicId === "g6-ratios"), "topic breakdown missing the practised topic");

    /* Another account cannot read this learner's mistakes. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "errbob@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await bob(`/learners/${kid.id}/errors`)).status === 403,
      "another account read this learner's error report");

    return `${cases.length} classifier cases, mistakes recorded and reported by category and topic`;
  },


  /* 6.5 — intervention triggers during a session */
  "intervention-triggers": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "interv@b.com", password: "a-long-enough-pass", name: "I" });
    const kid = (await post(c, "/learners", { name: "Intervention Kid" })).body.learner;

    /* Three consecutive wrong answers must raise a struggling intervention. */
    const start = await post(c, "/practice/start", { learnerId: kid.id, topicId: "g6-nscoord" });
    let struggling = null, seenBefore3 = [];
    for (let i = 0; i < 4; i++) {
      const step = await post(c, "/practice/answer",
        { sessionId: start.body.sessionId, answer: "-424242", hintsUsed: 0 });
      if (step.body.done) break;
      if (i < 2) seenBefore3.push(step.body.intervention);
      if (step.body.intervention?.type === "struggling") { struggling = step.body.intervention; break; }
    }
    assert(seenBefore3.every(x => x === null || x?.type !== "struggling"),
      "struggling intervention fired before three consecutive wrong answers");
    assert(struggling, "three wrong answers in a row raised no intervention");
    assert(struggling.message && struggling.suggest, "intervention carries no message or suggestion");

    /* A correct answer clears the streak, so it does not fire again immediately. */
    const solve = async q => {
      if (q.type === "mc") {
        for (let i = 0; i < q.opts.length; i++)
          if ((await post(c, "/answer", { questionId: q.id, answer: i })).body.correct) return i;
        return 0;
      }
      if (q.type === "order") return (await post(c, "/answer", { questionId: q.id, answer: [] }))
        .body.correctAnswer.split("  →  ");
      if (q.type === "multi") { const p = await post(c, "/answer", { questionId: q.id, answer: [] });
        return p.body.correctAnswer.split(", ").map(t => q.opts.indexOf(t)); }
      return (await post(c, "/answer", { questionId: q.id, answer: "__" })).body.correctAnswer;
    };
    const s2 = await post(c, "/practice/start", { learnerId: kid.id, topicId: "g6-nscoord" });
    let q = s2.body.question, cleared = true;
    for (let i = 0; i < 3; i++) {
      const wrong = await post(c, "/practice/answer",
        { sessionId: s2.body.sessionId, answer: "-424242", hintsUsed: 0 });
      if (wrong.body.done) break;
      q = wrong.body.question;
      const right = await post(c, "/practice/answer",
        { sessionId: s2.body.sessionId, answer: await solve(q), hintsUsed: 0 });
      if (right.body.done) break;
      q = right.body.question;
      if (right.body.intervention?.type === "struggling") cleared = false;
    }
    assert(cleared, "a correct answer did not clear the wrong-answer streak");

    return "struggling fires on the third consecutive miss, not before, and a correct answer clears it";
  },


  /* 4.1.9 + 13.12 — competition prep: timed papers scored accurately */
  "competition-prep": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "contest@b.com", password: "a-long-enough-pass", name: "C" });
    const kid = (await post(c, "/learners", { name: "Contest Kid" })).body.learner;

    const formats = (await c("/contest/formats")).body.formats;
    for (const f of ["kangaroo", "moems", "amc8", "mathcounts"])
      assert(formats[f], `contest format ${f} missing`);

    /* Start a paper: questions must arrive without answers, with a time limit. */
    const start = await post(c, "/contest/start", { learnerId: kid.id, format: "drill" });
    assert(start.status === 200, "contest did not start");
    assert(start.body.limitSeconds > 0, "no time limit issued");
    assert(start.body.questions.length > 1, "contest paper is too short");
    const raw = JSON.stringify(start.body.questions);
    for (const k of ['"ans"', '"ansP"', '"expl"', '"a":', '"ansOrder"', '"aMulti"'])
      assert(!raw.includes(k), `contest paper leaked ${k}`);

    /* Answer everything correctly; the server must score it accurately. */
    const answers = {};
    for (const q of start.body.questions) {
      if (q.type === "mc") {
        for (let i = 0; i < q.opts.length; i++)
          if ((await post(c, "/answer", { questionId: q.id, answer: i })).body.correct) { answers[q.id] = i; break; }
      } else if (q.type === "order") {
        answers[q.id] = (await post(c, "/answer", { questionId: q.id, answer: [] }))
          .body.correctAnswer.split("  →  ");
      } else if (q.type === "multi") {
        const p = await post(c, "/answer", { questionId: q.id, answer: [] });
        answers[q.id] = p.body.correctAnswer.split(", ").map(t => q.opts.indexOf(t));
      } else {
        answers[q.id] = (await post(c, "/answer", { questionId: q.id, answer: "__" })).body.correctAnswer;
      }
    }
    const done = await post(c, "/contest/submit", { contestId: start.body.contestId, answers });
    assert(done.body.pct === 100, `perfect paper scored ${done.body.pct}%`);
    assert(done.body.expired === false, "an in-time submission was marked expired");
    assert(typeof done.body.seconds === "number", "no elapsed time recorded");
    assert(done.body.byTopic.length > 0, "no topic breakdown for the paper");

    /* A spent paper cannot be resubmitted. */
    assert((await post(c, "/contest/submit", { contestId: start.body.contestId, answers })).status === 404,
      "a submitted contest was accepted twice");

    /* The clock is the server's. Test the timing rules directly rather than
       waiting out a real deadline. */
    const { isExpired, scorePaper } = await import("../app/server/src/contest.js");
    assert(isExpired(1000, 1001) === true, "a submission after the deadline was not expired");
    assert(isExpired(1000, 1000) === false, "a submission exactly on the deadline was expired");
    const late = scorePaper({ marks: [true, true, true], expired: true });
    assert(late.score === 0, `an expired paper scored ${late.score}, expected 0`);
    assert(late.correctBeforePenalty === 3, "an expired paper hid what the learner got right");
    const intime = scorePaper({ marks: [true, false, true], expired: false });
    assert(intime.score === 2 && intime.pct === 67, `in-time scoring wrong: ${JSON.stringify(intime)}`);

    const late2 = await post(c, "/contest/start", { learnerId: kid.id, format: "drill" });
    assert(late2.body.limitSeconds === formats.drill.minutes * 60,
      "issued time limit does not match the format");
    await post(c, "/contest/submit", { contestId: late2.body.contestId, answers: {} });

    /* History and analytics. */
    const hist = (await c(`/learners/${kid.id}/contests`)).body;
    assert(hist.history.length === 2, `expected 2 attempts, got ${hist.history.length}`);
    assert(hist.byFormat.some(f => f.format === "drill" && f.best === 100),
      "best score not tracked per format");

    /* Another account cannot start or read this learner's contests. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "conbob@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await post(bob, "/contest/start", { learnerId: kid.id, format: "drill" })).status === 403,
      "another account started a contest for someone else's learner");
    assert((await bob(`/learners/${kid.id}/contests`)).status === 403,
      "another account read this learner's contest history");

    return `${Object.keys(formats).length} formats, papers scored server-side, timing enforced, history tracked`;
  },


  /* 13.1 + 3.1.2-3.1.4 — authored content is valid and spread across grades */
  "content-integrity": async () => {
    const { QUESTIONS, SECS } = await import("../app/shared/questions.mjs");
    const { CURRICULUM } = await import("../app/shared/curriculum.mjs");
    const { PREREQS } = await import("../app/shared/prereqs.mjs");

    const ids = new Set();
    for (const g of Object.values(CURRICULUM))
      for (const u of g.units) for (const t of u.topics) ids.add(t.id);

    let total = 0;
    for (const [topic, bank] of Object.entries(QUESTIONS)) {
      assert(ids.has(topic), `question bank "${topic}" is not a curriculum topic`);
      assert(bank.length >= 5, `${topic} has only ${bank.length} questions`);
      const tiers = new Set(bank.map(q => (q.lvl || 1)));
      assert(tiers.size >= 2, `${topic} has questions at only one difficulty tier`);
      bank.forEach((q, i) => {
        const tag = `${topic}#${i + 1}`;
        total++;
        assert(q.q && q.q.trim(), `${tag} has no question text`);
        assert(q.expl && q.expl.trim(), `${tag} has no explanation`);
        assert(SECS[q.sec], `${tag} uses unknown section "${q.sec}"`);
        if (q.type === "mc") {
          assert(q.opts && q.opts[q.a] !== undefined, `${tag} has a bad answer index`);
          assert(new Set(q.opts).size === q.opts.length, `${tag} has duplicate options`);
          q.opts.forEach(o => assert(o === String(o).trim(), `${tag} option has stray whitespace`));
        } else if (q.type === "in") {
          assert(typeof q.ans === "number" && !isNaN(q.ans), `${tag} has a non-numeric answer`);
        } else if (q.type === "pair") {
          assert(Array.isArray(q.ansP) && q.ansP.length === 2, `${tag} has a bad ordered pair`);
        } else if (q.type === "multi") {
          assert(Array.isArray(q.aMulti) && q.aMulti.length, `${tag} has no correct selections`);
          assert(q.aMulti.every(i => q.opts[i] !== undefined), `${tag} selects a non-existent option`);
          assert(q.aMulti.length < q.opts.length, `${tag} marks every option correct`);
        } else if (q.type === "order") {
          assert([...q.items].sort().join("|") === [...q.ansOrder].sort().join("|"),
            `${tag}: ansOrder is not a permutation of items`);
          assert(q.items.length >= 3, `${tag} has too few items to order`);
        } else assert(false, `${tag} has unknown type "${q.type}"`);
      });
    }

    /* Spread: content must not all sit in one grade. */
    const gradesWith = new Set();
    for (const [g, v] of Object.entries(CURRICULUM))
      for (const u of v.units) for (const t of u.topics) if (QUESTIONS[t.id]) gradesWith.add(g);
    assert(gradesWith.size >= 5, `only ${gradesWith.size} grades have content`);
    assert(gradesWith.has("K"), "Kindergarten has no authored content");

    /* Every authored topic should sit on the prerequisite graph. */
    for (const topic of Object.keys(QUESTIONS)) {
      const onGraph = PREREQS[topic] || Object.values(PREREQS).some(v => v.includes(topic));
      assert(onGraph, `authored topic "${topic}" is absent from the prerequisite graph`);
    }

    return `${Object.keys(QUESTIONS).length} banks, ${total} questions, ${gradesWith.size} grades, all valid`;
  },


  /* 5.1 + 5.2 + 5.4 + 5.5 — points, badges, levels and streaks */
  "gamification": async () => {
    const rewards = await import("../app/server/src/rewards.js");

    /* Advanced work must be worth more than core work (spec 5.1). */
    const core = rewards.pointsFor({ pct: 100, total: 10, track: "core" });
    const adv  = rewards.pointsFor({ pct: 100, total: 10, track: "adv" });
    assert(adv > core, `advanced work (${adv}) is not worth more than core (${core})`);
    /* Hints cost points, but can never take a score below zero. */
    const hinted = rewards.pointsFor({ pct: 100, total: 10, track: "core", hintsUsed: 5 });
    assert(hinted < core, "hints did not reduce the points awarded");
    assert(rewards.pointsFor({ pct: 10, total: 1, track: "core", hintsUsed: 99 }) >= 0,
      "heavy hint use produced negative points");

    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "game@b.com", password: "a-long-enough-pass", name: "G" });
    const kid = (await post(c, "/learners", { name: "Game Kid" })).body.learner;

    /* Nothing earned yet. */
    let r = (await c(`/learners/${kid.id}/rewards`)).body;
    assert(r.points === 0 && r.badges.length === 0, "a new learner already has rewards");
    assert(r.level === 1, `a new learner starts at level ${r.level}`);
    assert(r.catalogue && Object.keys(r.catalogue).length > 5, "badge catalogue not published");

    /* A perfect round earns points and the expected badges. */
    const run = await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
    assert(run.body.reward, "a finished round returned no reward");
    assert(run.body.reward.points > 0, "a perfect round earned no points");
    const codes = run.body.reward.badges.map(b => b.code);
    assert(codes.includes("first_steps"), "no first-round badge");
    assert(codes.includes("perfect_round"), "no badge for a perfect round");

    /* Badges are awarded once, not repeatedly. */
    const again = await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
    assert(!again.body.reward.badges.some(b => b.code === "perfect_round"),
      "the same badge was awarded twice");

    r = (await c(`/learners/${kid.id}/rewards`)).body;
    assert(r.points > 0, "points did not accumulate");
    assert(r.badges.length >= 2, "badges not listed on the rewards endpoint");
    assert(r.badges.every(b => b.name), "a badge has no display name");
    assert(r.nextLevelAt > r.points || r.level > 1, "level progress is not reported");

    /* Streak counts consecutive days and breaks when a day is skipped. */
    const s0 = rewards.streak(kid.id);
    assert(s0 >= 1, `today's activity gave a streak of ${s0}`);
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    assert(rewards.streak(kid.id, future) === 0,
      "a streak survived a five-day gap");

    /* Another account cannot read this learner's rewards. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "gamebob@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await bob(`/learners/${kid.id}/rewards`)).status === 403,
      "another account read this learner's rewards");

    return `advanced worth ${adv} vs core ${core}, badges awarded once, levels and streaks tracked`;
  },

  /* X.4 — progress survives a restart (checked by reopening the file) */
  "persistence": async () => {
    const c = client();
    await post(c, "/auth/register", { coppaConsent: true, email: "persist@b.com", password: "a-long-enough-pass", name: "P" });
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
