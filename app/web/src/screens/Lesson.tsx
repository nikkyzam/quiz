import { useEffect, useState } from "react";
import { api, type Learner, type LessonPublic } from "../api";
import { Beast, Confetti } from "../beasts";
import { LessonArt } from "../components/LessonArt";
import { ReadAloud } from "../components/ReadAloud";

/* A short comic sequence: dialogue panels interleaved with inline checks.
   Wrong answers never block progress — this teaches, it does not gate. */
export function Lesson({ learner, lessonId, topicName, onExit, onDone }: {
  learner: Learner; lessonId: string; topicName: string;
  onExit: () => void; onDone: () => void;
}) {
  const [lesson, setLesson] = useState<LessonPublic | null>(null);
  const [pos, setPos] = useState(0);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{ correct: boolean; correctAnswer: string; expl: string } | null>(null);
  const [answered, setAnswered] = useState(false);
  const [cheer, setCheer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.lesson(learner.id, lessonId)
      .then(r => { setLesson(r.lesson); setPos(r.progress.panelIndex); })
      .catch(() => setError("Couldn't open this lesson."));
  }, [learner.id, lessonId]);

  if (error) return <><button className="back" onClick={onExit}>← Leave</button><p className="err" role="alert">{error}</p></>;
  if (!lesson) return <div className="loading" role="status">Opening the story…</div>;

  const panel = lesson.panels[pos];
  const last = pos === lesson.panels.length - 1;

  async function record(answer: unknown) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.lessonPanel(lesson!.id, learner.id, pos, answer);
      if (r.result) { setResult(r.result); setAnswered(true); if (r.result.correct) setCheer(c => c + 1); }
      else { setAnswered(true); }
      if (r.completed && last) { /* wait for the learner to press Finish */ }
    } catch { setError("Couldn't save your progress there."); }
    finally { setBusy(false); }
  }

  function next() {
    if (last) { onDone(); return; }
    setPos(p => p + 1);
    setResult(null); setAnswered(false); setTyped("");
  }

  return (
    <>
      <button className="back" onClick={onExit}>← Leave</button>
      <div className="eyebrow">{topicName} · {lesson.title}</div>
      <div className="lessondots" aria-hidden="true">
        {lesson.panels.map((_, i) => (
          <i key={i} className={i === pos ? "on" : i < pos ? "done" : ""} />
        ))}
      </div>

      <div className="lesson-card">
        <Confetti fire={cheer} />
        {panel.kind === "panel" ? (
          <>
            <div className="lessonrow">
              <Beast kind={panel.speaker} size={64} mood="idle" />
              <div style={{ flex: 1 }}>
                <div className="speech">{panel.text}</div>
                <ReadAloud text={panel.text} label="Read this" />
              </div>
            </div>
            {panel.art && <div className="lessonart"><LessonArt art={panel.art} /></div>}
            <div className="nextrow">
              <span className="kbd">Panel {pos + 1} of {lesson.panels.length}</span>
              <button className="btn" onClick={() => { if (!answered) record(null); next(); }}>
                {last ? "Finish →" : "Next →"}
              </button>
            </div>
          </>
        ) : (
          <div className="card">
            <div className="sec">Quick check</div>
            <p className="qtext">{panel.q}</p>
            {panel.art && <div className="lessonart"><LessonArt art={panel.art} /></div>}
            <ReadAloud text={panel.q} />

            {!answered && panel.type === "mc" && (
              <div className="opts">
                {panel.opts!.map((o, i) => (
                  <button key={i} className="opt" disabled={busy} onClick={() => record(i)}>
                    <span className="key" aria-hidden="true">{i + 1}</span>{o}
                  </button>
                ))}
              </div>
            )}
            {!answered && panel.type === "in" && (
              <div className="inrow">
                <input className="ansin" value={typed} aria-label="Your answer" disabled={busy}
                       onChange={e => setTyped(e.target.value)}
                       onKeyDown={e => { if (e.key === "Enter" && typed.trim()) record(typed); }} />
                <button className="btn" disabled={busy || !typed.trim()} onClick={() => record(typed)}>Check</button>
              </div>
            )}

            {answered && result && (
              <>
                <div className={"fb" + (result.correct ? "" : " bad")} role="status" aria-live="polite">
                  <h3>{result.correct ? "Exactly right!" : `Close — it's ${result.correctAnswer}`}</h3>
                  <p className="expl">{result.expl}</p>
                </div>
                <div className="nextrow">
                  <button className="btn" onClick={next}>{last ? "Finish →" : "Next →"}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
