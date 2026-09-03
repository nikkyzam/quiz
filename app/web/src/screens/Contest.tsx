import "../styles/contest.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, call, post, ApiError, type Learner, type Question } from "../api";
import { Grid, Beast } from "../beasts";
import { ReadAloud } from "../components/ReadAloud";
import { OrderAnswer, MultiAnswer } from "../components/AnswerInput";

/* Contest Corner (spec 3.3.5, 4.1.9, 13.12): timed papers in past-contest
   styles, marked on the server whose clock is authoritative. Answers stay on
   the device until the paper is handed in, so a learner can move around the
   paper freely and change their mind. */

export type Curriculum = Awaited<ReturnType<typeof api.curriculum>>;

export type ContestFormat = { name: string; questions: number; minutes: number };
export type ContestQuestion = Omit<Question, "type"> & {
  type: Question["type"] | "plot"; grid?: { min: number; max: number };
};
export type Paper = {
  contestId: string; format: string; name: string; limitSeconds: number;
  questions: ContestQuestion[];
  startedAt: number; deadline: number;
  answers: Record<string, unknown>;      /* question id -> answer, kept locally */
  times: Record<string, number>;         /* question id -> seconds spent */
};
export type ResultDetail = {
  id: string; topicId: string; correct: boolean; correctAnswer: string; explanation: string;
};
export type ContestResult = {
  score: number; total: number; pct: number; correctBeforePenalty: number;
  seconds: number; limitSeconds: number; expired: boolean;
  percentile: number | null;
  detail: ResultDetail[];
  byTopic: { topicId: string; asked: number; correct: number; pct: number }[];
  reward?: { points: number; badges: { code: string; name?: string }[]; streak: number };
};
export type Results = { paper: Paper; result: ContestResult };
export type HistoryRow = {
  format: string; score: number; total: number; pct: number;
  seconds: number; limit_secs: number; expired: number; finished_at: string;
};
export type FormatSummary = {
  format: string; attempts: number; best: number; latest: number | null;
  trend: number[]; percentile: number | null;
};
export type History = { history: HistoryRow[]; byFormat: FormatSummary[] };
export type Guide = { id: string; title: string; format: string | null; points: string[] };
export type Tab = "formats" | "paper" | "results" | "history" | "guides";
export type ContestData = {
  tab?: Tab;
  formats?: Record<string, ContestFormat>;
  paper?: Paper;
  results?: Results;
  history?: History;
  guides?: Guide[];
};

const contestApi = {
  formats: () => call<{ formats: Record<string, ContestFormat> }>("/contest/formats"),
  start: (learnerId: string, format: string) =>
    post<{ contestId: string; format: string; name: string; limitSeconds: number; questions: ContestQuestion[] }>(
      "/contest/start", { learnerId, format }),
  submit: (contestId: string, answers: Record<string, unknown>) =>
    post<ContestResult>("/contest/submit", { contestId, answers }),
  history: (learnerId: string) => call<History>(`/learners/${learnerId}/contests`),
  guides: () => call<{ guides: Guide[] }>("/contest/guides")
};

const TABS: { id: Tab; label: string }[] = [
  { id: "formats", label: "Formats" },
  { id: "paper", label: "Paper" },
  { id: "results", label: "Results" },
  { id: "history", label: "History" },
  { id: "guides", label: "Strategy" }
];

function errMsg(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Please sign in again to keep going.";
    if (e.status === 403) return "That learner is not on this account.";
    if (e.status === 404 && e.message === "not_enough_questions") return "Not enough questions for that paper yet.";
  }
  return fallback;
}

export function fmtTime(secs: number) {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* What the learner put down, in words, for the review list. */
export function showAnswer(q: ContestQuestion, a: unknown): string {
  if (a === undefined || a === null || a === "") return "No answer";
  if (q.type === "mc") return q.opts?.[Number(a)] ?? String(a);
  if (q.type === "multi") return Array.isArray(a) ? a.map(i => q.opts?.[Number(i)] ?? String(i)).join(", ") : String(a);
  if (q.type === "order") return Array.isArray(a) ? a.join("  →  ") : String(a);
  return String(a);
}

/* Analytics (4.1.9): everything here is derived from the marked paper plus
   the timings the client kept, so nothing extra is fetched. */
export type Analytics = {
  sections: { name: string; asked: number; correct: number; pct: number; seconds: number }[];
  strongest: string | null; weakest: string | null;
  perQuestion: { n: number; id: string; sec: string; seconds: number; correct: boolean }[];
  avgSeconds: number;
};
export function analyse(paper: Paper, result: ContestResult): Analytics {
  const marks = new Map(result.detail.map(d => [d.id, d.correct]));
  const bySec = new Map<string, { name: string; asked: number; correct: number; seconds: number }>();
  const perQuestion = paper.questions.map((q, i) => {
    const seconds = paper.times[q.id] || 0;
    const correct = marks.get(q.id) === true;
    const s = bySec.get(q.secName) || { name: q.secName, asked: 0, correct: 0, seconds: 0 };
    s.asked++; s.seconds += seconds; if (correct) s.correct++;
    bySec.set(q.secName, s);
    return { n: i + 1, id: q.id, sec: q.secName, seconds, correct };
  });
  const sections = [...bySec.values()]
    .map(s => ({ ...s, pct: Math.round((s.correct / s.asked) * 100) }))
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
  const totalSecs = perQuestion.reduce((a, p) => a + p.seconds, 0);
  return {
    sections,
    strongest: sections.length > 1 ? sections[0].name : null,
    weakest: sections.length > 1 ? sections[sections.length - 1].name : null,
    perQuestion,
    avgSeconds: perQuestion.length ? Math.round(totalSecs / perQuestion.length) : 0
  };
}

export function Contest({ learner, cur, onBack, initial }: {
  learner: Learner; cur: Curriculum; onBack: () => void; initial?: ContestData;
}) {
  const [tab, setTab] = useState<Tab>(
    initial?.tab ?? (initial?.results ? "results" : initial?.paper ? "paper" : "formats"));
  const [formats, setFormats] = useState<Record<string, ContestFormat> | null>(initial?.formats ?? null);
  const [paper, setPaper] = useState<Paper | null>(initial?.paper ?? null);
  const [results, setResults] = useState<Results | null>(initial?.results ?? null);
  const [history, setHistory] = useState<History | null>(initial?.history ?? null);
  const [guides, setGuides] = useState<Guide[] | null>(initial?.guides ?? null);
  const [pos, setPos] = useState(0);
  const [remaining, setRemaining] = useState(() =>
    initial?.paper ? Math.max(0, Math.ceil((initial.paper.deadline - Date.now()) / 1000)) : 0);
  const [announce, setAnnounce] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingTab, setLoadingTab] = useState(false);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);

  const viewedAt = useRef(Date.now());
  const warned = useRef(false);
  const submitting = useRef(false);

  /* formats load once */
  useEffect(() => {
    if (formats) return;
    contestApi.formats().then(r => setFormats(r.formats))
      .catch(e => setError(errMsg(e, "Couldn't load the contest formats. Check the server is running.")));
  }, [formats]);

  /* history and guides load when their tab is first opened */
  useEffect(() => {
    if (tab === "history" && !history) {
      setLoadingTab(true);
      contestApi.history(learner.id).then(setHistory)
        .catch(e => setError(errMsg(e, "Couldn't load past contests.")))
        .finally(() => setLoadingTab(false));
    }
    if (tab === "guides" && !guides) {
      setLoadingTab(true);
      contestApi.guides().then(r => setGuides(r.guides))
        .catch(e => setError(errMsg(e, "Couldn't load the strategy guides.")))
        .finally(() => setLoadingTab(false));
    }
  }, [tab, history, guides, learner.id]);

  /* Time spent on the question currently on screen is folded into the paper
     whenever we leave it, and once more just before handing in. */
  const flushTime = useCallback(() => {
    const now = Date.now();
    const spent = (now - viewedAt.current) / 1000;
    viewedAt.current = now;
    setPaper(p => {
      if (!p) return p;
      const q = p.questions[pos];
      if (!q) return p;
      return { ...p, times: { ...p.times, [q.id]: (p.times[q.id] || 0) + spent } };
    });
  }, [pos]);

  const goTo = (i: number) => {
    if (!paper || i < 0 || i >= paper.questions.length) return;
    flushTime();
    setPos(i);
    setArmed(false);
  };

  const setAnswer = (qid: string, value: unknown) =>
    setPaper(p => (p ? { ...p, answers: { ...p.answers, [qid]: value } } : p));

  const handIn = useCallback(async (auto: boolean) => {
    if (!paper || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    /* fold in the last question's time before we send */
    const spent = (Date.now() - viewedAt.current) / 1000;
    const q = paper.questions[pos];
    const finished: Paper = q
      ? { ...paper, times: { ...paper.times, [q.id]: (paper.times[q.id] || 0) + spent } }
      : paper;
    try {
      const r = await contestApi.submit(finished.contestId, finished.answers);
      setResults({ paper: finished, result: r });
      setPaper(null);
      setPos(0);
      setTab("results");
      setAnnounce(auto ? "Time is up. Your paper was handed in and marked." : "Paper handed in and marked.");
    } catch (e) {
      setError(errMsg(e, "Couldn't hand in the paper. Try again."));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }, [paper, pos]);

  const handInRef = useRef(handIn);
  handInRef.current = handIn;

  /* The countdown. The visible clock ticks silently; a polite live region
     speaks up once at one minute so screen-reader users are not read a new
     number every second (spec 4.1.9). */
  useEffect(() => {
    if (!paper) return;
    warned.current = false;
    viewedAt.current = Date.now();
    const tick = () => {
      const rem = Math.max(0, Math.ceil((paper.deadline - Date.now()) / 1000));
      setRemaining(rem);
      if (rem <= 60 && !warned.current) {
        warned.current = true;
        setAnnounce("One minute left. Hand in your paper soon.");
      }
      if (rem <= 0) {
        clearInterval(t);
        handInRef.current(true);
      }
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [paper?.contestId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(formatId: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await contestApi.start(learner.id, formatId);
      const startedAt = Date.now();
      setPaper({
        contestId: r.contestId, format: r.format, name: r.name, limitSeconds: r.limitSeconds,
        questions: r.questions, startedAt, deadline: startedAt + r.limitSeconds * 1000,
        answers: {}, times: {}
      });
      setPos(0); setArmed(false); setAnnounce("");
      setTab("paper");
    } catch (e) {
      setError(errMsg(e, "Couldn't start that paper. Try again."));
    } finally { setBusy(false); }
  }

  const topicName = (id: string) => {
    for (const g of Object.values(cur.curriculum))
      for (const u of g.units) {
        const t = u.topics.find(t => t.id === id);
        if (t) return t.name;
      }
    return id;
  };
  const formatName = (id: string) => formats?.[id]?.name ?? id;

  /* Tabs are keyboard-operable with arrows as well as Tab (WAI-ARIA tabs). */
  const enabled = (t: Tab) => (t === "paper" ? !!paper : t === "results" ? !!results : true);
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const ids = TABS.filter(t => enabled(t.id)).map(t => t.id);
    const at = ids.indexOf(TABS[i].id);
    const next = e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1
      : (at + (e.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
    setTab(ids[next]);
    document.getElementById(`ctab-${ids[next]}`)?.focus();
  };

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="maphead">
        <Beast kind={learner.beast || "vex"} size={44} />
        <div>
          <div className="eyebrow">{learner.name}</div>
          <h1 style={{ margin: 0, fontSize: "1.8rem" }}>Contest Corner</h1>
        </div>
      </div>

      <div className="tabs ctabs" role="tablist" aria-label="Contest Corner sections">
        {TABS.map((t, i) => (
          <button key={t.id} id={`ctab-${t.id}`} role="tab" type="button"
                  className={"tab" + (tab === t.id ? " on" : "")}
                  aria-selected={tab === t.id} aria-controls={`cpanel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1} disabled={!enabled(t.id)}
                  onClick={() => setTab(t.id)} onKeyDown={e => onTabKey(e, i)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="err" role="alert">{error}</p>}
      <div className="visually-hidden" role="status" aria-live="polite">{announce}</div>

      <div role="tabpanel" id={`cpanel-${tab}`} aria-labelledby={`ctab-${tab}`} tabIndex={0} className="cpanel">
        {tab === "formats" && (
          !formats ? <div className="loading" role="status">Loading formats…</div> : (
            <>
              <h2>Pick a paper</h2>
              <p className="lede">Each paper is timed like the real thing. The clock starts the moment you press Start.</p>
              <ul className="fmtgrid">
                {Object.entries(formats).map(([id, f]) => (
                  <li key={id} className="card fmt">
                    <h3>{f.name}</h3>
                    <p className="fmtmeta">
                      <span className="pill">{f.questions} questions</span>
                      <span className="pill">{f.minutes} minutes</span>
                    </p>
                    <button className="btn" disabled={busy} aria-label={`Start ${f.name}`}
                            onClick={() => start(id)}>Start</button>
                  </li>
                ))}
              </ul>
              {busy && <div className="loading" role="status">Setting up your paper…</div>}
            </>
          )
        )}

        {tab === "paper" && paper && (
          <PaperView paper={paper} pos={pos} remaining={remaining} busy={busy} armed={armed}
                     onGo={goTo} onAnswer={setAnswer}
                     onHandIn={() => {
                       const unanswered = paper.questions.filter(q => paper.answers[q.id] === undefined).length;
                       if (unanswered && !armed) { setArmed(true); return; }
                       handIn(false);
                     }} />
        )}

        {tab === "results" && results && (
          <ResultsView results={results} topicName={topicName}
                       onAnother={() => { setTab("formats"); }}
                       onHistory={() => { setHistory(null); setTab("history"); }} />
        )}

        {tab === "history" && (
          loadingTab || !history ? <div className="loading" role="status">Loading past contests…</div> : (
            <>
              <h2>Past papers</h2>
              {!history.history.length && (
                <p className="lede">No papers yet. Start one from the Formats tab and it will show up here.</p>
              )}
              {history.byFormat.length > 0 && (
                <ul className="fmtgrid">
                  {history.byFormat.map(f => (
                    <li key={f.format} className="drow">
                      <div className="dhead"><b>{formatName(f.format)}</b><span className="muted">best {f.best}%</span></div>
                      <div className="dsub">
                        {f.attempts} {f.attempts === 1 ? "attempt" : "attempts"}
                        {f.percentile !== null && ` · ${f.percentile}th percentile`}
                      </div>
                      <div className="pills" aria-label={`Recent scores for ${formatName(f.format)}`}>
                        {f.trend.slice(0, 8).map((p, i) => (
                          <span key={i} className={"pill" + (p >= 80 ? " good" : "")}>{p}%</span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {history.history.length > 0 && (
                <ul className="hlist">
                  {history.history.map((r, i) => (
                    <li key={i} className="drow">
                      <div className="dhead">
                        <b>{formatName(r.format)}</b>
                        <span className={"hscore" + (r.pct >= 80 ? " good" : "")}>{r.score} / {r.total}</span>
                      </div>
                      <div className="dsub">
                        {fmtDate(r.finished_at)} · {fmtTime(r.seconds)} of {fmtTime(r.limit_secs)}
                        {r.expired ? " · over time" : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        )}

        {tab === "guides" && (
          loadingTab || !guides ? <div className="loading" role="status">Loading strategy guides…</div> : (
            <>
              <h2>Strategy guides</h2>
              <p className="lede">How to sit a paper, not just how to do the maths.</p>
              <ul className="guidelist">
                {guides.map(g => (
                  <li key={g.id} className="card guide">
                    <h3>{g.title}</h3>
                    <ReadAloud text={`${g.title}. ${g.points.join(" ")}`} label={`Read "${g.title}" aloud`} />
                    <ul className="guidepts">
                      {g.points.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )
        )}
      </div>
    </>
  );
}

/* ---------------- the paper itself ---------------- */
function PaperView({ paper, pos, remaining, busy, armed, onGo, onAnswer, onHandIn }: {
  paper: Paper; pos: number; remaining: number; busy: boolean; armed: boolean;
  onGo: (i: number) => void; onAnswer: (qid: string, v: unknown) => void; onHandIn: () => void;
}) {
  const q = paper.questions[pos];
  const answered = paper.questions.filter(x => paper.answers[x.id] !== undefined).length;
  const unanswered = paper.questions.length - answered;
  const saved = paper.answers[q.id];
  const [typed, setTyped] = useState(typeof saved === "string" ? saved : "");
  useEffect(() => { setTyped(typeof saved === "string" ? saved : ""); }, [q.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const low = remaining <= 60;

  return (
    <>
      <div className="ctop">
        <h2 className="ptitle">{paper.name}</h2>
        <div className={"countdown" + (low ? " low" : "")} role="timer">
          <span className="visually-hidden">Time left </span>
          <span aria-hidden="true">⏱ </span>{fmtTime(remaining)}
        </div>
      </div>
      <p className="muted pmeta">{answered} of {paper.questions.length} answered · time limit {fmtTime(paper.limitSeconds)}</p>

      <nav aria-label="Questions" className="qnav">
        <ul>
          {paper.questions.map((x, i) => {
            const done = paper.answers[x.id] !== undefined;
            return (
              <li key={x.id}>
                <button type="button"
                        className={"qnavbtn" + (i === pos ? " on" : "") + (done ? " done" : "")}
                        aria-current={i === pos ? "step" : undefined}
                        aria-label={`Question ${i + 1}${done ? ", answered" : ", not answered"}`}
                        onClick={() => onGo(i)}>{i + 1}</button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="card">
        <div className="qhead">
          <div className="sec">Question {pos + 1} · {q.secName}</div>
        </div>
        <p className="qtext">{q.q}</p>
        <ReadAloud text={q.q} />
        {q.fig && <div className="fig"><Grid spec={q.fig} /></div>}

        {q.type === "order" ? (
          <>
            <OrderAnswer key={q.id} items={Array.isArray(saved) ? (saved as string[]) : q.items!}
                         disabled={busy} onSubmit={o => onAnswer(q.id, o)} />
            <p className="saved muted">
              {Array.isArray(saved) ? "Saved order: " + (saved as string[]).join(" → ") : "Press \"Check this order\" to save your order."}
            </p>
          </>
        ) : q.type === "multi" ? (
          <>
            <MultiAnswer key={q.id} opts={q.opts!} disabled={busy} onSubmit={p => onAnswer(q.id, p)} />
            <p className="saved muted">
              {Array.isArray(saved) ? "Saved: " + showAnswer(q, saved) : "Tick your choices and press \"Check\" to save them."}
            </p>
          </>
        ) : q.type === "mc" ? (
          <div className="opts">
            {q.opts!.map((o, i) => (
              <button key={i} type="button"
                      className={"opt" + (q.mono ? " mono" : "") + (saved === i ? " picked" : "")}
                      aria-pressed={saved === i} disabled={busy}
                      onClick={() => onAnswer(q.id, i)}>
                <span className="key" aria-hidden="true">{i + 1}</span>{o}
              </button>
            ))}
          </div>
        ) : (
          <div className="inrow">
            <label htmlFor={`cans-${pos}`} className="visually-hidden">Your answer</label>
            <input id={`cans-${pos}`} className="ansin" value={typed} disabled={busy}
                   placeholder={q.type === "pair" || q.type === "plot" ? "(x, y)" : "Your answer"}
                   onChange={e => { setTyped(e.target.value); onAnswer(q.id, e.target.value); }}
                   onKeyDown={e => { if (e.key === "Enter") onGo(pos + 1); }} />
            <span className="saved muted">{typeof saved === "string" && saved ? "Saved" : "Type to save"}</span>
          </div>
        )}
      </div>

      <div className="endbtns">
        <button className="btn ghost" disabled={pos === 0 || busy} onClick={() => onGo(pos - 1)}>← Previous</button>
        <button className="btn ghost" disabled={pos >= paper.questions.length - 1 || busy} onClick={() => onGo(pos + 1)}>Next →</button>
        <button className="btn" disabled={busy} onClick={onHandIn}>
          {busy ? "Handing in…" : armed ? "Hand in anyway" : "Hand in paper"}
        </button>
      </div>
      {armed && unanswered > 0 && (
        <p className="hintbox" role="status">
          {unanswered} {unanswered === 1 ? "question is" : "questions are"} still blank. Press "Hand in anyway" to finish, or go back and answer them.
        </p>
      )}
    </>
  );
}

/* ---------------- results and analytics ---------------- */
function ResultsView({ results, topicName, onAnother, onHistory }: {
  results: Results; topicName: (id: string) => string; onAnother: () => void; onHistory: () => void;
}) {
  const { paper, result } = results;
  const a = analyse(paper, result);
  const byId = new Map(result.detail.map(d => [d.id, d]));

  return (
    <>
      <h2>{paper.name}</h2>
      <div className="bigscore">{result.score}<small> / {result.total}</small></div>
      <p className="verdict">
        {result.expired
          ? `Time ran out, so this paper scores 0. You had ${result.correctBeforePenalty} right before the clock stopped.`
          : result.pct >= 80 ? `${result.pct}%. Contest ready!`
          : result.pct >= 50 ? `${result.pct}%. Solid work. The review below shows where the points went.`
          : `${result.pct}%. Every paper teaches something. Read the explanations and try again.`}
      </p>

      <div className="statgrid">
        <div className="stat"><b>{result.pct}%</b><span>Score</span></div>
        <div className="stat">
          <b>{result.percentile !== null && result.percentile !== undefined ? `${result.percentile}th` : "—"}</b>
          <span>Percentile</span>
        </div>
        <div className="stat"><b>{fmtTime(result.seconds)}</b><span>Time used of {fmtTime(result.limitSeconds)}</span></div>
      </div>

      {result.reward && (result.reward.points > 0 || result.reward.badges.length > 0) && (
        <p className="notice" role="status">
          +{result.reward.points} points
          {result.reward.badges.length > 0 && ` · new badge${result.reward.badges.length > 1 ? "s" : ""}: ${result.reward.badges.map(b => b.name || b.code).join(", ")}`}
        </p>
      )}

      <section className="card analytics" aria-labelledby="an-h">
        <h3 id="an-h">How you did</h3>
        {a.strongest && a.weakest && a.strongest !== a.weakest && (
          <p className="pills">
            <span className="pill good">Strongest: {a.strongest}</span>
            <span className="pill weak">Work on: {a.weakest}</span>
          </p>
        )}
        <ul className="secbars">
          {a.sections.map(s => (
            <li key={s.name} className="secrow">
              <div className="lbl"><b>{s.name}</b><span>{s.correct} / {s.asked} · {fmtTime(s.seconds)}</span></div>
              <div className="bar" role="img" aria-label={`${s.name}: ${s.pct} percent correct`}>
                <i style={{ width: `${s.pct}%`, background: s.pct >= 80 ? "var(--good)" : s.pct >= 50 ? "var(--band)" : "var(--bad)" }} />
              </div>
            </li>
          ))}
        </ul>
        {result.byTopic.length > 0 && (
          <>
            <h4>By topic</h4>
            <ul className="pills">
              {result.byTopic.map(t => (
                <li key={t.topicId} className={"pill" + (t.pct >= 80 ? " good" : "")}>{topicName(t.topicId)} {t.correct}/{t.asked}</li>
              ))}
            </ul>
          </>
        )}
        <h4>Time per question</h4>
        <p className="muted">Average {fmtTime(a.avgSeconds)} per question.</p>
        <div className="scroll">
          <table className="rtable">
            <thead><tr><th scope="col">Question</th><th scope="col">Section</th><th scope="col">Time</th><th scope="col">Result</th></tr></thead>
            <tbody>
              {a.perQuestion.map(p => (
                <tr key={p.id}>
                  <th scope="row">{p.n}</th>
                  <td>{p.sec}</td>
                  <td className="mono">{fmtTime(p.seconds)}</td>
                  <td className={p.correct ? "good" : "bad"}>{p.correct ? "Correct" : "Missed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <h3 className="reviewhead">Review every question</h3>
      <ol className="review">
        {paper.questions.map((q, i) => {
          const d = byId.get(q.id);
          const ok = d?.correct === true;
          return (
            <li key={q.id} className={"card rq" + (ok ? " ok" : " miss")}>
              <div className="sec">Question {i + 1} · {q.secName}</div>
              <p className="qtext rqtext">{q.q}</p>
              {q.fig && <div className="fig"><Grid spec={q.fig} /></div>}
              <p className="rline">
                <span className={"mark " + (ok ? "good" : "bad")} aria-hidden="true">{ok ? "✓" : "✗"}</span>
                <b>{ok ? "Correct." : "Not quite."}</b> Your answer: {showAnswer(q, paper.answers[q.id])}.
                {!ok && d && <> Correct answer: <b>{d.correctAnswer}</b>.</>}
              </p>
              {d?.explanation && <p className="expl">{d.explanation}</p>}
            </li>
          );
        })}
      </ol>

      <div className="endbtns">
        <button className="btn" onClick={onAnother}>Another paper</button>
        <button className="btn ghost" onClick={onHistory}>See history</button>
      </div>
    </>
  );
}
