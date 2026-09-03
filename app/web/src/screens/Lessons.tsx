import { useEffect, useState, useCallback } from "react";
import "../styles/lessons.css";
import { api, call, post, ApiError, type Learner } from "../api";
import { Beast, type Mood } from "../beasts";
import { ReadAloud } from "../components/ReadAloud";
import { LessonArt, Plane } from "../components/LessonArt";

/* Comic lessons (spec 3.2.1, 4.1.3): a library grouped by grade, and a
   player that shows one panel at a time, reads the narration aloud, grades
   embedded checks on the server and saves the panel after every move so a
   lesson can be picked up where it was left. */

export type Curriculum = Awaited<ReturnType<typeof api.curriculum>>;

/* ---------- API shapes (routes-student.js) ---------- */
export type LessonSummary = {
  id: string; topicId: string; topic: string; grade: string; title: string; panels: number; checks: number;
};
export type LessonProgress = {
  id: string; title: string; topicId: string; grade: string; panels: number;
  resumeAt: number | null; checksPassed: number; completed: boolean;
};
export type LessonsData = { lessons: LessonSummary[]; progress: LessonProgress[] };

export type LessonCheck = {
  id: string; type: "in" | "mc" | "plot"; q: string;
  opts?: string[]; grid?: { min: number; max: number }; hint: string | null;
};
export type LessonPanel = {
  index: number; art: { kind: string; [k: string]: any }; alt: string; text: string; check: LessonCheck | null;
};
export type LessonDetail = {
  id: string; topicId: string; grade: string; title: string; panels: number; checks: number;
  panelList: LessonPanel[];
  /* per-learner position, merged from GET /learners/:id/lessons */
  topic: string; resumeAt: number; checksPassed: number; completed: boolean;
};
type CheckResult = {
  correct: boolean; correctAnswer?: string; explanation?: string; hint?: string; canContinue: boolean;
};
type ProgressResult = { panel: number; completed: boolean; badges: any[] };

const lessonsApi = {
  list: () => call<{ lessons: LessonSummary[] }>("/lessons"),
  mine: (learnerId: string) => call<{ lessons: LessonProgress[] }>(`/learners/${learnerId}/lessons`),
  one: (id: string) => call<{ lesson: Omit<LessonDetail, "topic" | "resumeAt" | "checksPassed" | "completed"> }>(`/lessons/${id}`),
  check: (id: string, learnerId: string, panel: number, answer: unknown) =>
    post<CheckResult>(`/lessons/${id}/check`, { learnerId, panel, answer }),
  progress: (id: string, learnerId: string, panel: number) =>
    post<ProgressResult>(`/lessons/${id}/progress`, { learnerId, panel })
};

const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8"];
const narrator = (grade: string) => "K12".includes(grade) ? "pip" : "345".includes(grade) ? "nim" : "vex";

function friendlyError(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Please sign in again to keep going.";
    if (e.status === 403) return "That lesson belongs to a different learner.";
    if (e.status === 404) return "That lesson isn't here any more.";
  }
  return fallback;
}

/* ============================================================ library */
export function Lessons({ learner, cur, onBack, onPractice, initial }: {
  learner: Learner; cur: Curriculum; onBack: () => void;
  onPractice: (topicId: string, topicName: string) => void; initial?: LessonsData;
}) {
  const [data, setData] = useState<LessonsData | null>(initial ?? null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([lessonsApi.list(), lessonsApi.mine(learner.id)]);
      setData({ lessons: a.lessons, progress: b.lessons });
      setError("");
    } catch (e) { setError(friendlyError(e, "Couldn't load the lessons. Check the server is running.")); }
  }, [learner.id]);

  useEffect(() => { if (!initial) load(); }, [load, initial]);

  if (open) {
    return (
      <LessonPlayer learner={learner} lessonId={open} onPractice={onPractice}
                    onExit={() => { setOpen(null); load(); }} />
    );
  }

  if (error) return <><button className="back" onClick={onBack}>← Back</button><h1>Comic lessons</h1><p className="err" role="alert">{error}</p></>;
  if (!data) return <><button className="back" onClick={onBack}>← Back</button><h1>Comic lessons</h1><div className="loading" role="status">Loading lessons…</div></>;

  const progressOf = (id: string) => data.progress.find(p => p.id === id);
  const groups = GRADES
    .map(g => ({ g, label: cur.curriculum[g]?.label ?? (g === "K" ? "Kindergarten" : `Grade ${g}`),
                 beast: cur.curriculum[g]?.beast ?? narrator(g),
                 lessons: data.lessons.filter(l => l.grade === g) }))
    .filter(x => x.lessons.length);
  const done = data.progress.filter(p => p.completed).length;
  const started = data.progress.filter(p => !p.completed && p.resumeAt !== null && p.resumeAt > 0).length;

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="maphead">
        <Beast kind={learner.beast} size={44} />
        <div><div className="eyebrow">Read and try</div>
          <h1 style={{ margin: 0, fontSize: "1.8rem" }}>Comic lessons</h1></div>
      </div>
      <p className="lede">Short stories with a quick check inside. Stop any time and pick up where you left off.</p>
      <div className="statgrid">
        <div className="stat"><b>{data.lessons.length}</b><span>Lessons</span></div>
        <div className="stat"><b>{started}</b><span>In progress</span></div>
        <div className="stat"><b>{done}</b><span>Finished</span></div>
      </div>

      {groups.map(grp => (
        <section className="lgroup" key={grp.g} aria-labelledby={`lgrade-${grp.g}`}>
          <h2 id={`lgrade-${grp.g}`} className="lgrade"><Beast kind={grp.beast} size={30} still />{grp.label}</h2>
          <ul className="llist">
            {grp.lessons.map(l => {
              const p = progressOf(l.id);
              const partly = !!p && !p.completed && p.resumeAt !== null && p.resumeAt > 0;
              const completed = !!p?.completed;
              const cta = completed ? "Read again" : partly ? "Continue" : "Start";
              return (
                <li className="lrow" key={l.id}>
                  <div className="lmeta">
                    <h3 className="ltitle">{l.title}</h3>
                    <div className="dsub">{l.topic} · {l.panels} panels · {l.checks} {l.checks === 1 ? "check" : "checks"}</div>
                    <div className="pills">
                      {completed && <span className="pill good">✓ finished</span>}
                      {partly && <span className="pill">panel {(p!.resumeAt ?? 0) + 1} of {l.panels}</span>}
                      {!!p?.checksPassed && <span className="pill">{p!.checksPassed}/{l.checks} checks passed</span>}
                    </div>
                  </div>
                  <button className={"btn" + (completed ? " ghost" : "")} onClick={() => setOpen(l.id)}
                          aria-label={`${cta}: ${l.title}`}>{cta} →</button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/* ============================================================ player */
type Answer = { typed: string; picked: number | null; px: string; py: string };
const blank: Answer = { typed: "", picked: null, px: "", py: "" };

export function LessonPlayer({ learner, lessonId, onExit, onPractice, initial }: {
  learner: Learner; lessonId: string; onExit: () => void;
  onPractice: (topicId: string, topicName: string) => void; initial?: LessonDetail;
}) {
  const [data, setData] = useState<LessonDetail | null>(initial ?? null);
  const [error, setError] = useState("");
  const [pos, setPos] = useState(initial ? Math.min(initial.resumeAt, initial.panelList.length - 1) : 0);
  const [checksPassed, setChecksPassed] = useState(initial?.checksPassed ?? 0);
  const [ans, setAns] = useState<Answer>(blank);
  const [fb, setFb] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveNote, setSaveNote] = useState("");
  const [finished, setFinished] = useState<ProgressResult | null>(null);
  const [resumed, setResumed] = useState(!!initial && initial.resumeAt > 0);

  useEffect(() => {
    if (initial) return;
    let live = true;
    (async () => {
      try {
        const [one, list, mine] = await Promise.all([lessonsApi.one(lessonId), lessonsApi.list(), lessonsApi.mine(learner.id)]);
        if (!live) return;
        const l = one.lesson;
        const p = mine.lessons.find(x => x.id === l.id);
        const topic = list.lessons.find(x => x.id === l.id)?.topic ?? l.topicId;
        const resumeAt = Math.min(p?.resumeAt ?? 0, l.panelList.length - 1);
        setData({ ...l, topic, resumeAt, checksPassed: p?.checksPassed ?? 0, completed: !!p?.completed });
        setPos(resumeAt);
        setChecksPassed(p?.checksPassed ?? 0);
        setResumed(resumeAt > 0);
      } catch (e) { if (live) setError(friendlyError(e, "Couldn't open this lesson. Check the server is running.")); }
    })();
    return () => { live = false; };
  }, [lessonId, learner.id, initial]);

  if (error) return <><button className="back" onClick={onExit}>← Lessons</button><h1>Lesson</h1><p className="err" role="alert">{error}</p></>;
  if (!data) return <><button className="back" onClick={onExit}>← Lessons</button><h1>Lesson</h1><div className="loading" role="status">Opening the lesson…</div></>;

  const panels = data.panelList;
  const panel = panels[pos];
  const total = panels.length;
  const who = narrator(data.grade);
  /* which check (1-based) sits on this panel, and whether it is already passed */
  const checkIdx = panels.slice(0, pos + 1).filter(p => p.check).length;
  const gated = !!panel.check && checksPassed < checkIdx;
  const canNext = !gated;

  async function save(target: number) {
    try {
      const r = await lessonsApi.progress(data!.id, learner.id, target);
      setSaveNote(target >= total ? "" : "Saved");
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setSaveNote("Finish the check first.");
      else setSaveNote("Couldn't save your place.");
      return null;
    }
  }

  function goTo(i: number) {
    setPos(i); setAns(blank); setFb(null); setResumed(false);
    save(i);
  }

  async function finish() {
    setBusy(true);
    const r = await save(total);
    setFinished(r ?? { panel: total - 1, completed: true, badges: [] });
    setBusy(false);
  }

  async function submit() {
    if (!panel.check || busy || fb?.correct) return;
    const c = panel.check;
    let answer: unknown;
    if (c.type === "mc") answer = ans.picked;
    else if (c.type === "plot") answer = [Number(ans.px), Number(ans.py)];
    else answer = ans.typed;
    setBusy(true);
    try {
      const r = await lessonsApi.check(data!.id, learner.id, pos, answer);
      setFb(r);
      if (r.correct) setChecksPassed(n => Math.max(n, checkIdx));
    } catch (e) { setError(friendlyError(e, "Couldn't reach the server to check that answer.")); }
    finally { setBusy(false); }
  }

  const ready = !panel.check ? false
    : panel.check.type === "mc" ? ans.picked !== null
    : panel.check.type === "plot" ? ans.px.trim() !== "" && ans.py.trim() !== "" && !isNaN(Number(ans.px)) && !isNaN(Number(ans.py))
    : ans.typed.trim() !== "";

  const mood: Mood = fb ? (fb.correct ? "happy" : "oops") : gated ? "thinking" : "idle";

  if (finished) {
    return (
      <>
        <button className="back" onClick={onExit}>← Lessons</button>
        <div className="eyebrow">{data.topic}</div>
        <h1>You finished {data.title}!</h1>
        <div className="panel card lfinish">
          <LessonArt kind="celebrate" props={{ stars: 3 }} alt="A cheering character under three stars." />
          <p className="verdict" role="status">
            {data.checks ? `${Math.min(checksPassed, data.checks)} of ${data.checks} checks passed. ` : ""}
            Now try it for real.
          </p>
          {finished.badges?.length > 0 && (
            <ul className="pills" aria-label="New badges">
              {finished.badges.map((b: any, i: number) => (
                <li key={i} className="pill good">★ {b.name || b.title || b.code || "badge"}</li>
              ))}
            </ul>
          )}
          <div className="endbtns">
            <button className="btn" onClick={() => onPractice(data.topicId, data.topic)}>Practise this topic →</button>
            <button className="btn ghost" onClick={() => { setFinished(null); goTo(0); }}>Read it again</button>
            <button className="btn ghost" onClick={onExit}>Back to lessons</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <button className="back" onClick={onExit}>← Lessons</button>
      <div className="eyebrow">{data.topic}</div>
      <h1 className="ltitle-big">{data.title}</h1>

      <div className="qtop">
        <div className="qcount">Panel <b>{pos + 1}</b> / {total}</div>
        <ol className="dots" aria-label={`Panel ${pos + 1} of ${total}`}>
          {panels.map((p, i) => (
            <li key={i} className={"dot" + (i < pos ? " done" : "") + (i === pos ? " on" : "") + (p.check ? " chk" : "")}
                aria-current={i === pos ? "step" : undefined}>
              <span className="visually-hidden">Panel {i + 1}{p.check ? ", with a check" : ""}{i === pos ? ", current" : i < pos ? ", read" : ""}</span>
            </li>
          ))}
        </ol>
      </div>

      {resumed && (
        <p className="notice" role="status">Welcome back! Picking up at panel {pos + 1}.</p>
      )}

      <article className="panel card" aria-label={`Panel ${pos + 1}`}>
        <div className="panel-art">
          <LessonArt kind={panel.art.kind} props={panel.art} alt={panel.alt} />
        </div>
        <div className="bubble-row">
          <div className="bubble-who"><Beast kind={who} size={56} mood={mood} /></div>
          <div className="bubble">
            <p className="bubble-text">{panel.text}</p>
            <ReadAloud text={panel.text} />
          </div>
        </div>

        {panel.check && (
          <div className="lcheck">
            <h2 className="sec">Quick check</h2>
            <p className="qtext">{panel.check.q}</p>
            <ReadAloud text={panel.check.q} label="Read the question" />

            {panel.check.type === "mc" && (
              <div className="opts">
                {panel.check.opts!.map((o, i) => {
                  const correctIdx = fb?.correctAnswer ? panel.check!.opts!.indexOf(fb.correctAnswer) : -1;
                  const cls = "opt" + (fb
                    ? (i === correctIdx ? " right" : i === ans.picked ? " wrong" : " dim")
                    : (i === ans.picked ? " sel" : ""));
                  return (
                    <button key={i} className={cls} disabled={!!fb?.correct || busy}
                            aria-pressed={!fb && ans.picked === i}
                            onClick={() => { setFb(null); setAns(a => ({ ...a, picked: i })); }}>
                      <span className="key" aria-hidden="true">{i + 1}</span>{o}
                      {fb && i === correctIdx && <span className="mark">✓<span className="visually-hidden"> correct answer</span></span>}
                      {fb && !fb.correct && i === ans.picked && <span className="mark">✗<span className="visually-hidden"> your answer, incorrect</span></span>}
                    </button>
                  );
                })}
              </div>
            )}

            {panel.check.type === "in" && (
              <div className="inrow">
                <label className="visually-hidden" htmlFor={`lans-${pos}`}>Your answer</label>
                <input id={`lans-${pos}`} className="ansin" value={ans.typed} disabled={!!fb?.correct}
                       inputMode="decimal" placeholder="Your answer"
                       onChange={e => { setFb(null); setAns(a => ({ ...a, typed: e.target.value })); }}
                       onKeyDown={e => { if (e.key === "Enter" && ready) submit(); }} />
              </div>
            )}

            {panel.check.type === "plot" && (
              <div className="plotbox">
                <div className="plotgrid" aria-hidden="true">
                  <svg viewBox="0 0 320 200" className="lessonart">
                    <rect x="0" y="0" width="320" height="200" rx="18" fill="var(--chip)" />
                    <Plane pts={[]} min={panel.check.grid?.min ?? -5} max={panel.check.grid?.max ?? 5}
                           pick={ans.px !== "" && ans.py !== "" && !isNaN(Number(ans.px)) && !isNaN(Number(ans.py))
                             ? [Number(ans.px), Number(ans.py)] : undefined} />
                  </svg>
                </div>
                <div className="plotin">
                  <div className="field">
                    <label htmlFor={`lpx-${pos}`}>x (left–right)</label>
                    <input id={`lpx-${pos}`} className="ansin" inputMode="numeric" value={ans.px} disabled={!!fb?.correct}
                           onChange={e => { setFb(null); setAns(a => ({ ...a, px: e.target.value })); }} />
                  </div>
                  <div className="field">
                    <label htmlFor={`lpy-${pos}`}>y (up–down)</label>
                    <input id={`lpy-${pos}`} className="ansin" inputMode="numeric" value={ans.py} disabled={!!fb?.correct}
                           onChange={e => { setFb(null); setAns(a => ({ ...a, py: e.target.value })); }}
                           onKeyDown={e => { if (e.key === "Enter" && ready) submit(); }} />
                  </div>
                </div>
              </div>
            )}

            {!fb?.correct && (
              <div className="rowbtns">
                <button className="btn" disabled={!ready || busy} onClick={submit}>
                  {fb && !fb.correct ? "Try again" : "Check"}
                </button>
                {!fb && panel.check.hint && (
                  <span className="muted lhint">Hint: {panel.check.hint}</span>
                )}
              </div>
            )}

            {fb && (
              <div className={"fb" + (fb.correct ? "" : " bad")} role="status" aria-live="polite">
                <h3>{fb.correct ? "Correct!" : "Not quite."}</h3>
                <p className="expl">{fb.correct ? fb.explanation : fb.hint}</p>
              </div>
            )}
          </div>
        )}
      </article>

      <div className="lnav">
        <button className="btn ghost" disabled={pos === 0} onClick={() => goTo(pos - 1)}>← Previous</button>
        <span className="muted lsave" role="status" aria-live="polite">{saveNote}</span>
        {pos < total - 1
          ? <button className="btn" disabled={!canNext} onClick={() => goTo(pos + 1)}>Next →</button>
          : <button className="btn" disabled={!canNext || busy} onClick={finish}>Finish ★</button>}
      </div>
      {gated && <p className="muted lgate">Pass the quick check to move on.</p>}
    </>
  );
}
