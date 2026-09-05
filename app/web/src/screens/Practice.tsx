import { useEffect, useState } from "react";
import { api, type Question, type Learner } from "../api";
import { Grid, Beast, Confetti } from "../beasts";
import { ReadAloud } from "../components/ReadAloud";
import { OrderAnswer, MultiAnswer, PlotAnswer } from "../components/AnswerInput";

type Summary = {
  score: number; total: number; pct: number; stars: number; hintsUsed: number;
  threshold: number; seconds: number;
  missed: { id: string; q: string; correctAnswer: string; explanation: string }[];
};

/* Adaptive practice: the server picks each question from how the session is
   going, and hands back every mistake at the end to review. */
export function Practice({ learner, topicId, topicName, onExit, onRestart }: {
  learner: Learner; topicId: string; topicName: string;
  onExit: () => void; onRestart: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [q, setQ] = useState<Question | null>(null);
  const [asked, setAsked] = useState(0);
  const [len, setLen] = useState(10);
  const [score, setScore] = useState(0);
  const [typed, setTyped] = useState("");
  const [fb, setFb] = useState<{ correct: boolean; correctAnswer: string; explanation: string; figA: any } | null>(null);
  const [pendingNext, setPendingNext] = useState<Question | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [finished, setFinished] = useState(false);
  const [hints, setHints] = useState<string[]>([]);
  const [nudge, setNudge] = useState<{ type: string; message: string; suggest: string } | null>(null);
  const [cheer, setCheer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.startPractice(learner.id, topicId)
      .then(r => { setSessionId(r.sessionId); setQ(r.question); setLen(r.length); })
      .catch(() => setError("Couldn't start practice."));
  }, [learner.id, topicId]);

  async function submit(answer: unknown) {
    if (!sessionId || fb || busy) return;
    setBusy(true);
    try {
      const r = await api.answerPractice(sessionId, answer, hints.length);
      setFb({ correct: r.correct, correctAnswer: r.correctAnswer, explanation: r.explanation, figA: r.figA });
      if (r.correct) setCheer(c => c + 1);
      if (r.done && r.summary) setSummary(r.summary as Summary);
      else { setPendingNext(r.question!); setAsked(r.asked ?? asked + 1); setScore(r.score ?? score);
             setNudge(r.intervention ?? null); }
    } catch { setError("Couldn't submit that answer."); }
    finally { setBusy(false); }
  }

  async function getHint() {
    if (!q || hints.length >= 3) return;
    try {
      const r = await api.hint(q.id, hints.length + 1);
      setHints(h => [...h, r.hint]);
    } catch { /* a failed hint should not end the session */ }
  }

  /* The last question still shows its feedback; only then do we reveal the
     summary, so nothing is skipped past. */
  function next() {
    if (summary) { setFinished(true); return; }
    setQ(pendingNext); setPendingNext(null);
    setFb(null); setTyped(""); setHints([]);
  }

  if (error) return <><button className="back" onClick={onExit}>← Leave</button><p className="err" role="alert">{error}</p></>;

  if (summary && finished) {
    return (
      <>
        <Confetti fire={summary.pct >= 80 ? summary.total : 0} />
        <div className="hero">
          <Beast kind={learner.beast} size={72} mood={summary.pct >= 80 ? "happy" : "thinking"} />
          <div>
            <div className="eyebrow">{topicName} · adaptive practice</div>
            <div className="bigscore" aria-live="polite">{summary.score}<small> / {summary.total}</small></div>
          </div>
        </div>
        <p className="verdict">
          {"★".repeat(summary.stars)}{"☆".repeat(3 - summary.stars)} — {summary.pct}%
          {summary.hintsUsed > 0 && ` · ${summary.hintsUsed} hint${summary.hintsUsed === 1 ? "" : "s"} used`}
        </p>
        {summary.missed.length > 0 ? (
          <>
            <h2 style={{ fontFamily: "var(--slab)", fontSize: "1.1rem" }}>
              Worth another look ({summary.missed.length})
            </h2>
            {summary.missed.map(m => (
              <div className="drow" key={m.id}>
                <div className="dhead"><b>{m.q}</b></div>
                <div className="dsub">Answer: {m.correctAnswer}</div>
                <p className="expl" style={{ marginTop: 6 }}>{m.explanation}</p>
              </div>
            ))}
          </>
        ) : <p className="lede">Nothing missed — every question correct.</p>}
        <div className="rowbtns">
          <button className="btn" onClick={onRestart}>Practise again</button>
          <button className="btn ghost" onClick={onExit}>Back to topic</button>
        </div>
      </>
    );
  }

  if (!q) return <div className="loading" role="status">Setting up your practice…</div>;

  const starValue = hints.length === 0 ? 3 : hints.length === 1 ? 2 : 1;

  return (
    <>
      <button className="back" onClick={onExit}>← Leave</button>
      <div className="qtop">
        <div className="qcount">Question <b>{asked + 1}</b> / {len}</div>
        <div className="scorechip">score {score}</div>
      </div>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={len}
           aria-valuenow={asked} aria-label={`Question ${asked + 1} of ${len}`}>
        <div className="fill" style={{ width: `${(asked / len) * 100}%` }} />
      </div>

      <Confetti fire={cheer && fb?.correct ? cheer : 0} />
      <div className="card">
        <div className="qhead">
          <Beast kind={learner.beast} size={54}
                 mood={fb ? (fb.correct ? "happy" : "oops") : hints.length ? "thinking" : "idle"} />
          <div className="sec">{q.secName}</div>
        </div>
        <p className="qtext">{q.q}</p>
        <ReadAloud text={q.q} />
        {q.fig && <div className="fig"><Grid spec={q.fig} /></div>}

        {q.type === "plot" ? (
          <PlotAnswer plot={q.plot!} disabled={!!fb} onSubmit={p => submit(p)} />
        ) : q.type === "order" ? (
          <OrderAnswer items={q.items!} disabled={!!fb} onSubmit={o => submit(o)} />
        ) : q.type === "multi" ? (
          <MultiAnswer opts={q.opts!} disabled={!!fb} onSubmit={p => submit(p)} />
        ) : q.type === "mc" ? (
          <div className="opts">
            {q.opts!.map((o, i) => (
              <button key={i} className={"opt" + (q.mono ? " mono" : "")} disabled={!!fb}
                      onClick={() => submit(i)}>
                <span className="key" aria-hidden="true">{i + 1}</span>{o}
              </button>
            ))}
          </div>
        ) : (
          <div className="inrow">
            <input className="ansin" value={typed} aria-label="Your answer" disabled={!!fb}
                   placeholder={q.type === "pair" ? "(x, y)" : "Your answer"}
                   onChange={e => setTyped(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter" && typed.trim()) submit(typed); }} />
            <button className="btn" disabled={!!fb || !typed.trim() || busy} onClick={() => submit(typed)}>Check</button>
          </div>
        )}

        {!fb && (
          <div style={{ marginTop: 12 }}>
            <button className="linkbtn" onClick={getHint} disabled={hints.length >= 3}>
              {hints.length === 0 ? "Need a hint?" : hints.length < 3 ? "Another hint" : "No more hints"}
            </button>
            <span className="muted" style={{ fontSize: ".8rem", marginLeft: 10 }}>
              worth {starValue} {starValue === 1 ? "star" : "stars"}
            </span>
          </div>
        )}
        {hints.map((h, i) => (
          <div className="hintbox" key={i} role="status" aria-live="polite"><b>Hint {i + 1}.</b> {h}</div>
        ))}

        {fb && nudge && (
          <div className={"nudge nudge-" + nudge.type} role="status" aria-live="polite">
            <b>{nudge.type === "ready_to_advance" ? "Nicely done." : "A suggestion."}</b> {nudge.message}
          </div>
        )}

        {fb && (
          <>
            <div className={"fb" + (fb.correct ? "" : " bad")} role="status" aria-live="polite">
              <h3>{fb.correct ? "Correct!" : `Not quite — the answer is ${fb.correctAnswer}`}</h3>
              <p className="expl">{fb.explanation}</p>
              {fb.figA && <div className="fig"><Grid spec={fb.figA} /></div>}
            </div>
            <div className="nextrow">
              <button className="btn" onClick={next}>
                {summary ? "See results →" : "Next →"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
