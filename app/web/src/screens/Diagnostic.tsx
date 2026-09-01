import { useEffect, useState } from "react";
import { api, type Question, type Learner, type DiagnosticSummary } from "../api";
import { Grid } from "../beasts";

/* Placement diagnostic. The server decides which question comes next and
   when to stop, so this screen only renders and submits. */
export function Diagnostic({ learner, topicId, topicName, onDone, onExit }: {
  learner: Learner; topicId: string; topicName: string;
  onDone: () => void; onExit: () => void;
}) {
  const [id, setId] = useState<string | null>(null);
  const [q, setQ] = useState<Question | null>(null);
  const [asked, setAsked] = useState(0);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.startDiagnostic(learner.id, topicId)
      .then(r => { setId(r.diagnosticId); setQ(r.question); })
      .catch(() => setError("Couldn't start the placement check."));
  }, [learner.id, topicId]);

  async function send(answer: unknown) {
    if (!id || busy) return;
    setBusy(true);
    try {
      const r = await api.answerDiagnostic(id, answer);
      if (r.done && r.summary) { setSummary(r.summary); setQ(null); }
      else { setQ(r.question!); setAsked(r.asked ?? asked + 1); setTyped(""); }
    } catch { setError("Couldn't submit that answer."); }
    finally { setBusy(false); }
  }

  if (error) return <><button className="back" onClick={onExit}>← Leave</button><p className="err" role="alert">{error}</p></>;

  if (summary) {
    const rec = summary.recommendation;
    return (
      <>
        <div className="eyebrow">Placement result</div>
        <h1 style={{ fontSize: "1.8rem" }}>{topicName}</h1>
        <p className="verdict" aria-live="polite">{rec.message}</p>
        {!summary.reliable && (
          <p className="muted" style={{ marginTop: -12 }}>
            Only {summary.asked} questions were answered, so treat this as a rough guide.
          </p>
        )}
        <div className="statgrid">
          <div className="stat"><b>{summary.overall}%</b><span>Overall</span></div>
          <div className="stat"><b>{summary.correct}/{summary.asked}</b><span>Correct</span></div>
          <div className="stat"><b>{rec.tier}</b><span>Start at</span></div>
        </div>
        <h2 style={{ fontFamily: "var(--slab)", fontSize: "1.1rem" }}>Skill map</h2>
        {summary.skillMap.map(s => (
          <div className="drow" key={s.sec}>
            <div className="dhead">
              <b>{s.name}</b>
              <span className={"pill" + (s.level === "secure" ? " good" : "")}>{s.level}</span>
            </div>
            <div className="dsub">{s.correct} of {s.asked} correct</div>
            <div className="bar"><i style={{
              width: `${s.pct}%`,
              background: s.pct >= 80 ? "var(--good)" : s.pct >= 50 ? "var(--accent)" : "var(--bad)"
            }} /></div>
          </div>
        ))}
        <div className="rowbtns">
          <button className="btn" onClick={onDone}>Start practising →</button>
        </div>
      </>
    );
  }

  if (!q) return <div className="loading" role="status">Preparing your placement check…</div>;

  return (
    <>
      <button className="back" onClick={onExit}>← Leave</button>
      <div className="eyebrow">Placement check · {topicName}</div>
      <p className="muted" style={{ marginTop: 0 }}>
        Question {asked + 1}. These get harder or easier depending on how you do — no hints here.
      </p>
      <div className="card">
        <div className="sec">{q.secName}</div>
        <p className="qtext">{q.q}</p>
        {q.fig && <div className="fig"><Grid spec={q.fig} /></div>}
        {q.type === "mc" ? (
          <div className="opts">
            {q.opts!.map((o, i) => (
              <button key={i} className={"opt" + (q.mono ? " mono" : "")} disabled={busy}
                      onClick={() => send(i)}>
                <span className="key" aria-hidden="true">{i + 1}</span>{o}
              </button>
            ))}
          </div>
        ) : (
          <div className="inrow">
            <input className="ansin" value={typed} aria-label="Your answer" disabled={busy}
                   placeholder={q.type === "pair" ? "(x, y)" : "Your answer"}
                   onChange={e => setTyped(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter" && typed.trim()) send(typed); }} />
            <button className="btn" disabled={busy || !typed.trim()} onClick={() => send(typed)}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}
