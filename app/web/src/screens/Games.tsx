import "../styles/play.css";
import { useEffect, useRef, useState } from "react";
import { call, post, ApiError, type Learner } from "../api";
import { Beast, Confetti, Grid } from "../beasts";

/* Mini-games (spec 5.9). The server builds each round from a seed and scores
   it from the same seed; this screen only runs the clock and the input. */

export type GameInfo = { id: string; title: string; topicId: string; grade: string; seconds: number; blurb: string };
export type GamesData = { games: GameInfo[] };
export type GameRound = { sessionId: string; gameId: string; seed: number; seconds: number; items: any[]; total: number };
export type GameResult = {
  score: number; total: number; points: number; late: boolean; bestPoints: number | null;
  badges: any[]; seconds: number;
};

const gamesApi = {
  list: () => call<GamesData>("/games"),
  start: (id: string, learnerId: string) => post<GameRound>(`/games/${id}/start`, { learnerId }),
  finish: (sessionId: string, responses: unknown[]) => post<GameResult>("/games/finish", { sessionId, responses })
};

function friendly(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Please sign in again to play.";
    if (e.status === 403) return "This learner is not on your account.";
    if (e.status === 404) return "That game round has expired. Start a new one.";
  }
  return fallback;
}

const badgeName = (b: any) => typeof b === "string" ? b : (b?.name || b?.code || "badge");

export function Games({ learner, onBack, initial }: { learner: Learner; onBack: () => void; initial?: GamesData }) {
  const [games, setGames] = useState<GameInfo[] | null>(initial?.games ?? null);
  const [error, setError] = useState("");
  const [round, setRound] = useState<{ info: GameInfo; round: GameRound } | null>(null);
  const [result, setResult] = useState<{ info: GameInfo; result: GameResult } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) return;
    gamesApi.list().then(r => setGames(r.games))
      .catch(e => setError(friendly(e, "Couldn't load the games. Check the server is running.")));
  }, [initial]);

  async function start(info: GameInfo) {
    setBusy(true); setError("");
    try { setRound({ info, round: await gamesApi.start(info.id, learner.id) }); setResult(null); }
    catch (e) { setError(friendly(e, "Couldn't start that game.")); }
    finally { setBusy(false); }
  }

  if (round) {
    return <RoundPlay learner={learner} info={round.info} round={round.round}
      onQuit={() => setRound(null)}
      onDone={r => { setResult({ info: round.info, result: r }); setRound(null); }} />;
  }

  if (result) {
    const { info, result: r } = result;
    return (
      <>
        <button className="back" onClick={() => setResult(null)}>← All games</button>
        <Confetti fire={r.points > 0 ? 1 : 0} />
        <div className="play-head">
          <Beast kind={learner.beast} size={56} mood={r.score > 0 ? "happy" : "oops"} />
          <div><div className="eyebrow">{info.title}</div><h1>Round over!</h1></div>
        </div>
        <div className="bigscore" role="status">{r.score}<small> / {r.total}</small></div>
        {r.late
          ? <p className="play-status warn" role="status">That round came in after the clock ran out, so no points this time.</p>
          : <p className="result-points">+{r.points} points {r.bestPoints != null && r.bestPoints > r.points ? `(your best is ${r.bestPoints})` : r.points > 0 ? "(a new best!)" : ""}</p>}
        <p className="muted">Finished in {r.seconds} seconds.</p>
        {r.badges?.length > 0 && (
          <>
            <h2>New badges</h2>
            <ul className="badgelist">{r.badges.map((b, i) => <li key={i}>{badgeName(b)}</li>)}</ul>
          </>
        )}
        {error && <p className="err" role="alert">{error}</p>}
        <div className="endbtns">
          <button className="btn" disabled={busy} onClick={() => start(info)}>Play again</button>
          <button className="btn ghost" onClick={() => setResult(null)}>All games</button>
        </div>
      </>
    );
  }

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="play-head">
        <Beast kind={learner.beast} size={48} />
        <div><div className="eyebrow">Mini-games</div><h1>Quick rounds</h1></div>
      </div>
      <p className="lede">Short, fast and scored. Every point you win counts towards your levels.</p>
      {error && <p className="err" role="alert">{error}</p>}
      {!games && !error && <div className="loading" role="status">Loading games…</div>}
      {games && (
        <ul className="play-list" style={{ listStyle: "none", padding: 0 }}>
          {games.map(g => (
            <li className="drow" key={g.id}>
              <div className="dhead"><b>{g.title}</b>
                <span className="gamecard-meta">Grade {g.grade} · {g.seconds}s</span></div>
              <div className="dsub">{g.blurb}</div>
              <div className="play-actions">
                <button className="btn" disabled={busy} onClick={() => start(g)}>Play {g.title}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------------- one timed round ---------------- */

function RoundPlay({ learner, info, round, onDone, onQuit }: {
  learner: Learner; info: GameInfo; round: GameRound;
  onDone: (r: GameResult) => void; onQuit: () => void;
}) {
  const [pos, setPos] = useState(0);
  const [left, setLeft] = useState(round.seconds);
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const responses = useRef<unknown[]>([]);
  const done = useRef(false);

  async function finish() {
    if (done.current) return;
    done.current = true;
    setFinishing(true);
    try { onDone(await gamesApi.finish(round.sessionId, responses.current)); }
    catch (e) { setError(friendly(e, "Couldn't send your score. Try the round again.")); }
  }

  useEffect(() => {
    const end = Date.now() + round.seconds * 1000;
    const t = setInterval(() => {
      const l = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0) { clearInterval(t); finish(); }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.sessionId]);

  function answer(v: unknown) {
    if (done.current) return;
    responses.current[pos] = v;
    if (pos + 1 >= round.total) finish();
    else setPos(pos + 1);
  }

  const item = round.items[pos];
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");

  return (
    <>
      <button className="back" onClick={onQuit}>← Leave</button>
      <div className="hud">
        <div className="qcount"><h1 style={{ fontSize: "1.1rem", margin: 0, display: "inline" }}>{info.title}</h1> · <b>{pos + 1}</b> / {round.total}</div>
        <div className={"timer" + (left <= 10 ? " low" : "")} role="timer" aria-label="Time left">{mm}:{ss}</div>
      </div>
      <div className="visually-hidden" role="status">{left === 10 ? "Ten seconds left" : ""}</div>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={round.total}
           aria-valuenow={pos} aria-label={`Item ${pos + 1} of ${round.total}`}>
        <div className="fill" style={{ width: `${(pos / round.total) * 100}%` }} />
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {finishing && !error && <div className="loading" role="status">Scoring your round…</div>}
      {!finishing && item && (
        <div className="card">
          <div className="qhead"><Beast kind={learner.beast} size={44} /><div className="sec">Grade {info.grade}</div></div>
          {info.id === "factor-blast" && <FactorBlast key={pos} item={item} onAnswer={answer} />}
          {info.id === "bond-catch" && <BondCatch key={pos} item={item} onAnswer={answer} />}
          {info.id === "coordinate-hunt" && <CoordinateHunt key={pos} item={item} onAnswer={answer} />}
          {info.id === "table-sprint" && <TableSprint key={pos} item={item} onAnswer={answer} />}
          {!["factor-blast", "bond-catch", "coordinate-hunt", "table-sprint"].includes(info.id) &&
            <GenericItem key={pos} item={item} onAnswer={answer} />}
        </div>
      )}
    </>
  );
}

/* Number keys 1..n pick the nth tile, but never while typing in a field. */
function useNumberKeys(n: number, fn: (i: number) => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const i = Number(e.key);
      if (Number.isInteger(i) && i >= 1 && i <= n) { e.preventDefault(); fn(i - 1); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [n, fn]);
}

function FactorBlast({ item, onAnswer }: { item: { target: number; board: number[] }; onAnswer: (v: number[]) => void }) {
  const [sel, setSel] = useState<number[]>([]);
  const toggle = (n: number) => setSel(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n]);
  useNumberKeys(item.board.length, i => toggle(item.board[i]));
  return (
    <>
      <p className="target">{item.target}<small>tap every number that divides it</small></p>
      <div className="board" role="group" aria-label={`Numbers on the board for ${item.target}`}>
        {item.board.map((n, i) => (
          <button key={n} type="button" className="tile" aria-pressed={sel.includes(n)} onClick={() => toggle(n)}>
            <span className="keyhint" aria-hidden="true">{i + 1}</span>{n}
          </button>
        ))}
      </div>
      <div className="play-actions">
        <button className="btn" onClick={() => onAnswer(sel)}>Blast! {sel.length ? `(${sel.length} picked)` : ""}</button>
        <span className="muted" style={{ fontSize: ".85rem" }}>Keys 1 to {item.board.length} pick tiles.</span>
      </div>
    </>
  );
}

function BondCatch({ item, onAnswer }: { item: { target: number; hold: number; falling: number[] }; onAnswer: (v: number) => void }) {
  useNumberKeys(item.falling.length, i => onAnswer(item.falling[i]));
  return (
    <>
      <div className="hold">
        <span>You hold<b>{item.hold}</b></span>
        <span>Make<b>{item.target}</b></span>
      </div>
      <p className="muted" style={{ textAlign: "center", margin: 0 }}>Catch the number that adds up to {item.target}.</p>
      <div className="board two" role="group" aria-label="Falling numbers">
        {item.falling.map((n, i) => (
          <button key={n} type="button" className="tile" onClick={() => onAnswer(n)}>
            <span className="keyhint" aria-hidden="true">{i + 1}</span>{n}
          </button>
        ))}
      </div>
    </>
  );
}

function CoordinateHunt({ item, onAnswer }: { item: { x: number; y: number; prompt: string }; onAnswer: (v: number[]) => void }) {
  const [x, setX] = useState(""), [y, setY] = useState("");
  const parse = (s: string) => Number(s.replace("−", "-").trim());
  const ready = x.trim() !== "" && y.trim() !== "" && Number.isFinite(parse(x)) && Number.isFinite(parse(y));
  const go = () => { if (ready) onAnswer([parse(x), parse(y)]); };
  return (
    <>
      <p className="qtext">{item.prompt || "Where is the treasure?"}</p>
      <div className="fig"><Grid spec={{ pts: [[item.x, item.y, "★"]] }} /></div>
      <div className="inrow">
        <label className="visually-hidden" htmlFor="hunt-x">x coordinate</label>
        <input id="hunt-x" className="ansin" value={x} inputMode="numeric" placeholder="x" autoFocus
          onChange={e => setX(e.target.value)} onKeyDown={e => { if (e.key === "Enter") go(); }} />
        <label className="visually-hidden" htmlFor="hunt-y">y coordinate</label>
        <input id="hunt-y" className="ansin" value={y} inputMode="numeric" placeholder="y"
          onChange={e => setY(e.target.value)} onKeyDown={e => { if (e.key === "Enter") go(); }} />
        <button className="btn" disabled={!ready} onClick={go}>Found it</button>
      </div>
    </>
  );
}

function TableSprint({ item, onAnswer }: { item: { a: number; b: number }; onAnswer: (v: number) => void }) {
  const [v, setV] = useState("");
  const go = () => { if (v.trim() !== "") onAnswer(Number(v)); };
  return (
    <>
      <p className="sprint" aria-hidden="true">{item.a} × {item.b} = ?</p>
      <div className="inrow">
        <label className="visually-hidden" htmlFor="sprint-in">{item.a} times {item.b}</label>
        <input id="sprint-in" className="ansin" value={v} inputMode="numeric" autoFocus placeholder="?"
          onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === "Enter") go(); }} />
        <button className="btn" disabled={v.trim() === ""} onClick={go}>Go</button>
      </div>
    </>
  );
}

/* A game this client does not know yet: show the item and take a typed answer,
   so a new server-side game still plays rather than breaking the screen. */
function GenericItem({ item, onAnswer }: { item: any; onAnswer: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <>
      <p className="qtext">{item?.prompt || Object.entries(item || {}).map(([k, val]) => `${k}: ${JSON.stringify(val)}`).join(" · ")}</p>
      <div className="inrow">
        <label className="visually-hidden" htmlFor="generic-in">Your answer</label>
        <input id="generic-in" className="ansin" value={v} autoFocus onChange={e => setV(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && v.trim()) onAnswer(v); }} />
        <button className="btn" disabled={!v.trim()} onClick={() => onAnswer(v)}>Go</button>
      </div>
    </>
  );
}
