import { useEffect, useState } from "react";
import { api, type Question, type Learner } from "../api";
import { Grid } from "../beasts";
import { ReadAloud } from "../components/ReadAloud";
import { OrderAnswer, MultiAnswer } from "../components/AnswerInput";

/* Mastery check: no hints, one pass through, marked by the server. */
export function MasteryCheck({ learner, topicId, topicName, onExit }: {
  learner: Learner; topicId: string; topicName: string; onExit: () => void;
}) {
  const [checkId, setCheckId] = useState<string | null>(null);
  const [qs, setQs] = useState<Question[] | null>(null);
  const [threshold, setThreshold] = useState(90);
  const [pos, setPos] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.submitMastery>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.startMastery(learner.id, topicId)
      .then(r => { setCheckId(r.checkId); setQs(r.questions); setThreshold(r.threshold); })
      .catch(() => setError("Couldn't start the mastery check."));
  }, [learner.id, topicId]);

  if (error) return <><button className="back" onClick={onExit}>← Leave</button><p className="err" role="alert">{error}</p></>;
  if (!qs) return <div className="loading" role="status">Preparing the check…</div>;

  if (result) {
    return (
      <>
        <div className="eyebrow">{topicName} · mastery check</div>
        <div className="bigscore" aria-live="polite">{result.score}<small> / {result.total}</small></div>
        <p className="verdict">
          {result.passed
            ? `Passed at ${result.pct}%. Mastery here is ${result.threshold}%. ★`
            : `${result.pct}%. You need ${result.threshold}% — review the ones below and try again.`}
        </p>
        {result.detail.filter(d => !d.correct).map(d => {
          const q = qs.find(x => x.id === d.id)!;
          return (
            <div className="drow" key={d.id}>
              <div className="dhead"><b>{q.q}</b></div>
              <div className="dsub">Answer: {d.correctAnswer}</div>
              <p className="expl" style={{ marginTop: 6 }}>{d.explanation}</p>
            </div>
          );
        })}
        <div className="rowbtns"><button className="btn" onClick={onExit}>Back to topic</button></div>
      </>
    );
  }

  const q = qs[pos];
  const record = (v: unknown) => {
    const next = { ...answers, [q.id]: v };
    setAnswers(next);
    setTyped("");
    if (pos < qs.length - 1) setPos(pos + 1);
    else submit(next);
  };
  async function submit(final: Record<string, unknown>) {
    if (!checkId || busy) return;
    setBusy(true);
    try { setResult(await api.submitMastery(checkId, final)); }
    catch { setError("Couldn't submit the check."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <button className="back" onClick={onExit}>← Leave</button>
      <div className="qtop">
        <div className="qcount">Mastery check · <b>{pos + 1}</b> / {qs.length}</div>
        <div className="scorechip">pass mark {threshold}%</div>
      </div>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={qs.length}
           aria-valuenow={pos} aria-label={`Question ${pos + 1} of ${qs.length}`}>
        <div className="fill" style={{ width: `${(pos / qs.length) * 100}%` }} />
      </div>
      <div className="card">
        <div className="sec">{q.secName}</div>
        <p className="qtext">{q.q}</p>
        <ReadAloud text={q.q} />
        {q.fig && <div className="fig"><Grid spec={q.fig} /></div>}
        <p className="muted" style={{ fontSize: ".85rem" }}>No hints during a mastery check.</p>
        {q.type === "order" ? (
          <OrderAnswer items={q.items!} disabled={busy} onSubmit={o => record(o)} />
        ) : q.type === "multi" ? (
          <MultiAnswer opts={q.opts!} disabled={busy} onSubmit={p => record(p)} />
        ) : q.type === "mc" ? (
          <div className="opts">
            {q.opts!.map((o, i) => (
              <button key={i} className={"opt" + (q.mono ? " mono" : "")} disabled={busy}
                      onClick={() => record(i)}>
                <span className="key" aria-hidden="true">{i + 1}</span>{o}
              </button>
            ))}
          </div>
        ) : (
          <div className="inrow">
            <input className="ansin" value={typed} aria-label="Your answer" disabled={busy}
                   placeholder={q.type === "pair" ? "(x, y)" : "Your answer"}
                   onChange={e => setTyped(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter" && typed.trim()) record(typed); }} />
            <button className="btn" disabled={busy || !typed.trim()} onClick={() => record(typed)}>
              {pos < qs.length - 1 ? "Next" : "Finish"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
