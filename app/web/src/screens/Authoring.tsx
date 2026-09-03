import "../styles/authoring.css";
import { useEffect, useState, useCallback } from "react";
import { call, post, put, ApiError, type User } from "../api";
import { OrderAnswer, MultiAnswer } from "../components/AnswerInput";

/* Web authoring tool (spec 8.1): a form per question type, the same linter
   the shipped banks pass through (8.5), a learner-eye preview with real
   grading, submit for review, admin approval (3.5.5), asset registry and the
   approvals ledger. Drafts never touch the live banks. */

/* ---------- types mirrored from routes-cms.js ---------- */
export type QType = "mc" | "in" | "multi" | "order" | "pair";
export type QBody = {
  sec: string; type: QType; q: string; lvl: number; hint?: string; expl?: string; mono?: boolean;
  opts?: string[]; a?: number; aMulti?: number[]; ans?: number; ansP?: [number, number];
  items?: string[]; ansOrder?: string[];
};
export type DraftStatus = "draft" | "submitted" | "approved" | "changes_requested";
export type Draft = {
  id: string; kind: string; topicId: string | null; body: QBody; status: DraftStatus; version: number;
  reviewNote: string | null; reviewedBy: string | null; createdAt: string; updatedAt: string; author?: string;
};
export type Lint = { errors: string[]; warnings: string[] };
export type Meta = {
  kinds: string[]; sections: Record<string, string>; artKinds: string[]; types: string[];
  topics: { id: string; name: string; grade: string; unit: string }[];
};
export type PreviewQ = {
  question: { id: string; sec: string; secName: string; type: QType; q: string; opts?: string[]; items?: string[];
              mono: boolean; hint: string | null };
  hints: string[];
};
export type PreviewFb = { correct: boolean; correctAnswer: string; explanation: string };
export type Asset = { id: string; kind: string; name: string; tags: string[]; licence: string; author: string;
                      origin: string; format: string; artKind?: string };
export type Licence = { name: string; url: string | null; commercial: boolean; attribution: boolean };
export type ApprovalUnit = {
  id: string; kind: string; hash: string; items: number; state: "approved" | "changed" | "unapproved";
  version: number; approvedBy: string | null; role: string | null; at: string | null; educator: boolean;
};
export type Tab = "drafts" | "editor" | "assets" | "approvals";
export type AuthoringData = {
  role?: string; forbidden?: boolean; meta: Meta; drafts: Draft[]; tab?: Tab; allAuthors?: boolean;
  draft?: Draft | null; body?: QBody; topicId?: string; lint?: Lint | null; preview?: PreviewQ | null;
  previewFb?: PreviewFb | null; exportText?: string | null;
  assets?: { assets: Asset[]; licences: Record<string, Licence> } | null;
  approvals?: { ok: boolean; units: ApprovalUnit[]; problems: number } | null;
};

/* ---------- api helpers (paths relative to /api) ---------- */
const cms = {
  me:       () => call<{ user: (User & { role?: string }) | null }>("/auth/me"),
  meta:     () => call<Meta>("/cms/meta"),
  drafts:   (all: boolean) => call<{ drafts: Draft[] }>(`/cms/drafts${all ? "?all=1" : ""}`),
  lint:     (body: QBody, topicId?: string) => post<Lint>("/cms/lint", { kind: "question", body, topicId: topicId || undefined }),
  preview:  (body: QBody) => post<PreviewQ>("/cms/preview", { kind: "question", body }),
  answer:   (body: QBody, answer: unknown) => post<PreviewFb>("/cms/preview/answer", { kind: "question", body, answer }),
  create:   (body: QBody, topicId?: string) => post<{ draft: Draft; lint: Lint }>("/cms/drafts", { kind: "question", body, topicId: topicId || undefined }),
  update:   (id: string, body: QBody, topicId?: string) => put<{ draft: Draft; lint: Lint }>(`/cms/drafts/${encodeURIComponent(id)}`, { body, topicId: topicId || undefined }),
  submit:   (id: string) => post<{ draft: Draft; lint: Lint }>(`/cms/drafts/${encodeURIComponent(id)}/submit`),
  review:   (id: string, decision: "approved" | "changes_requested", note: string) =>
              post<{ draft: Draft }>(`/cms/drafts/${encodeURIComponent(id)}/review`, { decision, note }),
  exportOf: (id: string) => call<unknown>(`/cms/drafts/${encodeURIComponent(id)}/export`),
  assets:   () => call<{ assets: Asset[]; licences: Record<string, Licence> }>("/cms/assets"),
  approvals:() => call<{ ok: boolean; units: ApprovalUnit[]; problems: number }>("/cms/approvals")
};

const TIERS = [[1, "Practice"], [2, "Challenge"], [3, "Boss"]] as const;
const TYPE_NAME: Record<QType, string> = {
  mc: "Multiple choice", in: "Numeric answer", multi: "Select all that apply", order: "Put in order", pair: "Ordered pair (x, y)"
};
const STATUS_NAME: Record<string, string> = {
  draft: "Draft", submitted: "Awaiting review", approved: "Approved", changes_requested: "Changes requested"
};

export const NEW_BODY: QBody = { sec: "N", type: "mc", q: "", lvl: 1, hint: "", expl: "", mono: false, opts: ["", ""], a: 0 };

/* Switching type keeps the shared fields and resets the answer fields. */
function retype(b: QBody, type: QType): QBody {
  const base = { sec: b.sec, q: b.q, lvl: b.lvl, hint: b.hint, expl: b.expl, mono: b.mono, type };
  const opts = b.opts?.length ? b.opts : ["", ""];
  if (type === "mc") return { ...base, opts, a: 0 };
  if (type === "multi") return { ...base, opts, aMulti: [] };
  if (type === "in") return { ...base, ans: 0 };
  if (type === "pair") return { ...base, ansP: [0, 0] };
  const items = b.items?.length ? b.items : ["", "", ""];
  return { ...base, items, ansOrder: items };
}

function errorText(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Your session has ended. Sign in again.";
    if (e.status === 403) return "Only teacher and admin accounts can do that.";
    if (e.status === 409) return e.message === "approved_drafts_are_frozen" ? "Approved drafts are frozen. Start a new draft to change it." : "This draft is not awaiting review.";
    if (e.status === 400 && e.message === "lint_errors") return "Fix the lint errors before submitting.";
    if (e.status === 404) return "That draft no longer exists.";
  }
  return fallback;
}

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/* ================================================================ */
export function Authoring({ user, onBack, initial }: { user: User; onBack: () => void; initial?: AuthoringData }) {
  const [role, setRole] = useState<string>(initial?.role ?? (user as User & { role?: string }).role ?? "");
  const [meta, setMeta] = useState<Meta | null>(initial?.meta ?? null);
  const [drafts, setDrafts] = useState<Draft[] | null>(initial?.drafts ?? null);
  const [allAuthors, setAllAuthors] = useState(initial?.allAuthors ?? false);
  const [tab, setTab] = useState<Tab>(initial?.tab ?? "drafts");
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(initial?.forbidden ?? false);
  const [msg, setMsg] = useState("");

  /* editor */
  const [draft, setDraft] = useState<Draft | null>(initial?.draft ?? null);
  const [body, setBody] = useState<QBody>(initial?.body ?? initial?.draft?.body ?? NEW_BODY);
  const [topicId, setTopicId] = useState(initial?.topicId ?? initial?.draft?.topicId ?? "");
  const [lint, setLint] = useState<Lint | null>(initial?.lint ?? null);
  const [preview, setPreview] = useState<PreviewQ | null>(initial?.preview ?? null);
  const [previewFb, setPreviewFb] = useState<PreviewFb | null>(initial?.previewFb ?? null);
  const [exportText, setExportText] = useState<string | null>(initial?.exportText ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const [assets, setAssets] = useState<{ assets: Asset[]; licences: Record<string, Licence> } | null>(initial?.assets ?? null);
  const [approvals, setApprovals] = useState<{ ok: boolean; units: ApprovalUnit[]; problems: number } | null>(initial?.approvals ?? null);

  const fail = useCallback((e: unknown, fallback: string) => {
    if (e instanceof ApiError && e.status === 403) setForbidden(true);
    setError(errorText(e, fallback));
  }, []);

  /* boot: role, meta and the draft list together */
  useEffect(() => {
    if (initial) return;
    (async () => {
      try {
        const [me, m, d] = await Promise.all([cms.me(), cms.meta(), cms.drafts(false)]);
        setRole(me.user?.role || "");
        setMeta(m); setDrafts(d.drafts);
      } catch (e) { fail(e, "Could not load the authoring tool. Check the server is running."); }
    })();
  }, [initial, fail]);

  const reloadDrafts = useCallback(async (all: boolean) => {
    try { setDrafts((await cms.drafts(all)).drafts); }
    catch (e) { fail(e, "Could not load drafts."); }
  }, [fail]);

  /* live lint, debounced, whenever the form changes */
  useEffect(() => {
    if (tab !== "editor" || !meta) return;
    const t = setTimeout(() => {
      cms.lint(body, topicId).then(setLint).catch(() => { /* the save reports lint too */ });
    }, 350);
    return () => clearTimeout(t);
  }, [body, topicId, tab, meta]);

  useEffect(() => {
    if (tab === "assets" && !assets) cms.assets().then(setAssets).catch(e => fail(e, "Could not load the asset registry."));
    if (tab === "approvals" && !approvals) cms.approvals().then(setApprovals).catch(e => fail(e, "Could not load approvals."));
  }, [tab, assets, approvals, fail]);

  const patch = (p: Partial<QBody>) => { setBody(b => ({ ...b, ...p })); setPreview(null); setPreviewFb(null); };

  function openEditor(d: Draft | null) {
    setDraft(d); setBody(d ? d.body : NEW_BODY); setTopicId(d?.topicId || "");
    setLint(null); setPreview(null); setPreviewFb(null); setExportText(null); setNote(""); setMsg(""); setError("");
    setTab("editor");
  }

  async function save() {
    setBusy(true); setError(""); setMsg("");
    try {
      const r = draft ? await cms.update(draft.id, body, topicId) : await cms.create(body, topicId);
      setDraft(r.draft); setLint(r.lint);
      setDrafts(ds => [r.draft, ...(ds || []).filter(x => x.id !== r.draft.id)]);
      setMsg(`Saved as version ${r.draft.version}.`);
    } catch (e) { setError(errorText(e, "Could not save the draft.")); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!draft) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const r = await cms.submit(draft.id);
      setDraft(r.draft); setLint(r.lint);
      setDrafts(ds => (ds || []).map(x => x.id === r.draft.id ? r.draft : x));
      setMsg("Submitted for review.");
    } catch (e) { setError(errorText(e, "Could not submit the draft.")); }
    finally { setBusy(false); }
  }

  async function review(decision: "approved" | "changes_requested") {
    if (!draft) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const r = await cms.review(draft.id, decision, note);
      setDraft(r.draft);
      setDrafts(ds => (ds || []).map(x => x.id === r.draft.id ? r.draft : x));
      setMsg(decision === "approved" ? "Approved. The draft is now frozen." : "Changes requested. The author can edit and resubmit.");
    } catch (e) { setError(errorText(e, "Could not record the review.")); }
    finally { setBusy(false); }
  }

  async function doPreview() {
    setBusy(true); setError(""); setPreviewFb(null);
    try {
      const p = await cms.preview(body);
      if (p.question.items) p.question.items = shuffle(p.question.items);
      setPreview(p);
    } catch (e) { setError(errorText(e, "Could not build the preview.")); }
    finally { setBusy(false); }
  }

  async function doAnswer(answer: unknown) {
    setBusy(true); setError("");
    try { setPreviewFb(await cms.answer(body, answer)); }
    catch (e) { setError(errorText(e, "Could not grade that answer. Check the answer fields.")); }
    finally { setBusy(false); }
  }

  async function doExport() {
    if (!draft) return;
    setBusy(true); setError("");
    try { setExportText(JSON.stringify(await cms.exportOf(draft.id), null, 2)); }
    catch (e) { setError(errorText(e, "Could not export the draft.")); }
    finally { setBusy(false); }
  }

  /* ---------- gates ---------- */
  if (forbidden) {
    return (
      <>
        <button className="back" onClick={onBack}>← Back</button>
        <h1>Content authoring</h1>
        <p className="err" role="alert">Authoring is for teacher and admin accounts. Your account ({user.email}) is not an author. Ask an admin to change your role.</p>
      </>
    );
  }
  if (error && !meta) {
    return (
      <>
        <button className="back" onClick={onBack}>← Back</button>
        <h1>Content authoring</h1>
        <p className="err" role="alert">{error}</p>
      </>
    );
  }
  if (!meta || !drafts) {
    return (
      <>
        <button className="back" onClick={onBack}>← Back</button>
        <h1>Content authoring</h1>
        <div className="loading" role="status">Loading the authoring tool…</div>
      </>
    );
  }

  const isAdmin = role === "admin";
  const topicName = (id: string | null) => (id && meta.topics.find(t => t.id === id)?.name) || "No topic";
  const tabs: [Tab, string][] = [["drafts", "Drafts"], ["editor", draft ? "Editor" : "New draft"], ["assets", "Assets"], ["approvals", "Approvals"]];

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="au-head">
        <div>
          <div className="eyebrow">BeastForge</div>
          <h1>Content authoring</h1>
        </div>
        <span className="pill">{user.name} · {role || "author"}</span>
      </div>
      <p className="lede">Write questions, run the same checks the shipped banks pass, preview them as a learner, and send them for review.</p>

      <div className="tabs au-tabs" role="tablist" aria-label="Authoring sections">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" id={`au-tab-${id}`} aria-controls={`au-panel-${id}`} aria-selected={tab === id}
                  className={"tab" + (tab === id ? " on" : "")} onClick={() => { setTab(id); setError(""); setMsg(""); }}>
            {label}
          </button>
        ))}
      </div>

      {msg && <p className="notice" role="status">{msg}</p>}
      {error && <p className="err" role="alert">{error}</p>}

      {/* ---------------- drafts ---------------- */}
      {tab === "drafts" && (
        <section id="au-panel-drafts" role="tabpanel" aria-labelledby="au-tab-drafts">
          <h2>Drafts</h2>
          <div className="au-toolbar">
            <button className="btn" onClick={() => openEditor(null)}>New draft</button>
            {isAdmin && (
              <label className="checkline">
                <input type="checkbox" checked={allAuthors}
                       onChange={e => { setAllAuthors(e.target.checked); reloadDrafts(e.target.checked); }} />
                Show every author's drafts
              </label>
            )}
          </div>
          {!drafts.length && <p className="muted">No drafts yet. Start one with New draft.</p>}
          <ul className="au-list">
            {drafts.map(d => (
              <li className="drow" key={d.id}>
                <div className="dhead">
                  <b>{d.body?.q?.trim() || "(untitled question)"}</b>
                </div>
                <button className="btn ghost" onClick={() => openEditor(d)}>Open<span className="visually-hidden"> draft {d.body?.q?.trim() || d.id.slice(0, 8)}</span></button>
                <div className="dsub">
                  {d.kind} · {d.body?.type ? TYPE_NAME[d.body.type] : "unknown type"} · {topicName(d.topicId)} · updated {new Date(d.updatedAt).toLocaleDateString()}
                </div>
                <div className="pills">
                  <span className={"pill st-" + d.status}>{STATUS_NAME[d.status] || d.status}</span>
                  <span className="pill">v{d.version}</span>
                  <span className="pill">author: {d.author || (allAuthors ? "another author" : "you")}</span>
                  {d.reviewedBy && <span className="pill">reviewed{d.reviewNote ? `: ${d.reviewNote}` : ""}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------- editor ---------------- */}
      {tab === "editor" && (
        <section id="au-panel-editor" role="tabpanel" aria-labelledby="au-tab-editor" className="au-editor">
          <div className="card">
            <h2>{draft ? `Editing version ${draft.version}` : "New question"}</h2>
            {draft && (
              <div className="pills" style={{ marginTop: 0, marginBottom: 12 }}>
                <span className={"pill st-" + draft.status}>{STATUS_NAME[draft.status] || draft.status}</span>
                <span className="pill">{topicName(draft.topicId)}</span>
              </div>
            )}
            {draft?.status === "changes_requested" && draft.reviewNote && (
              <div className="au-note"><b>Reviewer note:</b> {draft.reviewNote}</div>
            )}
            {draft?.status === "approved" && <p className="notice">Approved drafts are frozen. Export it, or start a new draft to change it.</p>}

            <div className="field">
              <label htmlFor="au-type">Question type</label>
              <select id="au-type" value={body.type} onChange={e => { setBody(retype(body, e.target.value as QType)); setPreview(null); setPreviewFb(null); }}>
                {(["mc", "in", "multi", "order", "pair"] as QType[]).map(t => <option key={t} value={t}>{TYPE_NAME[t]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="au-q">Question text</label>
              <textarea id="au-q" rows={3} value={body.q} onChange={e => patch({ q: e.target.value })} />
            </div>
            <div className="au-row">
              <div className="field">
                <label htmlFor="au-topic">Topic</label>
                <select id="au-topic" value={topicId} onChange={e => { setTopicId(e.target.value); setPreview(null); }}>
                  <option value="">No topic yet</option>
                  {meta.topics.map(t => <option key={t.id} value={t.id}>{t.grade} · {t.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="au-sec">Section</label>
                <select id="au-sec" value={body.sec} onChange={e => patch({ sec: e.target.value })}>
                  {Object.entries(meta.sections).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
                </select>
              </div>
            </div>
            <div className="au-row">
              <div className="field">
                <label htmlFor="au-tier">Tier</label>
                <select id="au-tier" value={body.lvl} onChange={e => patch({ lvl: Number(e.target.value) })}>
                  {TIERS.map(([n, name]) => <option key={n} value={n}>{name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="checkline" htmlFor="au-mono">
                  <input id="au-mono" type="checkbox" checked={!!body.mono} onChange={e => patch({ mono: e.target.checked })} />
                  Show options in monospace (numbers, expressions)
                </label>
              </div>
            </div>

            <h3>Answer</h3>
            {(body.type === "mc" || body.type === "multi") && (
              <OptionsEditor body={body} onChange={patch} />
            )}
            {body.type === "in" && (
              <div className="field">
                <label htmlFor="au-ans">Correct number</label>
                <input id="au-ans" type="number" step="any" value={body.ans ?? ""}
                       onChange={e => patch({ ans: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </div>
            )}
            {body.type === "pair" && (
              <div className="au-row">
                <div className="field">
                  <label htmlFor="au-px">Correct x</label>
                  <input id="au-px" type="number" step="any" value={body.ansP?.[0] ?? ""}
                         onChange={e => patch({ ansP: [Number(e.target.value), body.ansP?.[1] ?? 0] })} />
                </div>
                <div className="field">
                  <label htmlFor="au-py">Correct y</label>
                  <input id="au-py" type="number" step="any" value={body.ansP?.[1] ?? ""}
                         onChange={e => patch({ ansP: [body.ansP?.[0] ?? 0, Number(e.target.value)] })} />
                </div>
              </div>
            )}
            {body.type === "order" && <ItemsEditor body={body} onChange={patch} />}

            <h3>Help for the learner</h3>
            <div className="field">
              <label htmlFor="au-hint">Hint (first rung of the hint ladder)</label>
              <input id="au-hint" type="text" value={body.hint || ""} onChange={e => patch({ hint: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="au-expl">Explanation shown after answering</label>
              <textarea id="au-expl" rows={3} value={body.expl || ""} onChange={e => patch({ expl: e.target.value })} />
            </div>

            <div className="au-actions">
              <button className="btn" disabled={busy || draft?.status === "approved"} onClick={save}>
                {draft ? "Save new version" : "Save draft"}
              </button>
              <button className="btn ghost" disabled={busy || !draft || !!lint?.errors.length || !["draft", "changes_requested"].includes(draft.status)} onClick={submit}>
                Submit for review
              </button>
              <button className="btn ghost" disabled={busy || !draft} onClick={doExport}>Export</button>
            </div>
            {!draft && <p className="muted" style={{ marginTop: 8, fontSize: ".88rem" }}>Save the draft first to submit or export it.</p>}

            {isAdmin && draft && (
              <div className="au-review">
                <h3>Review</h3>
                {draft.status !== "submitted" && <p className="muted" style={{ margin: 0 }}>Only submitted drafts can be reviewed. This one is {STATUS_NAME[draft.status]?.toLowerCase() || draft.status}.</p>}
                {draft.status === "submitted" && (
                  <>
                    <div className="field">
                      <label htmlFor="au-note">Note to the author</label>
                      <textarea id="au-note" rows={2} value={note} onChange={e => setNote(e.target.value)} />
                    </div>
                    <div className="au-actions" style={{ marginTop: 0 }}>
                      <button className="btn" disabled={busy} onClick={() => review("approved")}>Approve</button>
                      <button className="btn danger" disabled={busy} onClick={() => review("changes_requested")}>Request changes</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {exportText !== null && (
              <>
                <h3>Export</h3>
                <p className="muted" style={{ margin: 0, fontSize: ".88rem" }}>Source a maintainer can paste into a bank.</p>
                <pre className="au-pre" tabIndex={0} aria-label="Exported draft source">{exportText}</pre>
              </>
            )}
          </div>

          <div>
            <div className="card">
              <h2>Lint</h2>
              <div role="status" aria-live="polite">
                {!lint && <p className="muted" style={{ margin: 0 }}>Checking…</p>}
                {lint && !lint.errors.length && !lint.warnings.length && <p className="au-clean">All checks pass.</p>}
                {lint && (lint.errors.length > 0 || lint.warnings.length > 0) && (
                  <ul className="au-lint">
                    {lint.errors.map((e, i) => <li className="error" key={"e" + i}><b>Error</b>{e.replace(/^draft: /, "")}</li>)}
                    {lint.warnings.map((w, i) => <li className="warning" key={"w" + i}><b>Warning</b>{w.replace(/^draft: /, "")}</li>)}
                  </ul>
                )}
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <h2>Preview</h2>
              <p className="muted" style={{ marginTop: 0 }}>See the question exactly as a learner would, and try answering it.</p>
              <button className="btn ghost" disabled={busy} onClick={doPreview}>{preview ? "Refresh preview" : "Preview as a learner"}</button>
              {preview && (
                <div className="au-preview" style={{ marginTop: 14 }}>
                  <PreviewCard preview={preview} fb={previewFb} busy={busy} onAnswer={doAnswer} />
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- assets ---------------- */}
      {tab === "assets" && (
        <section id="au-panel-assets" role="tabpanel" aria-labelledby="au-tab-assets">
          <h2>Asset registry</h2>
          {!assets && !error && <div className="loading" role="status">Loading assets…</div>}
          {assets && (
            <>
              <p className="lede">Every visual the product ships, with its licence and origin. Lessons may only use art kinds listed here.</p>
              <ul className="au-list">
                {assets.assets.map(a => {
                  const lic = assets.licences[a.licence];
                  return (
                    <li className="drow au-asset" key={a.id}>
                      <div className="dhead"><b>{a.name}</b></div>
                      <span className="pill">{a.kind}</span>
                      <div className="dsub"><code className="au-hash">{a.id}</code> · {a.format} · by {a.author} · {a.origin}</div>
                      <div className="au-lic">
                        Licence: {lic ? <>{lic.url ? <a href={lic.url} target="_blank" rel="noreferrer">{lic.name}</a> : lic.name}
                          {lic.commercial ? " · commercial use allowed" : " · no commercial use"}{lic.attribution ? " · attribution required" : ""}</> : a.licence}
                      </div>
                      <div className="pills">{a.tags.map(t => <span className="pill" key={t}>{t}</span>)}</div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ---------------- approvals ---------------- */}
      {tab === "approvals" && (
        <section id="au-panel-approvals" role="tabpanel" aria-labelledby="au-tab-approvals">
          <h2>Content approvals</h2>
          {!approvals && !error && <div className="loading" role="status">Loading approvals…</div>}
          {approvals && (
            <>
              <p className="au-summary">
                <span className={"pill " + (approvals.ok ? "good" : "st-changed")}>{approvals.ok ? "Everything approved" : `${approvals.problems} unit${approvals.problems === 1 ? "" : "s"} need approval`}</span>
                <span className="muted">{approvals.units.length} units. A unit whose hash differs from its approved hash is not live until it is signed off again.</span>
              </p>
              <div className="scroll">
                <table className="au-table">
                  <caption className="visually-hidden">Approval state of every content unit</caption>
                  <thead>
                    <tr><th scope="col">Unit</th><th scope="col">Kind</th><th scope="col">Hash</th><th scope="col">Version</th><th scope="col">Approver</th><th scope="col">State</th></tr>
                  </thead>
                  <tbody>
                    {approvals.units.map(u => (
                      <tr key={u.id}>
                        <th scope="row">{u.id}<span className="dsub">{u.items} item{u.items === 1 ? "" : "s"}</span></th>
                        <td>{u.kind}</td>
                        <td><code>{u.hash}</code></td>
                        <td>{u.version || "none"}</td>
                        <td>{u.approvedBy ? <>{u.approvedBy}{u.role ? ` (${u.role})` : ""}{u.at ? <span className="dsub">{new Date(u.at).toLocaleDateString()}</span> : null}</> : <span className="muted">nobody yet</span>}</td>
                        <td><span className={"pill st-" + u.state}>{u.state}</span>{u.educator && <span className="pill good" style={{ marginLeft: 6 }}>educator</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}

/* ---------- option list for mc / multi ---------- */
function OptionsEditor({ body, onChange }: { body: QBody; onChange: (p: Partial<QBody>) => void }) {
  const opts = body.opts || [];
  const multi = body.type === "multi";
  const isCorrect = (i: number) => multi ? (body.aMulti || []).includes(i) : body.a === i;
  const setOpt = (i: number, v: string) => onChange({ opts: opts.map((o, k) => k === i ? v : o) });
  const mark = (i: number, on: boolean) => {
    if (!multi) return onChange({ a: i });
    const cur = new Set(body.aMulti || []);
    if (on) cur.add(i); else cur.delete(i);
    onChange({ aMulti: [...cur].sort((x, y) => x - y) });
  };
  const remove = (i: number) => {
    const next = opts.filter((_, k) => k !== i);
    if (multi) onChange({ opts: next, aMulti: (body.aMulti || []).filter(k => k !== i).map(k => k > i ? k - 1 : k) });
    else onChange({ opts: next, a: body.a === undefined ? 0 : body.a > i ? body.a - 1 : body.a === i ? 0 : body.a });
  };
  return (
    <>
      <p className="muted" style={{ marginTop: 0, fontSize: ".88rem" }}>
        {multi ? "Tick every option that is correct." : "Choose the one correct option."}
      </p>
      <ul className="au-opts">
        {opts.map((o, i) => (
          <li className={"au-opt" + (isCorrect(i) ? " correct" : "")} key={i}>
            <span className="key" aria-hidden="true">{i + 1}</span>
            <input type="text" id={`au-opt-${i}`} aria-label={`Option ${i + 1}`} value={o} onChange={e => setOpt(i, e.target.value)} />
            <span className="au-optbtns">
              <label className="checkline">
                <input type={multi ? "checkbox" : "radio"} name="au-correct" checked={isCorrect(i)} onChange={e => mark(i, e.target.checked)} />
                Correct
              </label>
              <button type="button" className="au-small" disabled={opts.length <= 2} onClick={() => remove(i)}
                      aria-label={`Remove option ${i + 1}`}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="au-actions" style={{ marginTop: 10 }}>
        <button type="button" className="au-small" disabled={opts.length >= 6} onClick={() => onChange({ opts: [...opts, ""] })}>Add option</button>
      </div>
    </>
  );
}

/* ---------- item list for order: entered in the correct order ---------- */
function ItemsEditor({ body, onChange }: { body: QBody; onChange: (p: Partial<QBody>) => void }) {
  const items = body.items || [];
  const set = (next: string[]) => onChange({ items: next, ansOrder: next });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; set(next);
  };
  return (
    <>
      <p className="muted" style={{ marginTop: 0, fontSize: ".88rem" }}>Enter the items in the correct order. Learners see them shuffled.</p>
      <ol className="au-opts">
        {items.map((it, i) => (
          <li className="au-opt" key={i}>
            <span className="key" aria-hidden="true">{i + 1}</span>
            <input type="text" id={`au-item-${i}`} aria-label={`Item ${i + 1}`} value={it} onChange={e => set(items.map((x, k) => k === i ? e.target.value : x))} />
            <span className="au-optbtns">
              <button type="button" className="movebtn" disabled={i === 0} aria-label={`Move item ${i + 1} up`} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="movebtn" disabled={i === items.length - 1} aria-label={`Move item ${i + 1} down`} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="au-small" disabled={items.length <= 3} aria-label={`Remove item ${i + 1}`}
                      onClick={() => set(items.filter((_, k) => k !== i))}>Remove</button>
            </span>
          </li>
        ))}
      </ol>
      <div className="au-actions" style={{ marginTop: 10 }}>
        <button type="button" className="au-small" disabled={items.length >= 8} onClick={() => set([...items, ""])}>Add item</button>
      </div>
    </>
  );
}

/* ---------- the learner's view of the draft, graded by the server ---------- */
function PreviewCard({ preview, fb, busy, onAnswer }: {
  preview: PreviewQ; fb: PreviewFb | null; busy: boolean; onAnswer: (a: unknown) => void;
}) {
  const q = preview.question;
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => { setTyped(""); setPicked(null); }, [preview]);
  const correctIdx = fb && q.opts ? q.opts.indexOf(fb.correctAnswer) : -1;

  return (
    <>
      <div className="sec">{q.secName}</div>
      <p className="qtext">{q.q || "(no question text yet)"}</p>

      {q.type === "order" ? (
        <OrderAnswer items={q.items || []} disabled={!!fb || busy} onSubmit={onAnswer} />
      ) : q.type === "multi" ? (
        <MultiAnswer opts={q.opts || []} disabled={!!fb || busy} onSubmit={onAnswer} />
      ) : q.type === "mc" ? (
        <div className="opts">
          {(q.opts || []).map((o, i) => (
            <button key={i} type="button"
              className={"opt" + (q.mono ? " mono" : "") + (fb ? (i === correctIdx ? " right" : i === picked ? " wrong" : " dim") : "")}
              disabled={!!fb || busy}
              onClick={() => { setPicked(i); onAnswer(i); }}>
              <span className="key" aria-hidden="true">{i + 1}</span>{o || `(option ${i + 1} is blank)`}
              {fb && i === correctIdx && <span className="mark">✓<span className="visually-hidden"> correct answer</span></span>}
              {fb && i === picked && i !== correctIdx && <span className="mark">✗<span className="visually-hidden"> your answer, incorrect</span></span>}
            </button>
          ))}
        </div>
      ) : (
        <div className="inrow">
          <input className="ansin" value={typed} disabled={!!fb || busy} aria-label="Your answer"
            placeholder={q.type === "pair" ? "(x, y)" : "Your answer"}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && typed.trim()) onAnswer(typed); }} />
          <button type="button" className="btn" disabled={!!fb || !typed.trim() || busy} onClick={() => onAnswer(typed)}>Check</button>
        </div>
      )}

      {preview.hints.length > 0 && (
        <div className="hintbox"><b>Hint ladder.</b>
          <ol style={{ margin: "6px 0 0", paddingLeft: "1.3em" }}>{preview.hints.map((h, i) => <li key={i}>{h}</li>)}</ol>
        </div>
      )}

      {fb && (
        <div className={"fb" + (fb.correct ? "" : " bad")} role="status" aria-live="polite">
          <h3>{fb.correct ? "Correct!" : `Not quite. The answer is ${fb.correctAnswer}`}</h3>
          <p className="expl">{fb.explanation || "(no explanation yet)"}</p>
        </div>
      )}
    </>
  );
}
