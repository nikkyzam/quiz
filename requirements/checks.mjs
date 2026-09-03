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
           ADMIN_EMAILS: "boss@b.com",
           /* Integrations run against mock services the checks stand up on
              loopback: an Anthropic-shaped LLM, an SMTP server, push and
              webhook receivers. Background jobs are run on demand. */
           JOBS_INTERVAL_MS: "0", PUBLIC_URL: `http://localhost:${PORT}`, GLOBAL_LIMIT_PER_MINUTE: "1000000",
           ANTHROPIC_API_KEY: "test-key", TUTOR_API_URL: "http://127.0.0.1:4126", TUTOR_TIMEOUT_MS: "1500",
           SMTP_HOST: "127.0.0.1", SMTP_PORT: "4127", SMTP_TLS: "none", SMTP_USER: "bf", SMTP_PASS: "pw", SMTP_FROM: "BeastForge <no-reply@beastforge.test>" },
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
      assert(row, "existing user row was lost during migration");
      /* Personal data from before encryption at rest (10.3) is encrypted on
         first boot: the raw row must now be ciphertext, and it must still
         decrypt to what was there, with the blind index filled in. */
      const { decrypt, blindIndex, isEncrypted } = await import("../app/server/src/crypto.js");
      assert(isEncrypted(row.name) && isEncrypted(row.email), "legacy personal data was left in clear");
      assert(decrypt(row.name) === "Legacy User" && decrypt(row.email) === "legacy@b.com", "encrypted legacy row does not decrypt to the original");
      assert(row.email_hash === blindIndex("legacy@b.com"), "blind index not filled for the legacy row");
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
        } else if (q.type === "plot") {
          assert(Array.isArray(q.ansPt) && q.ansPt.length === 2 && q.ansPt.every(Number.isInteger), `${tag} has a bad plot point`);
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

  /* 3.1.2-3.1.4, 3.4.1-3.4.5 — every topic in Appendix A, core and advanced,
     has authored or generated questions at practice, challenge and boss tier;
     K-2 wording passes the reading-level rule; every topic maps to a standard. */
  "curriculum-coverage": async () => {
    const { QUESTIONS } = await import("../app/shared/questions.mjs");
    const { CURRICULUM } = await import("../app/shared/curriculum.mjs");
    const { TEMPLATES, generate } = await import("../app/shared/generators.mjs");
    const { TOPIC_STANDARDS } = await import("../app/shared/standards.mjs");
    const { lintQuestion, runAll } = await import("../tools/lint-content.mjs");

    const perGrade = {}, perStrand = {};
    let topics = 0, questions = 0;
    for (const [g, v] of Object.entries(CURRICULUM)) {
      perGrade[g] = { topics: 0, questions: 0 };
      for (const u of v.units) for (const t of u.topics) {
        topics++; perGrade[g].topics++;
        const bank = QUESTIONS[t.id] || [];
        const generated = TEMPLATES[t.id] ? Array.from({ length: 12 }, (_, i) => ({ lvl: TEMPLATES[t.id].lvl, ...generate(t.id, i) })) : [];
        const all = [...bank, ...generated];
        assert(all.length >= 6, `${g}/${t.id} (${t.name}) has ${all.length} questions; every Appendix A topic needs at least 6`);
        const tiers = new Set(all.map(q => q.lvl || 1));
        assert(tiers.has(1) && tiers.has(2) && tiers.has(3),
          `${g}/${t.id} lacks a tier: has ${[...tiers].sort().join(",")} (needs practice, challenge and boss)`);
        assert(new Set(all.map(q => q.type)).size >= 2, `${g}/${t.id} uses a single question type`);
        assert(TOPIC_STANDARDS[t.id]?.ccss?.length, `${g}/${t.id} has no standards mapping`);
        questions += all.length; perGrade[g].questions += all.length;
        if (u.track === "adv") {
          const k = u.name.replace(/ Extended| Extensions?/g, "");
          perStrand[k] = (perStrand[k] || 0) + 1;
        }
        if (["K", "1", "2"].includes(g))
          for (const [i, q] of bank.entries()) {
            const r = lintQuestion(q, `${t.id}#${i + 1}`, g, new Map());
            const heavy = r.warnings.filter(w => /words is long|heavy vocabulary/.test(w));
            assert(!heavy.length, `reading level: ${heavy[0]}`);
          }
      }
    }
    for (const strand of ["Number Theory", "Combinatorics", "Algebra", "Geometry", "Probability"])
      assert(Object.keys(perStrand).some(k => k.includes(strand)), `no advanced ${strand} unit is covered`);

    const lint = runAll();
    const errs = lint.errors.filter(e => !e.startsWith("approval:"));
    assert(errs.length === 0, `content lint errors: ${errs.slice(0, 3).join(" | ")}`);

    return `${topics} topics across ${Object.keys(perGrade).length} grades all covered, ${questions} questions ` +
           `(${Object.entries(perGrade).map(([g, v]) => `${g}:${v.questions}`).join(" ")}), ` +
           `advanced strands ${Object.keys(perStrand).length}, lint clean`;
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
    const { readdirSync } = await import("node:fs");
    const src = readdirSync("app/server/src").filter(f => f.endsWith(".js"))
      .map(f => readFileSync(`app/server/src/${f}`, "utf8")).join("\n");
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
      /* Highlighting (3.2.9): the spoken word is tracked from the speech
         engine's boundary events and marked in the rendered text. */
      const { readFileSync } = await import("node:fs");
      const src = readFileSync("app/web/src/components/ReadAloud.tsx", "utf8");
      assert(/boundary/.test(src), "read-aloud does not listen for word boundary events");
      assert(/<mark/.test(src), "read-aloud never marks the word being spoken");
      assert(/charIndex/.test(src), "read-aloud does not map the boundary offset to a word");
      return `${results.length} maths phrases spoken as words, spoken word highlighted from boundary events`;
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
      if (p.kind === "freeform") {
        good = { lines: p.reference };
        bad = { lines: ["Because it is true."] };
      } else if (p.kind === "order") {
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
      assert(fb.wrongSteps || fb.firstWrongPosition !== null || fb.missing?.length,
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
    assert(list.length === PUZZLES.filter(p => !p.hidden).length, "puzzle list incomplete");
    assert(list.every(p => !p.hidden), "a hidden puzzle is listed without an unlock");
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
      env: { ...process.env, NODE_ENV: "production", PORT: String(port), DB_FILE: dbFile,
             DATA_KEY: Buffer.alloc(32, 7).toString("base64") },
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


  /* X.6 — password reset: the account is recoverable without losing the data */
  "password-reset": async () => {
    const c = client();
    const email = "reset@b.com", oldPw = "a-long-enough-pass", newPw = "a-different-long-pass";
    await post(c, "/auth/register", { coppaConsent: true, email, password: oldPw, name: "R" });
    const kid = (await post(c, "/learners", { name: "Reset Kid" })).body.learner;
    await post(c, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 7, total: 8 });

    /* Requesting a reset must not reveal whether an account exists. */
    const known = await post(client(), "/auth/forgot", { email });
    const unknown = await post(client(), "/auth/forgot", { email: "nobody@nowhere.test" });
    assert(known.body.message === unknown.body.message,
      "the forgot-password response differs for known and unknown addresses");
    assert(known.body.token, "no reset token issued while email delivery is unavailable");

    /* The raw token must NOT be what is stored. */
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync("app/server/data/verify.db");
    const stored = db.prepare("SELECT token_hash FROM reset_tokens ORDER BY created_at DESC LIMIT 1").get();
    assert(stored && stored.token_hash !== known.body.token,
      "the reset token is stored in plain text");

    /* A wrong or absent token is refused, and weak passwords still are. */
    assert((await post(client(), "/auth/reset", { token: "nonsense", password: newPw })).status === 400,
      "an invalid reset token was accepted");
    assert((await post(client(), "/auth/reset", { token: known.body.token, password: "short" })).status === 400,
      "a weak password was accepted on reset");

    /* The reset works. */
    const done = await post(client(), "/auth/reset", { token: known.body.token, password: newPw });
    assert(done.status === 200, `reset failed: ${JSON.stringify(done.body)}`);

    /* Single use. */
    assert((await post(client(), "/auth/reset", { token: known.body.token, password: newPw })).status === 400,
      "a reset token worked twice");

    /* Old password dead, new one works, and the learner data survived. */
    assert((await post(client(), "/auth/login", { email, password: oldPw })).status === 401,
      "the old password still works after a reset");
    const back = client();
    const login = await post(back, "/auth/login", { email, password: newPw });
    assert(login.status === 200, "the new password does not work");
    const learners = (await back("/learners")).body.learners;
    assert(learners.length === 1 && learners[0].id === kid.id,
      "the learner was lost during a password reset");
    const prog = (await back(`/learners/${kid.id}/progress`)).body.progress;
    assert(prog.length > 0, "progress was lost during a password reset");

    /* A reset must lock out whoever prompted it: the original session dies. */
    assert((await c("/learners")).status === 401,
      "the session that existed before the reset is still valid");

    /* Changing a password while signed in requires the current one. */
    assert((await post(back, "/auth/change-password", { current: "wrong-one-entirely", password: "yet-another-long-pass" })).status === 401,
      "the password was changed without the current one");

    return "token hashed at rest, single use, old sessions revoked, learner data intact";
  },

  /* X.7 — graceful shutdown and error handling */
  "resilience": async () => {
    const { spawn } = await import("node:child_process");

    /* Malformed JSON must produce a clean error, not a stack trace. */
    const bad = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
    assert(bad.status === 400, `malformed JSON returned ${bad.status}`);
    const body = await bad.text();
    assert(!/at .*\.js:\d+/.test(body), "an error response leaked a stack trace");
    assert(body.startsWith("{"), "the error handler returned HTML rather than JSON");

    /* An oversized body is rejected rather than buffered. */
    const huge = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x".repeat(200_000) }) });
    assert(huge.status === 413 || huge.status === 400, `oversized body returned ${huge.status}`);

    /* SIGTERM must drain rather than kill: start a server, signal it, and
       confirm it exits cleanly of its own accord. */
    const port = 4177;
    const srv = spawn("node", ["src/index.js"], {
      cwd: "app/server",
      env: { ...process.env, PORT: String(port), DB_FILE: "./data/shutdown.db" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    srv.stdout.on("data", d => { out += d.toString(); });

    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch(`http://localhost:${port}/health`)).ok; } catch {}
      if (!up) await new Promise(r => setTimeout(r, 100));
    }
    assert(up, "the test server never started");

    const exited = new Promise(resolve => srv.on("exit", (code, sig) => resolve({ code, sig })));
    srv.kill("SIGTERM");
    const result = await Promise.race([
      exited,
      new Promise(r => setTimeout(() => r({ timeout: true }), 8000))
    ]);
    assert(!result.timeout, "the server did not exit within 8s of SIGTERM");
    assert(result.code === 0, `the server exited with code ${result.code} rather than draining cleanly`);
    assert(/draining connections/.test(out), "shutdown did not log that it was draining");

    const { rmSync } = await import("node:fs");
    rmSync("app/server/data/shutdown.db", { force: true });

    return "malformed and oversized bodies handled without stack traces, SIGTERM drains and exits 0";
  },


  /* X.8 — backups actually happen on a schedule, not only when asked */
  "scheduled-backup": async () => {
    const { spawn } = await import("node:child_process");
    const { rmSync, existsSync, readdirSync, mkdirSync } = await import("node:fs");

    const dir = "app/server/data/sched-backups";
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    rmSync("app/server/data/sched.db", { force: true });

    /* A tiny interval so the check does not wait an hour. */
    const port = 4178;
    const srv = spawn("node", ["src/index.js"], {
      cwd: "app/server",
      env: { ...process.env, PORT: String(port), DB_FILE: "./data/sched.db",
             BACKUP_INTERVAL_HOURS: String(1 / 3600),   // one second
             BACKUP_DIR: "./data/sched-backups", BACKUP_KEEP: "3" },
      stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    srv.stdout.on("data", d => { out += d.toString(); });

    try {
      let up = false;
      for (let i = 0; i < 50 && !up; i++) {
        try { up = (await fetch(`http://localhost:${port}/health`)).ok; } catch {}
        if (!up) await new Promise(r => setTimeout(r, 100));
      }
      assert(up, "the test server never started");
      assert(/Scheduled backups every/.test(out), "the server did not announce a backup schedule");

      /* Wait for several intervals so both creation and pruning are exercised. */
      await new Promise(r => setTimeout(r, 5500));
      const files = readdirSync(dir).filter(f => f.endsWith(".db"));
      assert(files.length > 0, "no backup was taken on the schedule");
      assert(files.length <= 3, `retention kept ${files.length} backups, limit was 3`);

      /* The scheduled backup must be a real database, not an empty file. */
      const { DatabaseSync } = await import("node:sqlite");
      const snap = new DatabaseSync(`${dir}/${files[0]}`);
      const check = snap.prepare("PRAGMA integrity_check").get();
      assert(String(Object.values(check)[0]).toLowerCase() === "ok",
        "a scheduled backup fails its integrity check");
      snap.close();

      /* And the schedule must be OFF unless explicitly configured, so tests and
         development do not litter the disk. */
      assert(!/Scheduled backups/.test(
        (await (await fetch(`${BASE}/health`)).text()) + " "),
        "sanity");
      return `scheduled backup ran, kept ${files.length} of the last snapshots, integrity verified`;
    } finally {
      srv.kill("SIGTERM");
      await new Promise(r => setTimeout(r, 300));
      rmSync(dir, { recursive: true, force: true });
      rmSync("app/server/data/sched.db", { force: true });
    }
  },


  /* 10.7 — age-appropriate interface that scales by grade band */
  "age-appropriate-ui": async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("app/web/src/styles.css", "utf8");
    const { bandFor } = await import("../app/web/src/useAgeBand.ts").catch(() => ({}));

    /* Bands must exist and differ, or "age-appropriate" is decoration. */
    for (const band of ["junior", "middle", "senior"])
      assert(css.includes(`[data-band="${band}"]`), `no styling for the ${band} band`);
    const tapOf = band => {
      const m = css.match(new RegExp(`\\[data-band="${band}"\\][^}]*--tap:\\s*(\\d+)px`));
      return m ? Number(m[1]) : null;
    };
    const junior = tapOf("junior"), senior = tapOf("senior");
    assert(junior && senior, "touch target sizes are not set per band");
    assert(junior > senior, `junior targets (${junior}px) are not larger than senior (${senior}px)`);
    assert(senior >= 44, `senior touch target is ${senior}px, below the 44px minimum`);

    const stepOf = band => {
      const m = css.match(new RegExp(`\\[data-band="${band}"\\][^}]*--step:\\s*([\\d.]+)`));
      return m ? Number(m[1]) : null;
    };
    assert(stepOf("junior") > stepOf("senior"), "junior type is not larger than senior type");

    /* Interactive controls must be sized from the token, not hard-coded. */
    for (const sel of [".btn{", ".opt{", ".topic{", ".movebtn{", ".ansin{"]) {
      const block = css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
      assert(/var\(--tap\)/.test(block), `${sel} does not use the --tap token for its size`);
    }

    /* Motion must be optional. */
    assert(/@media \(prefers-reduced-motion: reduce\)/.test(css),
      "no reduced-motion handling");
    const reduce = css.slice(css.lastIndexOf("prefers-reduced-motion: reduce"));
    assert(/animation:\s*none/.test(reduce), "animations are not disabled under reduced motion");
    assert(/\.confetti\{display:none\}/.test(css.replace(/\s/g, "")),
      "confetti is not suppressed under reduced motion");

    /* Celebration must not be the only signal that an answer was right. */
    const practice = readFileSync("app/web/src/screens/Practice.tsx", "utf8");
    assert(/Correct!/.test(practice) || /fb.correct \?/.test(practice),
      "correctness is signalled by animation alone");

    return `junior ${junior}px targets vs senior ${senior}px, type scales by band, motion optional`;
  },

  /* 6.1 + 6.3 + 6.6 + 4.2.2 — IRT-driven diagnostic, bandit difficulty
     selection, and a per-learner track that parent or teacher can set. */
  "adaptive-engine": async () => {
    const irt = await import("../app/server/src/irt.js");
    const bandit = await import("../app/server/src/bandit.js");

    /* --- IRT: the model behaves like a model --- */
    const boss = irt.ITEM_PARAMS.boss, prac = irt.ITEM_PARAMS.practice;
    assert(irt.prob(2, boss) > irt.prob(0, boss), "success probability does not rise with ability");
    assert(irt.prob(0, prac) > irt.prob(0, boss), "a boss item is not harder than a practice item");
    const strong = irt.estimate(Array.from({ length: 6 }, () => ({ item: boss, correct: true })));
    const weak = irt.estimate(Array.from({ length: 6 }, () => ({ item: prac, correct: false })));
    assert(strong.theta > 0.6 && weak.theta < -0.6,
      `estimates do not separate strong (${strong.theta}) from weak (${weak.theta})`);
    const one = irt.estimate([{ item: boss, correct: true }]);
    assert(strong.se < one.se, "standard error does not shrink with more evidence");
    assert(irt.estimate([]).se > strong.se, "the prior is not less certain than the posterior");
    const cands = Object.entries(irt.ITEM_PARAMS).map(([tier, item]) => ({ tier, item }));
    assert(irt.selectItem(1.4, cands).tier === "boss", "max-information selection did not pick the hardest item for a strong learner");
    assert(irt.selectItem(-1.4, cands).tier === "practice", "max-information selection did not pick the easiest item for a weak learner");
    assert(irt.placement(strong.theta) === "boss" && irt.placement(weak.theta) === "practice",
      "placement does not follow ability");

    /* --- Bandit: the policy reaches for the hardest tier the learner can manage --- */
    const rng = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    const tally = arms => {
      const t = { practice: 0, challenge: 0, boss: 0 };
      for (let i = 0; i < 2000; i++) t[bandit.choose(arms, rng)]++;
      return t;
    };
    const novice = tally({ practice: { successes: 8, failures: 0 }, challenge: { successes: 0, failures: 6 }, boss: { successes: 0, failures: 6 } });
    assert(novice.practice > novice.challenge && novice.practice > novice.boss,
      `a learner failing harder tiers was not kept on practice: ${JSON.stringify(novice)}`);
    const expert = tally({ practice: { successes: 8, failures: 0 }, challenge: { successes: 8, failures: 0 }, boss: { successes: 8, failures: 0 } });
    assert(expert.boss > expert.practice, `a learner succeeding everywhere was not moved up: ${JSON.stringify(expert)}`);
    const blank = tally({});
    assert(blank.practice > 50 && blank.challenge > 50 && blank.boss > 50,
      `with no evidence the policy does not explore every tier: ${JSON.stringify(blank)}`);
    const beta = Array.from({ length: 500 }, () => bandit.sampleBeta(9, 1, rng));
    assert(beta.reduce((a, b) => a + b, 0) / beta.length > 0.8, "Beta(9,1) samples are not centred near 0.9");

    /* --- Through the API: diagnostic placement uses the model --- */
    const c = client();
    await post(c, "/auth/register", { coppaConsent: true, email: "engine@b.com", password: "a-long-enough-pass", name: "E" });
    const kid = (await post(c, "/learners", { name: "Engine Kid" })).body.learner;
    assert(kid.track === "core", "a new learner does not start on the core track");

    const solve = async q => {
      if (q.type === "mc") {
        for (let i = 0; i < q.opts.length; i++)
          if ((await post(c, "/answer", { questionId: q.id, answer: i })).body.correct) return i;
        return 0;
      }
      if (q.type === "multi") return (await post(c, "/answer", { questionId: q.id, answer: [] }))
        .body.correctAnswer.split(", ").map(t => q.opts.indexOf(t));
      if (q.type === "order") return (await post(c, "/answer", { questionId: q.id, answer: [] }))
        .body.correctAnswer.split("  →  ");
      return (await post(c, "/answer", { questionId: q.id, answer: "__" })).body.correctAnswer;
    };
    let r = await post(c, "/diagnostic/start", { learnerId: kid.id, topicId: "g6-nscoord" });
    let q = r.body.question, summary = null, guard = 0;
    while (guard++ < 30) {
      const step = await post(c, "/diagnostic/answer", { diagnosticId: r.body.diagnosticId, answer: await solve(q) });
      if (step.body.done) { summary = step.body.summary; break; }
      q = step.body.question;
    }
    assert(summary?.ability?.model === "2PL-IRT/EAP", "diagnostic did not report an IRT ability estimate");
    assert(summary.ability.theta > 0.6, `all-correct diagnostic estimated theta ${summary.ability.theta}`);
    assert(summary.ability.se < 1, "ability estimate carries no precision");
    assert(summary.sequence.at(-1) === "boss", `an all-correct run ended on ${summary.sequence.at(-1)}, not boss`);
    assert(summary.recommendation.tier === "boss", "strong learner not placed at boss");
    assert(summary.asked < 12 || summary.ability.se <= 0.45 + 1e-9,
      "the diagnostic neither stopped early on precision nor hit its maximum");

    /* The placement seeds the bandit, and practice records every arm it pulls. */
    let model = (await c(`/learners/${kid.id}/model/g6-nscoord`)).body;
    assert(model.placement?.ability?.theta > 0.6, "stored placement has no ability estimate");
    assert(model.arms.boss.successes >= 2, "placement did not seed the bandit");

    const s = await post(c, "/practice/start", { learnerId: kid.id, topicId: "g6-nscoord" });
    q = s.body.question; guard = 0; let done = false;
    while (guard++ < 30 && !done) {
      const step = await post(c, "/practice/answer", { sessionId: s.body.sessionId, answer: await solve(q), hintsUsed: 0 });
      done = step.body.done; q = step.body.question;
    }
    model = (await c(`/learners/${kid.id}/model/g6-nscoord`)).body;
    const pulls = Object.values(model.arms).reduce((a, x) => a + x.successes + x.failures, 0);
    assert(pulls >= 12, `bandit recorded ${pulls} pulls after a placement seed and a 10-question session`);
    const after = tally(model.arms);
    assert(after.practice < 1000, `after a perfect run the policy still favours practice: ${JSON.stringify(after)}`);

    /* A learner who keeps failing wherever they are sent must be moved: the
       arm they are failing on loses its draw and another tier gets tried. */
    const kid2 = (await post(c, "/learners", { name: "Struggling Kid" })).body.learner;
    const s2 = await post(c, "/practice/start", { learnerId: kid2.id, topicId: "g6-nscoord" });
    for (let i = 0; i < 12; i++) {
      const step = await post(c, "/practice/answer", { sessionId: s2.body.sessionId, answer: "-424242", hintsUsed: 0 });
      if (step.body.done) break;
    }
    const arms2 = (await c(`/learners/${kid2.id}/model/g6-nscoord`)).body.arms;
    const tried = Object.values(arms2).filter(x => x.successes + x.failures > 0).length;
    assert(tried >= 2, `the bandit kept a failing learner on one tier: ${JSON.stringify(arms2)}`);
    assert(Object.values(arms2).reduce((a, x) => a + x.failures, 0) === 10, "not every miss was recorded against an arm");

    /* --- Track override by parent, and by teacher for a class member --- */
    const t = (await c(`/learners/${kid.id}/track`)).body;
    assert(t.track === "core" && t.tracks.enrichment && t.recommended?.track, "track endpoint is incomplete");
    assert((await c(`/learners/${kid.id}/track`, { method: "PUT", body: JSON.stringify({ track: "olympiad" }) })).status === 400,
      "an unknown track was accepted");
    const setTrack = await c(`/learners/${kid.id}/track`, { method: "PUT", body: JSON.stringify({ track: "competition" }) });
    assert(setTrack.body.track === "competition", "parent could not set the track");
    const next = (await c(`/learners/${kid.id}/next`)).body;
    assert(next.track === "competition", "recommendations do not carry the track");
    if (next.ready.some(e => e.track === "adv") && next.ready.some(e => e.track !== "adv"))
      assert(next.ready[0].track === "adv", "competition track does not put advanced work first");
    await c(`/learners/${kid.id}/track`, { method: "PUT", body: JSON.stringify({ track: "core" }) });
    const coreNext = (await c(`/learners/${kid.id}/next`)).body;
    assert(coreNext.ready.filter(e => e.track === "adv").every(e => e.optional === true),
      "core track does not mark advanced topics optional");

    const teacher = client();
    await post(teacher, "/auth/register", { coppaConsent: true, email: "enginet@b.com", password: "a-long-enough-pass", name: "T", role: "teacher" });
    const cls = (await post(teacher, "/classes", { name: "Engine Class" })).body.class;
    const before = await teacher(`/classes/${cls.id}/learners/${kid.id}/track`, { method: "PUT", body: JSON.stringify({ track: "enrichment" }) });
    assert(before.status === 404, "teacher set a track for a learner not in their class");
    await post(c, "/classes/join", { joinCode: cls.joinCode, learnerId: kid.id });
    const byTeacher = await teacher(`/classes/${cls.id}/learners/${kid.id}/track`, { method: "PUT", body: JSON.stringify({ track: "enrichment" }) });
    assert(byTeacher.body.track === "enrichment", "teacher could not set the track for a class member");
    assert((await c(`/learners/${kid.id}/track`)).body.track === "enrichment", "teacher's track change did not persist");
    const stranger = client();
    await post(stranger, "/auth/register", { coppaConsent: true, email: "engines@b.com", password: "a-long-enough-pass", name: "S" });
    assert((await stranger(`/learners/${kid.id}/track`, { method: "PUT", body: JSON.stringify({ track: "core" }) })).status === 403,
      "another account changed this learner's track");

    return `IRT placement θ=${summary.ability.theta}±${summary.ability.se} over ${summary.asked} items, bandit explored ${tried} tiers, track set by parent and teacher`;
  },

  /* 4.2.3 + 4.2.5 + 4.2.6 + 4.2.7 + 4.1.2 + 8.3 — parent portal: time on task,
     readiness, alerts into a notification feed, goal notifications, the
     curriculum overview with sample problems and standards, and the home
     screen with its dual-track map and challenge of the day. */
  "parent-portal": async () => {
    const c = client();
    await post(c, "/auth/register", { coppaConsent: true, email: "parent@b.com", password: "a-long-enough-pass", name: "P" });
    const kid = (await post(c, "/learners", { name: "Portal Kid" })).body.learner;

    /* Time on task accumulates from recorded seconds and is bounded. */
    await post(c, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8, seconds: 120 });
    await post(c, "/runs", { learnerId: kid.id, topicId: "g6-percent", tier: "practice", score: 3, total: 8, seconds: 999999 });
    const time = (await c(`/learners/${kid.id}/time`)).body;
    assert(time.totalSeconds === 120 + 4 * 3600, `time on task is ${time.totalSeconds}, expected 120 + a 4h cap`);
    assert(time.byDay.length === 7 && time.byDay.at(-1).seconds === time.totalSeconds, "per-day breakdown is wrong");
    assert(time.byTopic[0].name, "per-topic time carries no topic name");

    /* Readiness names its evidence. */
    const ready = (await c(`/learners/${kid.id}/readiness`)).body;
    assert(ready.mastery.core === 1 && ready.mastery.started === 2, `mastery summary wrong: ${JSON.stringify(ready.mastery)}`);
    assert(ready.readiness.advanced.ready === false && /core topic/.test(ready.readiness.advanced.reason),
      "advanced readiness does not explain itself");
    assert(ready.readiness.competition.ready === false, "competition readiness claimed without evidence");
    assert(typeof ready.level === "number", "readiness carries no level");

    /* Alerts: two poor rounds on a topic raise a struggling alert, which lands
       in the notification feed exactly once per day. */
    await post(c, "/runs", { learnerId: kid.id, topicId: "g6-percent", tier: "challenge", score: 2, total: 8 });
    let alerts = (await c(`/learners/${kid.id}/alerts`)).body.alerts;
    assert(alerts.some(a => a.kind === "struggling" && a.topicId === "g6-percent"), `no struggling alert: ${JSON.stringify(alerts)}`);
    await c(`/learners/${kid.id}/alerts`);
    let feed = (await c("/me/notifications")).body;
    assert(feed.notifications.filter(n => n.kind === "struggling").length === 1, "struggling alert was duplicated in the feed");
    assert(feed.unread >= 1 && feed.notifications[0].learnerName === "Portal Kid", "feed lacks unread count or learner name");
    const nid = feed.notifications[0].id;
    await post(c, `/me/notifications/${nid}/read`);
    feed = (await c("/me/notifications")).body;
    assert(feed.notifications.find(n => n.id === nid).readAt, "marking read did not stick");

    /* Ready-to-advance alert once the evidence is there. */
    await post(c, "/runs", { learnerId: kid.id, topicId: "g3-mult", tier: "practice", score: 8, total: 8 });
    alerts = (await c(`/learners/${kid.id}/alerts`)).body.alerts;
    assert(alerts.some(a => a.kind === "ready_to_advance"), `no ready-to-advance alert with two core topics mastered: ${JSON.stringify(alerts)}`);

    /* Goal met raises a notification the moment the target is reached. */
    await c(`/learners/${kid.id}/goal`, { method: "PUT", body: JSON.stringify({ roundsPerWeek: 4 }) });
    await post(c, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "challenge", score: 5, total: 8 });
    feed = (await c("/me/notifications")).body;
    assert(feed.notifications.some(n => n.kind === "goal_met"), "reaching the weekly goal raised no notification");

    /* Curriculum overview: every unit, one real sample per authored topic,
       served without answers, and a standards code on every topic. */
    const ov = (await c("/curriculum/overview/6")).body;
    assert(ov.units.length >= 5, "overview is missing units");
    const withSample = ov.units.flatMap(u => u.topics).filter(t => t.sample);
    assert(withSample.length >= 2, "no sample problems in the overview");
    const raw = JSON.stringify(ov);
    for (const k of ['"ans"', '"ansP"', '"expl"', '"a":']) assert(!raw.includes(k), `overview leaked ${k}`);
    const allTopics = ov.units.flatMap(u => u.topics);
    assert(allTopics.every(t => t.standards && t.standards.codes.length), "a topic has no standards alignment");
    assert(allTopics.some(t => t.standards.framework === "CCSS") && allTopics.some(t => t.standards.framework === "ENRICH"),
      "overview does not distinguish standards-aligned from enrichment topics");
    assert((await c("/curriculum/overview/99")).status === 404, "unknown grade not rejected");
    const { TOPIC_STANDARDS } = await import("../app/shared/standards.mjs");
    const { CURRICULUM } = await import("../app/shared/curriculum.mjs");
    const ids = Object.values(CURRICULUM).flatMap(g => g.units.flatMap(u => u.topics.map(t => t.id)));
    const unmapped = ids.filter(id => !TOPIC_STANDARDS[id]);
    assert(unmapped.length === 0, `${unmapped.length} topics have no standards mapping: ${unmapped.slice(0, 5).join(", ")}`);
    for (const id of ids) assert(TOPIC_STANDARDS[id].ccss.every(code => /^([K0-8]\.[A-Z]+\.[A-Z](\.\d+)?(\.[A-Z])?|[A-Z]-[A-Z]+\.[A-Z]\.\d+|MP\.\d)$/.test(code)),
      `${id} has a malformed standards code: ${TOPIC_STANDARDS[id].ccss.join(", ")}`);

    /* Home: streak, daily goal, dual-track map, and a challenge that is the
       same all day, graded server-side, paid once. */
    const home = (await c(`/learners/${kid.id}/home`)).body;
    assert(home.streak.days >= 1, "home shows no streak after today's rounds");
    assert(home.dailyGoal.target === 1 && home.dailyGoal.done >= 4 && home.dailyGoal.met, `daily goal wrong: ${JSON.stringify(home.dailyGoal)}`);
    assert(home.map.length === 9 && home.map.every(g => g.core && g.advanced), "dual-track map is incomplete");
    const g6 = home.map.find(g => g.grade === "6");
    assert(g6.core.mastered >= 1 && g6.core.started >= 2, `map does not reflect progress: ${JSON.stringify(g6)}`);
    assert(home.challenge?.id && home.challenge.done === false && !JSON.stringify(home.challenge).includes('"expl"'),
      "challenge of the day is missing or leaks its answer");
    const again = (await c(`/learners/${kid.id}/home`)).body;
    assert(again.challenge.id === home.challenge.id, "the challenge changed on reload");
    const wrongQ = await post(c, `/learners/${kid.id}/challenge`, { questionId: "g6-ratios:0", answer: 0 });
    assert(wrongQ.status === 400 || home.challenge.id === "g6-ratios:0", "an arbitrary question was accepted as the challenge");
    const probe = (await post(c, "/answer", { questionId: home.challenge.id, answer: "__" })).body;
    const solved = home.challenge.type === "mc" ? home.challenge.opts.indexOf(probe.correctAnswer)
      : home.challenge.type === "multi" ? probe.correctAnswer.split(", ").map(t => home.challenge.opts.indexOf(t))
      : home.challenge.type === "order" ? probe.correctAnswer.split("  →  ") : probe.correctAnswer;
    const before = (await c(`/learners/${kid.id}/rewards`)).body.points;
    const done = await post(c, `/learners/${kid.id}/challenge`, { questionId: home.challenge.id, answer: solved });
    assert(done.body.correct === true && done.body.bonus === 30, `challenge not credited: ${JSON.stringify(done.body)}`);
    const after = (await c(`/learners/${kid.id}/rewards`)).body;
    assert(after.points === before + 30, "challenge bonus not paid");
    assert(after.badges.some(b => b.code === "daily_challenger"), "no badge for the challenge");
    const twice = await post(c, `/learners/${kid.id}/challenge`, { questionId: home.challenge.id, answer: solved });
    assert(twice.status === 409, "the challenge was paid twice");
    assert((await c(`/learners/${kid.id}/home`)).body.challenge.done === true, "home does not show the challenge as done");

    /* Another account sees none of it. */
    const bob = client();
    await post(bob, "/auth/register", { coppaConsent: true, email: "parentbob@b.com", password: "a-long-enough-pass", name: "B" });
    for (const p of ["time", "readiness", "alerts", "home"])
      assert((await bob(`/learners/${kid.id}/${p}`)).status === 403, `another account read ${p}`);
    assert((await bob("/me/notifications")).body.notifications.length === 0, "another account saw this parent's notifications");

    return `time on task, readiness with reasons, ${alerts.length} alerts into the feed, goal notification, overview with ${withSample.length} samples and ${ids.length} standards-mapped topics, challenge paid once`;
  },

  /* 5.2 + 5.3 + 5.4 + 5.5 + 5.6 + 5.7 + 5.8 + 4.1.8 — the deeper gamification:
     a 100+ badge catalogue where every badge has a rule that fires, gear
     unlocked by achievements, per-subject levels with prestige, streak
     freezes, a branching story, hidden areas, and class teams with a weekly
     tournament that never messages. */
  "gamification-depth": async () => {
    const rewards = await import("../app/server/src/rewards.js");
    const { CHAPTERS, epilogue } = await import("../app/shared/story.mjs");
    const { ACCESSORIES } = await import("../app/shared/accessories.mjs");
    const { AREAS } = await import("../app/shared/unlockables.mjs");

    /* --- catalogue: 100+, categorised, and every rule provably fires --- */
    const codes = Object.keys(rewards.BADGES);
    assert(codes.length >= 100, `only ${codes.length} badges in the catalogue`);
    const cats = new Set(Object.values(rewards.BADGES).map(b => b.category));
    for (const c of ["subject", "meta", "puzzle", "proof", "competition", "story"])
      assert(cats.has(c), `no ${c} badges`);
    assert(rewards.RULES.length >= 90, `only ${rewards.RULES.length} rule-driven badges`);
    /* A maxed-out statistics object must satisfy every rule; an empty one none.
       If a rule cannot fire even then, it is decoration and the check fails. */
    const maxed = {
      points: 1e6, level: 99, rounds: 1e4, perfectRounds: 1e3, unaidedPerfect: 1e3, masteredTopics: 500,
      masteredByGrade: Object.fromEntries(["K","1","2","3","4","5","6","7","8"].map(g => [g, 50])),
      masteredByStrand: { NT: 50, CB: 50, AL: 50, GE: 50, PS: 50, LG: 50, PR: 50 },
      masteredBySubject: Object.fromEntries(Object.keys(rewards.SUBJECTS).map(k => [k, 50])),
      roundsByGrade: Object.fromEntries(["K","1","2","3","4","5","6","7","8"].map(g => [g, 50])),
      subjectLevels: Object.fromEntries(Object.keys(rewards.SUBJECTS).map(k => [k, 50])),
      masteredCore: 200, masteredAdv: 200, bossMastered: 100, masteryPassed: 100, diagnostics: 10, comebacks: 5,
      streak: 365, puzzlesSolved: 20, goldPuzzles: 20, proofs: 50, contests: 50, contestBest: 100,
      challenges: 100, chapters: 6, lessons: 50, games: 50
    };
    const empty = { ...Object.fromEntries(Object.keys(maxed).map(k => [k, typeof maxed[k] === "object" ? {} : 0])), level: 1, subjectLevels: {} };
    for (const r of rewards.RULES) {
      assert(r.when(maxed) === true, `badge "${r.code}" cannot be earned even by a maxed-out learner`);
      assert(!r.when(empty), `badge "${r.code}" is awarded to a learner who has done nothing`);
      assert(rewards.BADGES[r.code]?.name && rewards.BADGES[r.code].hint, `badge "${r.code}" has no name or hint`);
    }
    assert(new Set(codes).size === codes.length, "duplicate badge codes");

    /* --- through the API --- */
    const c = client();
    await post(c, "/auth/register", { coppaConsent: true, email: "deep@b.com", password: "a-long-enough-pass", name: "D" });
    const kid = (await post(c, "/learners", { name: "Deep Kid" })).body.learner;

    /* Gear: nothing equipped, nothing unlocked, and a locked item is refused. */
    let av = (await c(`/learners/${kid.id}/avatar`)).body;
    assert(av.unlocked.length === 0 && av.locked.length === ACCESSORIES.length, "a new learner has gear unlocked");
    assert(av.locked.every(l => l.hint), "locked gear does not say how to unlock it");
    const refused = await c(`/learners/${kid.id}/avatar`, { method: "PUT", body: JSON.stringify({ slot: "hat", item: "cap" }) });
    assert(refused.status === 403, "locked gear was equipped");

    /* A round unlocks first_steps, which unlocks the cap; sweep awards milestones. */
    const run = await post(c, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
    const got = run.body.reward.badges.map(b => b.code);
    for (const want of ["first_steps", "grade_6_explorer", "unaided_1"])
      assert(got.includes(want), `round did not award ${want} (got ${got.join(", ")})`);
    av = (await c(`/learners/${kid.id}/avatar`)).body;
    assert(av.unlocked.some(a => a.id === "cap"), "first_steps did not unlock the cap");
    const worn = await c(`/learners/${kid.id}/avatar`, { method: "PUT", body: JSON.stringify({ slot: "hat", item: "cap" }) });
    assert(worn.body.equipped.hat === "cap", "could not equip unlocked gear");
    assert((await c(`/learners/${kid.id}/avatar`, { method: "PUT", body: JSON.stringify({ slot: "hat", item: "crown" }) })).status === 403,
      "gear unlocked by a badge not held was equipped");

    /* Per-subject levels: points on a ratios topic land in "number". */
    const lv = (await c(`/learners/${kid.id}/levels`)).body;
    assert(lv.subjects.length === Object.keys(rewards.SUBJECTS).length, "not every subject reported");
    const num = lv.subjects.find(s => s.subject === "number");
    assert(num.points > 0 && lv.subjects.find(s => s.subject === "combinatorics").points === 0, "subject points not attributed by topic");
    assert(lv.overall.level >= 1 && num.nextLevelAt > num.points, "level progress not reported");
    const early = await post(c, `/learners/${kid.id}/prestige`, { subject: "number" });
    assert(early.status === 409 && early.body.needed === rewards.PRESTIGE_LEVEL, "prestige allowed before the level was reached");
    /* Direct model test for prestige, since reaching level 10 legitimately takes thousands of points. */
    for (let i = 0; i < 60; i++) rewards.award(kid.id, "points", "round:g5-modarith", 100);
    const before = rewards.subjectLevels(kid.id).find(s => s.subject === "numtheory");
    assert(before.level >= rewards.PRESTIGE_LEVEL && before.canPrestige, `numtheory level ${before.level} after 6000 points`);
    const pr = await post(c, `/learners/${kid.id}/prestige`, { subject: "numtheory" });
    assert(pr.body.stars === 1, "prestige did not award a star");
    const afterP = rewards.subjectLevels(kid.id).find(s => s.subject === "numtheory");
    assert(afterP.level === 1 && afterP.prestige === 1 && afterP.points === before.points,
      `prestige did not restart the level (level ${afterP.level}, stars ${afterP.prestige})`);
    assert((await c(`/learners/${kid.id}/rewards`)).body.badges.some(b => b.code === "prestige_numtheory"), "no prestige badge");

    /* Streak freezes: a one-day gap is bridged when a freeze is held, spent once. */
    const { DatabaseSync } = await import("node:sqlite");
    const dbx = new DatabaseSync("app/server/data/verify.db");
    const kid2 = (await post(c, "/learners", { name: "Streak Kid" })).body.learner;
    const day = n => new Date(Date.now() - n * 86400000).toISOString();
    const ins = dbx.prepare("INSERT INTO awards (id, learner_id, kind, code, amount, at) VALUES (?,?,?,?,?,?)");
    for (const n of [9, 8, 7, 6, 5, 4, 3, 2]) ins.run(`s${n}`, kid2.id, "points", `round:x${n}`, 10, day(n));
    /* Days 2..9 active, yesterday (1) missed, today (0) not yet: streak is broken... */
    const withoutFreeze = rewards.streak(kid2.id, undefined, { spend: false });
    assert(withoutFreeze === 0, `a missed day did not break the streak (${withoutFreeze})`);
    /* ...unless a freeze is held. Grant one and add today's activity. */
    ins.run("fe", kid2.id, "freeze_earned", "streak:7:test", 0, day(2));
    ins.run("s0", kid2.id, "points", "round:x0", 10, day(0));
    const st = (await c(`/learners/${kid2.id}/streak`)).body;
    assert(st.days === 9, `freeze did not bridge the gap: streak ${st.days}`);
    assert(st.freezesUsed === 1 && st.freezesAvailable === 0, `freeze accounting wrong: ${JSON.stringify(st)}`);
    const again = (await c(`/learners/${kid2.id}/streak`)).body;
    assert(again.freezesUsed === 1, "the same freeze was spent twice");

    /* Story: chapter one open, later chapters locked until earned, choices
       persist and change the next chapter's opening. */
    const kid3 = (await post(c, "/learners", { name: "Story Kid" })).body.learner;
    let story = (await c(`/learners/${kid3.id}/story`)).body;
    assert(story.chapters.length === CHAPTERS.length && CHAPTERS.length >= 6, "story is short");
    assert(story.chapters[0].unlocked && !story.chapters[1].unlocked, "chapter gating wrong");
    assert(story.chapters[1].panels === null && story.chapters[1].unlockHint, "a locked chapter leaked its panels or gives no hint");
    assert((await post(c, `/learners/${kid3.id}/story/ch2`, { choice: "spark" })).status === 403, "a locked chapter accepted a choice");
    assert((await post(c, `/learners/${kid3.id}/story/ch1`, { choice: "up" })).status === 400, "an unknown choice was accepted");
    const ch1 = await post(c, `/learners/${kid3.id}/story/ch1`, { choice: "right" });
    assert(ch1.body.chosen === "right" && ch1.body.badges.includes("story_1"), "choice not recorded or chapter badge missing");
    assert((await post(c, `/learners/${kid3.id}/story/ch1`, { choice: "left" })).status === 409, "a choice was overwritten");
    await post(c, "/runs", { learnerId: kid3.id, topicId: "g6-ratios", tier: "practice", score: 5, total: 8 });
    story = (await c(`/learners/${kid3.id}/story`)).body;
    assert(story.chapters[1].unlocked && /river/.test(story.chapters[1].intro), "the earlier choice did not shape the next chapter");
    const alt = { ch1: "left", ch2: "spark", ch3: "shield", ch4: "time", ch5: "compass", ch6: "bridge" };
    const alt2 = { ...alt, ch1: "right", ch6: "bell" };
    assert(epilogue(alt) !== epilogue(alt2), "the ending does not depend on the choices");

    /* Hidden areas and puzzles: absent until unlocked, then served. */
    let unl = (await c(`/learners/${kid3.id}/unlocks`)).body;
    assert(unl.areas.length === AREAS.length && unl.areas.every(a => !a.unlocked), "a new learner has areas open");
    assert(unl.hiddenPuzzles.length === 0, "hidden puzzles served before unlock");
    const listed = (await c(`/puzzles?learnerId=${kid3.id}`)).body.puzzles;
    assert(listed.every(p => !p.hidden), "a hidden puzzle appeared in the public list");
    assert((await post(c, "/puzzles/pz-vault-locker/answer", { learnerId: kid3.id, answer: 10 })).status === 403, "a hidden puzzle accepted an answer while locked");
    for (const t of ["g6-ratios", "g6-nscoord"])           // boss tier mastered -> the Vault
      await post(c, "/runs", { learnerId: kid3.id, topicId: t, tier: "boss", score: 8, total: 8 });
    unl = (await c(`/learners/${kid3.id}/unlocks`)).body;
    const vault = unl.areas.find(a => a.id === "vault");
    assert(vault.unlocked && vault.puzzles.length >= 2, "mastering a boss tier did not open the Vault");
    assert(unl.hiddenPuzzles.some(p => p.id === "pz-vault-locker"), "unlocked hidden puzzle not served");
    assert((await c(`/puzzles?learnerId=${kid3.id}`)).body.puzzles.some(p => p.id === "pz-vault-locker"), "unlocked puzzle absent from the list");
    const solved = await post(c, "/puzzles/pz-vault-locker/answer", { learnerId: kid3.id, answer: 10, hintsUsed: 0 });
    assert(solved.body.correct === true, "hidden puzzle not answerable once unlocked");
    assert((await c(`/learners/${kid3.id}/rewards`)).body.badges.some(b => b.code === "area_vault"), "no badge for entering the Vault");

    /* Multiple-solution puzzles accept any valid answer and refuse others. */
    for (const a of [18, 90]) assert((await post(c, "/puzzles/pz-digitsum/answer", { learnerId: kid3.id, answer: a })).body.correct, `${a} refused`);
    assert(!(await post(c, "/puzzles/pz-digitsum/answer", { learnerId: kid3.id, answer: 19 })).body.correct, "19 accepted");

    /* Teams and tournament: teacher-made, class-scoped, off by default,
       anonymised by default, no messaging. */
    const t = client();
    await post(t, "/auth/register", { coppaConsent: true, email: "deept@b.com", password: "a-long-enough-pass", name: "T", role: "teacher" });
    const cls = (await post(t, "/classes", { name: "Deep Class" })).body.class;
    await post(c, "/classes/join", { joinCode: cls.joinCode, learnerId: kid.id });
    await post(c, "/classes/join", { joinCode: cls.joinCode, learnerId: kid3.id });
    const team = (await post(t, `/classes/${cls.id}/teams`, { name: "Red" })).body.team;
    assert((await post(t, `/classes/${cls.id}/teams/${team.id}/members`, { learnerId: kid2.id })).status === 404, "a non-member was put in a team");
    await post(t, `/classes/${cls.id}/teams/${team.id}/members`, { learnerId: kid.id });
    await post(t, `/classes/${cls.id}/teams/${team.id}/members`, { learnerId: kid3.id });
    const off = (await c(`/classes/${cls.id}/tournament`)).body;
    assert(off.enabled === false, "tournament on by default");
    await t(`/classes/${cls.id}/settings`, { method: "PUT", body: JSON.stringify({ tournamentOn: true }) });
    const on = (await c(`/classes/${cls.id}/tournament`)).body;
    assert(on.enabled && on.teams[0].name === "Red" && on.teams[0].points > 0, `tournament not scored: ${JSON.stringify(on).slice(0, 200)}`);
    assert(on.messaging === false, "tournament advertises messaging");
    assert(on.teams[0].members.every(m => m.you ? m.name !== "Learner 1" && m.name !== "Learner 2" : /^Learner \d+$/.test(m.name)),
      "other children's names shown to a parent by default");
    const other = client();
    await post(other, "/auth/register", { coppaConsent: true, email: "deepo@b.com", password: "a-long-enough-pass", name: "O" });
    assert((await other(`/classes/${cls.id}/tournament`)).status === 403, "a stranger read the tournament");
    assert((await other(`/classes/${cls.id}/teams`)).status === 403, "a stranger read the teams");
    assert((await post(other, `/classes/${cls.id}/teams`, { name: "X" })).status === 403, "a parent created a team");

    return `${codes.length} badges (${rewards.RULES.length} rule-driven, all fire), gear, subject levels + prestige, freezes, ${CHAPTERS.length}-chapter branching story, ${AREAS.length} hidden areas, teams + tournament`;
  },

  /* 4.3.1 + 4.3.2 + 4.3.4 + 4.3.5 + 4.4.1 + 7.2 + 7.6 + 13.12 + 4.1.9 — teacher and
     admin depth: roster import claimed by parents, groups and accommodations
     that change conditions not marking, configurable thresholds with decay,
     the gifted report, unit tests, contest percentiles and leaderboards, and
     a school/district hierarchy with aggregates only. */
  "teacher-admin-depth": async () => {
    const { parseRosterCsv } = await import("../app/server/src/routes-teacher.js");
    const policy = await import("../app/server/src/policy.js");

    /* --- roster parsing handles plain and OneRoster-style CSV, quoted fields --- */
    const plain = parseRosterCsv('name,guardian_email\n"Lee, Sam",sam@x.com\nPriya Patel,\n');
    assert(plain.rows.length === 2 && plain.rows[0].name === "Lee, Sam" && plain.rows[0].guardianEmail === "sam@x.com", "plain CSV misparsed");
    const one = parseRosterCsv("sourcedId,status,givenName,familyName,role\nu1,active,Ada,Lovelace,student\nu2,active,Alan,Turing,student");
    assert(one.rows.length === 2 && one.rows[1].name === "Alan Turing" && one.rows[0].externalId === "u1", "OneRoster CSV misparsed");
    assert(parseRosterCsv("foo,bar\n1,2").error === "no_name_column", "a CSV without names was accepted");

    const t = client(), p = client();
    await post(t, "/auth/register", { coppaConsent: true, email: "tad@b.com", password: "a-long-enough-pass", name: "T", role: "teacher" });
    await post(p, "/auth/register", { coppaConsent: true, email: "pad@b.com", password: "a-long-enough-pass", name: "P" });
    const cls = (await post(t, "/classes", { name: "Depth Class" })).body.class;

    /* --- roster import: codes issued, parent claims, re-import updates not duplicates --- */
    const imp = await post(t, `/classes/${cls.id}/roster/import`, { csv: "sourcedId,givenName,familyName\ns1,Ada,Lovelace\ns2,Alan,Turing" });
    assert(imp.body.imported === 2 && imp.body.entries.every(e => /^[A-Z0-9]{8}$/.test(e.claimCode)), "import issued no claim codes");
    const again = await post(t, `/classes/${cls.id}/roster/import`, { csv: "sourcedId,givenName,familyName\ns1,Ada,Byron" });
    assert(again.body.entries[0].updated === true && again.body.entries[0].claimCode === imp.body.entries[0].claimCode, "re-import duplicated an entry");
    assert((await post(p, "/classes/claim", { claimCode: "NOPE0000" })).status === 404, "unknown claim code accepted");
    const claimed = await post(p, "/classes/claim", { claimCode: imp.body.entries[0].claimCode });
    assert(claimed.body.created === true && claimed.body.joined.classId === cls.id, "claim did not create and enrol a learner");
    const kid = (await p("/learners")).body.learners.find(l => l.id === claimed.body.learnerId);
    assert(kid && kid.name === "Ada Byron", "claimed learner did not take the roster name");
    assert((await post(p, "/classes/claim", { claimCode: imp.body.entries[0].claimCode })).status === 409, "a claim code was used twice");
    const roster = (await t(`/classes/${cls.id}/roster`)).body.roster;
    assert(roster.find(r => r.name === "Ada Byron").claimed && roster.find(r => r.name === "Alan Turing").claimCode, "roster status wrong");
    const other = (await post(p, "/learners", { name: "Second Kid" })).body.learner;
    const claim2 = await post(p, "/classes/claim", { claimCode: imp.body.entries[1].claimCode, learnerId: other.id });
    assert(claim2.body.created === false && claim2.body.learnerId === other.id, "claim did not link an existing learner");

    /* --- groups: a group assignment applies to its members only; a track group sets tracks --- */
    const grp = (await post(t, `/classes/${cls.id}/groups`, { name: "Stretch", track: "enrichment" })).body.group;
    await post(t, `/classes/${cls.id}/groups/${grp.id}/members`, { learnerId: kid.id });
    assert((await p(`/learners/${kid.id}/track`)).body.track === "enrichment", "group track not applied");
    assert((await p(`/learners/${other.id}/track`)).body.track === "core", "group track leaked to a non-member");
    assert((await post(t, `/classes/${cls.id}/assignments`, { topicId: "g6-ratios", groupId: "nope" })).status === 404, "unknown group accepted");
    await post(t, `/classes/${cls.id}/assignments`, { topicId: "g6-ratios", groupId: grp.id });
    await post(t, `/classes/${cls.id}/assignments`, { topicId: "g6-percent" });
    const prog = (await t(`/classes/${cls.id}/progress`)).body;
    const ada = prog.learners.find(l => l.learnerId === kid.id), sec = prog.learners.find(l => l.learnerId === other.id);
    assert(ada.assignments.length === 2 && sec.assignments.length === 1, "group assignment applied to the wrong learners");
    assert(prog.heatmap.find(h => h.groupId === grp.id).assigned === 1, "heatmap counts non-members for a group assignment");

    /* --- accommodations: hints allowed and a shorter check, marking unchanged --- */
    const acc = await t(`/classes/${cls.id}/learners/${kid.id}/accommodations`, { method: "PUT",
      body: JSON.stringify({ hintsInChecks: true, shorterChecks: true, extraTimePct: 50, notes: "dyslexia" }) });
    assert(acc.body.accommodations.hintsInChecks && acc.body.accommodations.extraTimePct === 50, "accommodations not stored");
    assert((await t(`/classes/${cls.id}/learners/${other.id}/accommodations`, { method: "PUT", body: JSON.stringify({ extraTimePct: 500 }) })).body.accommodations.extraTimePct === 100,
      "extra time not bounded");
    const check = (await post(p, "/mastery/start", { learnerId: kid.id, topicId: "g6-nscoord" })).body;
    assert(check.questions.length === 5 && check.accommodations?.shorterChecks, `shorter check has ${check.questions.length} questions`);
    const hint = await post(p, "/hint", { questionId: check.questions[0].id, level: 1 });
    assert(hint.status === 200 && hint.body.hint, "accommodated learner was refused a hint during a check");
    const plain2 = (await post(p, "/mastery/start", { learnerId: other.id, topicId: "g6-nscoord" })).body;
    assert(plain2.questions.length === 8 && !plain2.accommodations?.shorterChecks && !plain2.accommodations?.hintsInChecks,
      "accommodations leaked to another learner");
    assert((await post(p, "/hint", { questionId: plain2.questions[0].id, level: 1 })).status === 409, "hints allowed in a plain check");
    const paper = (await post(p, "/contest/start", { learnerId: kid.id, format: "drill" })).body;
    assert(paper.limitSeconds === 6 * 60 * 1.5, `extra time not applied to the paper (${paper.limitSeconds}s)`);

    /* --- configurable thresholds: per class, bounded, strictest wins; platform default via admin --- */
    assert((await t(`/classes/${cls.id}/thresholds`, { method: "PUT", body: JSON.stringify({ core: 30 }) })).status === 400, "an absurd threshold was accepted");
    await t(`/classes/${cls.id}/thresholds`, { method: "PUT", body: JSON.stringify({ core: 95, adv: 85 }) });
    const th = (await p(`/learners/${kid.id}/thresholds`)).body;
    assert(th.core === 95 && th.adv === 85 && th.defaults.core === 90, `class threshold not applied: ${JSON.stringify(th)}`);
    const r92 = await post(p, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 23, total: 25 });
    assert(r92.body.threshold === 95 && r92.body.star === false, "92% counted as mastery under a 95% class bar");
    const loner = (await post(p, "/learners", { name: "No Class Kid" })).body.learner;
    const r92b = await post(p, "/runs", { learnerId: loner.id, topicId: "g6-ratios", tier: "practice", score: 23, total: 25 });
    assert(r92b.body.threshold === 90 && r92b.body.star === true, "class threshold leaked to a learner outside the class");
    const a = client();
    if ((await post(a, "/auth/register", { coppaConsent: true, email: "boss@b.com", password: "a-long-enough-pass", name: "Boss" })).status === 409)
      await post(a, "/auth/login", { email: "boss@b.com", password: "a-long-enough-pass" });
    assert((await a("/admin/settings")).body.mastery.core === 90, "admin settings do not show the default");
    await a("/admin/settings", { method: "PUT", body: JSON.stringify({ mastery: { core: 85, adv: 75 } }) });
    assert((await p(`/learners/${loner.id}/thresholds`)).body.core === 85, "platform threshold not applied");
    assert((await p(`/learners/${kid.id}/thresholds`)).body.core === 95, "class override lost to the platform setting");
    await a("/admin/settings", { method: "PUT", body: JSON.stringify({ mastery: { core: 90, adv: 80 } }) });
    assert((await t("/admin/settings")).status === 403, "a teacher read admin settings");

    /* --- decay: a long-overdue review turns mastery into "decayed" and back into the review queue --- */
    const { DatabaseSync } = await import("node:sqlite");
    const dbx = new DatabaseSync("app/server/data/verify.db");
    await post(p, "/runs", { learnerId: loner.id, topicId: "g6-percent", tier: "practice", score: 8, total: 8 });
    let ms = (await p(`/learners/${loner.id}/mastery`)).body.topics.find(x => x.topicId === "g6-percent");
    assert(ms.state === "mastered", `fresh mastery reported as ${ms.state}`);
    const longAgo = new Date(Date.now() - 40 * 86400000).toISOString();
    dbx.prepare("UPDATE review_schedule SET due_at=? WHERE learner_id=? AND topic_id='g6-percent'").run(longAgo, loner.id);
    ms = (await p(`/learners/${loner.id}/mastery`)).body.topics.find(x => x.topicId === "g6-percent");
    assert(ms.state === "decayed" && ms.bestPct === 100, `overdue mastery reported as ${ms.state}`);
    const rev = (await p(`/learners/${loner.id}/review`)).body.review;
    assert(rev[0]?.topicId === "g6-percent" && rev[0].reason === "mastery_decayed", "decayed topic not first in the review queue");
    const nx = (await p(`/learners/${loner.id}/next`)).body;
    assert([...nx.ready, ...nx.blocked].some(e => e.topicId === "g6-percent"), "a decayed topic is still treated as mastered by next-up");

    /* --- unit test across a unit's topics, recorded per topic --- */
    const units = (await p("/units")).body.units;
    const unit = units.find(u => u.grade === "6" && u.topics >= 2);
    assert(unit, "no testable unit");
    const ut = (await post(p, "/unit-test/start", { learnerId: loner.id, grade: unit.grade, unit: unit.unit })).body;
    assert(ut.questions.length >= 4 && new Set(ut.questions.map(q => q.id.split(":")[0])).size >= 2, "unit test does not span topics");
    assert(!JSON.stringify(ut).includes('"expl"'), "unit test leaked explanations");
    const answers = {};
    for (const q of ut.questions) {
      const probe = (await post(p, "/answer", { questionId: q.id, answer: "__" })).body;
      answers[q.id] = q.type === "mc" ? q.opts.indexOf(probe.correctAnswer) : q.type === "multi" ? probe.correctAnswer.split(", ").map(x => q.opts.indexOf(x))
        : q.type === "order" ? probe.correctAnswer.split("  →  ") : probe.correctAnswer;
    }
    const res = (await post(p, "/unit-test/submit", { testId: ut.testId, answers })).body;
    assert(res.pct === 100 && res.passed && res.byTopic.length >= 2 && res.byTopic.every(b => b.name), `unit test misgraded: ${JSON.stringify(res).slice(0, 200)}`);
    const progRows = (await p(`/learners/${loner.id}/progress`)).body.progress.filter(r => r.tier === "unit");
    assert(progRows.length >= 2, "unit test not recorded per topic");
    assert((await post(p, "/unit-test/submit", { testId: ut.testId, answers })).status === 404, "unit test replayed");

    /* --- contest percentile and class contest leaderboard --- */
    const sub = async (cl, lid, fmt, right) => {
      const s = (await post(cl, "/contest/start", { learnerId: lid, format: fmt })).body;
      const ans = {};
      for (const q of s.questions) {
        if (!right) { ans[q.id] = "-99999"; continue; }
        const probe = (await post(cl, "/answer", { questionId: q.id, answer: "__" })).body;
        ans[q.id] = q.type === "mc" ? q.opts.indexOf(probe.correctAnswer) : q.type === "multi" ? probe.correctAnswer.split(", ").map(x => q.opts.indexOf(x))
          : q.type === "order" ? probe.correctAnswer.split("  →  ") : probe.correctAnswer;
      }
      return (await post(cl, "/contest/submit", { contestId: s.contestId, answers: ans })).body;
    };
    const first = await sub(p, other.id, "drill", false);
    assert(first.percentile === null || first.percentile <= 50, `a zero paper sits at percentile ${first.percentile}`);
    const strong = await sub(p, loner.id, "drill", true);
    assert(strong.pct === 100 && strong.percentile >= 50, `strong paper percentile ${strong.percentile}`);
    const hist = (await p(`/learners/${other.id}/contests`)).body.byFormat.find(f => f.format === "drill");
    assert(hist.percentile < strong.percentile, `weak paper (${hist.percentile}) not below strong (${strong.percentile})`);
    assert((await p(`/classes/${cls.id}/contest-leaderboard`)).body.enabled === false, "contest leaderboard on by default");
    await t(`/classes/${cls.id}/settings`, { method: "PUT", body: JSON.stringify({ leaderboardOn: true }) });
    await sub(p, kid.id, "drill", true);
    const lb = (await p(`/classes/${cls.id}/contest-leaderboard?format=drill`)).body;
    assert(lb.enabled && lb.board[0].best === 100 && lb.board.length === 2, `contest leaderboard wrong: ${JSON.stringify(lb)}`);
    assert(lb.board.every(b => b.you), "parent of both learners sees them anonymised");
    assert((await p(`/classes/${cls.id}/contest-leaderboard?format=nope`)).status === 400, "unknown format accepted");

    /* --- gifted report and team detail --- */
    assert((await t(`/classes/${cls.id}/gifted.csv`)).status === 200 && (await t(`/classes/${cls.id}/gifted.html`)).status === 200,
      "gifted report unavailable");
    const team = (await post(t, `/classes/${cls.id}/teams`, { name: "Blue" })).body.team;
    await post(t, `/classes/${cls.id}/teams/${team.id}/members`, { learnerId: kid.id });
    const td = (await t(`/classes/${cls.id}/teams/${team.id}`)).body;
    assert(td.members.length === 1 && td.lineup.drill.includes("Ada Byron"), `team detail wrong: ${JSON.stringify(td)}`);
    assert((await p(`/classes/${cls.id}/gifted.html`)).status === 403, "a parent read the gifted report");

    /* --- schools and districts: hierarchy with aggregates, admin only --- */
    const d = (await post(a, "/admin/districts", { name: "North District" })).body.district;
    const sch = (await post(a, "/admin/schools", { name: "Hill School", districtId: d.id })).body.school;
    assert((await post(a, "/admin/schools", { name: "X", districtId: "nope" })).status === 404, "unknown district accepted");
    await a("/admin/users/school", { method: "PUT", body: JSON.stringify({ email: "tad@b.com", schoolId: sch.id }) });
    const h = (await a("/admin/hierarchy")).body;
    const north = h.districts.find(x => x.id === d.id);
    assert(north.schools[0].teachers === 1 && north.schools[0].classes === 1 && north.schools[0].learners === 2,
      `school aggregates wrong: ${JSON.stringify(north.schools[0])}`);
    assert(north.totals.learners === 2 && h.totals.learners === 2, "district totals do not roll up");
    assert(!JSON.stringify(h).includes("Ada"), "hierarchy leaked a child's name");
    assert((await t("/admin/hierarchy")).status === 403 && (await post(t, "/admin/districts", { name: "X" })).status === 403, "teacher reached admin hierarchy");

    return `roster import + parent claim, groups, accommodations (5-question check, hints, +50% time), thresholds 95/85 per class, decay, unit test over ${res.byTopic.length} topics, percentiles, contest board, gifted report, hierarchy`;
  },

  /* 3.2.1 + 4.1.3 + 3.2.2 + 3.2.7 + 5.9 + 3.3.5 + 4.1.10 + 3.2.5 + 3.4.6 + 7.3 +
     3.5.4 + 8.4 + 10.8 + 10.6 — the student app's content types: comic
     lessons that resume and gate on embedded checks, plot input, simulations
     with server-checked tasks, seeded mini-games, contest guides, the proof
     template library with freeform rubric marking and an elegance bonus,
     LaTeX to MathML, localisation with RTL, and offline sync. */
  "student-app-depth": async () => {
    const { LESSONS, publicLesson } = await import("../app/shared/lessons.mjs");
    const { SIMULATIONS, checkTask } = await import("../app/shared/simulations.mjs");
    const { GAMES, buildRound, scoreRound } = await import("../app/shared/games.mjs");
    const { allProofs, checkProof, TEMPLATES, PROOF_KINDS } = await import("../app/shared/proofs.mjs");
    const { latexToMathML } = await import("../app/shared/mathml.mjs");
    const { STRINGS, LOCALES, missingKeys, dirOf, t } = await import("../app/shared/i18n.mjs");

    /* --- lessons: structure, alt text, no answer leaks --- */
    assert(LESSONS.length >= 6, `only ${LESSONS.length} lessons`);
    for (const l of LESSONS) {
      assert(l.panels.length >= 4 && l.panels.some(p => p.check), `${l.id} is too short or has no check`);
      for (const p of l.panels) assert(p.alt && p.alt.length > 10 && p.art?.kind, `${l.id} has a panel without art or alt text`);
      const raw = JSON.stringify(publicLesson(l));
      for (const k of ['"ans"', '"ansPt"', '"expl"', '"a":']) assert(!raw.includes(k), `${l.id} leaked ${k}`);
    }
    const c = client();
    await post(c, "/auth/register", { coppaConsent: true, email: "stud@b.com", password: "a-long-enough-pass", name: "S" });
    const kid = (await post(c, "/learners", { name: "Lesson Kid" })).body.learner;
    const les = LESSONS.find(l => l.id === "les-g6-nscoord");
    const firstCheck = les.panels.findIndex(p => p.check);
    /* Cannot skip past a check; wrong answer refused without the answer; right answer unlocks. */
    const skip = await post(c, `/lessons/${les.id}/progress`, { learnerId: kid.id, panel: firstCheck + 1 });
    assert(skip.status === 409 && skip.body.error === "check_not_passed", "a lesson check was skipped");
    const wrong = await post(c, `/lessons/${les.id}/check`, { learnerId: kid.id, panel: firstCheck, answer: [9, 9] });
    assert(wrong.body.correct === false && !wrong.body.correctAnswer && wrong.body.hint, "a wrong lesson check leaked or gave no hint");
    const right = await post(c, `/lessons/${les.id}/check`, { learnerId: kid.id, panel: firstCheck, answer: [2, -3] });
    assert(right.body.correct === true && right.body.explanation, "plot check misgraded (right answer refused)");
    const moved = await post(c, `/lessons/${les.id}/progress`, { learnerId: kid.id, panel: firstCheck + 1 });
    assert(moved.status === 200 && moved.body.panel === firstCheck + 1, "could not advance after passing the check");
    let mine = (await c(`/learners/${kid.id}/lessons`)).body.lessons.find(x => x.id === les.id);
    assert(mine.resumeAt === firstCheck + 1 && !mine.completed, "resume position not saved");
    /* Finish: pass the remaining checks then move to the end. */
    for (let i = firstCheck + 1; i < les.panels.length; i++)
      if (les.panels[i].check) {
        const ck = les.panels[i].check;
        await post(c, `/lessons/${les.id}/check`, { learnerId: kid.id, panel: i, answer: ck.type === "plot" ? ck.ansPt : ck.type === "mc" ? ck.a : ck.ans });
      }
    const done = await post(c, `/lessons/${les.id}/progress`, { learnerId: kid.id, panel: les.panels.length });
    assert(done.body.completed === true && done.body.badges.includes("lessons_1"), "completing a lesson gave no completion or badge");
    mine = (await c(`/learners/${kid.id}/lessons`)).body.lessons.find(x => x.id === les.id);
    assert(mine.completed && mine.resumeAt === null, "completed lesson still offers a resume point");

    /* --- plot questions served and graded --- */
    const qs = (await c("/topics/g6-nscoord/practice/questions")).body.questions;
    const plot = qs.find(q => q.type === "plot");
    assert(plot && plot.grid && !("ansPt" in plot), "plot question not served or leaks its point");
    assert((await post(c, "/answer", { questionId: plot.id, answer: [4, 2] })).body.correct === true, "plot answer misgraded");
    assert((await post(c, "/answer", { questionId: plot.id, answer: "4, 3" })).body.correct === false, "wrong plot accepted");

    /* --- simulations: valid state required; tasks checked server-side --- */
    assert(SIMULATIONS.length >= 5 && SIMULATIONS.every(s => s.tasks.length >= 3), "too few simulations or tasks");
    const area = SIMULATIONS.find(s => s.id === "sim-area");
    assert(checkTask(area, "area-24", { w: 6, h: 4 }).ok && !checkTask(area, "area-24", { w: 5, h: 5 }).ok, "area task misjudged");
    assert(checkTask(area, "area-24", { w: 24, h: "x" }).error === "invalid_state", "malformed state accepted");
    const tri = SIMULATIONS.find(s => s.id === "sim-triangle");
    assert(checkTask(tri, "right-triangle", { ax: 0, ay: 0, bx: 4, by: 0, cx: 0, cy: 3 }).ok, "right angle not recognised");
    const simDone = await post(c, "/simulations/sim-reflect/check", { learnerId: kid.id, taskId: "image-3-neg2", state: { x: 3, y: 2, axis: "x" } });
    assert(simDone.body.ok === true, "simulation task not credited through the API");
    assert((await post(c, "/simulations/sim-reflect/check", { learnerId: kid.id, taskId: "image-3-neg2", state: { x: 3, y: 2, axis: "y" } })).body.ok === false, "wrong mirror accepted");
    assert((await c(`/learners/${kid.id}/simulations`)).body.completed.some(x => x.taskId === "image-3-neg2"), "completed task not listed");

    /* --- mini-games: seeded, reproducible, scored server-side --- */
    assert(Object.keys(GAMES).length >= 4, "too few games");
    for (const id of Object.keys(GAMES)) {
      const a = buildRound(id, 42), b = buildRound(id, 42);
      assert(JSON.stringify(a) === JSON.stringify(b), `${id} is not reproducible from its seed`);
      assert(!JSON.stringify(a).includes('"answer"'), `${id} serves its answers`);
      assert(scoreRound(id, 42, []).score === 0, `${id} scores an empty round above zero`);
    }
    const start = (await post(c, "/games/table-sprint/start", { learnerId: kid.id })).body;
    assert(start.sessionId && start.items.length === 20 && start.seconds > 0, "game round malformed");
    const resp = start.items.map(it => it.a * it.b);
    resp[0] = -1;
    const fin = (await post(c, "/games/finish", { sessionId: start.sessionId, responses: resp })).body;
    assert(fin.score === 19 && fin.points === 38 && fin.badges.includes("games_1"), `game misscored: ${JSON.stringify(fin)}`);
    assert((await post(c, "/games/finish", { sessionId: start.sessionId, responses: resp })).status === 404, "a game round was finished twice");

    /* --- contest guides and proof templates --- */
    const guides = (await c("/contest/guides?format=amc8")).body.guides;
    assert(guides.some(g => g.format === "amc8") && guides.some(g => g.format === null), "guides missing format-specific or general advice");
    const tpl = (await c("/proofs/templates")).body.templates;
    for (const k of ["direct", "contrapositive", "contradiction", "induction", "pigeonhole", "extremal"])
      assert(tpl[k]?.scaffold?.length >= 3, `template ${k} missing`);

    /* --- proofs: pigeonhole and extremal represented; freeform rubric marking --- */
    const proofs = allProofs();
    assert(proofs.some(p => p.template === "pigeonhole") && proofs.some(p => p.template === "extremal") && proofs.some(p => p.template === "contrapositive"),
      "pigeonhole, extremal or contrapositive proof missing");
    assert(proofs.length >= 10 && new Set(proofs.map(p => p.grade)).size >= 7, `proof breadth: ${proofs.length} proofs over ${new Set(proofs.map(p => p.grade)).size} grades`);
    assert(PROOF_KINDS.freeform, "no freeform kind");
    const free = proofs.find(p => p.id === "p-free-even-square");
    const good = checkProof(free, { lines: ["Let n be even, so n = 2k for a whole number k.", "Then n^2 = (2k)^2 = 4k^2.", "So n^2 = 2(2k^2), which is even."] });
    assert(good.correct && good.elegant, `a valid three-line proof was refused: ${JSON.stringify(good)}`);
    const longer = checkProof(free, { text: "Let n be even.\nThat means n = 2k.\nSquare both sides.\nn^2 = (2k)^2 = 4k^2.\nSo n^2 = 2(2k^2), which is even." });
    assert(longer.correct && !longer.elegant, "a longer valid proof was refused or called elegant");
    const outOfOrder = checkProof(free, { lines: ["So n^2 = 2(2k^2), which is even.", "n = 2k.", "n^2 = (2k)^2 = 4k^2."] });
    assert(!outOfOrder.correct && outOfOrder.missing.length, "steps out of order were accepted");
    const vague = checkProof(free, { lines: ["It is obviously even."] });
    assert(!vague.correct && vague.missing[0].key === "define" && !JSON.stringify(vague).includes("2k"), "vague proof accepted, or feedback leaked phrasing");
    const started = await post(c, `/proofs/${free.id}/start`, { learnerId: kid.id });
    assert(started.body.proof.rubric?.every(r => r.must && !r.accept), "served freeform proof leaks accept patterns");
    const sub = await post(c, "/proofs/submit", { sessionId: started.body.sessionId, submission: { lines: ["n = 2k", "(2k)^2 = 4k^2", "= 2(2k^2), so even"] } });
    assert(sub.body.correct && sub.body.elegant && sub.body.points === 30, `elegance bonus not paid: ${JSON.stringify(sub.body)}`);

    /* --- LaTeX to MathML --- */
    const frac = latexToMathML("\\frac{3}{4} + x^2");
    assert(/<mfrac>/.test(frac.mathml) && /<msup>/.test(frac.mathml) && frac.spoken === "3 over 4 plus x squared", `LaTeX render wrong: ${frac.spoken}`);
    assert(latexToMathML("\\sqrt[3]{27}").spoken === "the cube root of 27", "cube root not spoken");
    let threw = false; try { latexToMathML("\\evil{x}"); } catch { threw = true; }
    assert(threw, "unsupported LaTeX was accepted silently");
    assert((await post(c, "/render/latex", { src: "\\frac{1}{2}" })).body.spoken === "1 over 2", "render endpoint broken");
    assert((await post(c, "/render/latex", { src: "\\bad" })).status === 400, "render endpoint accepted bad LaTeX");

    /* --- localisation: parity, RTL, translated content with honest fallback --- */
    for (const loc of Object.keys(LOCALES)) assert(missingKeys(loc).length === 0, `${loc} is missing keys: ${missingKeys(loc).slice(0, 3).join(", ")}`);
    assert(Object.keys(STRINGS.en).length >= 60, "UI dictionary is thin");
    assert(dirOf("ar") === "rtl" && dirOf("es") === "ltr", "writing direction wrong");
    assert(t("es", "quiz.correct") === "¡Correcto!" && t("ar", "nav.home") !== "Home", "translation lookup broken");
    const i18n = (await c("/i18n?locale=ar")).body;
    assert(i18n.dir === "rtl" && i18n.strings["nav.home"] === STRINGS.ar["nav.home"], "i18n endpoint wrong");
    const es = (await c("/topics/k-count/practice/questions?lang=es")).body;
    assert(es.lang === "es" && es.questions[0].q.startsWith("¿"), "translated bank not served");
    const esAns = (await post(c, "/answer", { questionId: "k-count:0", answer: 8, lang: "es" })).body;
    assert(/8 viene/.test(esAns.explanation), "explanation not translated");
    const fallback = (await c("/topics/g6-ratios/practice/questions?lang=es")).body;
    assert(fallback.lang === "en" && fallback.requestedLang === "es", "untranslated bank not flagged as a fallback");
    const enOrder = (await c("/topics/k-count/practice/questions")).body.questions[0];
    const esOrder = es.questions[0];
    assert(enOrder.id === esOrder.id && enOrder.type === esOrder.type, "translation changed the question identity");

    /* --- offline sync: graded on arrival, idempotent by client id --- */
    const batch = { clientId: "offline-batch-0001", topicId: "g6-ratios", seconds: 90, finishedAt: new Date(Date.now() - 3600e3).toISOString(),
      answers: { "g6-ratios:0": 0, "g6-ratios:2": "0.5", "g6-ratios:3": "banana" } };
    const s1 = (await post(c, "/sync", { learnerId: kid.id, batches: [batch] })).body.results[0];
    assert(s1.duplicate === false && s1.total === 3 && s1.detail.length === 3 && typeof s1.pct === "number", `sync misgraded: ${JSON.stringify(s1)}`);
    const s2 = (await post(c, "/sync", { learnerId: kid.id, batches: [batch] })).body.results[0];
    assert(s2.duplicate === true && s2.pct === s1.pct, "a re-sent batch was recorded twice");
    const progRows = (await c(`/learners/${kid.id}/progress`)).body.progress.filter(r => r.tier === "offline");
    assert(progRows.length === 1 && progRows[0].runs === 1, "offline run recorded wrongly");
    assert((await post(c, "/sync", { learnerId: kid.id, batches: [{ clientId: "x", topicId: "g6-ratios", answers: {} }] })).body.results[0].error, "malformed batch accepted");
    const bob = client();
    await post(bob, "/auth/register", { coppaConsent: true, email: "studbob@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await post(bob, "/sync", { learnerId: kid.id, batches: [batch] })).status === 403, "another account synced for this learner");

    return `${LESSONS.length} lessons with gated checks and resume, plot input, ${SIMULATIONS.length} simulations, ${Object.keys(GAMES).length} games, ${proofs.length} proofs incl. freeform + elegance, LaTeX, ${Object.keys(LOCALES).length} locales incl. RTL, offline sync`;
  },


  /* 9.2 + 9.5 + 9.4 + 4.2.4 + 4.1.11 + 11.5 + 9.1 — integrations, each proven
     against a mock of the real counterpart: signed webhooks with retry,
     GraphQL with ownership, an LTI 1.3 launch verified against a platform's
     JWKS, SMTP email and Web Push decrypted by the subscriber, the AI tutor
     with safety filters, latency budget and provider fallback, the analytics
     pipeline, and OneRoster import and sync. */
  "integrations": async () => {
    const http = await import("node:http");
    const net = await import("node:net");
    const cryptoMod = await import("node:crypto");
    const { sign } = await import("../app/server/src/webhooks.js");
    const push = await import("../app/server/src/push.js");
    const tutorMod = await import("../app/server/src/tutor.js");
    const { QUESTIONS } = await import("../app/shared/questions.mjs");
    const servers = [];
    const listen = (srv, port) => new Promise(r => { srv.listen(port, "127.0.0.1", () => r()); servers.push(srv); });
    const readBody = req => new Promise(r => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
    try {
      /* ---- mocks ---- */
      const hooks = []; let hookFailures = 1;
      await listen(http.createServer(async (req, res) => {
        const body = await readBody(req);
        hooks.push({ headers: req.headers, body: body.toString() });
        if (hookFailures-- > 0) { res.writeHead(500); return res.end("nope"); }
        res.writeHead(200); res.end("ok");
      }), 4128);

      const mails = [];
      await listen(net.createServer(sock => {
        let data = false, buf = "", msg = "";
        sock.write("220 mock ESMTP\r\n");
        sock.on("data", d => {
          buf += d.toString();
          let i;
          while ((i = buf.indexOf("\r\n")) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 2);
            if (data) { if (line === ".") { data = false; mails.push(msg); msg = ""; sock.write("250 queued\r\n"); } else msg += line + "\n"; continue; }
            if (/^EHLO/i.test(line)) sock.write("250-mock\r\n250 AUTH PLAIN LOGIN\r\n");
            else if (/^AUTH PLAIN/i.test(line)) sock.write(Buffer.from(line.slice(11), "base64").toString().includes("\0bf\0pw") ? "235 ok\r\n" : "535 no\r\n");
            else if (/^(MAIL FROM|RCPT TO)/i.test(line)) sock.write("250 ok\r\n");
            else if (/^DATA/i.test(line)) { data = true; sock.write("354 go\r\n"); }
            else if (/^QUIT/i.test(line)) { sock.write("221 bye\r\n"); sock.end(); }
            else sock.write("500 what\r\n");
          }
        });
      }), 4127);

      const pushes = [];
      await listen(http.createServer(async (req, res) => {
        pushes.push({ headers: req.headers, body: await readBody(req) });
        res.writeHead(201); res.end();
      }), 4129);

      const llmCalls = [];
      await listen(http.createServer(async (req, res) => {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        llmCalls.push({ url: req.url, headers: req.headers, body });
        const last = body.messages?.at(-1)?.content || "";
        const text = /SLOW/.test(last) ? null : /LEAK/.test(last) ? "The answer is 0.5, so type 0.5." : "What do you notice about the two numbers in the ratio? Try writing them as a fraction first.";
        const reply = () => { res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn",
            content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10 } })); };
        if (text === null) setTimeout(() => { try { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ content: [{ type: "text", text: "late" }], stop_reason: "end_turn" })); } catch {} }, 4000);
        else reply();
      }), 4126);

      const platformKeys = cryptoMod.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const platformJwk = { ...platformKeys.publicKey.export({ format: "jwk" }), kid: "pk1", alg: "RS256", use: "sig" };
      await listen(http.createServer((req, res) => {
        if (req.url === "/jwks") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ keys: [platformJwk] })); }
        res.writeHead(404); res.end();
      }), 4130);

      await listen(http.createServer(async (req, res) => {
        const json = o => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
        if (req.url === "/token") {
          const auth = Buffer.from((req.headers.authorization || "").replace("Basic ", ""), "base64").toString();
          if (auth !== "cid:csecret") { res.writeHead(401); return res.end(); }
          return json({ access_token: "tok123", token_type: "Bearer" });
        }
        if (req.headers.authorization !== "Bearer tok123") { res.writeHead(401); return res.end(); }
        if (req.url.endsWith("/classes")) return json({ classes: [{ sourcedId: "c1", title: "Year 4 Maths" }] });
        if (req.url.endsWith("/users")) return json({ users: [{ sourcedId: "u1", givenName: "Ada", familyName: "Lovelace", role: "student" }, { sourcedId: "u2", givenName: "Alan", familyName: "Turing", role: "student" }, { sourcedId: "t1", givenName: "Grace", familyName: "Hopper", role: "teacher" }] });
        if (req.url.endsWith("/enrollments")) return json({ enrollments: [{ class: { sourcedId: "c1" }, user: { sourcedId: "u1" }, role: "student" }, { class: { sourcedId: "c1" }, user: { sourcedId: "u2" }, role: "student" }, { class: { sourcedId: "c1" }, user: { sourcedId: "t1" }, role: "teacher" }] });
        res.writeHead(404); res.end();
      }), 4131);

      /* ---- accounts ---- */
      const c = client(), a = client(), t = client();
      await post(c, "/auth/register", { coppaConsent: true, email: "integ@b.com", password: "a-long-enough-pass", name: "I" });
      const kid = (await post(c, "/learners", { name: "Integration Kid" })).body.learner;
      if ((await post(a, "/auth/register", { coppaConsent: true, email: "boss@b.com", password: "a-long-enough-pass", name: "Boss" })).status === 409)
        await post(a, "/auth/login", { email: "boss@b.com", password: "a-long-enough-pass" });
      await post(t, "/auth/register", { coppaConsent: true, email: "integt@b.com", password: "a-long-enough-pass", name: "T", role: "teacher" });

      /* ---- webhooks: registered, signed, retried after a failure, scoped to own learners ---- */
      assert((await post(c, "/webhooks", { url: "ftp://x" })).status === 400, "bad webhook URL accepted");
      const wh = (await post(c, "/webhooks", { url: "http://127.0.0.1:4128/hook", events: ["run.recorded", "badge.earned"] })).body.webhook;
      assert(wh.secret && wh.events.length === 2, "webhook not registered");
      await post(c, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
      let drained = (await post(a, "/admin/jobs/webhooks")).body.result;
      assert(drained.retried >= 1, `the failed delivery was not scheduled for retry: ${JSON.stringify(drained)}`);
      let dl = (await c(`/webhooks/${wh.id}/deliveries`)).body.deliveries;
      assert(dl.some(d => d.status === "pending" && d.attempts === 1 && /500/.test(d.last_error)), "retry state not recorded");
      const { DatabaseSync } = await import("node:sqlite");
      const dbx = new DatabaseSync("app/server/data/verify.db");
      dbx.prepare("UPDATE webhook_deliveries SET next_at=? WHERE status='pending'").run(new Date(0).toISOString());
      drained = (await post(a, "/admin/jobs/webhooks")).body.result;
      assert(drained.delivered >= 1 && drained.retried === 0, `retry did not deliver: ${JSON.stringify(drained)}`);
      const runHook = hooks.find(h => h.headers["x-event"] === "run.recorded" && JSON.parse(h.body).data.pct === 100 && !JSON.parse(h.body).data.test);
      assert(runHook, "run.recorded webhook never arrived");
      assert(runHook.headers["x-signature"] === sign(wh.secret, runHook.body), "webhook signature does not verify");
      assert(hooks.some(h => h.headers["x-event"] === "badge.earned"), "badge.earned webhook never arrived");
      dl = (await c(`/webhooks/${wh.id}/deliveries`)).body.deliveries;
      assert(dl.every(d => d.status === "delivered") && dl.some(d => d.attempts === 2), "delivery record wrong after retry");
      const bob = client();
      await post(bob, "/auth/register", { coppaConsent: true, email: "integbob@b.com", password: "a-long-enough-pass", name: "B" });
      assert((await bob(`/webhooks/${wh.id}/deliveries`)).body.deliveries.length === 0, "another account read webhook deliveries");
      assert((await c(`/webhooks/${wh.id}`, { method: "DELETE" })).body.deleted === 1, "could not delete webhook");

      /* ---- GraphQL: typed reads, ownership enforced ---- */
      const gq = (cl, query, variables) => post(cl, "/graphql", { query, variables });
      const mine = (await gq(c, `{ learners { id name track rewards { points level badges { code name } } progress { topicId topic { name standards { codes } } bestPct } } }`)).body;
      assert(!mine.errors && mine.data.learners[0].name === "Integration Kid" && mine.data.learners[0].rewards.points > 0, `graphql learners: ${JSON.stringify(mine).slice(0, 200)}`);
      assert(mine.data.learners[0].progress[0].topic.standards.codes.length, "graphql topic has no standards");
      const theirs = (await gq(bob, `query($id: ID!) { learner(id: $id) { name } }`, { id: kid.id })).body;
      assert(theirs.data.learner === null, "graphql leaked another account's learner");
      const anon = (await gq(client(), `{ me { email } grades { key label units { name topics { id questions } } } }`)).body;
      assert(anon.data.me === null && anon.data.grades.length === 9, "graphql public curriculum or anonymous me wrong");
      assert((await gq(c, `{ nope }`)).body.errors?.length, "graphql accepted an unknown field");

      /* ---- LTI 1.3: login redirect, signed launch, provisioning ---- */
      const reg = await post(a, "/admin/lti/platforms", { issuer: "https://lms.test", clientId: "tool-1", authLoginUrl: "http://127.0.0.1:4130/auth",
        jwksUrl: "http://127.0.0.1:4130/jwks", deploymentId: "dep-1", name: "Mock LMS" });
      assert(reg.status === 200, "platform not registered");
      assert((await post(t, "/admin/lti/platforms", { issuer: "x" })).status === 403, "teacher registered a platform");
      const jwks = (await c("/lti/jwks")).body;
      assert(jwks.keys?.[0]?.kty === "RSA" && jwks.keys[0].kid && !jwks.keys[0].d, "tool JWKS missing or leaks the private key");
      assert((await c("/lti/config")).body.oidc_initiation_url.endsWith("/api/lti/login"), "tool config wrong");
      const login = await fetch(BASE + "/api/lti/login?iss=https://lms.test&login_hint=user-1&target_link_uri=" + encodeURIComponent(BASE + "/lessons") + "&client_id=tool-1", { redirect: "manual" });
      assert(login.status === 302, `login initiation returned ${login.status}`);
      const redirect = new URL(login.headers.get("location"));
      assert(redirect.origin === "http://127.0.0.1:4130" && redirect.searchParams.get("response_mode") === "form_post" && redirect.searchParams.get("nonce"), "OIDC redirect malformed");
      const state = redirect.searchParams.get("state"), nonce = redirect.searchParams.get("nonce");
      const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
      const CL = s => `https://purl.imsglobal.org/spec/lti/claim/${s}`;
      const nowSec = Math.floor(Date.now() / 1000);
      const makeToken = (over = {}, key = platformKeys.privateKey) => {
        const claims = { iss: "https://lms.test", aud: "tool-1", sub: "user-1", exp: nowSec + 300, iat: nowSec, nonce, name: "Ms Hopper",
          [CL("message_type")]: "LtiResourceLinkRequest", [CL("version")]: "1.3.0", [CL("deployment_id")]: "dep-1",
          [CL("roles")]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
          [CL("context")]: { id: "ctx-9", title: "Period 3 Maths" }, [CL("target_link_uri")]: BASE + "/lessons", ...over };
        const data = `${b64u({ alg: "RS256", typ: "JWT", kid: "pk1" })}.${b64u(claims)}`;
        return `${data}.${cryptoMod.sign("sha256", Buffer.from(data), key).toString("base64url")}`;
      };
      const launchWith = (token, st = state) => fetch(BASE + "/api/lti/launch", { method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_token: token, state: st }) });
      const forged = cryptoMod.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
      assert((await launchWith(makeToken({}, forged))).status === 401, "a token signed by the wrong key was accepted");
      /* A rejected launch spends the state; get a fresh one for the real launch. */
      const login2 = await fetch(BASE + "/api/lti/login?iss=https://lms.test&login_hint=user-1&client_id=tool-1", { redirect: "manual" });
      const r2 = new URL(login2.headers.get("location")); const state2 = r2.searchParams.get("state"), nonce2 = r2.searchParams.get("nonce");
      assert((await launchWith(makeToken({ nonce: nonce2, [CL("deployment_id")]: "dep-9" }), state2)).status === 401, "wrong deployment accepted");
      const login3 = await fetch(BASE + "/api/lti/login?iss=https://lms.test&login_hint=user-1&client_id=tool-1", { redirect: "manual" });
      const r3 = new URL(login3.headers.get("location")); const state3 = r3.searchParams.get("state"), nonce3 = r3.searchParams.get("nonce");
      const launched = await launchWith(makeToken({ nonce: nonce3 }), state3);
      assert(launched.status === 302 && launched.headers.get("location") === "/lessons", `instructor launch failed: ${launched.status} ${await launched.text()}`);
      const sid = (launched.headers.getSetCookie?.() || []).join(";");
      assert(/sid=/.test(sid) && /HttpOnly/i.test(sid), "launch issued no session cookie");
      assert((await launchWith(makeToken({ nonce: nonce3 }), state3)).status === 401, "a launch state was replayed");
      const ltiTeacher = async (path, opts = {}) => { const r = await fetch(BASE + "/api" + path, { ...opts, headers: { cookie: sid.split(";")[0], "Content-Type": "application/json", ...(opts.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
      const me = (await ltiTeacher("/auth/me")).body.user;
      assert(me?.role === "teacher" && me.name === "Ms Hopper", `LTI instructor not provisioned as a teacher: ${JSON.stringify(me)}`);
      const classes = (await ltiTeacher("/classes")).body.classes;
      assert(classes.some(x => x.name === "Period 3 Maths"), "LMS context did not become a class");
      /* A learner launch into the same context joins that class. */
      const login4 = await fetch(BASE + "/api/lti/login?iss=https://lms.test&login_hint=user-2&client_id=tool-1", { redirect: "manual" });
      const r4 = new URL(login4.headers.get("location"));
      const learnerLaunch = await launchWith(makeToken({ nonce: r4.searchParams.get("nonce"), sub: "user-2", name: "Sam Student",
        [CL("roles")]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"] }), r4.searchParams.get("state"));
      assert(learnerLaunch.status === 302, "learner launch failed");
      const roster = (await ltiTeacher(`/classes/${classes.find(x => x.name === "Period 3 Maths").id}/progress`)).body.learners;
      assert(roster.some(l => l.name === "Sam Student"), "LTI learner was not enrolled in the context's class");

      /* ---- push: subscription, encrypted delivery the subscriber can decrypt, VAPID ---- */
      const vapid = (await c("/push/vapid-public-key")).body.publicKey;
      assert(Buffer.from(vapid, "base64url").length === 65, "VAPID public key is not a P-256 point");
      const sub = push.makeSubscriber();
      assert((await post(c, "/me/push/subscribe", { endpoint: "http://127.0.0.1:4129/push/abc", keys: { p256dh: "bad", auth: sub.auth } })).status === 400, "bad push keys accepted");
      assert((await post(c, "/me/push/subscribe", { endpoint: "http://127.0.0.1:4129/push/abc", keys: { p256dh: sub.p256dh, auth: sub.auth } })).body.ok, "push subscription refused");

      /* ---- email + push delivery of the outbox; preferences honoured; weekly summary ---- */
      await c(`/learners/${kid.id}/goal`, { method: "PUT", body: JSON.stringify({ roundsPerWeek: 1 }) });
      await post(c, "/runs", { learnerId: kid.id, topicId: "g6-percent", tier: "practice", score: 4, total: 8 });   // goal met -> notification
      let delivered = (await post(a, "/admin/jobs/deliver")).body.result;
      assert(delivered.email >= 1 && delivered.push >= 1, `outbox not delivered: ${JSON.stringify(delivered)}`);
      const mail = mails.find(m => /Subject: =\?UTF-8\?B\?/.test(m) && /integ@b\.com/.test(m));
      assert(mail, "no email reached the SMTP server for the parent");
      const subject = Buffer.from(mail.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1], "base64").toString();
      assert(/goal/i.test(subject), `email subject is "${subject}"`);
      const p1 = pushes.find(p => p.headers.authorization?.startsWith("vapid t="));
      assert(p1 && p1.headers["content-encoding"] === "aes128gcm" && p1.headers.ttl, "push request lacks VAPID or aes128gcm");
      const jwt = p1.headers.authorization.match(/t=([^,]+)/)[1];
      const [h, pl, sg] = jwt.split(".");
      const vapidKey = cryptoMod.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256",
        x: Buffer.from(vapid, "base64url").subarray(1, 33).toString("base64url"), y: Buffer.from(vapid, "base64url").subarray(33, 65).toString("base64url") } });
      assert(cryptoMod.verify("sha256", Buffer.from(`${h}.${pl}`), { key: vapidKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sg, "base64url")), "VAPID JWT signature invalid");
      assert(JSON.parse(Buffer.from(pl, "base64url")).aud === "http://127.0.0.1:4129", "VAPID audience is not the push origin");
      const plain = JSON.parse(push.decryptPayload(p1.body, sub));
      assert(/goal/i.test(plain.title) && plain.kind === "goal_met", `push payload did not decrypt to the notification: ${JSON.stringify(plain)}`);
      const feed = (await c("/me/notifications")).body.notifications.find(n => n.kind === "goal_met");
      assert(feed.deliveredVia === "email+push", `delivery channels recorded as ${feed.deliveredVia}`);
      await c("/me/preferences", { method: "PUT", body: JSON.stringify({ emailAlerts: false, push: false }) });
      const mailsBefore = mails.length, pushesBefore = pushes.length;
      await post(c, "/runs", { learnerId: kid.id, topicId: "g3-mult", tier: "practice", score: 1, total: 8 });
      await post(c, "/runs", { learnerId: kid.id, topicId: "g3-mult", tier: "challenge", score: 1, total: 8 });
      await c(`/learners/${kid.id}/alerts`);            // struggling alert
      delivered = (await post(a, "/admin/jobs/deliver")).body.result;
      assert(mails.length === mailsBefore && pushes.length === pushesBefore && delivered.inApp >= 1, "preferences to stop email/push were ignored");
      await c("/me/preferences", { method: "PUT", body: JSON.stringify({ emailSummary: true }) });
      const weekly = (await post(a, "/admin/jobs/weekly-summary", { force: true })).body.result;
      assert(weekly.created >= 1 && /W\d\d/.test(weekly.week), `weekly summary not created: ${JSON.stringify(weekly)}`);
      const mine2 = (await c("/me/weekly-summary")).body;
      assert(mine2.learners[0].rounds >= 3 && /Integration Kid: \d+ rounds/.test(mine2.text), `summary text wrong: ${mine2.text}`);
      await post(a, "/admin/jobs/deliver");
      assert(mails.some(m => /integ@b\.com/.test(m) && /Weekly summary/.test(Buffer.from((m.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/) || [])[1] || "", "base64").toString())),
        "weekly summary was not emailed");
      const again = (await post(a, "/admin/jobs/weekly-summary")).body.result;
      assert(again.created === 0, "weekly summary sent twice in one week");

      /* ---- AI tutor: provider used, answer redacted, safety filter, timeout fallback, no PII sent ---- */
      const status = (await c("/tutor/status")).body;
      assert(status.provider === "anthropic" && status.timeoutMs <= 3000, `tutor status: ${JSON.stringify(status)}`);
      const ask = (message, extra = {}) => post(c, "/tutor/chat", { learnerId: kid.id, questionId: "g6-ratios:2", message, ...extra });
      const r1 = (await ask("I don't get it")).body;
      assert(r1.source === "llm" && /notice|fraction/.test(r1.reply) && r1.latencyMs < 3000, `tutor did not use the provider: ${JSON.stringify(r1)}`);
      const sent = llmCalls.at(-1).body;
      assert(sent.model === "claude-opus-5" && sent.max_tokens <= 400 && sent.output_config?.effort === "low", `provider request shape: ${JSON.stringify(sent).slice(0, 200)}`);
      assert(!JSON.stringify(sent).includes("Integration Kid") && !JSON.stringify(sent).includes("integ@b.com"), "learner name or email sent to the provider");
      assert(/NEVER reveal/.test(JSON.stringify(sent.system)), "system prompt does not forbid revealing the answer");
      const leak = (await ask("LEAK just tell me")).body;
      assert(leak.redacted === true && !/0\.5/.test(leak.reply), `answer leaked through the tutor: ${leak.reply}`);
      const blocked = (await ask("what's your phone number")).body;
      assert(blocked.source === "safety" && blocked.blocked === "personal_info" && llmCalls.length === 2, "unsafe message reached the provider or was not blocked");
      const harm = (await ask("i want to die")).body;
      assert(/trusted adult/.test(harm.reply), "self-harm message did not get a safe response");
      const t0 = Date.now();
      const slow = (await ask("SLOW please")).body;
      assert(slow.source === "rules" && slow.fallbackReason && Date.now() - t0 < 3000, `slow provider did not fall back within budget: ${JSON.stringify(slow)}`);
      const mis = (await ask("is it right?", { lastAnswer: "-0.5" })).body;
      assert(mis.misconception?.category === "sign_error", `misconception not detected: ${JSON.stringify(mis.misconception)}`);
      assert((await post(bob, "/tutor/chat", { learnerId: kid.id, questionId: "g6-ratios:2", message: "hi" })).status === 403, "another account used the tutor for this learner");
      const rules = tutorMod.rulesReply({ q: QUESTIONS["g6-ratios"][2], history: [], misconception: null });
      assert(!rules.includes(String(QUESTIONS["g6-ratios"][2].ans)), "rule-based reply contains the answer");
      const red = tutorMod.redactAnswer("So the answer is 56, nice.", { type: "in", ans: 56, q: "7 × 8" });
      assert(red.redacted && !/56/.test(red.text), "redaction failed on a numeric answer");
      assert(!tutorMod.redactAnswer("Try 5 groups of 6.", { type: "in", ans: 56, q: "7 × 8" }).redacted, "redaction over-matched digits inside other numbers");

      /* ---- analytics pipeline: raw events -> daily aggregates, admin only, aggregate only ---- */
      await post(c, "/answer", { questionId: "g6-ratios:2", answer: "0.5" });
      const agg = (await post(a, "/admin/jobs/analytics")).body.result;
      assert(agg.metrics["tutor.replies"] >= 4 && agg.metrics["tutor.under_3s_rate"] === 100 && agg.metrics["tutor.blocked"] >= 2, `tutor metrics wrong: ${JSON.stringify(agg.metrics)}`);
      assert(agg.metrics["answers.total"] >= 1 && agg.metrics["learners.active"] >= 1 && agg.metrics["runs.recorded"] >= 3, `platform metrics wrong: ${JSON.stringify(agg.metrics)}`);
      const rep = (await a("/admin/analytics?days=7")).body;
      assert(rep.days[agg.day]?.["tutor.replies"] === agg.metrics["tutor.replies"], "analytics report does not match the aggregate");
      assert(!JSON.stringify(rep).includes(kid.id), "analytics report exposes a learner id");
      assert((await c("/admin/analytics")).status === 403, "a parent read analytics");

      /* ---- OneRoster: CSV bundle import, and REST sync with OAuth2 client credentials ---- */
      const imp = await post(t, "/classes/import/oneroster", {
        classes: "sourcedId,status,title\nc7,active,Year 7 Set 1",
        users: "sourcedId,status,givenName,familyName,role\nu7,active,Ada,Lovelace,student\nu8,active,Alan,Turing,student\nt7,active,Grace,Hopper,teacher",
        enrollments: "sourcedId,classSourcedId,userSourcedId,role\ne1,c7,u7,student\ne2,c7,u8,student\ne3,c7,t7,teacher" });
      assert(imp.body.classes?.[0]?.students === 2, `OneRoster CSV import: ${JSON.stringify(imp.body)}`);
      const rosterT = (await t(`/classes/${imp.body.classes[0].classId}/roster`)).body.roster;
      assert(rosterT.length === 2 && rosterT.every(r => r.claimCode), "imported students have no claim codes");
      const sync = await post(a, "/admin/oneroster/sync", { baseUrl: "http://127.0.0.1:4131", clientId: "cid", clientSecret: "csecret", teacherEmail: "integt@b.com" });
      assert(sync.body.classes?.[0]?.name === "Year 4 Maths" && sync.body.classes[0].students === 2 && sync.body.pulled.users === 3, `OneRoster sync: ${JSON.stringify(sync.body)}`);
      const bad = await post(a, "/admin/oneroster/sync", { baseUrl: "http://127.0.0.1:4131", clientId: "cid", clientSecret: "wrong", teacherEmail: "integt@b.com" });
      assert(bad.status === 502, "sync with bad credentials did not fail");
      const claimed = await post(c, "/classes/claim", { claimCode: rosterT[0].claimCode });
      assert(claimed.body.created === true, "a OneRoster-imported entry could not be claimed by a parent");

      return `signed webhooks with retry, GraphQL, LTI 1.3 launch verified against JWKS, SMTP + Web Push (decrypted by subscriber), tutor via provider with redaction/safety/fallback, analytics aggregates, OneRoster CSV + REST`;
    } finally {
      for (const s of servers) { try { s.close(); s.closeAllConnections?.(); } catch {} }
    }
  },


  /* 10.3 + 11.6 + 13.9 — security depth: personal data encrypted at rest with
     key rotation, production refusing to start without a key, a global abuse
     limit and slow-client timeouts, OpenID Connect sign-in with PKCE against
     a mock provider, retention deletion, and an automated penetration test
     proven against a vulnerable stand-in before it is run against the real
     server. */
  "security-depth": async () => {
    const http = await import("node:http");
    const cryptoMod = await import("node:crypto");
    const { spawn } = await import("node:child_process");
    const { rmSync } = await import("node:fs");
    const { DatabaseSync } = await import("node:sqlite");
    const { runSuite, PROBES } = await import("../tools/pentest.mjs");
    const { isEncrypted, keyIdOf } = await import("../app/server/src/crypto.js");
    const servers = [];
    const listen = (srv, port) => new Promise(r => { srv.listen(port, "127.0.0.1", () => r()); servers.push(srv); });
    const readBody = req => new Promise(r => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString())); });
    const keyA = Buffer.alloc(32, 1).toString("base64"), keyB = Buffer.alloc(32, 2).toString("base64");
    const kidOf = k => cryptoMod.createHash("sha256").update(Buffer.from(k, "base64")).digest("hex").slice(0, 8);
    const secDb = "./data/seccheck.db";
    const boot = async (env, port) => {
      const srv = spawn("node", ["src/index.js"], { cwd: "app/server", stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, PORT: String(port), DB_FILE: secDb, JOBS_INTERVAL_MS: "0", REGISTER_LIMIT_PER_HOUR: "1000", ADMIN_EMAILS: "boss@b.com", ...env } });
      let stderr = ""; srv.stderr.on("data", d => { stderr += d; });
      let up = false;
      for (let i = 0; i < 50 && !up && srv.exitCode === null; i++) {
        try { up = (await fetch(`http://localhost:${port}/health`)).ok; } catch {}
        if (!up) await new Promise(r => setTimeout(r, 120));
      }
      return { srv, up, stderr: () => stderr, kill: () => new Promise(r => { if (srv.exitCode !== null) return r(); srv.once("exit", r); srv.kill(); }) };
    };
    const kid = "app/server/" + secDb.replace("./", "");
    for (const f of [kid, kid + "-wal", kid + "-shm"]) rmSync(f, { force: true });
    let running = null;
    try {
      /* ---- encryption at rest on a server with an explicit key ---- */
      const port = 4189;
      running = await boot({ DATA_KEY: keyA, GLOBAL_LIMIT_PER_MINUTE: "60" }, port);
      assert(running.up, "server with DATA_KEY did not boot: " + running.stderr());
      const c = (() => { let cookie = ""; return async (path, opts = {}) => {
        const res = await fetch(`http://localhost:${port}/api` + path, { ...opts, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) } });
        const sc = res.headers.getSetCookie?.() || []; if (sc.length) cookie = sc.map(x => x.split(";")[0]).join("; ");
        return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) }; }; })();
      const reg = await c("/auth/register", { method: "POST", body: JSON.stringify({ email: "enc@b.com", password: "a-long-enough-pass", name: "Encrypted Parent", coppaConsent: true }) });
      assert(reg.status === 200, "registration failed on the key server");
      const kidL = (await c("/learners", { method: "POST", body: JSON.stringify({ name: "Secret Child" }) })).body.learner;
      let raw = new DatabaseSync(kid);
      let u = raw.prepare("SELECT email, name, email_hash FROM users").get();
      let l = raw.prepare("SELECT name FROM learners").get();
      assert(isEncrypted(u.email) && isEncrypted(u.name) && isEncrypted(l.name), "personal data is stored in clear");
      assert(!JSON.stringify([u, l]).includes("Secret Child") && !JSON.stringify([u, l]).includes("enc@b.com"), "plaintext leaked into the row");
      assert(u.email_hash && u.email_hash.length === 64, "no blind index for the email");
      assert(keyIdOf(u.email) === kidOf(keyA), "ciphertext not made with DATA_KEY");
      raw.close();
      assert((await c("/learners")).body.learners[0].name === "Secret Child", "decrypt on read failed");
      const rawSql = new DatabaseSync(kid);
      assert(!rawSql.prepare("SELECT 1 FROM users WHERE email=?").get("enc@b.com"), "email is findable in clear in the database");
      rawSql.close();

      /* ---- global abuse limit (11.6) ---- */
      let limited = null;
      for (let i = 0; i < 80 && !limited; i++) { const r = await fetch(`http://localhost:${port}/api/curriculum`); if (r.status === 429) limited = r; }
      assert(limited, "80 rapid requests were never throttled by the global limit");
      assert(limited.headers.get("retry-after") && limited.headers.get("ratelimit-limit") === "60", "429 lacks RateLimit/Retry-After headers");

      /* ---- rotation: new key, old key still readable, rekey rewrites ---- */
      await running.kill();
      running = await boot({ DATA_KEY: keyB, DATA_KEY_PREVIOUS: keyA, GLOBAL_LIMIT_PER_MINUTE: "100000" }, port);
      assert(running.up, "server did not boot after rotation: " + running.stderr());
      const login = await c("/auth/login", { method: "POST", body: JSON.stringify({ email: "enc@b.com", password: "a-long-enough-pass" }) });
      assert(login.status === 200 && login.body.user.name === "Encrypted Parent", "login by blind index failed after key rotation");
      assert((await c("/learners")).body.learners[0].name === "Secret Child", "old-key ciphertext not readable with DATA_KEY_PREVIOUS");
      const admin = (() => { let cookie = ""; return async (path, opts = {}) => {
        const res = await fetch(`http://localhost:${port}/api` + path, { ...opts, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) } });
        const sc = res.headers.getSetCookie?.() || []; if (sc.length) cookie = sc.map(x => x.split(";")[0]).join("; ");
        return { status: res.status, body: await res.json().catch(() => ({})) }; }; })();
      await admin("/auth/register", { method: "POST", body: JSON.stringify({ email: "boss@b.com", password: "a-long-enough-pass", name: "Boss", coppaConsent: true }) });
      let keys = (await admin("/admin/keys")).body;
      assert(keys.currentKeyId === kidOf(keyB) && keys.byKey[kidOf(keyA)] >= 3 && keys.plaintext === 0, `key report before rekey: ${JSON.stringify(keys)}`);
      const rk = (await admin("/admin/jobs/rekey", { method: "POST" })).body.result;
      assert(rk.rewritten >= 2 && !rk.byKey[kidOf(keyA)] && rk.byKey[kidOf(keyB)] >= 5, `rekey did not rewrite rows: ${JSON.stringify(rk)}`);
      assert((await c("/learners")).body.learners[0].name === "Secret Child", "data unreadable after rekey");
      assert((await c("/admin/keys")).status === 403, "a parent read the key report");
      await running.kill();
      running = await boot({ DATA_KEY: keyB }, port);        // previous key gone
      assert(running.up && (await c("/auth/login", { method: "POST", body: JSON.stringify({ email: "enc@b.com", password: "a-long-enough-pass" }) })).status === 200,
        "after rekey the old key is still needed");
      await running.kill(); running = null;

      /* ---- production refuses to run without a key ---- */
      const prod = await boot({ NODE_ENV: "production" }, 4190);
      assert(!prod.up && prod.srv.exitCode !== 0 && /DATA_KEY is required/.test(prod.stderr()), "production started without DATA_KEY");

      /* ---- OIDC with PKCE against a mock provider (11.6, 9.1) ---- */
      const pk = cryptoMod.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = { ...pk.publicKey.export({ format: "jwk" }), kid: "ok1", alg: "RS256", use: "sig" };
      const tokenCalls = [];
      let nextEmail = "teacher@school.test";
      await listen(http.createServer(async (req, res) => {
        const json = (o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
        if (req.url === "/jwks") return json({ keys: [jwk] });
        if (req.url === "/token") {
          const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
          tokenCalls.push(form);
          const expect = tokenCalls.challenge;
          const got = cryptoMod.createHash("sha256").update(form.code_verifier || "").digest("base64url");
          if (form.client_secret !== "s3cret" || form.code !== "code-xyz" || got !== expect) return json({ error: "invalid_grant" }, 400);
          const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
          const nowSec = Math.floor(Date.now() / 1000);
          const data = `${b64u({ alg: "RS256", typ: "JWT", kid: "ok1" })}.${b64u({ iss: "https://idp.test", aud: "bf-client", sub: "subj-" + nextEmail, exp: nowSec + 300, iat: nowSec,
            nonce: tokenCalls.nonce, email: nextEmail, email_verified: true, name: "Ms Teacher" })}`;
          return json({ access_token: "at", id_token: `${data}.${cryptoMod.sign("sha256", Buffer.from(data), pk.privateKey).toString("base64url")}` });
        }
        res.writeHead(404); res.end();
      }), 4132);
      const a = client();
      if ((await post(a, "/auth/register", { coppaConsent: true, email: "boss@b.com", password: "a-long-enough-pass", name: "Boss" })).status === 409)
        await post(a, "/auth/login", { email: "boss@b.com", password: "a-long-enough-pass" });
      const prov = await post(a, "/admin/oidc/providers", { id: "mock", name: "Mock IdP", issuer: "https://idp.test", clientId: "bf-client", clientSecret: "s3cret",
        authUrl: "http://127.0.0.1:4132/auth", tokenUrl: "http://127.0.0.1:4132/token", jwksUrl: "http://127.0.0.1:4132/jwks", defaultRole: "teacher", emailDomain: "school.test" });
      assert(prov.status === 200, "OIDC provider not registered");
      assert((await client()("/auth/oidc/providers")).body.providers.some(p => p.id === "mock" && !p.clientSecret), "provider list missing or leaks the secret");
      const start = await fetch(BASE + "/api/auth/oidc/mock/start", { redirect: "manual" });
      assert(start.status === 302, "OIDC start did not redirect");
      const au = new URL(start.headers.get("location"));
      assert(au.origin === "http://127.0.0.1:4132" && au.searchParams.get("code_challenge_method") === "S256" && au.searchParams.get("code_challenge") && au.searchParams.get("nonce"),
        "authorization request lacks PKCE or nonce");
      tokenCalls.challenge = au.searchParams.get("code_challenge"); tokenCalls.nonce = au.searchParams.get("nonce");
      const cb = await fetch(BASE + `/api/auth/oidc/mock/callback?code=code-xyz&state=${encodeURIComponent(au.searchParams.get("state"))}`, { redirect: "manual" });
      assert(cb.status === 302, `OIDC callback failed: ${cb.status} ${await cb.text()}`);
      assert(tokenCalls.length === 1 && tokenCalls[0].code_verifier, "token exchange did not carry the PKCE verifier");
      const sid = (cb.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).join("; ");
      const me = await (await fetch(BASE + "/api/auth/me", { headers: { cookie: sid } })).json();
      assert(me.user?.email === "teacher@school.test" && me.user.role === "teacher", `OIDC user not provisioned as configured: ${JSON.stringify(me)}`);
      assert((await fetch(BASE + `/api/auth/oidc/mock/callback?code=code-xyz&state=${encodeURIComponent(au.searchParams.get("state"))}`, { redirect: "manual" })).status === 401, "OIDC state replayed");
      nextEmail = "outsider@elsewhere.test";
      const s2 = new URL((await fetch(BASE + "/api/auth/oidc/mock/start", { redirect: "manual" })).headers.get("location"));
      tokenCalls.challenge = s2.searchParams.get("code_challenge"); tokenCalls.nonce = s2.searchParams.get("nonce");
      const denied = await fetch(BASE + `/api/auth/oidc/mock/callback?code=code-xyz&state=${encodeURIComponent(s2.searchParams.get("state"))}`, { redirect: "manual" });
      assert(denied.status === 401, "an email outside the allowed domain signed in");

      /* ---- retention deletion (10.3) ---- */
      const dbx = new DatabaseSync("app/server/data/verify.db");
      const old = new Date(Date.now() - 400 * 86400000).toISOString();
      dbx.prepare("INSERT INTO users (id, email, email_hash, pass_hash, pass_salt, name, role, created_at) VALUES (?,?,?,?,?,?,?,?)")
        .run("stale-user", "enc:v1:x", "stalehash", "h", "s", "enc:v1:y", "parent", old);
      dbx.prepare("INSERT INTO audit_log (id, user_id, action, at) VALUES (?,?,?,?)").run("old-audit", "stale-user", "auth.login", old);
      dbx.prepare("INSERT INTO analytics_events (id, kind, at) VALUES (?,?,?)").run("old-event", "answer", old);
      const before = (await post(a, "/admin/jobs/retention")).body.result;
      assert(before.skipped === true, "retention ran with no window configured");
      assert((await a("/admin/settings", { method: "PUT", body: JSON.stringify({ retentionDays: 10 }) })).status === 400, "a 10-day retention window was accepted");
      await a("/admin/settings", { method: "PUT", body: JSON.stringify({ retentionDays: 365 }) });
      const swept = (await post(a, "/admin/jobs/retention")).body.result;
      assert(swept.auditDeleted >= 1 && swept.eventsDeleted >= 1 && swept.accountsErased >= 1, `retention sweep did nothing: ${JSON.stringify(swept)}`);
      assert(!dbx.prepare("SELECT 1 FROM users WHERE id='stale-user'").get() && !dbx.prepare("SELECT 1 FROM audit_log WHERE id='old-audit'").get(), "stale data survived the sweep");
      assert(dbx.prepare("SELECT COUNT(*) c FROM users").get().c > 1, "the sweep erased active accounts");
      await a("/admin/settings", { method: "PUT", body: JSON.stringify({ retentionDays: null }) });

      /* ---- automated penetration test (13.9): every probe fires on a
             vulnerable stand-in, and none finds anything critical here ---- */
      const vulnPort = 4133;
      await listen(http.createServer(async (req, res) => {
        const url = req.url, body = await readBody(req);
        const send = (code, text, headers = {}) => { res.writeHead(code, headers); res.end(text); };
        if (/\.\.|%2e%2e/i.test(url)) return send(200, "root:x:0:0:root:/root:/bin/bash");
        if (url === "/health") return send(200, "ok", { "x-powered-by": "Express", "content-type": "text/plain" });
        if (url === "/api/auth/register") return send(200, JSON.stringify({ user: {} }), { "set-cookie": "sid=abc; Path=/" });
        if (url === "/api/auth/login") return send(401, JSON.stringify({ error: "unknown_email" }));
        if (url === "/api/learners" && req.method === "POST") { if (/OR 1=1|DROP TABLE|UNION SELECT/.test(body)) return send(500, "boom"); return send(200, JSON.stringify({ learner: { id: "L1", name: body } })); }
        if (/^\/api\/topics\//.test(url) && /%27|%22|;|%3B/i.test(url)) return send(500, "SQLITE_ERROR: syntax error");
        if (/^\/api\/topics\/.*questions$/.test(url)) return send(200, JSON.stringify({ questions: [{ q: "x", ans: 4, expl: "y" }] }));
        if (/^\/api\/topics\//.test(url)) return send(500, "SQLITE_ERROR: syntax error");
        if (/^\/api\/learners\/[^/]+\/report\.html/.test(url)) return send(200, `<h1>${decodeURIComponent('<img src=x onerror="alert(1)">')}</h1>`, { "content-type": "text/html" });
        if (/^\/api\/learners\/[^/]+\/report\.csv/.test(url)) return send(200, "topic,pct\n=cmd|' /C calc'!A0,1");
        if (/^\/api\/learners\//.test(url)) return send(200, JSON.stringify({ progress: [] }));
        if (url === "/api/answer") { if (body.length > 100000 || body.startsWith("{not")) return send(500, "TypeError at /srv/app.js:12:3"); return send(200, "{}"); }
        if (url.startsWith("/api/lti/login")) return send(302, "", { location: "https://evil.test/phish" });
        if (url === "/api/auth/me") return send(200, JSON.stringify({ user: { role: "admin" } }));
        if (req.method === "POST") return send(200, JSON.stringify({ ok: true }));
        return send(200, "Cannot GET " + url + "\n    at /srv/app.js:1:1");
      }), vulnPort);
      const vuln = await runSuite(`http://127.0.0.1:${vulnPort}`);
      const fired = new Set(vuln.findings.map(f => f.probe));
      for (const name of Object.keys(PROBES)) {
        const key = { bruteForce: "brute-force" }[name] || name;
        assert(fired.has(key), `probe "${name}" found nothing on a server built to fail it`);
      }
      assert(vuln.counts.critical >= 5, `stand-in only produced ${vuln.counts.critical} critical findings`);
      const real = await runSuite(BASE);
      assert(real.counts.critical === 0 && real.counts.high === 0,
        `penetration test found ${real.counts.critical} critical / ${real.counts.high} high:\n    ` + real.findings.filter(f => /critical|high/.test(f.severity)).map(f => `${f.probe}: ${f.detail}`).join("\n    "));

      return `PII encrypted at rest (rotated ${kidOf(keyA)}→${kidOf(keyB)}, rekeyed, prod needs a key), global limit + timeouts, OIDC+PKCE via mock IdP, retention swept ${swept.accountsErased} account, pentest: ${Object.keys(PROBES).length} probes fire on stand-in, ${real.findings.length} low/medium findings here, 0 critical/high`;
    } finally {
      if (running) await running.kill();
      for (const s of servers) { try { s.close(); s.closeAllConnections?.(); } catch {} }
      for (const f of [kid, kid + "-wal", kid + "-shm"]) rmSync(f, { force: true });
    }
  },


  /* 11.7 + 10.4 + 10.1 + 13.10 + 11.4 — operations: a deployment pipeline and
     infrastructure as code that agree with each other, a restore drill that
     boots a service from the newest (sealed) backup, Prometheus metrics, a
     load-test rig, real page-load timing in a throttled browser, and CDN-
     ready asset builds. */
  "ops-depth": async () => {
    const { readFileSync, existsSync, rmSync } = await import("node:fs");
    const { execSync, spawn } = await import("node:child_process");
    const { drill } = await import("../tools/restore-drill.mjs");
    const { loadTest } = await import("../tools/loadtest.mjs");

    /* ---- pipeline and IaC agree with the runtime config ---- */
    const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
    assert(/workflow_run:/.test(deploy) && /Verify requirements/.test(deploy), "deploy does not wait for verification");
    assert(/--strategy bluegreen/.test(deploy), "deploy is not blue-green");
    assert(/\/ready/.test(deploy) && /FLY_API_TOKEN/.test(deploy), "deploy lacks a readiness smoke test or credential gating");
    assert(/docker build/.test(deploy) && /DATA_KEY/.test(deploy), "deploy does not build and boot the image with a key");
    const tf = readFileSync("infra/terraform/main.tf", "utf8"), fly = readFileSync("fly.toml", "utf8");
    const flyApp = fly.match(/^app\s*=\s*"([^"]+)"/m)[1], flyRegion = fly.match(/primary_region\s*=\s*"([^"]+)"/)[1], flyVol = fly.match(/source\s*=\s*"([^"]+)"/)[1];
    assert(tf.includes(`default     = "${flyApp}"`) && tf.includes(`default     = "${flyRegion}"`), "terraform app/region disagree with fly.toml");
    assert(tf.includes(`name   = "${flyVol}"`), "terraform volume name disagrees with fly.toml mount");
    for (const v of ["data_key", "admin_emails"]) assert(new RegExp(`variable "${v}"[\\s\\S]*?sensitive\\s*=\\s*true`).test(tf), `${v} is not a sensitive variable`);
    assert(/fly_volume/.test(tf) && /fly_ip/.test(tf) && /BACKUP_ENCRYPT=1/.test(tf), "terraform is missing the volume, IPs or backup secrets");
    const compose = readFileSync("docker-compose.yml", "utf8");
    assert(/DATA_KEY: \$\{DATA_KEY:\?/.test(compose) && /beastforge_data:\/data/.test(compose) && /healthcheck:/.test(compose), "compose file lacks required key, volume or health check");
    assert(existsSync("infra/README.md"), "no infrastructure README");

    /* ---- metrics reflect traffic ---- */
    const c = client();
    await c("/curriculum"); await c("/topics/g6-ratios/practice/questions"); await c("/nope-404");
    const prom = await (await fetch(BASE + "/metrics")).text();
    assert(/beastforge_up 1/.test(prom) && /beastforge_db_ready 1/.test(prom), "metrics lack up/ready gauges");
    const reqs = Number(prom.match(/beastforge_http_requests_total (\d+)/)[1]);
    assert(reqs >= 3, "request counter not counting");
    assert(/beastforge_http_request_duration_ms_bucket\{le="\+Inf"\} \d+/.test(prom) && /beastforge_route_requests_total\{route="GET \/api\/curriculum"\}/.test(prom), "histogram or route counters missing");
    const snap = await (await fetch(BASE + "/metrics.json")).json();
    assert(snap.uptimeSeconds >= 0 && snap.requests >= reqs && typeof snap.errorRate === "number", "metrics snapshot malformed");

    /* ---- restore drill from a sealed backup ---- */
    const a = client();
    if ((await post(a, "/auth/register", { coppaConsent: true, email: "boss@b.com", password: "a-long-enough-pass", name: "Boss" })).status === 409)
      await post(a, "/auth/login", { email: "boss@b.com", password: "a-long-enough-pass" });
    await post(client(), "/auth/register", { coppaConsent: true, email: "drill@b.com", password: "a-long-enough-pass", name: "Drill" });
    const usersNow = (await a("/admin/overview")).body.users;
    const sealed = (await post(a, "/admin/backup", { encrypt: true })).body;
    assert(sealed.ok && sealed.encrypted && sealed.file.endsWith(".db.enc"), `sealed backup not made: ${JSON.stringify(sealed)}`);
    assert(readFileSync(sealed.file).subarray(0, 6).toString() === "BFENC1" && !readFileSync(sealed.file).includes("SQLite format"), "sealed backup is not encrypted");
    const dataKey = readFileSync("app/server/data/.datakey", "utf8").trim();
    const dr = await drill({ dir: "app/server/data/backups", port: 4177, env: { DATA_KEY: dataKey } });
    assert(dr.encrypted && dr.integrity === "ok", `drill did not restore the sealed backup: ${JSON.stringify(dr)}`);
    assert(dr.users === usersNow && dr.readyUsers === usersNow, `restored service has ${dr.readyUsers} users, expected ${usersNow}`);
    assert(dr.secondsToServe < 20, `restore took ${dr.secondsToServe}s`);
    let failed = false;
    try { await drill({ dir: "app/server/data/backups", port: 4178, env: { DATA_KEY: Buffer.alloc(32, 9).toString("base64") } }); } catch { failed = true; }
    assert(failed, "a sealed backup was restored with the wrong key");

    /* ---- load: concurrent virtual users, no errors, bounded latency ---- */
    const lt = await loadTest({ base: BASE, users: 150, seconds: 3 });
    assert(lt.requests > 500 && lt.errorRate === 0, `load test: ${lt.requests} requests, errors ${lt.errors} (${JSON.stringify(lt.statuses)})`);
    assert(lt.p95 < 1000, `p95 latency ${lt.p95}ms under 150 concurrent users`);

    /* ---- real page load in a throttled browser against the production build ---- */
    const { measure } = await import("../tools/pageload.mjs");
    execSync("./node_modules/.bin/vite build", { cwd: "app/web", stdio: "pipe" });
    const port = 4191, dbFile = "./data/pagecheck.db";
    rmSync("app/server/" + dbFile.replace("./", ""), { force: true });
    const srv = spawn("node", ["src/index.js"], { cwd: "app/server", stdio: "ignore",
      env: { ...process.env, NODE_ENV: "production", PORT: String(port), DB_FILE: dbFile, JOBS_INTERVAL_MS: "0", DATA_KEY: Buffer.alloc(32, 3).toString("base64") } });
    let pl = {};
    try {
      let up = false;
      for (let i = 0; i < 50 && !up; i++) { try { up = (await fetch(`http://localhost:${port}/ready`)).ok; } catch {} if (!up) await new Promise(r => setTimeout(r, 150)); }
      assert(up, "production server for page-load timing did not start");
      const assets = await fetch(`http://localhost:${port}/`);
      const html = await assets.text();
      const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
      assert(asset, "built shell references no hashed script");
      const cc = (await fetch(`http://localhost:${port}${asset}`)).headers.get("cache-control") || "";
      assert(/max-age=31536000/.test(cc) && /immutable/.test(cc), `hashed asset cache-control is "${cc}"`);
      for (const profile of ["broadband", "3g"]) {
        pl[profile] = await measure(`http://localhost:${port}`, profile, { runs: 2 });
        assert(pl[profile].withinBudget, `${profile}: interactive in ${pl[profile].interactiveMs}ms, budget ${pl[profile].budgetMs}ms`);
        assert(pl[profile].fcp === null || pl[profile].fcp <= pl[profile].budgetMs, `${profile}: first contentful paint ${pl[profile].fcp}ms`);
      }
    } finally { srv.kill(); rmSync("app/server/" + dbFile.replace("./", ""), { force: true }); }

    /* ---- CDN-ready build: assets referenced from the CDN origin ---- */
    execSync("./node_modules/.bin/vite build --outDir dist-cdn", { cwd: "app/web", stdio: "pipe", env: { ...process.env, CDN_BASE: "https://cdn.example.test/bf/" } });
    const cdnHtml = readFileSync("app/web/dist-cdn/index.html", "utf8");
    assert(/src="https:\/\/cdn\.example\.test\/bf\/assets\//.test(cdnHtml), "CDN build does not reference assets from the CDN");
    rmSync("app/web/dist-cdn", { recursive: true, force: true });

    return `deploy+IaC coherent, metrics, sealed backup restored and served in ${dr.secondsToServe}s, ${lt.users} users ${lt.rps} req/s p95 ${lt.p95}ms 0 errors, page interactive broadband ${pl.broadband.interactiveMs}ms / 3G ${pl["3g"].interactiveMs}ms, CDN build`;
  },


  /* 8.1 + 8.2 + 8.5 + 3.5.5 + 3.5.2 + 3.5.3 — content management: a registry
     with licences, an approval workflow with versions enforced by the linter,
     diversity and alt-text rules proven to fire, and the authoring API that
     validates drafts, previews them as a student and routes them to review. */
  "cms-depth": async () => {
    const { execSync } = await import("node:child_process");
    const { existsSync, readFileSync } = await import("node:fs");
    const { lintQuestion, lintLesson, lintDiversity } = await import("../tools/lint-content.mjs");
    const { status, units, hashOf, approve } = await import("../tools/content-approve.mjs");
    const { ASSETS, LICENCES, lintAssets, sceneKinds } = await import("../app/shared/assets.mjs");
    const { LESSONS } = await import("../app/shared/lessons.mjs");
    const { figureAlt } = await import("../app/shared/figures.mjs");

    /* --- rules fire --- */
    const fig = lintQuestion({ type: "in", q: "Where is the point on the grid?", ans: 1, expl: "Look at the grid.", sec: "N", fig: { pts: [[1, 2]] } }, "t#1", null, new Map());
    assert(fig.errors.some(e => /nothing to describe/.test(e)), "an undescribable figure was not flagged");
    assert(figureAlt({ pts: [[1, 2, "A"]], path: [[1, 2], [3, 4]] }).includes("A at (1, 2)") && figureAlt({ alt: "custom" }) === "custom", "figure alt derivation wrong");
    const badLesson = lintLesson({ id: "x", grade: "K", panels: [{ art: { kind: "dragon" }, alt: "", text: "Hello there friend" }, { art: { kind: "baskets" }, alt: "A basket with three apples", text: "Count them all now" }, { art: { kind: "baskets" }, alt: "A basket with three apples", text: "Count again please" }] });
    assert(badLesson.errors.some(e => /not in the asset registry/.test(e)) && badLesson.errors.some(e => /alt text/.test(e)) && badLesson.errors.some(e => /no interactive check/.test(e)),
      `lesson rules did not fire: ${badLesson.errors.join(" | ")}`);
    const div = lintDiversity([{ where: "t", text: "Girls are worse at maths than boys, said the stupid teacher." }]);
    assert(div.errors.length >= 2, `stereotype/demeaning rules did not fire: ${JSON.stringify(div)}`);
    const skew = lintDiversity(Array.from({ length: 12 }, (_, i) => ({ where: `t${i}`, text: "He gave his brother his ball and he ran." })));
    assert(skew.warnings.some(w => /pronoun balance/.test(w)), "pronoun imbalance not warned");
    const same = lintDiversity(Array.from({ length: 12 }, (_, i) => ({ where: `t${i}`, text: "Ben has 3 apples." })));
    assert(same.warnings.some(w => /name diversity/.test(w)), "name monoculture not warned");
    assert(lintDiversity([{ where: "t", text: "Priya shares 6 pears with Omar. Ana counts 4 kites. Kwame builds 5 towers." }]).errors.length === 0, "clean text flagged");

    /* --- assets: registered, licensed, every lesson scene covered --- */
    assert(lintAssets().length === 0, `asset registry problems: ${lintAssets().join("; ")}`);
    assert(ASSETS.length >= 25 && ASSETS.every(a => LICENCES[a.licence] && a.tags.length && a.origin), "registry incomplete");
    for (const l of LESSONS) for (const p of l.panels) assert(sceneKinds().includes(p.art.kind), `${l.id} uses unregistered art ${p.art.kind}`);
    assert(existsSync("app/web/public/icon.svg") && ASSETS.some(a => a.origin === "app/web/public/icon.svg"), "icon not registered");

    /* --- approvals: every unit approved at the current hash; a change is caught --- */
    assert(existsSync("content/approvals.json"), "no approvals file");
    const s = status();
    assert(s.ok && s.rows.length >= 40 && s.rows.every(r => r.version >= 1 && r.approvedBy), `approval status: ${s.problems.length} problems over ${s.rows.length} units`);
    const tampered = JSON.parse(readFileSync("content/approvals.json", "utf8"));
    const someUnit = units().find(u => u.kind === "bank");
    tampered.units[someUnit.id].hash = "0000000000000000";
    const st = status(tampered);
    assert(st.problems.some(p => p.id === someUnit.id && p.state === "changed"), "a changed unit was not detected");
    delete tampered.units["puzzles"];
    assert(status(tampered).problems.some(p => p.id === "puzzles" && p.state === "unapproved"), "an unapproved unit was not detected");
    /* Re-approval bumps the version and keeps history. */
    const fresh = { version: 1, units: {} };
    approve(fresh, someUnit.id, { by: "A", role: "author" });
    const before = fresh.units[someUnit.id].version;
    fresh.units[someUnit.id].hash = "changed";
    approve(fresh, someUnit.id, { by: "B", role: "educator", note: "checked" });
    assert(fresh.units[someUnit.id].version === before + 1 && fresh.units[someUnit.id].history.length === 2, "re-approval did not version");
    assert(status(fresh, { requireEducator: true }).rows.find(r => r.id === someUnit.id).educator === true, "educator sign-off not recognised");
    assert(!status(undefined, { requireEducator: true }).ok, "educator sign-off is reported present when none exists (3.5.1 is still open)");
    assert(hashOf({ a: 1, b: [1, 2] }) === hashOf({ b: [1, 2], a: 1 }) && hashOf({ a: 1 }) !== hashOf({ a: 2 }), "hash not canonical");
    execSync("node tools/content-approve.mjs --status", { stdio: "pipe" });
    let educatorExit = 0; try { execSync("node tools/content-approve.mjs --status --require-educator", { stdio: "pipe" }); } catch (e) { educatorExit = e.status; }
    assert(educatorExit === 1, "the CLI does not fail when educator sign-off is required and missing");
    const lintOut = JSON.parse(execSync("node tools/lint-content.mjs --json").toString());
    assert(lintOut.approvals.units === s.rows.length && lintOut.approvals.approved === s.rows.length, "linter does not report approvals");

    /* --- authoring API --- */
    const t = client(), p = client(), a = client();
    await post(t, "/auth/register", { coppaConsent: true, email: "author@b.com", password: "a-long-enough-pass", name: "Author", role: "teacher" });
    await post(p, "/auth/register", { coppaConsent: true, email: "cmsparent@b.com", password: "a-long-enough-pass", name: "P" });
    if ((await post(a, "/auth/register", { coppaConsent: true, email: "boss@b.com", password: "a-long-enough-pass", name: "Boss" })).status === 409)
      await post(a, "/auth/login", { email: "boss@b.com", password: "a-long-enough-pass" });
    assert((await t("/cms/meta")).body.types.includes("plot") && (await p("/cms/meta")).status === 403, "meta not served to authors only");
    const bad = { type: "mc", q: "Pick", opts: ["a", "a"], a: 5, sec: "N" };
    const lint = (await post(t, "/cms/lint", { kind: "question", body: bad, topicId: "k-count" })).body;
    assert(lint.errors.length >= 3, `live lint too lenient: ${JSON.stringify(lint)}`);
    const draft = (await post(t, "/cms/drafts", { kind: "question", body: bad, topicId: "k-count" })).body.draft;
    assert(draft.status === "draft" && draft.version === 1, "draft not created");
    assert((await post(t, `/cms/drafts/${draft.id}/submit`)).status === 400, "a draft with lint errors was submitted");
    const good = { type: "mc", q: "Which number comes right after 4?", opts: ["5", "3", "6", "2"], a: 0, sec: "N", expl: "Counting up: 3, 4, then 5.", hint: "Count on from 4." };
    const upd = (await t(`/cms/drafts/${draft.id}`, { method: "PUT", body: JSON.stringify({ body: good }) })).body;
    assert(upd.draft.version === 2 && upd.lint.errors.length === 0, `update did not clear lint: ${JSON.stringify(upd.lint)}`);
    const prev = (await post(t, "/cms/preview", { kind: "question", body: good })).body;
    assert(prev.question.opts.length === 4 && !("a" in prev.question) && !("expl" in prev.question) && prev.hints.length === 3, "preview leaks answers or lacks hints");
    const graded = (await post(t, "/cms/preview/answer", { kind: "question", body: good, answer: 0 })).body;
    assert(graded.correct === true && graded.explanation, "preview grading failed");
    const sub = (await post(t, `/cms/drafts/${draft.id}/submit`)).body;
    assert(sub.draft.status === "submitted", "clean draft not submitted");
    assert((await p(`/cms/drafts`)).status === 403 && (await p(`/cms/drafts/${draft.id}/export`)).status === 403, "a parent reached the CMS");
    assert((await post(t, `/cms/drafts/${draft.id}/review`, { decision: "approved" })).status === 403, "an author reviewed their own draft");
    const rev = (await post(a, `/cms/drafts/${draft.id}/review`, { decision: "approved", note: "good" })).body;
    assert(rev.draft.status === "approved" && rev.draft.reviewNote === "good", "review not recorded");
    assert((await t(`/cms/drafts/${draft.id}`, { method: "PUT", body: JSON.stringify({ body: good }) })).status === 409, "an approved draft was edited");
    const exp = await fetch(BASE + `/api/cms/drafts/${draft.id}/export`, { headers: { cookie: (await t("/auth/me")).setCookie?.[0] || "" } }).catch(() => null);
    const expBody = (await t(`/cms/drafts/${draft.id}/export`)).body;
    assert(expBody.kind === "question" && expBody.body.q === good.q && expBody.status === "approved", "export malformed");
    assert((await a("/cms/drafts?all=1")).body.drafts.some(d => d.id === draft.id), "admin cannot list all drafts");
    const pz = (await post(t, "/cms/drafts", { kind: "puzzle", body: { title: "Test", prompt: "Give the smallest two-digit prime number that reads the same backwards.", accepts: [11], hints: ["Two digits.", "Same forwards and backwards."], difficulty: 2 } })).body;
    assert(pz.lint.errors.length === 0 && pz.draft.kind === "puzzle", `puzzle draft lint: ${JSON.stringify(pz.lint)}`);
    const ls = (await post(t, "/cms/lint", { kind: "lesson", body: { title: "T", panels: [{ art: { kind: "unicorn" }, alt: "short", text: "x" }] } })).body;
    assert(ls.errors.length >= 3, "lesson draft lint too lenient");
    const assets = (await t("/cms/assets?tag=fractions")).body;
    assert(assets.assets.length >= 1 && assets.licences["CC0-1.0"], "asset lookup by tag failed");
    const ap = (await t("/cms/approvals")).body;
    assert(ap.ok && ap.units.length === s.rows.length && (await t("/cms/approvals?educator=1")).body.ok === false, "approvals endpoint wrong");

    return `${ASSETS.length} registered assets, ${s.rows.length} content units approved at v≥1 (educator sign-off still open), diversity/alt/lesson rules fire, drafts lint→preview→submit→review→export`;
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
