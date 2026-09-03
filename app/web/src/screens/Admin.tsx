/* Admin console (spec 4.4.1, 4.4.3, 7.6, 9.x, 10.3, 10.4, 11.5): school and
   district hierarchy, platform settings, backups and retention, audit log,
   analytics, integrations and key status. Aggregate only; never a child's work. */
import "../styles/teacher.css";
import { useEffect, useId, useState, type FormEvent } from "react";
import { ApiError, type User } from "../api";
import {
  explain, useLoad, fmtDate, fmtWhen, adminApi as A,
  type Overview, type Hierarchy, type AdminSettings, type Retention, type AuditEntry, type Analytics,
  type Webhook, type Delivery, type LtiPlatform, type OidcProvider, type KeyReport
} from "./teacher.api";

export type AdminTab = "overview" | "schools" | "settings" | "data" | "analytics" | "integrations" | "keys";

export type AdminData = {
  tab?: AdminTab;
  overview?: Overview;
  hierarchy?: Hierarchy;
  settings?: AdminSettings;
  retention?: Retention;
  audit?: AuditEntry[];
  analytics?: Analytics;
  webhooks?: Webhook[];
  events?: string[];
  lti?: LtiPlatform[];
  oidc?: OidcProvider[];
  keys?: KeyReport;
};

const TABS: { id: AdminTab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "schools", label: "Schools & districts" }, { id: "settings", label: "Settings" },
  { id: "data", label: "Data" }, { id: "analytics", label: "Analytics" }, { id: "integrations", label: "Integrations" }, { id: "keys", label: "Keys" }
];

function Status({ msg, err }: { msg: string; err: string }) {
  return (
    <>
      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="notice" role="status">{msg}</p>}
    </>
  );
}

export function Admin({ user, onBack, initial }: { user: User; onBack: () => void; initial?: AdminData }) {
  const [tab, setTab] = useState<AdminTab>(initial?.tab ?? "overview");
  const [overview, setOverview] = useState<Overview | null>(initial?.overview ?? null);
  const [err, setErr] = useState("");
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (initial?.overview) return;
    A.overview().then(setOverview).catch(e => {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setErr(explain(e));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const label = TABS.find(t => t.id === tab)?.label ?? "";

  return (
    <div className="tc">
      <button className="back" onClick={onBack}>← Back</button>
      <div className="eyebrow">Admin console</div>
      <h1>Platform administration</h1>
      <p className="lede">Signed in as {user.name} ({user.email}). Everything here is aggregate; every read is written to the audit log.</p>

      {forbidden && (
        <p className="err" role="alert">This console needs an administrator account. Your account does not have the admin role, so nothing here can be shown.</p>
      )}
      {!forbidden && err && <p className="err" role="alert">{err}</p>}
      {!forbidden && overview === null && !err && <div className="loading" role="status">Loading overview…</div>}

      {!forbidden && overview && (
        <>
          <div className="tabs tc-tabs" role="tablist" aria-label="Admin sections">
            {TABS.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={"tab" + (tab === t.id ? " on" : "")}
                      onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <section role="tabpanel" aria-label={label}>
            {tab === "overview" && <OverviewTab o={overview} />}
            {tab === "schools" && <SchoolsTab seed={initial?.hierarchy} />}
            {tab === "settings" && <SettingsTab seed={initial?.settings} />}
            {tab === "data" && <DataTab seedRetention={initial?.retention} seedAudit={initial?.audit} />}
            {tab === "analytics" && <AnalyticsTab seed={initial?.analytics} />}
            {tab === "integrations" && <IntegrationsTab seedHooks={initial?.webhooks} seedEvents={initial?.events} seedLti={initial?.lti} seedOidc={initial?.oidc} />}
            {tab === "keys" && <KeysTab seed={initial?.keys} />}
          </section>
        </>
      )}
    </div>
  );
}

/* ---------------- Overview ---------------- */
function OverviewTab({ o }: { o: Overview }) {
  const buckets = Object.entries(o.attainment);
  const total = buckets.reduce((a, [, n]) => a + n, 0);
  return (
    <>
      <h2>Overview</h2>
      <div className="statgrid tc-stats">
        <div className="stat"><b>{o.users}</b><span>Accounts</span></div>
        <div className="stat"><b>{o.learners}</b><span>Learners</span></div>
        <div className="stat"><b>{o.classes}</b><span>Classes</span></div>
        <div className="stat"><b>{o.runs}</b><span>Rounds played</span></div>
        <div className="stat"><b>{o.activeLearnersLast7Days}</b><span>Active in 7 days</span></div>
      </div>
      <h3>Accounts by role</h3>
      <ul className="tc-inline">{o.byRole.map(r => <li key={r.role} className="pill">{r.role}: {r.c}</li>)}</ul>

      <h3>Attainment distribution</h3>
      <p className="muted">Share of best scores per topic and tier across the platform.</p>
      <div className="scroll">
        <table className="tc-table">
          <caption className="visually-hidden">Attainment buckets</caption>
          <thead><tr><th scope="col">Best score</th><th scope="col" className="tc-num">Records</th><th scope="col" className="tc-num">Share</th></tr></thead>
          <tbody>{buckets.map(([k, n]) => (
            <tr key={k}><td>{k}%</td><td className="tc-num">{n}</td><td className="tc-num">{total ? Math.round((n / total) * 100) : 0}%</td></tr>
          ))}</tbody>
        </table>
      </div>

      <h3>Hardest topics</h3>
      {o.hardestTopics.length === 0 ? <p className="muted">No topic data yet.</p> : (
        <div className="scroll">
          <table className="tc-table">
            <caption className="visually-hidden">Topics with the lowest average best score</caption>
            <thead><tr><th scope="col">Topic</th><th scope="col" className="tc-num">Attempts</th><th scope="col" className="tc-num">Average best</th></tr></thead>
            <tbody>{o.hardestTopics.map(t => (
              <tr key={t.topicId}><td>{t.name}</td><td className="tc-num">{t.attempts}</td><td className="tc-num">{t.averagePct}%</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------- Schools & districts ---------------- */
function SchoolStats({ s }: { s: { teachers: number; classes: number; learners: number; rounds: number; masteredPct?: number | null } }) {
  return (
    <span className="tc-classmeta">
      {s.teachers} teachers · {s.classes} classes · {s.learners} learners · {s.rounds} rounds
      {s.masteredPct != null ? ` · ${s.masteredPct}% mastered` : ""}
    </span>
  );
}

function SchoolsTab({ seed }: { seed?: Hierarchy }) {
  const h = useLoad(A.hierarchy, seed);
  const [district, setDistrict] = useState("");
  const [school, setSchool] = useState({ name: "", districtId: "" });
  const [assign, setAssign] = useState({ email: "", schoolId: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr(""); setMsg("");
    try { setMsg(await fn()); await h.reload(); } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };
  const allSchools = h.data ? [...h.data.districts.flatMap(d => d.schools.map(s => ({ ...s, district: d.name }))), ...h.data.unassignedSchools.map(s => ({ ...s, district: "" }))] : [];

  return (
    <>
      <h2>Schools and districts</h2>
      {h.err && <p className="err" role="alert">{h.err}</p>}
      {h.data === null && !h.err && <div className="loading" role="status">Loading hierarchy…</div>}
      {h.data && (
        <div className="card">
          <p className="muted">Platform totals: <SchoolStats s={h.data.totals} /></p>
          {h.data.districts.length === 0 && h.data.unassignedSchools.length === 0 && <p className="muted">No districts or schools yet.</p>}
          <ul className="tc-tree">
            {h.data.districts.map(d => (
              <li key={d.id}>
                <b>{d.name}</b> <SchoolStats s={d.totals} />
                {d.schools.length > 0 && <ul>{d.schools.map(s => <li key={s.id}>{s.name} <SchoolStats s={s} /></li>)}</ul>}
              </li>
            ))}
            {h.data.unassignedSchools.length > 0 && (
              <li><b>Not in a district</b>
                <ul>{h.data.unassignedSchools.map(s => <li key={s.id}>{s.name} <SchoolStats s={s} /></li>)}</ul>
              </li>
            )}
          </ul>
        </div>
      )}
      <Status msg={msg} err={err} />

      <form className="card tc-form" onSubmit={e => { e.preventDefault(); run(async () => { const r = await A.createDistrict(district.trim()); setDistrict(""); return `Created district ${r.district.name}.`; }); }}>
        <h3>Create a district</h3>
        <div className="field"><label htmlFor={id + "-d"}>District name</label><input id={id + "-d"} value={district} onChange={e => setDistrict(e.target.value)} maxLength={80} required /></div>
        <button className="btn" type="submit" disabled={busy || !district.trim()}>Create district</button>
      </form>

      <form className="card tc-form" onSubmit={e => { e.preventDefault(); run(async () => { const r = await A.createSchool(school.name.trim(), school.districtId || null); setSchool({ name: "", districtId: "" }); return `Created school ${r.school.name}.`; }); }}>
        <h3>Create a school</h3>
        <div className="tc-row">
          <div className="field"><label htmlFor={id + "-s"}>School name</label><input id={id + "-s"} value={school.name} onChange={e => setSchool(s => ({ ...s, name: e.target.value }))} maxLength={80} required /></div>
          <div className="field">
            <label htmlFor={id + "-sd"}>District</label>
            <select id={id + "-sd"} value={school.districtId} onChange={e => setSchool(s => ({ ...s, districtId: e.target.value }))}>
              <option value="">No district</option>
              {(h.data?.districts ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn" type="submit" disabled={busy || !school.name.trim()}>Create school</button>
      </form>

      <form className="card tc-form" onSubmit={e => { e.preventDefault(); run(async () => { await A.assignUser(assign.email.trim(), assign.schoolId || null); const s = allSchools.find(x => x.id === assign.schoolId); setAssign({ email: "", schoolId: "" }); return `${assign.email.trim()} is now ${s ? `at ${s.name}` : "not placed in any school"}.`; }); }}>
        <h3>Place a teacher in a school</h3>
        <p className="muted">By email. Choose no school to remove the placement.</p>
        <div className="tc-row">
          <div className="field"><label htmlFor={id + "-e"}>Teacher email</label><input id={id + "-e"} type="email" value={assign.email} onChange={e => setAssign(a => ({ ...a, email: e.target.value }))} required /></div>
          <div className="field">
            <label htmlFor={id + "-as"}>School</label>
            <select id={id + "-as"} value={assign.schoolId} onChange={e => setAssign(a => ({ ...a, schoolId: e.target.value }))}>
              <option value="">No school</option>
              {allSchools.map(s => <option key={s.id} value={s.id}>{s.name}{s.district ? ` (${s.district})` : ""}</option>)}
            </select>
          </div>
        </div>
        <button className="btn ghost" type="submit" disabled={busy || !assign.email.trim()}>Save placement</button>
      </form>
    </>
  );
}

/* ---------------- Settings ---------------- */
function SettingsTab({ seed }: { seed?: AdminSettings }) {
  const s = useLoad(A.settings, seed);
  const [form, setForm] = useState({ core: "", adv: "", retention: "" });
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  useEffect(() => {
    if (s.data && !ready) { setForm({ core: String(s.data.mastery.core), adv: String(s.data.mastery.adv), retention: s.data.retentionDays == null ? "" : String(s.data.retentionDays) }); setReady(true); }
  }, [s.data, ready]);
  const cur = ready ? form : { core: String(s.data?.mastery.core ?? ""), adv: String(s.data?.mastery.adv ?? ""), retention: s.data?.retentionDays == null ? "" : String(s.data.retentionDays) };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await A.saveSettings({ mastery: { core: Number(cur.core), adv: Number(cur.adv) }, retentionDays: cur.retention === "" ? null : Number(cur.retention) });
      s.setData(d => (d ? { ...d, ...r } : r));
      setMsg(`Saved. Mastery core ${r.mastery.core}%, advanced ${r.mastery.adv}%; retention ${r.retentionDays == null ? "not set (keep until deleted)" : `${r.retentionDays} days`}.`);
    } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  return (
    <>
      <h2>Platform settings</h2>
      {s.err && <p className="err" role="alert">{s.err}</p>}
      {s.data === null && !s.err && <div className="loading" role="status">Loading settings…</div>}
      {s.data && (
        <form className="card tc-form" onSubmit={save}>
          <h3>Mastery thresholds</h3>
          <p className="muted">Defaults are core {s.data.defaults?.core ?? 90}% and advanced {s.data.defaults?.adv ?? 80}%. A class can override these. Allowed range 50 to 100.</p>
          <div className="tc-row">
            <div className="field"><label htmlFor={id + "-c"}>Core topics (%)</label><input id={id + "-c"} type="number" min={50} max={100} value={cur.core} onChange={e => setForm(f => ({ ...f, core: e.target.value }))} required /></div>
            <div className="field"><label htmlFor={id + "-a"}>Advanced topics (%)</label><input id={id + "-a"} type="number" min={50} max={100} value={cur.adv} onChange={e => setForm(f => ({ ...f, adv: e.target.value }))} required /></div>
          </div>
          <h3>Retention</h3>
          <div className="field">
            <label htmlFor={id + "-r"}>Delete inactive learner work after (days, at least 30; blank = keep until deleted)</label>
            <input id={id + "-r"} type="number" min={30} value={cur.retention} onChange={e => setForm(f => ({ ...f, retention: e.target.value }))} />
          </div>
          <button className="btn" type="submit" disabled={busy}>Save settings</button>
          <Status msg={msg} err={err} />
        </form>
      )}
    </>
  );
}

/* ---------------- Data ---------------- */
const JOBS: { id: string; label: string }[] = [
  { id: "retention", label: "Retention sweep" }, { id: "webhooks", label: "Deliver webhooks" }, { id: "deliver", label: "Send notifications" },
  { id: "weekly-summary", label: "Weekly summaries" }, { id: "analytics", label: "Aggregate today's analytics" }
];

function DataTab({ seedRetention, seedAudit }: { seedRetention?: Retention; seedAudit?: AuditEntry[] }) {
  const ret = useLoad(A.retention, seedRetention);
  const audit = useLoad(async () => (await A.audit()).entries, seedAudit);
  const [encrypt, setEncrypt] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr(""); setMsg("");
    try { setMsg(await fn()); await Promise.all([ret.reload(), audit.reload()]); } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  return (
    <>
      <h2>Data</h2>
      <Status msg={msg} err={err} />
      <div className="card tc-form">
        <h3>Backup</h3>
        <p className="muted">Takes a consistent snapshot of the database into the backups folder on the server. The seven most recent are kept.</p>
        <label className="checkline"><input type="checkbox" checked={encrypt} onChange={e => setEncrypt(e.target.checked)} /><span>Encrypt the snapshot with the current data key</span></label>
        <div className="rowbtns">
          <button type="button" className="btn" disabled={busy} onClick={() => run(async () => {
            const r = await A.backup(encrypt);
            if (!r.ok) throw new ApiError(r.error || "backup_failed", 500);
            return `Backup written${r.encrypted ? " (encrypted)" : ""} at ${fmtWhen(r.at)}: ${r.file}`;
          })}>Back up now</button>
        </div>
      </div>

      <div className="card tc-form">
        <h3>Jobs</h3>
        <p className="muted">Run a scheduled job on demand.</p>
        <div className="rowbtns tc-wrap">
          {JOBS.map(j => (
            <button key={j.id} type="button" className="btn ghost" disabled={busy}
                    onClick={() => run(async () => { const r = await A.runJob(j.id); return `${j.label} finished: ${JSON.stringify(r.result).slice(0, 300)}`; })}>{j.label}</button>
          ))}
        </div>
      </div>

      <h3>Retention</h3>
      {ret.err && <p className="err" role="alert">{ret.err}</p>}
      {ret.data === null && !ret.err && <div className="loading" role="status">Loading retention status…</div>}
      {ret.data && (
        <div className="card">
          <div className="statgrid tc-stats">
            <div className="stat"><b>{ret.data.counts.runs}</b><span>Rounds held</span></div>
            <div className="stat"><b>{ret.data.counts.mistakes}</b><span>Mistakes held</span></div>
            <div className="stat"><b>{ret.data.counts.auditEntries}</b><span>Audit entries</span></div>
          </div>
          <p className="muted">Oldest record: {fmtWhen(ret.data.oldestRecord)}.</p>
          <dl className="tc-dl">
            {Object.entries(ret.data.policy).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </div>
      )}

      <h3>Audit log</h3>
      <p className="muted">The 200 most recent entries. Reading this log is itself recorded.</p>
      {audit.err && <p className="err" role="alert">{audit.err}</p>}
      {audit.data === null && !audit.err && <div className="loading" role="status">Loading audit log…</div>}
      {audit.data && audit.data.length === 0 && <p className="muted">No entries yet.</p>}
      {audit.data && audit.data.length > 0 && (
        <div className="scroll tc-tall">
          <table className="tc-table">
            <caption className="visually-hidden">Audit log, newest first</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Detail</th><th scope="col">Account</th></tr></thead>
            <tbody>{audit.data.map((e, i) => (
              <tr key={i}><td className="tc-nowrap">{fmtWhen(e.at)}</td><td><code>{e.action}</code></td><td>{e.detail || ""}</td><td><code>{e.user_id ? e.user_id.slice(0, 8) : "anon"}</code></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------- Analytics ---------------- */
function AnalyticsTab({ seed }: { seed?: Analytics }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(seed ?? null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [seeded] = useState(seed !== undefined);
  const id = useId();
  const load = async (d: number) => { try { setData(await A.analytics(d)); setErr(""); } catch (x) { setErr(explain(x)); } };
  useEffect(() => { if (!seeded) load(days); }, [days, seeded]);

  const rows = data ? Object.entries(data.days) : [];
  const metrics = Array.from(new Set(rows.flatMap(([, m]) => Object.keys(m)))).sort();

  return (
    <>
      <h2>Analytics</h2>
      <p className="muted">Daily aggregates: events, active learners, answer accuracy, tutor latency. No individual is identifiable.</p>
      <div className="tc-row">
        <div className="field tc-narrow">
          <label htmlFor={id + "-days"}>Window</label>
          <select id={id + "-days"} value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        </div>
        <div className="field">
          <button type="button" className="btn ghost" onClick={async () => {
            setMsg(""); setErr("");
            try { const r = await A.runJob("analytics"); setMsg(`Aggregated ${JSON.stringify((r.result as { day?: string })?.day ?? "today")}.`); await load(days); } catch (x) { setErr(explain(x)); }
          }}>Aggregate today</button>
        </div>
      </div>
      <Status msg={msg} err={err} />
      {data === null && !err && <div className="loading" role="status">Loading analytics…</div>}
      {data && rows.length === 0 && <p className="muted">No aggregates since {data.since}. Run the analytics job to compute today.</p>}
      {data && rows.length > 0 && (
        <div className="scroll">
          <table className="tc-table">
            <caption className="visually-hidden">Daily metrics since {data.since}</caption>
            <thead><tr><th scope="col">Day</th>{metrics.map(m => <th scope="col" key={m} className="tc-num">{m}</th>)}</tr></thead>
            <tbody>{rows.map(([day, m]) => (
              <tr key={day}><th scope="row" className="tc-nowrap">{day}</th>{metrics.map(k => <td key={k} className="tc-num">{m[k] ?? ""}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------- Integrations ---------------- */
const LTI_FIELDS: [string, string, boolean][] = [
  ["name", "Display name", false], ["issuer", "Issuer", true], ["clientId", "Client ID", true], ["deploymentId", "Deployment ID", true],
  ["authLoginUrl", "OIDC auth login URL", true], ["tokenUrl", "Token URL", false], ["jwksUrl", "JWKS URL", true]
];
const OIDC_FIELDS: [string, string, string][] = [
  ["id", "Provider id (lowercase, 2 to 32 chars)", "text"], ["name", "Display name", "text"], ["issuer", "Issuer", "url"],
  ["clientId", "Client ID", "text"], ["clientSecret", "Client secret", "password"], ["authUrl", "Authorization URL", "url"],
  ["tokenUrl", "Token URL", "url"], ["jwksUrl", "JWKS URL", "url"], ["emailDomain", "Restrict to email domain (optional)", "text"]
];

function IntegrationsTab({ seedHooks, seedEvents, seedLti, seedOidc }: { seedHooks?: Webhook[]; seedEvents?: string[]; seedLti?: LtiPlatform[]; seedOidc?: OidcProvider[] }) {
  const hooks = useLoad(async () => (await A.webhooks()).webhooks, seedHooks);
  const events = useLoad(async () => (await A.webhookEvents()).events, seedEvents);
  const lti = useLoad(async () => (await A.ltiPlatforms()).platforms, seedLti);
  const oidc = useLoad(async () => (await A.oidcProviders()).providers, seedOidc);
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [deliv, setDeliv] = useState<{ id: string; rows: Delivery[] } | null>(null);
  const [ltiForm, setLtiForm] = useState<Record<string, string>>({});
  const [oidcForm, setOidcForm] = useState<Record<string, string>>({ defaultRole: "parent" });
  const [sync, setSync] = useState({ baseUrl: "", clientId: "", clientSecret: "", teacherEmail: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const run = async (fn: () => Promise<string>, after?: () => Promise<unknown>) => {
    setBusy(true); setErr(""); setMsg("");
    try { setMsg(await fn()); if (after) await after(); } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  return (
    <>
      <h2>Integrations</h2>
      <Status msg={msg} err={err} />

      <h3>Webhooks</h3>
      <p className="muted">Signed HTTP callbacks for your own account's learner events. The signing secret is shown once, when the hook is created.</p>
      {hooks.err && <p className="err" role="alert">{hooks.err}</p>}
      {hooks.data === null && !hooks.err && <div className="loading" role="status">Loading webhooks…</div>}
      {hooks.data && hooks.data.length === 0 && <p className="muted">No webhooks registered.</p>}
      {hooks.data && hooks.data.length > 0 && (
        <ul className="tc-cards">
          {hooks.data.map(w => (
            <li className="drow" key={w.id}>
              <div className="dhead"><b className="tc-break">{w.url}</b><span className={"pill" + (w.active ? " good" : "")}>{w.active ? "active" : "paused"}</span></div>
              <div className="dsub">{w.events.join(", ")} · {w.pending} pending · {w.failed} failed · since {fmtDate(w.created_at)}</div>
              <div className="rowbtns">
                <button type="button" className="btn ghost" disabled={busy} aria-label={`Show deliveries for ${w.url}`}
                        onClick={() => run(async () => { const r = await A.deliveries(w.id); setDeliv({ id: w.id, rows: r.deliveries }); return `${r.deliveries.length} recent deliveries for ${w.url}.`; })}>Deliveries</button>
                <button type="button" className="btn ghost danger" disabled={busy} aria-label={`Delete webhook ${w.url}`}
                        onClick={() => run(async () => { await A.deleteWebhook(w.id); if (deliv?.id === w.id) setDeliv(null); return "Webhook deleted."; }, hooks.reload)}>Delete</button>
              </div>
              {deliv?.id === w.id && (
                deliv.rows.length === 0 ? <p className="muted">No deliveries yet.</p> : (
                  <div className="scroll">
                    <table className="tc-table">
                      <caption className="visually-hidden">Deliveries for {w.url}</caption>
                      <thead><tr><th scope="col">Event</th><th scope="col">Status</th><th scope="col" className="tc-num">Attempts</th><th scope="col">Created</th><th scope="col">Delivered</th><th scope="col">Last error</th></tr></thead>
                      <tbody>{deliv.rows.map(d => (
                        <tr key={d.id}><td>{d.event}</td><td>{d.status}</td><td className="tc-num">{d.attempts}</td><td className="tc-nowrap">{fmtWhen(d.created_at)}</td><td className="tc-nowrap">{fmtWhen(d.delivered_at)}</td><td>{d.last_error || ""}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="rowbtns">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => { const r = await A.testWebhook(); return `Queued ${r.queued} test ${r.queued === 1 ? "delivery" : "deliveries"}. Run the "Deliver webhooks" job under Data to send now.`; }, hooks.reload)}>Send a test event</button>
      </div>

      <form className="card tc-form" onSubmit={e => { e.preventDefault(); run(async () => {
        const r = await A.createWebhook(url.trim(), picked);
        setUrl(""); setPicked([]);
        return `Webhook created for ${r.webhook.url}. Signing secret (shown once, copy it now): ${r.webhook.secret}`;
      }, hooks.reload); }}>
        <h4>Add a webhook</h4>
        <div className="field"><label htmlFor={id + "-wurl"}>Receiver URL (https)</label><input id={id + "-wurl"} type="url" value={url} onChange={e => setUrl(e.target.value)} required /></div>
        <fieldset className="tc-fieldset">
          <legend className="flabel">Events (none selected = all)</legend>
          {(events.data ?? []).map(ev => (
            <label className="checkline" key={ev}>
              <input type="checkbox" checked={picked.includes(ev)} onChange={e => setPicked(p => (e.target.checked ? [...p, ev] : p.filter(x => x !== ev)))} />
              <span>{ev}</span>
            </label>
          ))}
        </fieldset>
        <button className="btn" type="submit" disabled={busy || !url.trim()}>Create webhook</button>
      </form>

      <h3>LTI 1.3 platforms</h3>
      <p className="muted">Register an LMS so it can launch BeastForge. The tool's JWKS and configuration are at /api/lti/jwks and /api/lti/config.</p>
      {lti.err && <p className="err" role="alert">{lti.err}</p>}
      {lti.data === null && !lti.err && <div className="loading" role="status">Loading platforms…</div>}
      {lti.data && lti.data.length === 0 && <p className="muted">No platforms registered.</p>}
      {lti.data && lti.data.length > 0 && (
        <div className="scroll">
          <table className="tc-table">
            <caption className="visually-hidden">Registered LTI platforms</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Issuer</th><th scope="col">Client ID</th><th scope="col">Deployment</th><th scope="col">Added</th></tr></thead>
            <tbody>{lti.data.map(p => <tr key={p.id}><td>{p.name}</td><td className="tc-break">{p.issuer}</td><td><code>{p.client_id}</code></td><td><code>{p.deployment_id}</code></td><td className="tc-nowrap">{fmtDate(p.created_at)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <form className="card tc-form" onSubmit={e => { e.preventDefault(); run(async () => { const r = await A.createLtiPlatform(ltiForm); setLtiForm({}); return `Platform registered (${r.platform.id}).`; }, lti.reload); }}>
        <h4>Register a platform</h4>
        {LTI_FIELDS.map(([k, label, req]) => (
          <div className="field" key={k}>
            <label htmlFor={`${id}-lti-${k}`}>{label}{req ? "" : " (optional)"}</label>
            <input id={`${id}-lti-${k}`} type={/Url$/.test(k) ? "url" : "text"} value={ltiForm[k] ?? ""} required={req}
                   onChange={e => setLtiForm(f => ({ ...f, [k]: e.target.value }))} />
          </div>
        ))}
        <button className="btn" type="submit" disabled={busy}>Register platform</button>
      </form>

      <h3>OpenID Connect sign-in</h3>
      {oidc.err && <p className="err" role="alert">{oidc.err}</p>}
      {oidc.data === null && !oidc.err && <div className="loading" role="status">Loading providers…</div>}
      {oidc.data && oidc.data.length === 0 && <p className="muted">No providers configured.</p>}
      {oidc.data && oidc.data.length > 0 && (
        <ul className="tc-inline">{oidc.data.map(p => <li key={p.id} className="pill">{p.name} ({p.id}) · {p.default_role}{p.email_domain ? ` · @${p.email_domain}` : ""}</li>)}</ul>
      )}
      <form className="card tc-form" onSubmit={e => { e.preventDefault(); run(async () => { const r = await A.createOidcProvider(oidcForm); setOidcForm({ defaultRole: "parent" }); return `Provider ${r.provider.id} saved. The client secret is stored encrypted and never shown again.`; }, oidc.reload); }}>
        <h4>Add or update a provider</h4>
        {OIDC_FIELDS.map(([k, label, type]) => (
          <div className="field" key={k}>
            <label htmlFor={`${id}-oidc-${k}`}>{label}</label>
            <input id={`${id}-oidc-${k}`} type={type} autoComplete={type === "password" ? "off" : undefined} value={oidcForm[k] ?? ""} required={k !== "emailDomain"}
                   onChange={e => setOidcForm(f => ({ ...f, [k]: e.target.value }))} />
          </div>
        ))}
        <div className="field">
          <label htmlFor={id + "-oidc-role"}>Role for new accounts</label>
          <select id={id + "-oidc-role"} value={oidcForm.defaultRole ?? "parent"} onChange={e => setOidcForm(f => ({ ...f, defaultRole: e.target.value }))}>
            <option value="parent">parent</option><option value="teacher">teacher</option>
          </select>
        </div>
        <button className="btn" type="submit" disabled={busy}>Save provider</button>
      </form>

      <h3>OneRoster sync</h3>
      <p className="muted">Pull classes, users and enrollments from a OneRoster 1.1 REST endpoint (Clever, ClassLink) into a teacher's account. Credentials are used for this sync only and not stored.</p>
      <form className="card tc-form" onSubmit={e => { e.preventDefault(); run(async () => {
        const r = await A.oneRosterSync(sync);
        setSync(s => ({ ...s, clientSecret: "" }));
        return `Pulled ${r.pulled.classes} classes, ${r.pulled.users} users, ${r.pulled.enrollments} enrollments; provisioned ${r.classes.length} ${r.classes.length === 1 ? "class" : "classes"}.`;
      }); }}>
        <div className="tc-row">
          <div className="field"><label htmlFor={id + "-or-base"}>Base URL</label><input id={id + "-or-base"} type="url" value={sync.baseUrl} onChange={e => setSync(s => ({ ...s, baseUrl: e.target.value }))} required /></div>
          <div className="field"><label htmlFor={id + "-or-email"}>Teacher email</label><input id={id + "-or-email"} type="email" value={sync.teacherEmail} onChange={e => setSync(s => ({ ...s, teacherEmail: e.target.value }))} required /></div>
        </div>
        <div className="tc-row">
          <div className="field"><label htmlFor={id + "-or-cid"}>Client ID</label><input id={id + "-or-cid"} value={sync.clientId} onChange={e => setSync(s => ({ ...s, clientId: e.target.value }))} required /></div>
          <div className="field"><label htmlFor={id + "-or-sec"}>Client secret</label><input id={id + "-or-sec"} type="password" autoComplete="off" value={sync.clientSecret} onChange={e => setSync(s => ({ ...s, clientSecret: e.target.value }))} required /></div>
        </div>
        <button className="btn" type="submit" disabled={busy}>Sync now</button>
      </form>
    </>
  );
}

/* ---------------- Keys ---------------- */
function KeysTab({ seed }: { seed?: KeyReport }) {
  const k = useLoad(A.keys, seed);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ids = k.data ? Object.entries(k.data.byKey) : [];
  const stale = ids.filter(([kid]) => kid !== k.data?.currentKeyId).reduce((a, [, n]) => a + n, 0);

  return (
    <>
      <h2>Encryption keys</h2>
      <p className="muted">Which key protects each stored personal field. Key ids only; key material never leaves the server environment.</p>
      {k.err && <p className="err" role="alert">{k.err}</p>}
      {k.data === null && !k.err && <div className="loading" role="status">Loading key status…</div>}
      {k.data && (
        <>
          <div className="statgrid tc-stats">
            <div className="stat"><b>{ids.reduce((a, [, n]) => a + n, 0)}</b><span>Encrypted values</span></div>
            <div className="stat"><b>{stale}</b><span>Under old keys</span></div>
            <div className="stat"><b>{k.data.plaintext}</b><span>Still in clear</span></div>
          </div>
          <div className="scroll">
            <table className="tc-table">
              <caption className="visually-hidden">Values per key id</caption>
              <thead><tr><th scope="col">Key id</th><th scope="col">Status</th><th scope="col" className="tc-num">Values</th></tr></thead>
              <tbody>
                {ids.map(([kid, n]) => (
                  <tr key={kid}><td><code>{kid}</code></td><td>{kid === k.data?.currentKeyId ? <span className="pill good">current</span> : <span className="pill">previous</span>}</td><td className="tc-num">{n}</td></tr>
                ))}
                {ids.length === 0 && <tr><td><code>{k.data.currentKeyId}</code></td><td><span className="pill good">current</span></td><td className="tc-num">0</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card tc-form">
            <h3>Rotation</h3>
            <p className="muted">{k.data.rotation}</p>
            <p className={stale || k.data.plaintext ? "" : "muted"}>
              {stale || k.data.plaintext ? `${stale + k.data.plaintext} values are not yet under the current key. Run the rekey job to rewrite them.` : "Everything is under the current key."}
            </p>
            <div className="rowbtns">
              <button type="button" className="btn" disabled={busy} onClick={async () => {
                setBusy(true); setErr(""); setMsg("");
                try { const r = await A.runJob("rekey"); const res = r.result as { rewritten?: number }; setMsg(`Rekey finished: ${res.rewritten ?? 0} values rewritten.`); await k.reload(); }
                catch (x) { setErr(explain(x)); }
                setBusy(false);
              }}>Run rekey job</button>
            </div>
            <Status msg={msg} err={err} />
          </div>
        </>
      )}
    </>
  );
}
