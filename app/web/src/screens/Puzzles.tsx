import "../styles/proofs.css";
import { useEffect, useState } from "react";
import { call, post, ApiError, type Learner } from "../api";
import { Beast, Confetti } from "../beasts";
import { ReadAloud } from "../components/ReadAloud";

/* Puzzles (spec 3.2.4, 4.1.5). Open-ended and untimed. Hints come one at a
   time from the server; a wrong answer never reveals the solution, so a
   puzzle stays worth coming back to. Some puzzles have more than one right
   answer, and the server may describe the different routes once solved. */

export type Puzzle = {
  id: string; title: string; difficulty: number; topic: string; prompt: string;
  hintCount: number; multiple: boolean; hidden: boolean; area: string | null;
};
export type Solve = { puzzleId: string; hintsUsed: number; solvedAt: string; trophy: string; title?: string };
export type PuzzleResult = {
  correct: boolean; encouragement?: string;
  trophy?: string; firstSolve?: boolean; message?: string;
  paths?: string[];                 /* solution routes, when the server sends them */
  solutions?: (string | number)[];  /* other accepted answers, when sent */
};
export type OpenPuzzle = { puzzle: Puzzle; hints?: string[]; result?: PuzzleResult | null; notes?: string; answer?: string };
export type PuzzlesData = {
  puzzles: Puzzle[];
  solved: Solve[];
  available: number;
  open?: OpenPuzzle | null;
};

const puzzlesApi = {
  list: (learnerId: string) =>
    call<{ puzzles: Puzzle[] }>(`/puzzles?learnerId=${encodeURIComponent(learnerId)}`),
  solved: (learnerId: string) =>
    call<{ solved: Solve[]; available: number }>(`/learners/${encodeURIComponent(learnerId)}/puzzles`),
  hint: (id: string, learnerId: string, level: number) =>
    post<{ level: number; hint: string; last: boolean }>(`/puzzles/${encodeURIComponent(id)}/hint`, { learnerId, level }),
  answer: (id: string, learnerId: string, answer: string, hintsUsed: number) =>
    post<PuzzleResult>(`/puzzles/${encodeURIComponent(id)}/answer`, { learnerId, answer, hintsUsed })
};

const LEVELS: Record<number, string> = { 1: "Warm-up", 2: "Thinker", 3: "Brain-bender", 4: "Beast mode" };
const TROPHY: Record<string, string> = { gold: "🥇", silver: "🥈", bronze: "🥉" };

function failMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError && e.status === 403 && e.message === "puzzle_locked")
    return "This puzzle is still locked. Explore more of the map to open it.";
  if (e instanceof ApiError && (e.status === 401 || e.status === 403))
    return "You need to be signed in as this learner's grown-up to do that.";
  return fallback;
}

export function Puzzles({ learner, onBack, initial }: {
  learner: Learner; onBack: () => void; initial?: PuzzlesData;
}) {
  const [data, setData] = useState<PuzzlesData | null>(initial ?? null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<OpenPuzzle | null>(initial?.open ?? null);

  useEffect(() => {
    if (initial) return;
    Promise.all([puzzlesApi.list(learner.id), puzzlesApi.solved(learner.id)])
      .then(([p, s]) => setData({ puzzles: p.puzzles, solved: s.solved, available: s.available }))
      .catch(e => setError(failMessage(e, "Couldn't load the puzzles. Check the server is running.")));
  }, [learner.id, initial]);

  if (error) return <><button className="back" onClick={onBack}>← Back</button><p className="err" role="alert">{error}</p></>;
  if (!data) return <div className="loading" role="status">Loading puzzles…</div>;

  if (open) {
    return (
      <PuzzleView key={open.puzzle.id} learner={learner} open={open}
                  onBack={() => setOpen(null)}
                  onSolved={(r, hintsUsed) => {
                    const id = open.puzzle.id;
                    setData(d => d && !d.solved.some(s => s.puzzleId === id)
                      ? { ...d, solved: [{ puzzleId: id, hintsUsed, solvedAt: new Date().toISOString(),
                                           trophy: r.trophy || "bronze", title: open.puzzle.title }, ...d.solved] }
                      : d);
                  }} />
    );
  }

  const solved = new Map(data.solved.map(s => [s.puzzleId, s]));
  const byLevel = new Map<number, Puzzle[]>();
  data.puzzles.forEach(p => byLevel.set(p.difficulty, [...(byLevel.get(p.difficulty) || []), p]));
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const noHints = data.solved.filter(s => s.hintsUsed === 0).length;

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="pf-head">
        <Beast kind={learner.beast} size={48} />
        <div>
          <div className="eyebrow">Puzzles</div>
          <h1 className="pf-title">Puzzle corner</h1>
        </div>
      </div>
      <p className="lede">
        No clock, no score to chase. Take your time, use the scratchpad, and ask for a hint if you get stuck.
        Some puzzles have more than one right answer.
      </p>

      <div className="statgrid">
        <div className="stat"><b>{data.solved.length}</b><span>Solved</span></div>
        <div className="stat"><b>{data.puzzles.length}</b><span>To try</span></div>
        <div className="stat"><b>{noHints}</b><span>No-hint solves</span></div>
      </div>

      {levels.length === 0 && <p className="muted" role="status">No puzzles to show yet.</p>}

      {levels.map(lv => (
        <section key={lv} className="pz-level" aria-labelledby={`pz-level-${lv}`}>
          <h2 id={`pz-level-${lv}`} className="pf-h2">
            <span className="pz-dots" aria-hidden="true">{"●".repeat(lv)}{"○".repeat(Math.max(0, 4 - lv))}</span>
            Level {lv} · {LEVELS[lv] || "Expert"}
          </h2>
          <ul className="pf-list">
            {byLevel.get(lv)!.map(p => {
              const s = solved.get(p.id);
              return (
                <li key={p.id} className="drow pf-row">
                  <div>
                    <div className="dhead"><b>{p.title}</b></div>
                    <div className="dsub">{p.prompt.length > 110 ? p.prompt.slice(0, 107).trimEnd() + "…" : p.prompt}</div>
                    <div className="pills">
                      {p.multiple && <span className="badge">many answers</span>}
                      {p.hidden && <span className="badge adv">secret</span>}
                      {s ? <span className="pill good"><span aria-hidden="true">{TROPHY[s.trophy] || "★"} </span>Solved · {s.trophy}</span>
                         : <span className="pill dim">Unsolved</span>}
                    </div>
                  </div>
                  <button className={"btn" + (s ? " ghost" : "")} onClick={() => setOpen({ puzzle: p })}
                          aria-label={`${s ? "Open again" : "Open"}: ${p.title}`}>
                    {s ? "Again" : "Open"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/* ---------------- one puzzle ---------------- */

function scratchKey(learnerId: string, puzzleId: string) { return `bf-scratch:${learnerId}:${puzzleId}`; }

function PuzzleView({ learner, open, onBack, onSolved }: {
  learner: Learner; open: OpenPuzzle; onBack: () => void;
  onSolved: (r: PuzzleResult, hintsUsed: number) => void;
}) {
  const p = open.puzzle;
  const [hints, setHints] = useState<string[]>(open.hints || []);
  const [notes, setNotes] = useState<string>(() => {
    if (open.notes !== undefined) return open.notes;
    try { return typeof window !== "undefined" ? window.localStorage.getItem(scratchKey(learner.id, p.id)) || "" : ""; }
    catch { return ""; }
  });
  const [answer, setAnswer] = useState(open.answer || "");
  const [result, setResult] = useState<PuzzleResult | null>(open.result ?? null);
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [cheer, setCheer] = useState(0);

  useEffect(() => {
    try { window.localStorage.setItem(scratchKey(learner.id, p.id), notes); } catch { /* private mode */ }
  }, [notes, learner.id, p.id]);

  async function getHint() {
    if (busy || hints.length >= p.hintCount) return;
    setBusy(true); setNotice("");
    try {
      const r = await puzzlesApi.hint(p.id, learner.id, hints.length + 1);
      setHints(h => [...h, r.hint]);
    } catch (e) { setNotice(failMessage(e, "Couldn't fetch a hint just now.")); }
    finally { setBusy(false); }
  }

  async function check() {
    if (busy || !answer.trim()) return;
    setBusy(true); setNotice("");
    try {
      const r = await puzzlesApi.answer(p.id, learner.id, answer.trim(), hints.length);
      setResult(r);
      setTries(t => t + 1);
      if (r.correct) { setCheer(c => c + 1); onSolved(r, hints.length); }
    } catch (e) { setNotice(failMessage(e, "Couldn't check that answer. Try again in a moment.")); }
    finally { setBusy(false); }
  }

  const solved = !!result?.correct;
  const hintsLeft = p.hintCount - hints.length;

  return (
    <>
      <button className="back" onClick={onBack}>← Back to puzzles</button>
      <Confetti fire={cheer} />
      <div className="pf-head">
        <Beast kind={learner.beast} size={48} mood={solved ? "happy" : result ? "thinking" : "idle"} />
        <div>
          <div className="eyebrow">Puzzle · Level {p.difficulty} · {LEVELS[p.difficulty] || "Expert"}</div>
          <h1 className="pf-title">{p.title}</h1>
        </div>
      </div>

      <div className="card">
        <p className="qtext pz-prompt">{p.prompt}</p>
        <ReadAloud text={p.prompt} />
        <div className="pills">
          {p.multiple && <span className="badge">more than one right answer</span>}
          <span className="pill">untimed</span>
        </div>

        <div className="field pz-notes">
          <label htmlFor="pz-scratch">Scratchpad (stays on this device)</label>
          <textarea id="pz-scratch" className="pf-line pz-scratch" rows={5} value={notes}
                    placeholder="Try things out here. Nobody marks this."
                    onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="pf-tools">
          <button type="button" className="linkbtn" onClick={getHint} disabled={busy || hintsLeft <= 0 || solved}>
            {hints.length === 0 ? "Need a hint?" : hintsLeft > 0 ? "Another hint" : "No more hints"}
          </button>
          <span className="muted pf-fine">
            {hintsLeft > 0 ? `${hintsLeft} hint${hintsLeft === 1 ? "" : "s"} left` : "all hints used"}
            {hints.length === 0 && " · solve with none for gold"}
          </span>
        </div>
        {hints.map((h, i) => (
          <div className="hintbox" key={i} role="status" aria-live="polite"><b>Hint {i + 1}.</b> {h}</div>
        ))}

        <div className="pz-answerrow">
          <div className="field pz-answerfield">
            <label htmlFor="pz-answer">Your answer</label>
            <input id="pz-answer" className="ansin" value={answer} disabled={solved || busy}
                   inputMode="decimal" autoComplete="off"
                   onChange={e => setAnswer(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter") check(); }} />
          </div>
          <button className="btn" disabled={solved || busy || !answer.trim()} onClick={check}>Check</button>
        </div>
        {notice && <p className="err" role="alert">{notice}</p>}

        {result && !result.correct && (
          <div className="fb bad" role="status" aria-live="polite">
            <h2 className="pf-fbh">Not that one</h2>
            <p className="expl">{result.encouragement || "Try a different approach, or take a hint."}</p>
            {tries >= 3 && hintsLeft > 0 && <p className="expl pf-fine">A hint might open it up. It costs a trophy step, not the puzzle.</p>}
          </div>
        )}

        {result && result.correct && (
          <>
            <div className="fb" role="status" aria-live="polite">
              <h2 className="pf-fbh">
                <span aria-hidden="true">{TROPHY[result.trophy || ""] || "★"} </span>
                {result.firstSolve === false ? "Solved again" : "Solved!"}
              </h2>
              <p className="expl">
                {result.message || "Solved."}
                {result.trophy && ` ${result.trophy[0].toUpperCase() + result.trophy.slice(1)} trophy`}
                {hints.length > 0 && ` with ${hints.length} hint${hints.length === 1 ? "" : "s"}`}.
              </p>
              {result.paths && result.paths.length > 0 && (
                <div className="pz-paths">
                  <h3 className="pf-h3">Ways to get there</h3>
                  <ol className="pf-scaffold">
                    {result.paths.map((path, i) => <li key={i}>{path}</li>)}
                  </ol>
                </div>
              )}
              {result.solutions && result.solutions.length > 1 && (
                <p className="expl pf-fine">
                  Other answers that work: {result.solutions.filter(s => String(s) !== answer.trim()).join(", ")}
                </p>
              )}
              {p.multiple && !(result.paths && result.paths.length) && (
                <p className="expl pf-fine">This puzzle has more than one right answer. Can you find a different one?</p>
              )}
            </div>
            <div className="endbtns">
              {p.multiple && (
                <button className="btn ghost" onClick={() => { setResult(null); setAnswer(""); }}>Try another answer</button>
              )}
              <button className="btn" onClick={onBack}>Back to puzzles</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
