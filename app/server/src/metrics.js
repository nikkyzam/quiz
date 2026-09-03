/* Operational metrics (spec 10.4): what a monitor needs to compute uptime
   and error rate, in Prometheus text format at /metrics. In-process counters
   only — correct for one node, and the format any scraper already reads. */

const started = Date.now();
const counts = { requests: 0, errors5xx: 0, errors4xx: 0 };
const byRoute = new Map();
const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const hist = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };

/* Group by method + first two path segments so cardinality stays bounded. */
const routeKey = req => `${req.method} /${req.path.split("/").filter(Boolean).slice(0, 2).map(s => /^[0-9a-f-]{20,}$/i.test(s) ? ":id" : s).join("/")}`;

export function metricsMiddleware(req, res, next) {
  const t0 = process.hrtime.bigint();
  const k = routeKey(req);          // before routers rewrite req.path
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    counts.requests++;
    if (res.statusCode >= 500) counts.errors5xx++; else if (res.statusCode >= 400) counts.errors4xx++;
    hist.sum += ms; hist.count++;
    for (let i = 0; i < BUCKETS.length; i++) if (ms <= BUCKETS[i]) hist.buckets[i]++;
    const r = byRoute.get(k) || { n: 0, e: 0 };
    r.n++; if (res.statusCode >= 500) r.e++;
    byRoute.set(k, r);
  });
  next();
}

export function snapshot() {
  const uptime = (Date.now() - started) / 1000;
  return {
    uptimeSeconds: Math.round(uptime), requests: counts.requests, errors5xx: counts.errors5xx, errors4xx: counts.errors4xx,
    errorRate: counts.requests ? counts.errors5xx / counts.requests : 0,
    latencyMsAvg: hist.count ? Math.round((hist.sum / hist.count) * 100) / 100 : 0,
    routes: Object.fromEntries([...byRoute].map(([k, v]) => [k, v]))
  };
}

export function prometheus({ dbReady }) {
  const lines = [];
  const g = (name, help, value, labels = "") => lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name}${labels} ${value}`);
  const c = (name, help, value, labels = "") => lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`, `${name}${labels} ${value}`);
  g("beastforge_up", "1 if the process is serving", 1);
  g("beastforge_db_ready", "1 if the database is readable", dbReady ? 1 : 0);
  g("beastforge_uptime_seconds", "Seconds since the process started", Math.round((Date.now() - started) / 1000));
  c("beastforge_http_requests_total", "Requests served", counts.requests);
  c("beastforge_http_errors_5xx_total", "Responses with a 5xx status", counts.errors5xx);
  c("beastforge_http_errors_4xx_total", "Responses with a 4xx status", counts.errors4xx);
  lines.push("# HELP beastforge_http_request_duration_ms Request latency", "# TYPE beastforge_http_request_duration_ms histogram");
  BUCKETS.forEach((b, i) => lines.push(`beastforge_http_request_duration_ms_bucket{le="${b}"} ${hist.buckets[i]}`));
  lines.push(`beastforge_http_request_duration_ms_bucket{le="+Inf"} ${hist.count}`);
  lines.push(`beastforge_http_request_duration_ms_sum ${Math.round(hist.sum)}`, `beastforge_http_request_duration_ms_count ${hist.count}`);
  lines.push("# HELP beastforge_route_requests_total Requests by route group", "# TYPE beastforge_route_requests_total counter");
  for (const [k, v] of byRoute) lines.push(`beastforge_route_requests_total{route="${k}"} ${v.n}`);
  g("beastforge_process_rss_bytes", "Resident memory", process.memoryUsage().rss);
  return lines.join("\n") + "\n";
}
