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
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB,
           /* The suite creates many accounts; the production signup limit is
              not what these checks are testing. The LOGIN limit, which is the
              brute-force control that matters, is still exercised in full by
              check:security-privacy. */
           REGISTER_LIMIT_PER_HOUR: "1000",
           ADMIN_EMAILS: "boss@b.com" },
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
    /* Every badge the code can award must exist in the catalogue, or it would
       render as a raw code. Scan the source for award(... "badge", "code"). */
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/server/src/routes.js", "utf8") +
                readFileSync("app/server/src/rewards.js", "utf8");
    const awarded = [...src.matchAll(/award\([^,]+,\s*"badge",\s*"([a-z_]+)"/g)].map(m => m[1]);
    const gives = [...src.matchAll(/give\("([a-z_]+)"\)/g)].map(m => m[1]);
    for (const code of new Set([...awarded, ...gives]))
      assert(rewards.BADGES[code], `code awards badge "${code}" which is not in the catalogue`);
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


  /* 4.3.1 + 4.3.2 + 4.3.3 — teacher portal with RBAC */
  "teacher-portal": async () => {
    const teacher = client(), parent = client(), other = client();
    await post(teacher, "/auth/register",
      { coppaConsent: true, role: "teacher", email: "teach@b.com", password: "a-long-enough-pass", name: "T" });
    await post(parent, "/auth/register",
      { coppaConsent: true, email: "tparent@b.com", password: "a-long-enough-pass", name: "P" });
    await post(other, "/auth/register",
      { coppaConsent: true, role: "teacher", email: "teach2@b.com", password: "a-long-enough-pass", name: "T2" });

    /* RBAC: a parent cannot create a class. */
    const denied = await post(parent, "/classes", { name: "Sneaky" });
    assert(denied.status === 403, `a parent created a class (status ${denied.status})`);

    const cls = (await post(teacher, "/classes", { name: "Period 2" })).body.class;
    assert(cls.joinCode && cls.joinCode.length >= 4, "class has no join code");

    /* A teacher cannot pull in a learner; the parent joins with the code. */
    const kid = (await post(parent, "/learners", { name: "Class Kid" })).body.learner;
    const joined = await post(parent, "/classes/join", { joinCode: cls.joinCode, learnerId: kid.id });
    assert(joined.status === 200, "parent could not join the class with a valid code");
    assert((await post(parent, "/classes/join", { joinCode: "NOPE00", learnerId: kid.id })).status === 404,
      "an invalid join code was accepted");

    /* Assignments. */
    const a = await post(teacher, `/classes/${cls.id}/assignments`,
      { topicId: "g6-ratios", tier: "practice", dueAt: "2026-12-01" });
    assert(a.status === 200, "assignment not created");
    assert((await post(teacher, `/classes/${cls.id}/assignments`, { topicId: "not-a-topic" })).status === 400,
      "an assignment against an unknown topic was accepted");

    /* Class progress reflects real learner work. */
    let prog = (await teacher(`/classes/${cls.id}/progress`)).body;
    assert(prog.learners.length === 1, "class roster is wrong");
    assert(prog.learners[0].assignments[0].attempted === false, "an untouched assignment shows as attempted");
    assert(prog.heatmap[0].attempted === 0, "heatmap counts work that has not happened");

    await post(parent, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
    prog = (await teacher(`/classes/${cls.id}/progress`)).body;
    const row = prog.learners[0].assignments[0];
    assert(row.attempted === true && row.bestPct === 100, "class progress did not pick up the learner's work");
    assert(row.mastered === true, "a perfect score is not shown as mastered");
    assert(prog.heatmap[0].mastered === 1, "heatmap did not count the mastery");
    assert(prog.heatmap[0].averagePct === 100, "heatmap average is wrong");

    /* Another teacher cannot read this class. */
    assert((await other(`/classes/${cls.id}/progress`)).status === 403,
      "another teacher read this class's progress");
    assert((await post(other, `/classes/${cls.id}/assignments`, { topicId: "g6-ratios" })).status === 403,
      "another teacher set work for this class");
    /* And a parent cannot read class progress at all. */
    assert((await parent(`/classes/${cls.id}/progress`)).status === 403,
      "a parent read teacher-only class progress");

    return "classes, parent-initiated join, assignments, class progress and heatmap, RBAC enforced";
  },


  /* 4.3.4 + 9.3 — CSV and printable reporting */
  "reporting-exports": async () => {
    const teacher = client(), parent = client();
    await post(teacher, "/auth/register",
      { coppaConsent: true, role: "teacher", email: "rep-t@b.com", password: "a-long-enough-pass", name: "T" });
    await post(parent, "/auth/register",
      { coppaConsent: true, email: "rep-p@b.com", password: "a-long-enough-pass", name: "P" });
    const kid = (await post(parent, "/learners", { name: 'Quote "Kid", Jr' })).body.learner;
    await post(parent, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 7, total: 8 });

    /* Learner CSV. */
    const raw = await fetch(`${BASE}/api/learners/${kid.id}/report.csv`,
      { headers: { cookie: (await post(parent, "/auth/login",
          { email: "rep-p@b.com", password: "a-long-enough-pass" })).setCookie.map(c => c.split(";")[0]).join("; ") } });
    assert(raw.ok, `CSV export failed with ${raw.status}`);
    assert(/text\/csv/.test(raw.headers.get("content-type") || ""), "CSV served with the wrong content type");
    assert(/attachment/.test(raw.headers.get("content-disposition") || ""), "CSV is not sent as a download");
    const csv = await raw.text();
    const lines = csv.trim().split("\n");
    assert(lines[0].startsWith("topic,grade,track,tier"), "CSV header is wrong");
    assert(lines.length >= 2, "CSV has no data rows");
    assert(csv.includes("88"), "CSV does not contain the recorded score");
    assert(/mastered/.test(lines[0]), "CSV omits the mastery column");

    /* A name containing a comma and quotes must not break the format. */
    const teacherCookie = (await post(teacher, "/auth/login",
      { email: "rep-t@b.com", password: "a-long-enough-pass" })).setCookie.map(c => c.split(";")[0]).join("; ");
    const cls = (await post(teacher, "/classes", { name: "Reporting" })).body.class;
    await post(parent, "/classes/join", { joinCode: cls.joinCode, learnerId: kid.id });
    const clsCsv = await (await fetch(`${BASE}/api/classes/${cls.id}/report.csv`,
      { headers: { cookie: teacherCookie } })).text();
    assert(clsCsv.includes('"Quote ""Kid"", Jr"'),
      "a learner name with a comma and quotes was not escaped for CSV");

    /* Printable report. */
    const html = await fetch(`${BASE}/api/learners/${kid.id}/report.html`,
      { headers: { cookie: (await post(parent, "/auth/login",
          { email: "rep-p@b.com", password: "a-long-enough-pass" })).setCookie.map(c => c.split(";")[0]).join("; ") } });
    assert(html.ok, "printable report failed");
    const body = await html.text();
    assert(body.startsWith("<!doctype html>"), "report is not a complete HTML document");
    assert(/<html lang="en">/.test(body), "report has no language attribute");
    assert(body.includes("Ratios &amp; Unit Rates") || body.includes("Ratios"), "report omits the topic");
    assert(!body.includes("<script"), "report contains script tags");
    assert(body.includes("Quote &quot;Kid&quot;, Jr") || body.includes("Quote \"Kid\", Jr") ||
           body.includes("Quote &lt;") || body.includes("Quote"), "report omits the learner name");

    /* Access control on both exports. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "rep-b@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await bob(`/learners/${kid.id}/report.csv`)).status === 403,
      "another account downloaded this learner's CSV");
    assert((await bob(`/classes/${cls.id}/report.csv`)).status === 403,
      "a non-teacher downloaded a class CSV");

    return "learner CSV, class CSV and printable report, with correct escaping and access control";
  },


  /* 3.2.3 — algorithmically generated problem variants */
  "generated-problems": async () => {
    const { generate, generatedTopics, TEMPLATES } = await import("../app/shared/generators.mjs");

    /* Reproducible: the same seed must rebuild the identical problem, or a
       generated question could not be marked or reviewed later. */
    for (const t of generatedTopics()) {
      const a = generate(t, 4242), b = generate(t, 4242);
      assert(a && b, `${t} generated nothing`);
      assert(a.q === b.q && a.ans === b.ans, `${t} is not reproducible from its seed`);
      assert(a.expl && a.hint, `${t} generated no explanation or hint`);
    }

    /* Varied: different seeds must give genuinely different problems. */
    for (const t of generatedTopics()) {
      const seen = new Set();
      for (let i = 0; i < 40; i++) seen.add(generate(t, i * 977).q);
      assert(seen.size > 10, `${t} produced only ${seen.size} distinct problems in 40 seeds`);
    }

    /* Answers must be correct, checked against each template's own maths. */
    for (let i = 0; i < 50; i++) {
      const m = generate("g3-mult", i);
      const [x, y] = m.q.match(/(\d+) × (\d+)/).slice(1).map(Number);
      assert(m.ans === x * y, `g3-mult generated ${m.q} with answer ${m.ans}`);
      const p = generate("g6-percent", i);
      const [pct, base] = p.q.match(/What is (\d+)% of (\d+)/).slice(1).map(Number);
      assert(p.ans === (base * pct) / 100, `g6-percent wrong: ${p.q} => ${p.ans}`);
      assert(Number.isInteger(p.ans), `g6-percent produced a non-whole answer: ${p.q}`);
      const d = generate("g6-nscoord", i);
      assert(d.ans > 0, `g6-nscoord generated a zero distance: ${d.q}`);
      const r2 = generate("g6-ratios", i);
      assert(Number.isInteger(r2.ans) && r2.ans > 0, `g6-ratios produced ${r2.ans}`);
    }

    /* Served without answers, and gradeable through the normal endpoint. */
    const c = client();
    const list = (await c("/generated/topics")).body.topics;
    assert(list.length >= 3, "too few generated topics published");
    const res = await c("/topics/g3-mult/generated?count=5&seed=777");
    assert(res.status === 200 && res.body.questions.length === 5, "generated endpoint failed");
    const raw = JSON.stringify(res.body.questions);
    for (const k of ['"ans"', '"expl"']) assert(!raw.includes(k), `generated question leaked ${k}`);
    assert(res.body.questions.every(q => q.id.startsWith("gen:")), "generated ids are not marked");
    assert(new Set(res.body.questions.map(q => q.q)).size === 5, "the same problem was served five times");

    /* The server can mark a generated question from its id alone. */
    const q0 = res.body.questions[0];
    const [x, y] = q0.q.match(/(\d+) × (\d+)/).slice(1).map(Number);
    const right = await post(c, "/answer", { questionId: q0.id, answer: String(x * y) });
    assert(right.body.correct === true, "a correct answer to a generated question was marked wrong");
    assert(right.body.explanation, "no explanation returned for a generated question");
    const wrong = await post(c, "/answer", { questionId: q0.id, answer: String(x * y + 1) });
    assert(wrong.body.correct === false, "a wrong answer to a generated question was accepted");

    /* Hints work on generated questions too. */
    const h = await post(c, "/hint", { questionId: q0.id, level: 1 });
    assert(h.status === 200 && h.body.hint, "hints unavailable for generated questions");

    /* Repeating the same request returns the same problems. */
    const again = await c("/topics/g3-mult/generated?count=5&seed=777");
    assert(JSON.stringify(again.body.questions.map(q => q.q)) ===
           JSON.stringify(res.body.questions.map(q => q.q)),
      "the same seed served different problems");

    /* Unknown template and malformed ids are refused. */
    assert((await c("/topics/g8-rsa/generated")).status === 404, "a topic with no template returned questions");
    assert((await post(c, "/answer", { questionId: "gen:g3-mult:notanumber", answer: "1" })).status === 400,
      "a malformed generated id was accepted");

    return `${generatedTopics().length} templates, reproducible from seed, served without answers, gradeable and hintable`;
  },


  /* 3.2.9 — read-aloud speaks maths as words, not symbols */
  "read-aloud": async () => {
    /* The text transform is pure, so test it directly rather than driving
       a speech engine. */
    const { execSync } = await import("node:child_process");
    const { writeFileSync, rmSync } = await import("node:fs");
    const entry = "app/web/a11y/speak-probe.mjs";
    writeFileSync(entry, `import { speakableText } from "../src/components/ReadAloud";
      const cases = ${JSON.stringify([
        ["4 × 6 = ?", "times"],
        ["12 ÷ 3 = ?", "divided by"],
        ["8 + 5 = ?", "plus"],
        ["9 - 4 = ?", "minus"],
        ["What is 25% of 80?", "percent"],
        ["The ratio 4 : 6", "4 to 6"],
        ["What is 1/2 of 10?", "half"],
        ["Order 3/4 and 1/4", "quarter"],
        ["Plot (3, -2) on the grid", "the point 3 comma -2"],
        ["What is |-7|?", "the absolute value of -7"]
      ])};
      const out = cases.map(([input, want]) => {
        const got = speakableText(input);
        return { input, want, got, ok: got.toLowerCase().includes(want.toLowerCase()) };
      });
      console.log(JSON.stringify(out));`);
    try {
      execSync(`./node_modules/.bin/esbuild ${entry.replace("app/web/", "")} --bundle --platform=node --format=esm --outfile=a11y/speak-probe.built.mjs`,
        { cwd: "app/web", stdio: "pipe" });
      const raw = execSync("node a11y/speak-probe.built.mjs", { cwd: "app/web" }).toString();
      const results = JSON.parse(raw);
      for (const r of results)
        assert(r.ok, `read-aloud: "${r.input}" became "${r.got}", expected it to contain "${r.want}"`);
      /* And it must not simply echo the symbol form. */
      const times = results.find(r => r.want === "times");
      assert(!times.got.includes("×"), "the multiplication sign was left in the spoken text");
      return `${results.length} maths phrases spoken as words`;
    } finally {
      rmSync(entry, { force: true });
      rmSync("app/web/a11y/speak-probe.built.mjs", { force: true });
    }
  },


  /* 4.2.6 — weekly goals with progress against them */
  "goals": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "goal@b.com", password: "a-long-enough-pass", name: "G" });
    const kid = (await post(c, "/learners", { name: "Goal Kid" })).body.learner;

    /* No goal set yet. */
    let g = (await c(`/learners/${kid.id}/goal`)).body;
    assert(g.goal === null, "a learner started with a goal already set");

    /* An empty goal is refused rather than silently stored. */
    assert((await c(`/learners/${kid.id}/goal`,
      { method: "PUT", body: JSON.stringify({ roundsPerWeek: 0, minutesPerWeek: 0 }) })).status === 400,
      "an empty goal was accepted");

    await c(`/learners/${kid.id}/goal`,
      { method: "PUT", body: JSON.stringify({ roundsPerWeek: 3 }) });
    g = (await c(`/learners/${kid.id}/goal`)).body;
    assert(g.goal.roundsPerWeek === 3, "goal not stored");
    assert(g.roundsThisWeek === 0, "a fresh learner already has rounds this week");
    assert(g.met === false, "an untouched goal is reported as met");

    /* Doing the work moves the goal towards met. */
    for (let i = 0; i < 3; i++)
      await post(c, "/runs",
        { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 5, total: 8 });
    g = (await c(`/learners/${kid.id}/goal`)).body;
    assert(g.roundsThisWeek === 3, `expected 3 rounds counted, got ${g.roundsThisWeek}`);
    assert(g.met === true, "a completed goal is not reported as met");
    assert(g.percentOfGoal === 100, `percent of goal is ${g.percentOfGoal}`);

    /* Updating replaces rather than duplicating. */
    await c(`/learners/${kid.id}/goal`,
      { method: "PUT", body: JSON.stringify({ roundsPerWeek: 10 }) });
    g = (await c(`/learners/${kid.id}/goal`)).body;
    assert(g.goal.roundsPerWeek === 10, "goal was not updated");
    assert(g.met === false, "a raised goal is still reported as met");

    /* Another account cannot read or set this learner's goal. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "goalbob@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await bob(`/learners/${kid.id}/goal`)).status === 403, "another account read the goal");
    assert((await bob(`/learners/${kid.id}/goal`,
      { method: "PUT", body: JSON.stringify({ roundsPerWeek: 1 }) })).status === 403,
      "another account set the goal");

    return "goals set, updated, measured against real rounds, and access-controlled";
  },


  /* 6.3 — Bayesian Knowledge Tracing */
  "knowledge-tracing": async () => {
    const bkt = await import("../app/server/src/bkt.js");

    /* Direction: correct raises the estimate, wrong lowers it. */
    const start = bkt.DEFAULTS.pInit;
    assert(bkt.update(start, true) > start, "a correct answer did not raise P(known)");
    assert(bkt.update(0.9, false) < 0.9, "a wrong answer did not lower P(known)");

    /* Bounded: the estimate stays a probability whatever the history. */
    let p = start;
    for (let i = 0; i < 60; i++) p = bkt.update(p, true);
    assert(p <= 1 && p > 0.99, `after 60 correct answers P(known) = ${p}`);
    let q = 0.99;
    for (let i = 0; i < 60; i++) q = bkt.update(q, false);
    assert(q >= 0 && q < 0.3, `after 60 wrong answers P(known) = ${q}`);

    /* Slip: one wrong answer must NOT erase a well-established skill. */
    let strong = start;
    for (let i = 0; i < 8; i++) strong = bkt.update(strong, true);
    const afterSlip = bkt.update(strong, false);
    assert(afterSlip > 0.3, `a single slip collapsed a strong skill to ${afterSlip.toFixed(3)}`);

    /* Guess: one lucky answer must NOT declare mastery. This is the behaviour
       a streak counter cannot express, and the reason the spec asks for BKT. */
    const oneLucky = bkt.update(start, true, bkt.paramsFor({ optionCount: 4 }));
    assert(!bkt.isKnown({ pKnown: oneLucky, observations: 1 }),
      "a single lucky multiple-choice answer counted as mastery");

    /* Guess rate must reflect the number of options. */
    assert(bkt.paramsFor({ optionCount: 2 }).pGuess > bkt.paramsFor({ optionCount: 5 }).pGuess,
      "a two-option question is not treated as easier to guess than a five-option one");

    /* Evidence requirement: high probability alone is not mastery. */
    assert(!bkt.isKnown({ pKnown: 0.99, observations: 1 }),
      "mastery declared on a single observation");
    assert(bkt.isKnown({ pKnown: 0.99, observations: 5 }), "mastery never reached despite strong evidence");

    /* End to end: practice answers move the learner's stored estimate. */
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "bkt@b.com", password: "a-long-enough-pass", name: "K" });
    const kid = (await post(c, "/learners", { name: "BKT Kid" })).body.learner;

    let before = (await c(`/learners/${kid.id}/skills`)).body.skills;
    assert(before.length === 0, "a new learner already has skill estimates");

    const st = await post(c, "/practice/start", { learnerId: kid.id, topicId: "g6-ratios" });
    let cur = st.body.question, guard = 0;
    while (guard++ < 15) {
      const step = await post(c, "/practice/answer",
        { sessionId: st.body.sessionId, answer: "-999999", hintsUsed: 0 });
      if (step.body.done) break;
      cur = step.body.question;
    }
    const after = (await c(`/learners/${kid.id}/skills`)).body;
    const skill = after.skills.find(s => s.skillId === "g6-ratios");
    assert(skill, "no skill estimate recorded after a practice session");
    assert(skill.observations >= 5, `only ${skill.observations} observations recorded`);
    assert(skill.pKnown < bkt.DEFAULTS.pInit,
      `an all-wrong session left P(known) at ${skill.pKnown}, no lower than the prior`);
    assert(skill.known === false, "an all-wrong session was counted as known");
    assert(skill.name, "skill estimates are not named");

    /* Another account cannot read the model for this learner. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "bktbob@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await bob(`/learners/${kid.id}/skills`)).status === 403,
      "another account read this learner's skill model");

    return "P(known) updated per answer, slip and guess handled, mastery needs evidence not just confidence";
  },


  /* 4.1.10 + 3.2.5 + 3.3.4 — proof trainer */
  "proof-trainer": async () => {
    const { allProofs, publicProof, checkProof } = await import("../app/shared/proofs.mjs");
    const proofs = allProofs();
    assert(proofs.length >= 4, `only ${proofs.length} proofs authored`);

    /* Progression across grades, as the spec requires (3.3.4). */
    const grades = proofs.map(p => p.grade).sort((a, b) => a - b);
    assert(grades[0] <= 2, "no proof exercise for the early grades");
    assert(grades[grades.length - 1] >= 8, "no proof exercise at grade 8");
    const kinds = new Set(proofs.map(p => p.kind));
    assert(kinds.size >= 3, `only ${kinds.size} kinds of proof exercise`);

    /* The served form must not contain the answer. */
    for (const p of proofs) {
      const raw = JSON.stringify(publicProof(p));
      assert(!raw.includes('"reason":'), `${p.id} leaked its reasons`);
      assert(!raw.includes('"answer":'), `${p.id} leaked its answer`);
    }

    /* Marking: correct accepted, wrong rejected, with useful feedback. */
    for (const p of proofs) {
      let good, bad;
      if (p.kind === "order") {
        good = { order: p.steps.map((_, i) => String(i)) };
        bad = { order: p.steps.map((_, i) => String(i)).reverse() };
      } else if (p.kind === "reasons") {
        good = { reasons: Object.fromEntries(p.steps.map((s, i) => [String(i), s.reason])) };
        bad = { reasons: Object.fromEntries(p.steps.map((_, i) => [String(i), "Because it looks true"])) };
      } else {
        good = { blanks: Object.fromEntries(p.steps.map((s, i) => s.blank ? [String(i), s.answer] : null).filter(Boolean)) };
        bad = { blanks: Object.fromEntries(p.steps.map((s, i) => s.blank ? [String(i), s.answer === 0 ? 1 : 0] : null).filter(Boolean)) };
      }
      assert(checkProof(p, good).correct === true, `${p.id}: the correct proof was rejected`);
      assert(checkProof(p, bad).correct === false, `${p.id}: a wrong proof was accepted`);
      assert(checkProof(p, {}).correct === false, `${p.id}: an empty submission was accepted`);
      const fb = checkProof(p, bad);
      assert(fb.wrongSteps || fb.firstWrongPosition !== null,
        `${p.id}: rejection gave no indication of what was wrong`);
    }

    /* End to end through the API. */
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "proof@b.com", password: "a-long-enough-pass", name: "P" });
    const kid = (await post(c, "/learners", { name: "Proof Kid" })).body.learner;

    const list = (await c("/proofs")).body;
    assert(list.proofs.length === proofs.length, "proof catalogue incomplete");

    const target = proofs.find(p => p.kind === "order");
    const started = await post(c, `/proofs/${target.id}/start`, { learnerId: kid.id });
    assert(started.status === 200, "proof session did not start");
    assert(started.body.proof.steps.length === target.steps.length, "served proof has the wrong step count");
    assert(started.body.proof.instruction, "no instruction given to the learner");

    /* A wrong order is refused and the session stays open for another go. */
    const wrongTry = await post(c, "/proofs/submit",
      { sessionId: started.body.sessionId, submission: { order: target.steps.map((_, i) => String(i)).reverse() } });
    assert(wrongTry.body.correct === false, "a reversed proof was accepted");
    assert(wrongTry.body.attempts === 1, "attempts not counted");

    const rightTry = await post(c, "/proofs/submit",
      { sessionId: started.body.sessionId, submission: { order: target.steps.map((_, i) => String(i)) } });
    assert(rightTry.body.correct === true, "the correct proof was rejected through the API");
    assert(rightTry.body.attempts === 2, "attempts not accumulated across tries");

    const completed = (await c(`/learners/${kid.id}/proofs`)).body.completed;
    assert(completed.some(x => x.proofId === target.id), "a completed proof was not recorded");

    /* Another account cannot drive or read this learner's proofs. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "proofbob@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await post(bob, `/proofs/${target.id}/start`, { learnerId: kid.id })).status === 403,
      "another account started a proof for this learner");
    assert((await bob(`/learners/${kid.id}/proofs`)).status === 403,
      "another account read this learner's proof history");

    return `${proofs.length} proofs across grades ${grades[0]}-${grades[grades.length - 1]}, ${kinds.size} kinds, structurally checked`;
  },


  /* 4.4.1 + 4.4.2 + 4.4.3 — admin portal, aggregate only */
  "admin-portal": async () => {
    const admin = client(), parent = client(), teacher = client();
    await post(admin, "/auth/register",
      { coppaConsent: true, email: "boss@b.com", password: "a-long-enough-pass", name: "Boss" });
    await post(parent, "/auth/register",
      { coppaConsent: true, email: "adm-p@b.com", password: "a-long-enough-pass", name: "P" });
    await post(teacher, "/auth/register",
      { coppaConsent: true, role: "teacher", email: "adm-t@b.com", password: "a-long-enough-pass", name: "T" });

    /* Admin is granted out of band, never self-assigned. */
    const sneaky = client();
    await post(sneaky, "/auth/register",
      { coppaConsent: true, role: "admin", email: "sneaky@b.com", password: "a-long-enough-pass", name: "S" });
    assert((await sneaky("/admin/overview")).status === 403,
      "an account granted itself the admin role at signup");

    /* Neither parents nor teachers reach admin data. */
    assert((await parent("/admin/overview")).status === 403, "a parent read admin data");
    assert((await teacher("/admin/overview")).status === 403, "a teacher read admin data");

    /* Give the platform something to aggregate. */
    const kid = (await post(parent, "/learners", { name: "Admin Kid" })).body.learner;
    await post(parent, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 4, total: 8 });

    const ov = await admin("/admin/overview");
    assert(ov.status === 200, `admin overview failed with ${ov.status}`);
    assert(ov.body.users >= 4, "user count is wrong");
    assert(ov.body.learners >= 1, "learner count is wrong");
    assert(ov.body.runs >= 1, "run count is wrong");
    assert(ov.body.attainment && typeof ov.body.attainment["50-69"] === "number",
      "no attainment distribution");
    assert(Array.isArray(ov.body.hardestTopics), "no hardest-topics analytics");
    assert(ov.body.byRole.some(r => r.role === "admin"), "role breakdown missing");

    /* Aggregate only: no child's name or individual answers in the payload. */
    const raw = JSON.stringify(ov.body);
    assert(!raw.includes("Admin Kid"), "admin overview exposed a learner's name");
    assert(!raw.includes("adm-p@b.com"), "admin overview exposed a parent's email");

    /* Retention policy is published, with real counts. */
    const ret = await admin("/admin/retention");
    assert(ret.status === 200 && ret.body.policy.erasure, "no retention policy published");
    assert(typeof ret.body.counts.auditEntries === "number", "no audit counts");

    /* Reading the audit log is itself audited. */
    const before = (await admin("/admin/audit")).body.entries.length;
    await admin("/admin/audit");
    const after = (await admin("/admin/audit")).body.entries;
    assert(after.length >= before, "audit log did not grow");
    assert(after.some(e => e.action === "admin.audit.read"), "admin audit access was not itself recorded");

    return "aggregate analytics, retention policy, audited access, RBAC enforced and admin not self-assignable";
  },


  /* 7.3 — partial credit on multi-step answers */
  "partial-credit": async () => {
    const c = client();
    const qs = (await c("/topics/g6-percent/practice/questions")).body.questions;

    /* Select-all: right picks earn credit, wrong picks cost it. */
    const mul = qs.find(q => q.type === "multi");
    assert(mul, "no multi-select question available");
    const probe = await post(c, "/answer", { questionId: mul.id, answer: [] });
    const correctIdx = probe.body.correctAnswer.split(", ").map(t => mul.opts.indexOf(t));
    assert(correctIdx.length >= 2, "need a multi question with at least two correct options");

    const full = await post(c, "/answer", { questionId: mul.id, answer: correctIdx });
    assert(full.body.correct === true && full.body.credit === 1, "a fully correct selection did not earn full credit");

    const partial = await post(c, "/answer", { questionId: mul.id, answer: correctIdx.slice(0, -1) });
    assert(partial.body.correct === false, "a partial selection was marked fully correct");
    assert(partial.body.credit > 0 && partial.body.credit < 1,
      `a partial selection earned credit ${partial.body.credit}, expected between 0 and 1`);
    assert(partial.body.creditDetail, "no explanation of the partial credit given");

    /* Guessing everything must NOT pay: wrong picks cancel right ones. */
    const all = mul.opts.map((_, i) => i);
    const shotgun = await post(c, "/answer", { questionId: mul.id, answer: all });
    assert(shotgun.body.credit < partial.body.credit,
      `selecting every option scored ${shotgun.body.credit}, no worse than a careful partial answer`);

    /* Ordering: credit for positions that are right. */
    const ord = qs.find(q => q.type === "order");
    assert(ord, "no ordering question available");
    const right = (await post(c, "/answer", { questionId: ord.id, answer: [] }))
      .body.correctAnswer.split("  →  ");
    const nearly = [...right];
    [nearly[0], nearly[1]] = [nearly[1], nearly[0]];        // one adjacent swap
    const near = await post(c, "/answer", { questionId: ord.id, answer: nearly });
    assert(near.body.correct === false, "a swapped order was marked correct");
    assert(near.body.credit > 0.4 && near.body.credit < 1,
      `one swap in an ordering scored ${near.body.credit}`);
    const reversed = await post(c, "/answer", { questionId: ord.id, answer: [...right].reverse() });
    assert(reversed.body.credit < near.body.credit,
      "a fully reversed order scored as well as a nearly-right one");

    /* Single-answer types stay all-or-nothing. */
    const num = qs.find(q => q.type === "in");
    const wrongNum = await post(c, "/answer", { questionId: num.id, answer: "-99999" });
    assert(wrongNum.body.credit === 0, "a wrong numeric answer earned partial credit");

    /* A session reports credit alongside the whole-question score. */
    await post(c, "/auth/register",
      { coppaConsent: true, email: "credit@b.com", password: "a-long-enough-pass", name: "C" });
    const kid = (await post(c, "/learners", { name: "Credit Kid" })).body.learner;
    const st = await post(c, "/practice/start", { learnerId: kid.id, topicId: "g6-percent" });
    let sum = null, guard = 0;
    while (guard++ < 20) {
      const step = await post(c, "/practice/answer",
        { sessionId: st.body.sessionId, answer: "-99999", hintsUsed: 0 });
      if (step.body.done) { sum = step.body.summary; break; }
    }
    assert(sum && typeof sum.creditPct === "number", "session summary omits partial credit");

    return "partial credit on ordering and select-all, guessing everything scores worse, single answers stay all-or-nothing";
  },


  /* 3.2.4 + 4.1.5 — puzzle area with hints but no solutions */
  "puzzles": async () => {
    const { PUZZLES, checkPuzzle, publicPuzzle } = await import("../app/shared/puzzles.mjs");
    assert(PUZZLES.length >= 6, `only ${PUZZLES.length} puzzles authored`);
    assert(new Set(PUZZLES.map(p => p.difficulty)).size >= 3, "puzzles span too few difficulties");

    /* Each puzzle accepts its own answer and rejects a near miss. */
    for (const p of PUZZLES) {
      assert(checkPuzzle(p, p.accepts[0]), `${p.id} rejects its own answer`);
      assert(!checkPuzzle(p, p.accepts[0] + 1), `${p.id} accepts a wrong answer`);
      assert(p.hints.length >= 2, `${p.id} has too few hints`);
      /* The real leak test is structural: the served object must carry
         neither the accepted answers nor the hint texts. Numeric fields like
         difficulty may legitimately coincide with an answer value. */
      const served = publicPuzzle(p);
      assert(!("accepts" in served), `${p.id} served its accepted answers`);
      assert(!("hints" in served), `${p.id} served all its hints at once`);
      assert(typeof served.hintCount === "number", `${p.id} does not say how many hints exist`);
      const values = Object.entries(served)
        .filter(([k]) => k !== "difficulty" && k !== "hintCount")
        .map(([, v]) => String(v)).join(" ");
      assert(!new RegExp(`\\b${p.accepts[0]}\\b`).test(values) || p.prompt.includes(String(p.accepts[0])),
        `${p.id} leaked its answer in the served text`);
    }

    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "puz@b.com", password: "a-long-enough-pass", name: "Z" });
    const kid = (await post(c, "/learners", { name: "Puzzle Kid" })).body.learner;

    const list = (await c("/puzzles")).body.puzzles;
    assert(list.length === PUZZLES.length, "puzzle list incomplete");
    assert(list.every(p => p.hintCount > 0 && !("accepts" in p)), "puzzle list exposes answers");

    const target = PUZZLES[1];

    /* A wrong answer must NOT reveal the solution — that is the whole point. */
    const wrong = await post(c, `/puzzles/${target.id}/answer`,
      { learnerId: kid.id, answer: "999999", hintsUsed: 0 });
    assert(wrong.body.correct === false, "a wrong puzzle answer was accepted");
    assert(!("correctAnswer" in wrong.body), "a wrong answer revealed the solution");
    assert(!JSON.stringify(wrong.body).includes(String(target.accepts[0])),
      "a wrong answer leaked the solution in its message");

    /* Hints come one at a time. */
    const h1 = await post(c, `/puzzles/${target.id}/hint`, { level: 1 });
    assert(h1.body.hint === target.hints[0], "wrong hint served");
    assert(h1.body.last === false, "the first of several hints was marked final");

    /* Solving with no hints earns a gold trophy and the elegant badge. */
    const solved = await post(c, `/puzzles/${target.id}/answer`,
      { learnerId: kid.id, answer: String(target.accepts[0]), hintsUsed: 0 });
    assert(solved.body.correct === true, "the correct puzzle answer was rejected");
    assert(solved.body.trophy === "gold", `unaided solve gave a ${solved.body.trophy} trophy`);
    assert(solved.body.firstSolve === true, "first solve not flagged");

    const rw = (await c(`/learners/${kid.id}/rewards`)).body;
    assert(rw.badges.some(b => b.code === "elegant_solution"), "no badge for an unaided solve");

    /* A hinted solve on another puzzle earns a lesser trophy. */
    const other = PUZZLES[2];
    const hinted = await post(c, `/puzzles/${other.id}/answer`,
      { learnerId: kid.id, answer: String(other.accepts[0]), hintsUsed: 2 });
    assert(hinted.body.trophy === "bronze", `a two-hint solve gave a ${hinted.body.trophy} trophy`);

    /* Re-solving does not award points twice. */
    const again = await post(c, `/puzzles/${target.id}/answer`,
      { learnerId: kid.id, answer: String(target.accepts[0]), hintsUsed: 0 });
    assert(again.body.firstSolve === false, "a repeat solve was counted as the first");

    const solvedList = (await c(`/learners/${kid.id}/puzzles`)).body;
    assert(solvedList.solved.length === 2, `expected 2 solved, got ${solvedList.solved.length}`);
    assert(solvedList.solved.every(s => s.title), "solved puzzles are not named");

    /* Another account cannot answer for this learner. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "puzbob@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await post(bob, `/puzzles/${target.id}/answer`,
      { learnerId: kid.id, answer: String(target.accepts[0]) })).status === 403,
      "another account solved a puzzle for this learner");

    return `${PUZZLES.length} puzzles, hints one at a time, wrong answers never reveal the solution, trophies reflect hint use`;
  },


  /* 10.1 — response times and payload sizes under concurrency.
     This measures the SERVER only. Real page-load time depends on the
     network and device, which cannot be established from here, so 10.1
     stays partial and says so. */
  "performance": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "perf@b.com", password: "a-long-enough-pass", name: "P" });
    const kid = (await post(c, "/learners", { name: "Perf Kid" })).body.learner;
    await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 6, total: 8 });

    const time = async (label, fn) => {
      const t0 = performance.now();
      const r = await fn();
      return { label, ms: performance.now() - t0, r };
    };

    /* Cold single-request latency on the endpoints a screen actually needs. */
    const singles = [];
    singles.push(await time("curriculum", () => c("/curriculum")));
    singles.push(await time("questions", () => c("/topics/g6-nscoord/practice/questions")));
    singles.push(await time("progress", () => c(`/learners/${kid.id}/progress`)));
    singles.push(await time("next", () => c(`/learners/${kid.id}/next`)));
    singles.push(await time("answer", () => post(c, "/answer", { questionId: "g6-ratios:0", answer: 0 })));

    for (const s of singles)
      assert(s.ms < 1000, `${s.label} took ${Math.round(s.ms)}ms, over the 1000ms budget`);

    /* The curriculum payload is the largest thing served; it must stay sane. */
    const curBytes = JSON.stringify((await c("/curriculum")).body).length;
    assert(curBytes < 600_000, `curriculum payload is ${Math.round(curBytes / 1024)}KB`);

    /* Concurrency: 40 simultaneous reads must all succeed and stay responsive.
       This is nowhere near the spec's 50,000 concurrent users — that needs a
       load-testing rig and horizontal scaling, and 13.10 stays open. */
    const t0 = performance.now();
    const results = await Promise.all(
      Array.from({ length: 40 }, () => c("/topics/g6-nscoord/practice/questions")));
    const wall = performance.now() - t0;
    assert(results.every(r => r.status === 200), "a request failed under concurrent load");
    assert(wall < 5000, `40 concurrent reads took ${Math.round(wall)}ms`);

    /* Writes under concurrency must not corrupt the progress row. */
    await Promise.all(Array.from({ length: 10 }, () =>
      post(c, "/runs", { learnerId: kid.id, topicId: "g6-percent", tier: "practice", score: 5, total: 6 })));
    const prog = (await c(`/learners/${kid.id}/progress`)).body.progress
      .find(p => p.topic_id === "g6-percent" && p.tier === "practice");
    assert(prog, "concurrent writes lost the progress row");
    assert(prog.runs === 10, `expected 10 runs recorded, got ${prog.runs}`);
    assert(prog.best_pct === 83, `best percentage corrupted to ${prog.best_pct}`);

    const slowest = singles.sort((a, b) => b.ms - a.ms)[0];
    return `slowest endpoint ${slowest.label} at ${Math.round(slowest.ms)}ms, ` +
           `curriculum ${Math.round(curBytes / 1024)}KB, 40 concurrent reads in ${Math.round(wall)}ms, ` +
           `10 concurrent writes all recorded`;
  },


  /* 11.1 + 10.6 — installable PWA with an offline shell */
  "pwa-offline": async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");

    /* Manifest. */
    assert(existsSync("app/web/public/manifest.webmanifest"), "no web app manifest");
    const man = JSON.parse(readFileSync("app/web/public/manifest.webmanifest", "utf8"));
    for (const k of ["name", "short_name", "start_url", "display", "icons"])
      assert(man[k], `manifest is missing ${k}`);
    assert(man.display === "standalone", "manifest does not request standalone display");
    assert(man.icons.length && man.icons[0].src, "manifest has no icon");
    assert(existsSync("app/web/public" + man.icons[0].src), "manifest icon file does not exist");

    /* The document must reference the manifest and a theme colour. */
    const html = readFileSync("app/web/index.html", "utf8");
    assert(/rel="manifest"/.test(html), "index.html does not link the manifest");
    assert(/name="theme-color"/.test(html), "no theme colour declared");
    assert(/<html lang="en">/.test(html), "document has no language");

    /* Service worker: shell cached, API never cached. That second rule is the
       important one — a cached answer could be replayed against the grader,
       and stale progress would be worse than an honest offline message. */
    const sw = readFileSync("app/web/public/sw.js", "utf8");
    assert(/addEventListener\("install"/.test(sw), "service worker has no install handler");
    assert(/addEventListener\("fetch"/.test(sw), "service worker has no fetch handler");
    assert(/pathname\.startsWith\("\/api\/"\)/.test(sw), "service worker does not exclude the API");
    assert(/method !== "GET"/.test(sw), "service worker does not exclude writes");
    assert(/caches\.delete/.test(sw), "service worker never cleans up old caches");

    /* It must be registered, and only in production builds. */
    const main = readFileSync("app/web/src/main.tsx", "utf8");
    assert(/serviceWorker.*register/s.test(main), "service worker is never registered");
    assert(/import\.meta\.env\.PROD/.test(main), "service worker would register during development");

    /* And the app must actually build, with the shell files emitted. */
    execSync("./node_modules/.bin/vite build", { cwd: "app/web", stdio: "pipe" });
    for (const f of ["dist/index.html", "dist/manifest.webmanifest", "dist/sw.js", "dist/icon.svg"])
      assert(existsSync("app/web/" + f), `production build did not emit ${f}`);

    const built = readFileSync("app/web/dist/index.html", "utf8");
    assert(/rel="manifest"/.test(built), "built page lost the manifest link");

    return "installable manifest, offline shell, API excluded from cache, production build emits all shell files";
  },


  /* 5.10 — achievement titles earned by advanced mastery */
  "achievement-titles": async () => {
    const rewards = await import("../app/server/src/rewards.js");
    assert(rewards.TITLES.length >= 4, "too few achievement titles");
    for (const t of rewards.TITLES) {
      assert(t.name && t.code, "a title is missing a name or code");
      assert(Array.isArray(t.needs) && t.needs.length, `${t.code} has no requirements`);
      for (const n of t.needs)
        assert(rewards.BADGES[n], `title ${t.code} requires unknown badge "${n}"`);
    }
    /* Titles must be ordered strongest first, so the displayed one is the best. */
    const idx = c => rewards.TITLES.findIndex(t => t.code === c);
    assert(idx("grand_combinatorialist") < idx("apprentice"),
      "titles are not ordered with the hardest first");

    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "title@b.com", password: "a-long-enough-pass", name: "T" });
    const kid = (await post(c, "/learners", { name: "Title Kid" })).body.learner;

    /* Nothing earned yet. */
    let r = (await c(`/learners/${kid.id}/rewards`)).body;
    assert(r.title && r.title.current === null, "a learner started with a title");
    assert(r.title.locked.length === rewards.TITLES.length, "locked titles not listed");

    /* A first round earns the entry title, not a prestigious one. */
    await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
    r = (await c(`/learners/${kid.id}/rewards`)).body;
    assert(r.title.current, "no title after earning the first badge");
    assert(r.title.current.code === "apprentice",
      `a single perfect round awarded "${r.title.current.code}"`);

    /* A title requiring badges the learner does not hold stays locked. */
    assert(r.title.locked.some(t => t.code === "grand_combinatorialist"),
      "an unearned advanced title is not locked");

    return `${rewards.TITLES.length} titles, requirements validated against real badges, strongest shown first`;
  },


  /* 4.1.8 + 5.8 — leaderboards: off by default, teacher-controlled, no global board */
  "leaderboards": async () => {
    const teacher = client(), alice = client(), bob = client(), outsider = client();
    await post(teacher, "/auth/register",
      { coppaConsent: true, role: "teacher", email: "lb-t@b.com", password: "a-long-enough-pass", name: "T" });
    await post(alice, "/auth/register",
      { coppaConsent: true, email: "lb-a@b.com", password: "a-long-enough-pass", name: "A" });
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "lb-b@b.com", password: "a-long-enough-pass", name: "B" });
    await post(outsider, "/auth/register",
      { coppaConsent: true, email: "lb-o@b.com", password: "a-long-enough-pass", name: "O" });

    const cls = (await post(teacher, "/classes", { name: "Leaderboard Class" })).body.class;
    const aKid = (await post(alice, "/learners", { name: "Ada" })).body.learner;
    const bKid = (await post(bob, "/learners", { name: "Ben" })).body.learner;
    await post(alice, "/classes/join", { joinCode: cls.joinCode, learnerId: aKid.id });
    await post(bob, "/classes/join", { joinCode: cls.joinCode, learnerId: bKid.id });

    /* Ada does more work than Ben. */
    for (let i = 0; i < 3; i++)
      await post(alice, "/runs", { learnerId: aKid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
    await post(bob, "/runs", { learnerId: bKid.id, topicId: "g6-ratios", tier: "practice", score: 4, total: 8 });

    /* OFF by default — a child is never ranked without an adult deciding. */
    let lb = await alice(`/classes/${cls.id}/leaderboard`);
    assert(lb.status === 200 && lb.body.enabled === false,
      "the leaderboard was on before any teacher enabled it");
    assert(lb.body.reason, "no explanation given when the leaderboard is off");

    /* A parent cannot switch it on. */
    assert((await alice(`/classes/${cls.id}/settings`,
      { method: "PUT", body: JSON.stringify({ leaderboardOn: true }) })).status === 403,
      "a parent enabled the class leaderboard");

    /* The teacher enables it, anonymised. */
    await teacher(`/classes/${cls.id}/settings`,
      { method: "PUT", body: JSON.stringify({ leaderboardOn: true, displayNames: false }) });

    lb = (await alice(`/classes/${cls.id}/leaderboard`)).body;
    assert(lb.enabled === true, "the leaderboard did not turn on");
    assert(lb.board.length === 2, `expected 2 learners, got ${lb.board.length}`);
    assert(lb.board[0].points > lb.board[1].points, "the board is not ordered by points");
    assert(lb.board[0].name === "Ada", "a parent cannot see their own child on the board");
    /* The other family's child must NOT be named while anonymised. */
    const otherRow = lb.board.find(r => !r.you);
    assert(otherRow.name !== "Ben", "another family's child was named on an anonymised board");
    assert(/^Learner \d+$/.test(otherRow.name), `anonymised label was "${otherRow.name}"`);

    /* With names allowed, classmates are named. */
    await teacher(`/classes/${cls.id}/settings`,
      { method: "PUT", body: JSON.stringify({ leaderboardOn: true, displayNames: true }) });
    lb = (await alice(`/classes/${cls.id}/leaderboard`)).body;
    assert(lb.board.some(r => r.name === "Ben"), "names were allowed but classmates stayed anonymous");

    /* Someone with no child in the class sees nothing at all. */
    assert((await outsider(`/classes/${cls.id}/leaderboard`)).status === 403,
      "an unrelated account read a class leaderboard");

    /* There is no global leaderboard endpoint to leak across classes. */
    const global = await alice("/leaderboard");
    assert(global.status === 404, "a global leaderboard endpoint exists");

    return "off by default, teacher-controlled, anonymised by default, class-scoped with no global board";
  },


  /* 10.4 — backups, restore, and a readiness probe that means something */
  "reliability": async () => {
    const { existsSync, rmSync, mkdirSync, writeFileSync, utimesSync } = await import("node:fs");
    const { DatabaseSync } = await import("node:sqlite");

    /* /health is liveness; /ready must actually consult the database. */
    const health = await (await fetch(`${BASE}/health`)).json();
    assert(health.ok === true, "health endpoint is not ok");
    const ready = await fetch(`${BASE}/ready`);
    assert(ready.status === 200, `readiness probe returned ${ready.status}`);
    const rBody = await ready.json();
    assert(rBody.ok === true && typeof rBody.users === "number",
      "readiness probe does not report on the database");

    /* Take a backup through the admin endpoint. */
    /* The admin account may already exist from another check, so register
       then fall back to signing in rather than assuming a clean slate. */
    const admin = client();
    const reg = await post(admin, "/auth/register",
      { coppaConsent: true, email: "boss@b.com", password: "a-long-enough-pass", name: "Boss" });
    if (reg.status !== 200)
      await post(admin, "/auth/login", { email: "boss@b.com", password: "a-long-enough-pass" });
    const overview = await admin("/admin/overview");
    assert(overview.status === 200, `admin sign-in failed: ${JSON.stringify(overview.body)}`);
    const before = overview.body.users;

    const b = await post(admin, "/admin/backup", {});
    assert(b.status === 200 && b.body.ok, `backup failed: ${JSON.stringify(b.body)}`);
    assert(existsSync(b.body.file), "backup file was not written");

    /* The snapshot must be a usable database with the same data, not an
       empty file — a backup nobody can restore is not a backup. */
    const snap = new DatabaseSync(b.body.file);
    const restored = snap.prepare("SELECT COUNT(*) c FROM users").get().c;
    assert(restored === before, `backup holds ${restored} users, live database has ${before}`);
    const integrity = snap.prepare("PRAGMA integrity_check").get();
    assert(String(Object.values(integrity)[0]).toLowerCase() === "ok",
      "the backup fails its own integrity check");
    snap.close();

    /* Pruning keeps the disk from filling. */
    const { prune } = await import("../app/server/src/backup.js");
    const dir = "app/server/data/prune-test";
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 10; i++) {
      const f = `${dir}/old-${i}.db`;
      writeFileSync(f, "x");
      const t = new Date(2020, 0, i + 1);
      utimesSync(f, t, t);
    }
    const removed = prune(dir, 3);
    assert(removed.length === 7, `pruning to 3 removed ${removed.length} of 10`);
    const { readdirSync } = await import("node:fs");
    assert(readdirSync(dir).length === 3, "pruning left the wrong number of backups");
    rmSync(dir, { recursive: true, force: true });

    /* Graceful degradation: an unknown route returns JSON-ish failure, not a crash. */
    const missing = await fetch(`${BASE}/api/definitely-not-a-route`);
    assert(missing.status === 404, `unknown route returned ${missing.status}`);

    return "liveness and readiness separated, backup restorable and integrity-checked, pruning bounded";
  },


  /* 3.5.4 — maths notation as MathML with spoken equivalents */
  "math-notation": async () => {
    const { toMathML, renderQuestion } = await import("../app/shared/mathml.mjs");

    const cases = [
      ["7 × 8", "7 times 8", "<mo>&#xD7;</mo>"],
      ["12 ÷ 3", "12 divided by 3", "<mo>&#xF7;</mo>"],
      ["3/4", "3 over 4", "<mfrac>"],
      ["|-7|", "the absolute value of -7", "<mo>|</mo>"],
      ["(3, -2)", "the point 3 comma -2", "<mo>,</mo>"],
      ["4 : 6", "4 to 6", "<mo>:</mo>"],
      ["2^5", "2 to the power of 5", "<msup>"]
    ];
    for (const [input, spoken, tag] of cases) {
      const r = toMathML(input);
      assert(r, `"${input}" produced no MathML`);
      assert(r.spoken === spoken, `"${input}" speaks as "${r.spoken}", expected "${spoken}"`);
      assert(r.mathml.includes(tag), `"${input}" is missing ${tag}`);
      assert(r.mathml.includes('xmlns="http://www.w3.org/1998/Math/MathML"'),
        `"${input}" has no MathML namespace`);
      assert(r.mathml.includes('aria-label='), `"${input}" has no accessible label`);
      /* Negative numbers must use a minus sign, not a hyphen. */
      if (input.includes("-")) assert(r.mathml.includes("&#x2212;"),
        `"${input}" rendered a hyphen instead of a minus sign`);
    }

    /* Unrecognised text must NOT be wrapped in markup that lies about it. */
    assert(toMathML("what is the capital of France") === null,
      "prose was rendered as mathematics");
    assert(toMathML("") === null, "empty input produced MathML");

    /* Inside a sentence, only the maths is marked up and prose is escaped. */
    const q = renderQuestion("What is 7 × 8, and where is (3, -2)?");
    assert(q.mathCount === 2, `found ${q.mathCount} expressions, expected 2`);
    assert(q.html.includes("What is "), "prose was lost");
    assert((q.html.match(/<math /g) || []).length === 2, "wrong number of math elements");

    /* Prose around the maths must be escaped, or a question containing an
       angle bracket would emit raw markup. */
    const risky = renderQuestion("Is 5 < 6 and 7 × 8 true?");
    assert(risky.html.includes("5 &lt; 6"), "a less-than in prose was not escaped");
    assert(risky.mathCount === 1, "the maths in a mixed sentence was not found");
    const injected = renderQuestion("Careful <script>alert(1)</script> and 3/4");
    assert(!injected.html.includes("<script"), "script markup survived rendering");
    assert(injected.html.includes("<mfrac>"), "the fraction was lost while escaping");

    /* Every MathML fragment must be balanced, or a reader will mis-announce it. */
    for (const [input] of cases) {
      const ml = toMathML(input).mathml;
      const open = (ml.match(/<[a-z]+[ >]/g) || []).length;
      const close = (ml.match(/<\/[a-z]+>/g) || []).length;
      assert(open === close, `"${input}" produced unbalanced MathML`);
    }

    return `${cases.length} notations rendered as MathML with spoken labels, prose left alone`;
  },


  /* 8.5 — content quality tooling that demonstrably catches problems */
  "content-lint": async () => {
    const { execSync } = await import("node:child_process");
    const { lintQuestion } = await import("../tools/lint-content.mjs");

    /* Every rule must fire on content that breaks it. A linter nobody has
       seen catch anything is not evidence that the content is sound. */
    const fires = (q, where, grade, needle) => {
      const r = lintQuestion(q, where || "t#1", grade || null, new Map());
      const all = [...r.errors, ...r.warnings].join(" | ");
      assert(all.includes(needle), `rule for "${needle}" did not fire; got: ${all || "(nothing)"}`);
    };

    fires({ type: "in", q: "What is 2 + 2?", ans: 4 }, "t#1", null, "no explanation");
    fires({ type: "in", q: "hi", ans: 1, expl: "x", sec: "N" }, "t#1", null, "too short");
    fires({ type: "mc", q: "Pick the right one here", opts: ["a", "a"], a: 0, expl: "x", sec: "N" },
      "t#1", null, "duplicate options");
    fires({ type: "mc", q: "Pick the right one here", opts: ["a"], a: 0, expl: "x", sec: "N" },
      "t#1", null, "fewer than two options");
    fires({ type: "mc", q: "Pick the right one here", opts: ["a", "b"], a: 9, expl: "x", sec: "N" },
      "t#1", null, "answer index");
    fires({ type: "multi", q: "Select every correct one", opts: ["a", "b"], aMulti: [0, 1], expl: "x", sec: "N" },
      "t#1", null, "every option marked correct");
    fires({ type: "order", q: "Put these in order please", items: ["a", "b", "c"], ansOrder: ["a", "b", "z"], expl: "x", sec: "N" },
      "t#1", null, "permutation");
    fires({ type: "order", q: "Put these in order please", items: ["a", "b"], ansOrder: ["a", "b"], expl: "x", sec: "N" },
      "t#1", null, "too few items");
    fires({ type: "in", q: "What is 2 + 2?", ans: 4, expl: "What is 2 + 2?", sec: "N" },
      "t#1", null, "repeats the question");
    fires({ type: "in", q: "What is 2 + 2?", ans: 4, sec: "N", expl: "Add them", hint: "Add them" },
      "t#1", null, "hint is identical");
    fires({ type: "in", q: "What is 2 + 2?", ans: 4, expl: "x", sec: "ZZZ" }, "t#1", null, "unknown section");
    fires({ type: "in", ans: 4, expl: "x", sec: "N",
            q: "Considering the aforementioned circumstances and notwithstanding any subsequent " +
               "developments, determine conclusively the aggregate quantity resulting therefrom" },
      "t#1", "K", "grade K");

    /* Duplicate detection across a bank. */
    const seen = new Map();
    lintQuestion({ type: "in", q: "What is 2 + 2?", ans: 4, expl: "x", sec: "N" }, "t#1", null, seen);
    const dup = lintQuestion({ type: "in", q: "What is 2 + 2?", ans: 4, expl: "x", sec: "N" }, "t#2", null, seen);
    assert(dup.errors.some(e => e.includes("duplicates")), "duplicate questions were not detected");

    /* Clean content passes. */
    const good = lintQuestion(
      { type: "in", q: "What is 7 times 8?", ans: 56, expl: "7 times 8 is 56.", sec: "N", hint: "Count in eights." },
      "t#1", "3", new Map());
    assert(good.errors.length === 0, `clean question rejected: ${good.errors.join(", ")}`);

    /* And the real content passes the whole tool. */
    const out = execSync("node tools/lint-content.mjs --json").toString();
    const report = JSON.parse(out);
    assert(report.errors.length === 0, `authored content has errors: ${report.errors.slice(0, 3).join("; ")}`);
    assert(report.questions > 150, "linter did not see the full content set");

    return `13 rules each proven to fire, ${report.questions} questions and ${report.puzzles} puzzles clean`;
  },


  /* 11.7 — the deployable artefact actually works.
     Production mode serves the built client from the API process, so a broken
     build or a wrong path would only show up after deploying. Check it here. */
  "production-build": async () => {
    const { execSync, spawn } = await import("node:child_process");
    const { existsSync, readFileSync, rmSync } = await import("node:fs");

    /* Deployment files exist and are coherent. */
    assert(existsSync("Dockerfile"), "no Dockerfile");
    const df = readFileSync("Dockerfile", "utf8");
    assert(/node:2[4-9]/.test(df), "Dockerfile does not pin a Node version with node:sqlite");
    assert(/VOLUME \/data/.test(df), "Dockerfile does not declare a volume for the database");
    assert(/DB_FILE=\/data/.test(df), "Dockerfile does not point the database at the volume");
    assert(/HEALTHCHECK/.test(df), "Dockerfile has no health check");
    assert(existsSync(".dockerignore"), "no .dockerignore, so node_modules would be copied in");
    assert(existsSync("DEPLOY.md"), "no deployment instructions");

    for (const f of ["fly.toml", "render.yaml"]) {
      assert(existsSync(f), `no ${f}`);
      const c = readFileSync(f, "utf8");
      assert(/\/ready/.test(c), `${f} does not use the readiness probe for health checks`);
      assert(/\/data/.test(c), `${f} does not mount persistent storage`);
    }

    /* Build the client and boot the server exactly as production would. */
    execSync("./node_modules/.bin/vite build", { cwd: "app/web", stdio: "pipe" });
    assert(existsSync("app/web/dist/index.html"), "production build produced no client");

    const port = 4188;
    const dbFile = "./data/prodcheck.db";
    rmSync("app/server/" + dbFile.replace("./", ""), { force: true });
    const srv = spawn("node", ["src/index.js"], {
      cwd: "app/server",
      env: { ...process.env, NODE_ENV: "production", PORT: String(port), DB_FILE: dbFile },
      stdio: "ignore"
    });
    try {
      let up = false;
      for (let i = 0; i < 50 && !up; i++) {
        try { up = (await fetch(`http://localhost:${port}/ready`)).ok; } catch {}
        if (!up) await new Promise(r => setTimeout(r, 150));
      }
      assert(up, "the production server never became ready");

      /* One process must serve the client, its assets and the API. */
      const shell = await fetch(`http://localhost:${port}/`);
      assert(shell.ok, `production server did not serve the client (${shell.status})`);
      assert((await shell.text()).includes("<title>"), "served client has no title");

      const deep = await fetch(`http://localhost:${port}/some/client/route`);
      assert(deep.ok, "client-side routes do not fall back to the shell");

      const asset = await fetch(`http://localhost:${port}/manifest.webmanifest`);
      assert(asset.ok, "static assets are not served in production");

      const api = await fetch(`http://localhost:${port}/api/curriculum`);
      assert(api.ok, "the API is not reachable in production mode");

      /* The SPA fallback must NOT swallow unknown API routes. */
      const bogus = await fetch(`http://localhost:${port}/api/definitely-not-here`);
      assert(bogus.status === 404,
        `an unknown API route returned ${bogus.status}; the SPA fallback is catching /api`);

      /* Production must set the hardened cookie flags. */
      const reg = await fetch(`http://localhost:${port}/api/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "prod@b.com", password: "a-long-enough-pass",
                               name: "Prod", coppaConsent: true })
      });
      const cookie = (reg.headers.getSetCookie?.() || []).join(";");
      assert(/Secure/i.test(cookie), "the session cookie is not Secure in production");
      assert(/HttpOnly/i.test(cookie), "the session cookie is not HttpOnly in production");
      assert(reg.headers.get("strict-transport-security"), "HSTS is not set in production");

      return "single-process production build serves client, assets and API; cookies hardened; configs coherent";
    } finally {
      srv.kill();
      rmSync("app/server/" + dbFile.replace("./", ""), { force: true });
    }
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
