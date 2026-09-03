#!/usr/bin/env node
/* Load-testing rig (spec 13.10, 10.2).

   Virtual users loop over the request mix a real session produces —
   curriculum, a question list, an answer, progress — as fast as the server
   answers, for a fixed duration. Reports throughput, latency percentiles and
   the error rate. Honest scope: this measures ONE server from ONE client
   machine. Reaching the spec's 50,000 concurrent users needs several
   application nodes behind a load balancer with a shared database; this rig
   is how you find the per-node ceiling to size that from.

   Usage: node tools/loadtest.mjs [--base http://localhost:4000] [--users 100] [--seconds 10] [--json]
   Exported: loadTest(opts) for the check. */

export async function loadTest({ base = "http://localhost:4000", users = 100, seconds = 10, mix = null } = {}) {
  const deadline = Date.now() + seconds * 1000;
  const lat = [];
  let ok = 0, errors = 0, statuses = {};
  const steps = mix || [
    { name: "curriculum", req: () => fetch(base + "/api/curriculum") },
    { name: "questions", req: () => fetch(base + "/api/topics/g6-nscoord/practice/questions") },
    { name: "answer", req: () => fetch(base + "/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: "g6-ratios:2", answer: "0.5" }) }) },
    { name: "health", req: () => fetch(base + "/ready") }
  ];
  const byStep = Object.fromEntries(steps.map(s => [s.name, { n: 0, ms: 0 }]));
  const worker = async (id) => {
    let i = id;
    while (Date.now() < deadline) {
      const s = steps[i++ % steps.length];
      const t0 = performance.now();
      try {
        const r = await s.req();
        await r.arrayBuffer();
        const ms = performance.now() - t0;
        lat.push(ms); byStep[s.name].n++; byStep[s.name].ms += ms;
        statuses[r.status] = (statuses[r.status] || 0) + 1;
        if (r.ok) ok++; else errors++;
      } catch { errors++; statuses.network = (statuses.network || 0) + 1; }
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: users }, (_, i) => worker(i)));
  const elapsed = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const p = q => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] * 10) / 10 : null);
  return {
    base, users, seconds: Math.round(elapsed * 10) / 10, requests: ok + errors, ok, errors,
    errorRate: ok + errors ? errors / (ok + errors) : 0,
    rps: Math.round((ok + errors) / elapsed), p50: p(0.5), p95: p(0.95), p99: p(0.99), max: p(1),
    statuses, byStep: Object.fromEntries(Object.entries(byStep).map(([k, v]) => [k, { requests: v.n, avgMs: v.n ? Math.round(v.ms / v.n * 10) / 10 : null }]))
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const r = await loadTest({ base: opt("--base", "http://localhost:4000"), users: Number(opt("--users", 100)), seconds: Number(opt("--seconds", 10)) });
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else console.log(`${r.users} users for ${r.seconds}s against ${r.base}: ${r.requests} requests, ${r.rps} req/s, ` +
    `p50 ${r.p50}ms p95 ${r.p95}ms p99 ${r.p99}ms, errors ${(r.errorRate * 100).toFixed(2)}%`);
}
