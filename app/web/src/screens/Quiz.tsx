import { useEffect, useState } from "react";
import { api, type Question, type Learner } from "../api";
import { Grid, Beast } from "../beasts";

const fbMood = (fb: any) => fb ? (fb.correct ? "happy" as const : "oops" as const) : "idle" as const;
import { ReadAloud } from "../components/ReadAloud";
import { OrderAnswer, MultiAnswer, PlotAnswer } from "../components/AnswerInput";

type Feedback = { correct: boolean; correctAnswer: string; explanation: string; figA: any };

export function Quiz({ topicId, topicName, tier, advanced, threshold, learner, onExit }: {
  topicId: string; topicName: string; tier: string; advanced: boolean;
  threshold: number; learner: Learner; onExit: () => void;
}) {
  const [qs, setQs] = useState<Question[] | null>(null);
  const [pos, setPos] = useState(0);
  const [score, setScore] = useState(0);
  const [typed, setTyped] = useState("");
  const [fb, setFb] = useState<Feedback | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [hintUsed, setHintUsed] = useState(0);
  const [done, setDone] = useState<{ pct: number; star: boolean; threshold?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.questions(topicId, tier)
      .then(r => setQs(r.questions))
      .catch(() => setError("Couldn't load this tier. Check the server is running."));
  }, [topicId, tier]);

  if (error) return <><button className="back" onClick={onExit}>← Leave</button><p className="err" role="alert">{error}</p></>;
  if (!qs) return <div className="loading">Loading questions…</div>;

  const q = qs[pos];

  async function submit(answer: unknown) {
    if (fb || busy) return;
    setBusy(true);
    try {
      const r = await api.answer(q.id, answer);
      setFb(r);
      if (r.correct) setScore(s => s + 1);
    } catch { setError("Couldn't reach the server to check that answer."); }
    finally { setBusy(false); }
  }

  async function getHint() {
    const level = hintUsed + 1;
    if (level > 3) return;
    try {
      const r = await api.hint(q.id, level);
      setHints(h => [...h, r.hint]);
      setHintUsed(level);
    } catch { /* a failed hint shouldn't break the round */ }
  }

  async function next() {
    if (pos < qs!.length - 1) {
      setPos(p => p + 1);
      setFb(null); setPicked(null); setTyped(""); setHints([]); setHintUsed(0);
    } else {
      try {
        const r = await api.saveRun(learner.id, topicId, tier, score, qs!.length);
        setDone(r);
      } catch { setDone({ pct: Math.round((score / qs!.length) * 100), star: false }); }
    }
  }

  if (done) {
    const bar = done.threshold ?? threshold;
    const passed = done.star;
    return (
      <>
        <h1 className="eyebrow" style={{ fontSize: "1rem" }}>{topicName} · {tier}</h1>
        <div className="bigscore" aria-live="polite">{score}<small> / {qs.length}</small></div>
        <p className="verdict">
          {passed ? `Mastered at ${done.pct}% — that's a star. ★`
                  : `${done.pct}%. Mastery here is ${bar}% — another run should do it.`}
        </p>
        <div className="rowbtns">
          <button className="btn" onClick={() => {
            setPos(0); setScore(0); setFb(null); setPicked(null); setTyped("");
            setHints([]); setHintUsed(0); setDone(null);
          }}>Run it again</button>
          <button className="btn ghost" onClick={onExit}>Back to tiers</button>
        </div>
      </>
    );
  }

  const stars = hintUsed === 0 ? 3 : hintUsed === 1 ? 2 : 1;

  return (
    <>
      <button className="back" onClick={onExit}>← Leave</button>
      <div className="qtop">
        <div className="qcount">Question <b>{pos + 1}</b> / {qs.length}</div>
        <div className="scorechip">score {score}</div>
      </div>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={qs.length}
           aria-valuenow={pos} aria-label={`Question ${pos + 1} of ${qs.length}`}>
        <div className="fill" style={{ width: `${(pos / qs.length) * 100}%` }} />
      </div>

      <div className="card">
        <div className="qhead">
          <Beast kind={learner?.beast || "vex"} size={48} mood={fbMood(typeof fb !== "undefined" ? fb : null)} />
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
              <button key={i}
                className={"opt" + (q.mono ? " mono" : "") +
                  (fb ? (i === q.opts!.indexOf(fb.correctAnswer) ? " right"
                       : i === picked ? " wrong" : " dim") : "")}
                disabled={!!fb}
                onClick={() => { setPicked(i); submit(i); }}>
                <span className="key" aria-hidden="true">{i + 1}</span>{o}
                {fb && i === q.opts!.indexOf(fb.correctAnswer) &&
                  <span className="mark">✓<span className="visually-hidden"> correct answer</span></span>}
                {fb && i === picked && i !== q.opts!.indexOf(fb.correctAnswer) &&
                  <span className="mark">✗<span className="visually-hidden"> your answer, incorrect</span></span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="inrow">
            <input className="ansin" value={typed} disabled={!!fb} aria-label="Your answer"
              placeholder={q.type === "pair" ? "(x, y)" : "Your answer"}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && typed.trim()) submit(typed); }} />
            <button className="btn" disabled={!!fb || !typed.trim() || busy}
                    onClick={() => submit(typed)}>Check</button>
          </div>
        )}

        {!fb && (
          <div style={{ marginTop: 12 }}>
            <button className="linkbtn" onClick={getHint} disabled={hintUsed >= 3}>
              {hintUsed === 0 ? "Need a hint?" : hintUsed < 3 ? "Another hint" : "No more hints"}
            </button>
            <span className="muted" style={{ fontSize: ".8rem", marginLeft: 10 }}>
              worth {stars} {stars === 1 ? "star" : "stars"}
            </span>
          </div>
        )}
        {hints.map((h, i) => (
          <div className="hintbox" key={i} role="status" aria-live="polite"><b>Hint {i + 1}.</b> {h}</div>
        ))}

        {fb && (
          <>
            <div className={"fb" + (fb.correct ? "" : " bad")} role="status" aria-live="polite">
              <h3>{fb.correct ? "Correct!" : `Not quite — the answer is ${fb.correctAnswer}`}</h3>
              <p className="expl">{fb.explanation}</p>
              {fb.figA && <div className="fig"><Grid spec={fb.figA} /></div>}
            </div>
            <div className="nextrow">
              <button className="btn" onClick={next}>
                {pos < qs.length - 1 ? "Next →" : "See results →"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
