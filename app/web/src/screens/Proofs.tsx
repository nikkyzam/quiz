import "../styles/proofs.css";
import { useEffect, useState, useCallback } from "react";
import { api, call, post, ApiError, type Learner } from "../api";
import { Beast } from "../beasts";
import { ReadAloud } from "../components/ReadAloud";

/* Proof trainer (spec 3.2.5, 4.1.10).

   Four exercise kinds come from the server: put steps in order, match each
   step to its reason, fill in a missing step, or write the proof in your own
   words and have it marked against a rubric. Checking is structural and the
   feedback names which step (or rubric point) needs another look, never the
   answer itself. */

export type Curriculum = Awaited<ReturnType<typeof api.curriculum>>;

export type ProofKind = "order" | "reasons" | "blanks" | "freeform";
export type ProofSummary = { id: string; grade: number; kind: ProofKind; claim: string };
export type Template = { name: string; when: string; scaffold: string[] };
export type ProofStep = { key: string; text?: string; blank?: boolean; options?: string[] };
export type PublicProof = {
  id: string; grade: number; kind: ProofKind; claim: string; instruction: string;
  template: ({ id: string } & Template) | null;
  steps?: ProofStep[];
  reasonBank?: string[];
  hint?: string | null;
  rubric?: { key: string; must: string }[];
  referenceLines?: number;
};
export type ProofResult = {
  correct: boolean; points: number; attempts: number; kind: ProofKind;
  firstWrongPosition?: number | null;            /* order */
  wrongSteps?: string[];                         /* reasons, blanks */
  missing?: { key: string; must: string }[];     /* freeform */
  lines?: number; elegant?: boolean; note?: string | null;
};
export type Completed = { proofId: string; at: string };
export type ActiveProof = {
  sessionId: string; proof: PublicProof; result: ProofResult | null;
  prefill?: string[];                            /* freeform lines from a template */
};
export type ProofsData = {
  kinds: Record<string, string>;
  proofs: ProofSummary[];
  completed: Completed[];
  templates: Record<string, Template>;
  active?: ActiveProof | null;
};

const proofsApi = {
  list: () => call<{ kinds: Record<string, string>; proofs: ProofSummary[] }>("/proofs"),
  forTopic: (topicId: string) =>
    call<{ proofs: ProofSummary[] }>(`/topics/${encodeURIComponent(topicId)}/proofs`),
  templates: () => call<{ templates: Record<string, Template> }>("/proofs/templates"),
  completed: (learnerId: string) =>
    call<{ completed: Completed[] }>(`/learners/${encodeURIComponent(learnerId)}/proofs`),
  start: (proofId: string, learnerId: string) =>
    post<{ sessionId: string; proof: PublicProof }>(`/proofs/${encodeURIComponent(proofId)}/start`, { learnerId }),
  submit: (sessionId: string, submission: unknown) =>
    post<ProofResult>("/proofs/submit", { sessionId, submission })
};

const KIND_LABEL: Record<ProofKind, string> = {
  order: "Put the steps in order",
  reasons: "Match each step to its reason",
  blanks: "Fill in the missing step",
  freeform: "Write the proof in your own words"
};

function failMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403))
    return "You need to be signed in as this learner's grown-up to do that.";
  return fallback;
}

export function Proofs({ learner, cur, onBack, initial }: {
  learner: Learner; cur: Curriculum; onBack: () => void; initial?: ProofsData;
}) {
  const [data, setData] = useState<ProofsData | null>(initial ?? null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<ActiveProof | null>(initial?.active ?? null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [topicIds, setTopicIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (initial) return;
    Promise.all([proofsApi.list(), proofsApi.completed(learner.id), proofsApi.templates()])
      .then(([l, c, t]) => setData({ kinds: l.kinds, proofs: l.proofs, completed: c.completed, templates: t.templates }))
      .catch(e => setError(failMessage(e, "Couldn't load the proof trainer. Check the server is running.")));
  }, [learner.id, initial]);

  useEffect(() => {
    if (!topicFilter) { setTopicIds(null); return; }
    let live = true;
    proofsApi.forTopic(topicFilter)
      .then(r => { if (live) setTopicIds(r.proofs.map(p => p.id)); })
      .catch(() => { if (live) setTopicIds([]); });
    return () => { live = false; };
  }, [topicFilter]);

  const refreshCompleted = useCallback(async () => {
    try {
      const r = await proofsApi.completed(learner.id);
      setData(d => (d ? { ...d, completed: r.completed } : d));
    } catch { /* the local mark is already in place */ }
  }, [learner.id]);

  async function start(proofId: string, prefill?: string[]) {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const r = await proofsApi.start(proofId, learner.id);
      setActive({ sessionId: r.sessionId, proof: r.proof, result: null, prefill });
    } catch (e) { setNotice(failMessage(e, "Couldn't start that proof. Try again in a moment.")); }
    finally { setBusy(false); }
  }

  async function submit(submission: unknown) {
    if (!active || busy) return;
    setBusy(true); setNotice("");
    try {
      const r = await proofsApi.submit(active.sessionId, submission);
      setActive(a => (a ? { ...a, result: r } : a));
      if (r.correct) {
        const id = active.proof.id;
        setData(d => d && !d.completed.some(c => c.proofId === id)
          ? { ...d, completed: [{ proofId: id, at: new Date().toISOString() }, ...d.completed] } : d);
        refreshCompleted();
      }
    } catch (e) { setNotice(failMessage(e, "Couldn't check that proof. Try again in a moment.")); }
    finally { setBusy(false); }
  }

  /* "Use this template" from the library: open a freeform proof of that
     shape with the scaffold already in the lines. */
  function useTemplate(id: string, t: Template) {
    if (active && active.proof.kind === "freeform") {
      setActive({ ...active, prefill: [...t.scaffold], result: null });
      return;
    }
    const free = (data?.proofs || []).filter(p => p.kind === "freeform");
    const done = new Set((data?.completed || []).map(c => c.proofId));
    const pick = free.find(p => p.id.includes(id)) || free.find(p => !done.has(p.id)) || free[0];
    if (!pick) { setNotice("There is no proof to write yet. Templates are still handy for planning."); return; }
    start(pick.id, [...t.scaffold]);
  }

  if (error) return <><button className="back" onClick={onBack}>← Back</button><p className="err" role="alert">{error}</p></>;
  if (!data) return <div className="loading" role="status">Loading the proof trainer…</div>;

  if (active) {
    const template = active.proof.template ? { [active.proof.template.id]: active.proof.template } : {};
    return (
      <>
        <button className="back" onClick={() => setActive(null)}>← Back to proofs</button>
        <div className="pf-head">
          <Beast kind={learner.beast} size={48}
                 mood={active.result ? (active.result.correct ? "happy" : "thinking") : "idle"} />
          <div>
            <div className="eyebrow">Proof trainer · {gradeLabel(cur, active.proof.grade)}</div>
            <h1 className="pf-title">{KIND_LABEL[active.proof.kind] || active.proof.instruction}</h1>
          </div>
        </div>
        <div className="card">
          <h2 className="pf-claim">{active.proof.claim}</h2>
          <ReadAloud text={active.proof.claim} />
          <ProofExercise key={active.sessionId + (active.prefill ? active.prefill.join("|") : "")}
                         proof={active.proof} result={active.result} busy={busy}
                         prefill={active.prefill}
                         templates={{ ...template, ...data.templates }}
                         onSubmit={submit} />
          {notice && <p className="err" role="alert">{notice}</p>}
          {active.result && (
            <ProofFeedback result={active.result} proof={active.proof}
                           onDone={() => setActive(null)} />
          )}
        </div>
      </>
    );
  }

  return (
    <ProofLibrary learner={learner} cur={cur} data={data} busy={busy} notice={notice}
                  topicFilter={topicFilter} topicIds={topicIds}
                  onTopicFilter={setTopicFilter} onBack={onBack}
                  onStart={id => start(id)} onUseTemplate={useTemplate} />
  );
}

function gradeLabel(cur: Curriculum, grade: number) {
  const key = grade === 0 ? "K" : String(grade);
  return cur?.curriculum?.[key]?.label || (grade === 0 ? "Kindergarten" : `Grade ${grade}`);
}

/* ---------------- library ---------------- */

function ProofLibrary({ learner, cur, data, busy, notice, topicFilter, topicIds, onTopicFilter, onBack, onStart, onUseTemplate }: {
  learner: Learner; cur: Curriculum; data: ProofsData; busy: boolean; notice: string;
  topicFilter: string; topicIds: string[] | null;
  onTopicFilter: (id: string) => void; onBack: () => void;
  onStart: (id: string) => void; onUseTemplate: (id: string, t: Template) => void;
}) {
  const done = new Set(data.completed.map(c => c.proofId));
  const visible = data.proofs.filter(p => !topicIds || topicIds.includes(p.id));
  const byGrade = new Map<number, ProofSummary[]>();
  visible.forEach(p => { byGrade.set(p.grade, [...(byGrade.get(p.grade) || []), p]); });
  const grades = [...byGrade.keys()].sort((a, b) => a - b);
  const topics: { id: string; name: string; grade: string }[] = [];
  Object.values(cur?.curriculum || {}).forEach(g =>
    g.units.forEach(u => u.topics.forEach(t => topics.push({ id: t.id, name: t.name, grade: g.label }))));

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="pf-head">
        <Beast kind={learner.beast} size={48} />
        <div>
          <div className="eyebrow">Proof trainer</div>
          <h1 className="pf-title">Prove it</h1>
        </div>
      </div>
      <p className="lede">
        Show why something is true, one step at a time. Start by putting steps in order,
        then match reasons, then write proofs of your own.
      </p>

      <div className="statgrid">
        <div className="stat"><b>{done.size}</b><span>Proved</span></div>
        <div className="stat"><b>{data.proofs.length}</b><span>Proofs</span></div>
        <div className="stat"><b>{Object.keys(data.templates).length}</b><span>Templates</span></div>
      </div>

      {topics.length > 0 && (
        <div className="field pf-filter">
          <label htmlFor="pf-topic">Show proofs for a topic</label>
          <select id="pf-topic" className="pf-select" value={topicFilter} onChange={e => onTopicFilter(e.target.value)}>
            <option value="">All topics</option>
            {topics.map(t => <option key={t.id} value={t.id}>{t.grade} · {t.name}</option>)}
          </select>
        </div>
      )}

      {notice && <p className="err" role="alert">{notice}</p>}

      {grades.length === 0 && (
        <p className="muted" role="status">
          {topicFilter ? "No proofs for that topic yet. Pick another, or show all topics." : "No proofs to show yet."}
        </p>
      )}

      {grades.map(g => (
        <section key={g} className="pf-grade" aria-labelledby={`pf-grade-${g}`}>
          <h2 id={`pf-grade-${g}`} className="pf-h2">
            <Beast kind={cur?.curriculum?.[String(g)]?.beast || learner.beast} size={28} still />
            {gradeLabel(cur, g)}
          </h2>
          <ul className="pf-list">
            {byGrade.get(g)!.map(p => (
              <li key={p.id} className="drow pf-row">
                <div>
                  <div className="dhead"><b>{p.claim}</b></div>
                  <div className="dsub">{data.kinds[p.kind] || KIND_LABEL[p.kind]}</div>
                  <div className="pills">
                    <span className="badge">{p.kind === "freeform" ? "write it" : p.kind === "blanks" ? "fill in" : p.kind}</span>
                    {done.has(p.id)
                      ? <span className="pill good">Proved ✓</span>
                      : <span className="pill dim">Not yet</span>}
                  </div>
                </div>
                <button className={"btn" + (done.has(p.id) ? " ghost" : "")} disabled={busy}
                        onClick={() => onStart(p.id)} aria-label={`${done.has(p.id) ? "Prove again" : "Start"}: ${p.claim}`}>
                  {done.has(p.id) ? "Again" : "Start"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <TemplatePanel templates={data.templates} onUse={onUseTemplate} />
    </>
  );
}

/* Template library (4.1.10): the shape of each kind of argument. */
function TemplatePanel({ templates, onUse, compact }: {
  templates: Record<string, Template>; onUse: (id: string, t: Template) => void; compact?: boolean;
}) {
  const ids = Object.keys(templates);
  if (!ids.length) return null;
  const Heading = compact ? "h3" : "h2";
  return (
    <section className="pf-templates" aria-labelledby="pf-tpl-h">
      <Heading id="pf-tpl-h" className={compact ? "pf-h3" : "pf-h2"}>Proof templates</Heading>
      {!compact && <p className="muted pf-tplintro">Every proof has a shape. Pick one and it fills in the first lines for you.</p>}
      <ul className="pf-tpllist">
        {ids.map(id => {
          const t = templates[id];
          return (
            <li key={id} className="pf-tpl">
              <div className="pf-tplbody">
                <b className="pf-tplname">{t.name}</b>
                <p className="pf-tplwhen">{t.when}</p>
                <ol className="pf-scaffold">
                  {t.scaffold.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
              <button className="btn ghost" onClick={() => onUse(id, t)} aria-label={`Use this template: ${t.name}`}>
                Use this template
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------- exercises ---------------- */

function ProofExercise({ proof, result, busy, prefill, templates, onSubmit }: {
  proof: PublicProof; result: ProofResult | null; busy: boolean; prefill?: string[];
  templates: Record<string, Template>;
  onSubmit: (submission: unknown) => void;
}) {
  const locked = busy || !!result?.correct;
  if (proof.kind === "order")
    return <OrderExercise steps={proof.steps || []} disabled={locked} result={result} onSubmit={onSubmit} />;
  if (proof.kind === "reasons")
    return <ReasonsExercise steps={proof.steps || []} bank={proof.reasonBank || []} disabled={locked} result={result} onSubmit={onSubmit} />;
  if (proof.kind === "freeform")
    return <FreeformExercise proof={proof} disabled={locked} result={result} prefill={prefill}
                             templates={templates} onSubmit={onSubmit} />;
  return <BlanksExercise steps={proof.steps || []} disabled={locked} result={result} onSubmit={onSubmit} />;
}

/* Order: move up/down buttons for keyboard and touch, plus drag-and-drop for
   a mouse. Both change the same list. */
function OrderExercise({ steps, disabled, result, onSubmit }: {
  steps: ProofStep[]; disabled: boolean; result: ProofResult | null; onSubmit: (s: unknown) => void;
}) {
  const [list, setList] = useState<ProofStep[]>(steps);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  useEffect(() => setList(steps), [steps]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  const dropOn = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) return;
    const from = list.findIndex(s => s.key === dragKey);
    const to = list.findIndex(s => s.key === targetKey);
    if (from < 0 || to < 0) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setList(next);
  };
  const clearDrag = () => { setDragKey(null); setOverKey(null); };
  const firstWrong = result && !result.correct ? result.firstWrongPosition ?? null : null;

  return (
    <div className="orderbox">
      <p className="muted pf-help">
        Use the arrows (or drag a step) to put the argument in order, then check.
      </p>
      <ol className="pf-steps">
        {list.map((s, i) => {
          const state = result?.correct ? "right" : firstWrong === null ? "" : i < firstWrong ? "right" : i === firstWrong ? "wrong" : "";
          return (
            <li key={s.key}
                className={"pf-step" + (state ? " " + state : "") + (dragKey === s.key ? " dragging" : "") + (overKey === s.key ? " over" : "")}
                draggable={!disabled}
                onDragStart={e => { setDragKey(s.key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.key); }}
                onDragOver={e => { if (disabled) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overKey !== s.key) setOverKey(s.key); }}
                onDragLeave={() => { if (overKey === s.key) setOverKey(null); }}
                onDrop={e => { e.preventDefault(); dropOn(s.key); clearDrag(); }}
                onDragEnd={clearDrag}>
              <span className="orderpos" aria-hidden="true">{i + 1}</span>
              <span className="pf-steptext">
                <span className="visually-hidden">Step {i + 1}. </span>{s.text}
                {state === "wrong" && <span className="tag">look again</span>}
              </span>
              <span className="orderbtns">
                <button type="button" className="movebtn" disabled={disabled || i === 0}
                        aria-label={`Move step ${i + 1} up`} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="movebtn" disabled={disabled || i === list.length - 1}
                        aria-label={`Move step ${i + 1} down`} onClick={() => move(i, 1)}>↓</button>
              </span>
            </li>
          );
        })}
      </ol>
      <button className="btn" disabled={disabled} onClick={() => onSubmit({ order: list.map(s => s.key) })}>
        Check this order
      </button>
    </div>
  );
}

/* Reasons: every step picks its justification from the reason bank. */
function ReasonsExercise({ steps, bank, disabled, result, onSubmit }: {
  steps: ProofStep[]; bank: string[]; disabled: boolean; result: ProofResult | null; onSubmit: (s: unknown) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const wrong = new Set(result && !result.correct ? result.wrongSteps || [] : []);
  const complete = steps.every(s => reasons[s.key]);

  return (
    <div className="orderbox">
      <p className="muted pf-help">Pick the reason that supports each step, then check.</p>
      <ol className="pf-steps">
        {steps.map((s, i) => {
          const state = result?.correct ? "right" : wrong.has(s.key) ? "wrong" : result && !result.correct ? "right" : "";
          return (
            <li key={s.key} className={"pf-step pf-step-reason" + (state ? " " + state : "")}>
              <span className="orderpos" aria-hidden="true">{i + 1}</span>
              <span className="pf-steptext">
                <span className="visually-hidden">Step {i + 1}. </span>{s.text}
                {state === "wrong" && <span className="tag">look again</span>}
              </span>
              <span className="pf-reasonpick">
                <label htmlFor={`pf-reason-${s.key}`} className="visually-hidden">Reason for step {i + 1}</label>
                <select id={`pf-reason-${s.key}`} className="pf-select" value={reasons[s.key] || ""} disabled={disabled}
                        onChange={e => setReasons(r => ({ ...r, [s.key]: e.target.value }))}>
                  <option value="">Choose a reason…</option>
                  {bank.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </span>
            </li>
          );
        })}
      </ol>
      <button className="btn" disabled={disabled || !complete} onClick={() => onSubmit({ reasons })}>
        Check my reasons
      </button>
    </div>
  );
}

/* Blanks: the argument is given with one step missing; choose it. */
function BlanksExercise({ steps, disabled, result, onSubmit }: {
  steps: ProofStep[]; disabled: boolean; result: ProofResult | null; onSubmit: (s: unknown) => void;
}) {
  const [picked, setPicked] = useState<Record<string, number>>({});
  const wrong = new Set(result && !result.correct ? result.wrongSteps || [] : []);
  const blanks = steps.filter(s => s.blank);
  const complete = blanks.every(b => picked[b.key] !== undefined);

  return (
    <div className="orderbox">
      <p className="muted pf-help">One step is missing. Choose the one that makes the argument work.</p>
      <ol className="pf-steps">
        {steps.map((s, i) => {
          if (!s.blank) return (
            <li key={s.key} className="pf-step">
              <span className="orderpos" aria-hidden="true">{i + 1}</span>
              <span className="pf-steptext"><span className="visually-hidden">Step {i + 1}. </span>{s.text}</span>
            </li>
          );
          const state = result?.correct ? "right" : wrong.has(s.key) ? "wrong" : "";
          return (
            <li key={s.key} className={"pf-step pf-step-blank" + (state ? " " + state : "")}>
              <span className="orderpos" aria-hidden="true">{i + 1}</span>
              <fieldset className="pf-blank">
                <legend className="pf-legend">
                  Step {i + 1}: choose the missing step
                  {state === "wrong" && <span className="tag">look again</span>}
                </legend>
                {(s.options || []).map((o, oi) => (
                  <label key={oi} className={"pf-option" + (picked[s.key] === oi ? " on" : "")}>
                    <input type="radio" name={`pf-blank-${s.key}`} value={oi} disabled={disabled}
                           checked={picked[s.key] === oi} onChange={() => setPicked(p => ({ ...p, [s.key]: oi }))} />
                    <span>{o}</span>
                  </label>
                ))}
              </fieldset>
            </li>
          );
        })}
      </ol>
      <button className="btn" disabled={disabled || !complete} onClick={() => onSubmit({ blanks: picked })}>
        Check my step
      </button>
    </div>
  );
}

/* Freeform: one textarea per line. The server marks each rubric point, in
   order, and says which it could not find. */
function FreeformExercise({ proof, disabled, result, prefill, templates, onSubmit }: {
  proof: PublicProof; disabled: boolean; result: ProofResult | null; prefill?: string[];
  templates: Record<string, Template>;
  onSubmit: (s: unknown) => void;
}) {
  const startLines = prefill && prefill.length ? prefill : Array.from({ length: proof.referenceLines || 3 }, () => "");
  const [lines, setLines] = useState<string[]>(startLines);
  const [showHint, setShowHint] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const rubric = proof.rubric || [];
  const missing = new Set(result && !result.correct ? (result.missing || []).map(m => m.key) : []);
  const filled = lines.some(l => l.trim());

  const setLine = (i: number, v: string) => setLines(ls => ls.map((l, j) => (j === i ? v : l)));
  const own = proof.template ? { [proof.template.id]: proof.template } : {};
  const all = { ...own, ...templates };

  return (
    <div className="pf-free">
      <p className="muted pf-help">Write one idea per line. Say what you know, what you do with it, and what that shows.</p>

      <div className="pf-rubricbox">
        <h3 className="pf-h3">Your proof must</h3>
        <ul className="pf-rubric">
          {rubric.map(r => {
            const state = !result ? "" : missing.has(r.key) ? "miss" : "hit";
            return (
              <li key={r.key} className={"pf-rubricitem" + (state ? " " + state : "")}>
                <span className="pf-mark" aria-hidden="true">{state === "hit" ? "✓" : state === "miss" ? "!" : "•"}</span>
                <span>
                  {r.must}
                  {state === "hit" && <span className="visually-hidden"> (found)</span>}
                  {state === "miss" && <span className="tag">not found yet</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="pf-tools">
        {proof.hint && (
          <button type="button" className="linkbtn" onClick={() => setShowHint(true)} disabled={showHint}>
            {showHint ? "Hint shown" : "Need a hint?"}
          </button>
        )}
        <button type="button" className="linkbtn" onClick={() => setShowTemplates(v => !v)}
                aria-expanded={showTemplates} aria-controls="pf-tplpanel">
          {showTemplates ? "Hide templates" : "Proof templates"}
        </button>
      </div>
      {showHint && proof.hint && (
        <div className="hintbox" role="status" aria-live="polite"><b>Hint.</b> {proof.hint}</div>
      )}
      <div id="pf-tplpanel" hidden={!showTemplates}>
        {proof.template && (
          <p className="muted pf-help">This claim suits a <b>{proof.template.name.toLowerCase()}</b>: {proof.template.when}</p>
        )}
        <TemplatePanel compact templates={all}
                       onUse={(_id, t) => {
                         if (filled && typeof window !== "undefined" && !window.confirm("Replace what you have written with the template?")) return;
                         setLines([...t.scaffold]); setShowTemplates(false);
                       }} />
      </div>

      <div className="pf-lines">
        {lines.map((l, i) => (
          <div key={i} className="field pf-linefield">
            <label htmlFor={`pf-line-${i}`}>Line {i + 1}</label>
            <textarea id={`pf-line-${i}`} className="pf-line" rows={2} value={l} disabled={disabled}
                      onChange={e => setLine(i, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="pf-linebtns">
        <button type="button" className="btn ghost" disabled={disabled || lines.length >= 12}
                onClick={() => setLines(ls => [...ls, ""])}>+ Add a line</button>
        <button type="button" className="btn ghost" disabled={disabled || lines.length <= 1}
                onClick={() => setLines(ls => ls.slice(0, -1))}>Remove last line</button>
        <button className="btn" disabled={disabled || !filled}
                onClick={() => onSubmit({ lines: lines.map(l => l.trim()).filter(Boolean) })}>
          Check my proof
        </button>
      </div>
      <p className="muted pf-fine">
        Marking is by rubric: each point must appear, in order, on its own line. A correct proof written in an
        unusual way may need rewording.
      </p>
    </div>
  );
}

/* ---------------- result ---------------- */

function ProofFeedback({ result, proof, onDone }: { result: ProofResult; proof: PublicProof; onDone: () => void }) {
  let detail: string;
  if (result.correct) {
    detail = proof.kind === "freeform"
      ? (result.elegant ? `Every point found in ${result.lines} line${result.lines === 1 ? "" : "s"}. That is as short as it gets: elegance bonus.`
                        : `Every point found, in the right order, in ${result.lines} lines.`)
      : proof.kind === "order" ? "Every step is in the right place."
      : proof.kind === "reasons" ? "Every step has a reason that supports it."
      : "That is the step that makes the argument work.";
  } else if (proof.kind === "order") {
    const p = result.firstWrongPosition ?? 0;
    detail = p === 0 ? "Start from the very first step: which one sets everything up?"
           : `The first ${p} step${p === 1 ? " is" : "s are"} in a good order. Look again from step ${p + 1}.`;
  } else if (proof.kind === "freeform") {
    const n = result.missing?.length || 0;
    detail = `${n} point${n === 1 ? "" : "s"} could not be found yet. ${result.note || ""}`.trim();
  } else {
    const ws = (result.wrongSteps || []).map(k => Number(k) + 1);
    detail = ws.length ? `Look again at step${ws.length === 1 ? "" : "s"} ${ws.join(", ")}.` : "Something is not right yet.";
  }
  return (
    <>
      <div className={"fb" + (result.correct ? "" : " bad")} role="status" aria-live="polite">
        <h3>{result.correct ? "Proved it!" : "Not there yet"}</h3>
        <p className="expl">{detail}</p>
        <p className="expl pf-fine">
          {result.correct ? `+${result.points} points · ` : ""}
          attempt {result.attempts}
        </p>
      </div>
      <div className="endbtns">
        {result.correct
          ? <button className="btn" onClick={onDone}>Back to proofs</button>
          : <span className="muted pf-fine">Change your answer above and check again.</span>}
      </div>
    </>
  );
}
