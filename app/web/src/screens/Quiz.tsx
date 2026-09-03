import "../styles/core.css";
import { useEffect, useRef, useState } from "react";
import { api, type Question, type Learner } from "../api";
import { Grid, Beast } from "../beasts";
import { ReadAloud, ReadAloudText } from "../components/ReadAloud";
import { OrderAnswer, MultiAnswer } from "../components/AnswerInput";
import { PlotInput, parsePt, type AnyQuestion } from "../components/PlotInput";
import { isOnline, loadPack, queueRun, useOnline } from "../offline";

/* A pending answer is one recorded offline: the server has not seen it yet,
   so there is no verdict to react to. */
type Feedback = { correct: boolean; correctAnswer: string; explanation: string; figA: any; pending?: boolean };
const fbMood = (fb: Feedback | null) =>
  !fb ? "idle" as const : fb.pending ? "thinking" as const : fb.correct ? "happy" as const : "oops" as const;

type Done = { pct: number; star: boolean; threshold?: number; pending?: boolean };

export function Quiz({ topicId, topicName, tier, advanced, threshold, learner, onExit, initial, initialOffline }: {
  topicId: string; topicName: string; tier: string; advanced: boolean;
  threshold: number; learner: Learner; onExit: () => void;
  /* Loaded state for renders where effects do not run (accessibility audit). */
  initial?: Question[]; initialOffline?: boolean;
}) {
  const [qs, setQs] = useState<AnyQuestion[] | null>(initial ?? null);
  const [offline, setOffline] = useState(!!initialOffline);
  const [pos, setPos] = useState(0);
  const [score, setScore] = useState(0);
  const [typed, setTyped] = useState("");
  const [fb, setFb] = useState<Feedback | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [hintUsed, setHintUsed] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const online = useOnline();
  const answers = useRef<Record<string, unknown>>({});
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (initial) return;
    let alive = true;
    const fromPack = () => loadPack(topicId, tier).then(p => {
      if (!alive) return;
      if (p) { setQs(p.questions); setOffline(true); }
      else setError(isOnline()
        ? "Couldn't load this tier. Check the server is running."
        : "You're offline and this tier isn't saved on this device. Save it for offline next time you're connected.");
    });
    /* Offline: play from the saved pack. Online: ask the server, and fall
       back to the pack if the request fails part-way through a connection. */
    if (!isOnline()) { fromPack(); return () => { alive = false; }; }
    api.questions(topicId, tier)
      .then(r => { if (alive) setQs(r.questions); })
      .catch(() => fromPack());
    return () => { alive = false; };
  }, [topicId, tier, initial]);

  if (error) return <><button className="back" onClick={onExit}>← Leave</button><p className="err" role="alert">{error}</p></>;
  if (!qs) return <div className="loading" role="status">Loading questions…</div>;

  const q = qs[pos];
  const answered = Object.keys(answers.current).length;

  async function submit(answer: unknown) {
    if (fb || busy) return;
    if (offline) {
      answers.current[q.id] = answer;
      setFb({ correct: false, correctAnswer: "", explanation: "", figA: null, pending: true });
      return;
    }
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
    if (offline) {
      /* The pack carries the first hint only; the rest live on the server. */
      if (q.hint && hintUsed === 0) { setHints([q.hint]); setHintUsed(1); }
      return;
    }
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
      return;
    }
    const seconds = Math.round((Date.now() - startedAt.current) / 1000);
    if (offline) {
      try {
        await queueRun({ learnerId: learner.id, topicId, tier, answers: { ...answers.current },
                         total: qs!.length, seconds, finishedAt: new Date().toISOString() });
      } catch { /* storage refused; the round still shows as saved locally */ }
      setDone({ pct: 0, star: false, pending: true });
      return;
    }
    try {
      const r = await api.saveRun(learner.id, topicId, tier, score, qs!.length);
      setDone(r);
    } catch { setDone({ pct: Math.round((score / qs!.length) * 100), star: false }); }
  }

  function restart() {
    answers.current = {}; startedAt.current = Date.now();
    setPos(0); setScore(0); setFb(null); setPicked(null); setTyped("");
    setHints([]); setHintUsed(0); setDone(null);
  }

  const banner = !online || offline ? (
    <p className="offline-banner" role="status">
      <b>Offline.</b> {offline
        ? "Your answers will be checked when you are back online."
        : "Answers can't be checked until you're connected again."}
    </p>
  ) : null;

  if (done) {
    const bar = done.threshold ?? threshold;
    const passed = done.star;
    return (
      <>
        <h1 className="eyebrow" style={{ fontSize: "1rem" }}>{topicName} · {tier}</h1>
        {banner}
        {done.pending ? (
          <>
            <div className="bigscore" aria-live="polite">{answered}<small> / {qs.length} saved</small></div>
            <p className="verdict" role="status">
              Round saved on this device. Your answers will be checked when you are back online.
            </p>
          </>
        ) : (
          <>
            <div className="bigscore" aria-live="polite">{score}<small> / {qs.length}</small></div>
            <p className="verdict">
              {passed ? `Mastered at ${done.pct}% — that's a star. ★`
                      : `${done.pct}%. Mastery here is ${bar}% — another run should do it.`}
            </p>
          </>
        )}
        <div className="rowbtns">
          <button className="btn" onClick={restart}>Run it again</button>
          <button className="btn ghost" onClick={onExit}>Back to tiers</button>
        </div>
      </>
    );
  }

  const stars = hintUsed === 0 ? 3 : hintUsed === 1 ? 2 : 1;
  const rightIdx = fb && !fb.pending && q.opts ? q.opts.indexOf(fb.correctAnswer) : -1;
  const reveal = fb && !fb.pending && q.type === "plot" ? parsePt(fb.correctAnswer) : undefined;
  const hintLabel = hintUsed === 0 ? "Need a hint?" : hintUsed < 3 ? "Another hint" : "No more hints";
  const hintDisabled = offline ? (hintUsed >= 1 || !q.hint) : hintUsed >= 3;

  return (
    <>
      <button className="back" onClick={onExit}>← Leave</button>
      <h1 className="visually-hidden">{topicName}, {tier} round</h1>
      {banner}
      <div className="qtop">
        <div className="qcount">Question <b>{pos + 1}</b> / {qs.length}</div>
        <div className="scorechip">{offline ? `saved ${answered}` : `score ${score}`}</div>
      </div>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={qs.length}
           aria-valuenow={pos} aria-label={`Question ${pos + 1} of ${qs.length}`}>
        <div className="fill" style={{ width: `${(pos / qs.length) * 100}%` }} />
      </div>

      <div className="card">
        <div className="qhead">
          <Beast kind={learner?.beast || "vex"} size={48} mood={fbMood(fb)} />
          <div className="sec">{q.secName}</div>
        </div>
        <ReadAloudText text={q.q} />
        <ReadAloud text={q.q} />
        {q.fig && <div className="fig"><Grid spec={q.fig} /></div>}

        {q.type === "order" ? (
          <OrderAnswer items={q.items!} disabled={!!fb} onSubmit={o => submit(o)} />
        ) : q.type === "multi" ? (
          <MultiAnswer opts={q.opts!} disabled={!!fb} onSubmit={p => submit(p)} />
        ) : q.type === "plot" ? (
          <PlotInput grid={q.grid ?? { min: -10, max: 10 }} disabled={!!fb} reveal={reveal}
                     onSubmit={p => submit(p)} />
        ) : q.type === "mc" ? (
          <div className="opts">
            {q.opts!.map((o, i) => (
              <button key={i}
                className={"opt" + (q.mono ? " mono" : "") +
                  (fb ? (fb.pending ? (i === picked ? " picked" : " dim")
                       : i === rightIdx ? " right" : i === picked ? " wrong" : " dim") : "")}
                disabled={!!fb}
                onClick={() => { setPicked(i); submit(i); }}>
                <span className="key" aria-hidden="true">{i + 1}</span>{o}
                {fb && !fb.pending && i === rightIdx &&
                  <span className="mark">✓<span className="visually-hidden"> correct answer</span></span>}
                {fb && !fb.pending && i === picked && i !== rightIdx &&
                  <span className="mark">✗<span className="visually-hidden"> your answer, incorrect</span></span>}
                {fb && fb.pending && i === picked &&
                  <span className="visually-hidden"> your answer, saved</span>}
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
            <button className="linkbtn" onClick={getHint} disabled={hintDisabled}>
              {offline && !q.hint ? "No hint saved" : hintLabel}
            </button>
            <span className="muted" style={{ fontSize: ".8rem", marginLeft: 10 }}>
              worth {stars} {stars === 1 ? "star" : "stars"}
            </span>
          </div>
        )}
        {hints.map((h, i) => (
          <div className="hintbox" key={i} role="status" aria-live="polite"><b>Hint {i + 1}.</b> {h}</div>
        ))}

        {fb && fb.pending && (
          <>
            <div className="fb pending" role="status" aria-live="polite">
              <h3>Answer saved</h3>
              <p className="expl">Your answers will be checked when you are back online.</p>
            </div>
            <div className="nextrow">
              <button className="btn" onClick={next}>
                {pos < qs.length - 1 ? "Next →" : "Finish →"}
              </button>
            </div>
          </>
        )}

        {fb && !fb.pending && (
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
