import { useState } from "react";
import type { Learner } from "../api";
import { sfx } from "./sound";
import { recordGame } from "./store";
import { GameShell, LevelPicker, ResultCard, type Level } from "./common";

/* Monster Compare — the hungry monster always eats the bigger pile. Younger
   kids compare berry piles they can count; older kids compare expressions
   and choose the sign. Comparison is estimation practice in disguise. */

const ROUNDS = 10;

function rnd(n: number) { return Math.floor(Math.random() * n); }

type Round =
  | { mode: "pick"; left: string; right: string; leftN: number; rightN: number; dots: boolean }
  | { mode: "sign"; left: string; right: string; leftN: number; rightN: number };

function makeRound(level: Level): Round {
  if (level === "easy") {
    /* countable berry piles, values 1..10, never equal */
    let a = 1 + rnd(10), b = 1 + rnd(10), guard = 0;
    while (a === b && guard++ < 30) b = 1 + rnd(10);
    if (a === b) b = ((a + 3) % 10) + 1;
    return { mode: "pick", left: "", right: "", leftN: a, rightN: b, dots: true };
  }
  if (level === "medium") {
    let a = 5 + rnd(95), b = 5 + rnd(95), guard = 0;
    while (a === b && guard++ < 30) b = 5 + rnd(95);
    if (a === b) b = a + 7 <= 100 ? a + 7 : a - 7;
    return { mode: "pick", left: String(a), right: String(b), leftN: a, rightN: b, dots: false };
  }
  /* hard: expressions on both sides, pick < > or = */
  const expr = () => {
    const kind = rnd(3);
    if (kind === 0) { const a = 2 + rnd(11), b = 2 + rnd(11); return { s: `${a} × ${b}`, n: a * b }; }
    if (kind === 1) { const a = 20 + rnd(70), b = 10 + rnd(60); return { s: `${a} + ${b}`, n: a + b }; }
    const a = 40 + rnd(60), b = 5 + rnd(40); return { s: `${a} − ${b}`, n: a - b };
  };
  /* An expression worth exactly n, written a different way than the one it
     has to equal. The previous version emitted "${n} + 0", which printed the
     answer to the other side in plain digits — there was nothing left to
     compare. These forms all require working the arithmetic out. */
  const exprWorth = (n: number, avoid: string): { s: string; n: number } => {
    const forms: string[] = [];
    for (let b = 2; b <= 12; b++) if (n % b === 0 && n / b >= 2) forms.push(`${n / b} × ${b}`);
    if (n >= 2) { const split = 1 + rnd(n - 1); forms.push(`${split} + ${n - split}`); }
    /* Offset far enough that the minuend is positive: this side of the board
       must never render "-3 − 1", whatever the other side worked out to. */
    const over = (n < 1 ? 1 - n : 0) + 1 + rnd(40);
    forms.push(`${n + over} − ${over}`);
    const usable = forms.filter(s => s !== avoid);
    return { s: usable[rnd(usable.length)], n };
  };

  let L = expr(), R = expr(), guard = 0;
  /* one time in four, engineer equality — spotting "=" is the hard skill */
  if (rnd(4) === 0) R = exprWorth(L.n, L.s);
  while (L.s === R.s && guard++ < 10) R = expr();
  return { mode: "sign", left: L.s, right: R.s, leftN: L.n, rightN: R.n };
}

function Berries({ n }: { n: number }) {
  return (
    <span className="berries" aria-label={`${n} berries`} role="img">
      {Array.from({ length: n }, (_, i) => <i key={i} />)}
    </span>
  );
}

export function Compare({ learner, onArcade }: { learner: Learner; onArcade: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);  // "left" | "right" | "<" | ">" | "="
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [result, setResult] = useState<{ score: number; stars: number; newBest: boolean; best: number } | null>(null);
  const [cheer, setCheer] = useState(0);

  function start(lv: Level | null) {
    setLevel(lv);
    if (lv) { setRound(makeRound(lv)); setIdx(0); setScore(0); setPicked(null); setLastOk(null); setResult(null); }
  }

  function finish(ok: boolean, lv: Level) {
    const finalScore = score + (ok ? 1 : 0);
    const stars = finalScore >= 9 ? 3 : finalScore >= 7 ? 2 : finalScore >= 5 ? 1 : 0;
    const rec = recordGame(learner.id, "compare", finalScore, stars);
    setResult({ score: finalScore, stars, newBest: rec.newBest, best: rec.best });
    setCheer(c => c + 1);
    if (stars > 0) sfx.win(); else sfx.done();
    void lv;
  }

  function pickSide(side: "left" | "right") {
    if (!round || round.mode !== "pick" || picked !== null || !level) return;
    const bigger = round.leftN === round.rightN ? null : round.leftN > round.rightN ? "left" : "right";
    const ok = side === bigger;
    setPicked(side); setLastOk(ok);
    if (ok) { setScore(s => s + 1); sfx.correct(); } else sfx.wrong();
    window.setTimeout(() => {
      const nextIdx = idx + 1;
      setPicked(null); setLastOk(null);
      if (nextIdx >= ROUNDS) finish(ok, level);
      else { setIdx(nextIdx); setRound(makeRound(level)); }
    }, ok ? 420 : 700);
  }

  function pickSign(sign: "<" | ">" | "=") {
    if (!round || round.mode !== "sign" || picked !== null || !level) return;
    const want = round.leftN < round.rightN ? "<" : round.leftN > round.rightN ? ">" : "=";
    const ok = sign === want;
    setPicked(sign); setLastOk(ok);
    if (ok) { setScore(s => s + 1); sfx.correct(); } else sfx.wrong();
    window.setTimeout(() => {
      const nextIdx = idx + 1;
      setPicked(null); setLastOk(null);
      if (nextIdx >= ROUNDS) finish(ok, level);
      else { setIdx(nextIdx); setRound(makeRound(level)); }
    }, ok ? 420 : 800);
  }

  if (!level)
    return <LevelPicker icon="👹" title="Monster Compare"
      blurb="The monster is hungry and ALWAYS eats the bigger pile. Feed it right — or teach it the signs!"
      onPick={start} onBack={onArcade} />;

  if (result)
    return <ResultCard beast={learner.beast} title="Monster is full!" score={`${result.score}/${ROUNDS}`} scoreLabel="correct"
      stars={result.stars} newBest={result.newBest} best={result.best} cheer={cheer}
      onAgain={() => start(level)} onLevels={() => start(null)} onArcade={onArcade} />;

  if (!round) return <div className="loading">Setting the table…</div>;

  return (
    <GameShell beast={learner.beast}
      mood={lastOk === null ? "thinking" : lastOk ? "happy" : "oops"}
      title="Monster Compare"
      hud={<span className="scorechip">👹 {idx + 1}/{ROUNDS} · ⭐ {score}</span>}>
      <div className="track" aria-hidden="true">
        <div className="fill" style={{ width: `${(idx / ROUNDS) * 100}%` }} />
      </div>

      {round.mode === "pick" ? (
        <>
          <p className="qtext" style={{ textAlign: "center" }}>Which pile should the hungry monster eat?</p>
          <div className="plates">
            {(["left", "right"] as const).map(side => (
              <button key={`${idx}-${side}`}
                className={"plate" + (picked === side ? (lastOk ? " right" : " wrong") : "")}
                onClick={() => pickSide(side)}
                aria-label={round.dots ? `Pile on the ${side}` : `${side === "left" ? round.left : round.right}`}>
                {round.dots
                  ? <Berries n={side === "left" ? round.leftN : round.rightN} />
                  : <span className="platenum mono">{side === "left" ? round.left : round.right}</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="cmpline" role="status" aria-live="polite">
            <span className="cmpexpr mono">{round.left}</span>
            <span className="cmphole">?</span>
            <span className="cmpexpr mono">{round.right}</span>
          </div>
          <div className="signrow" role="group" aria-label="Choose the correct sign">
            {(["<", "=", ">"] as const).map(s => (
              <button key={s}
                className={"signbtn" + (picked === s ? (lastOk ? " right" : " wrong") : "")}
                onClick={() => pickSign(s)}
                aria-label={`${s === "<" ? "less than" : s === ">" ? "greater than" : "equals"}`}>
                {s}
              </button>
            ))}
          </div>
          {picked !== null && !lastOk && (
            <p className="hint" role="status">
              {round.left} is {round.leftN} and {round.right} is {round.rightN} — so {round.leftN}
              {" "}{round.leftN < round.rightN ? "<" : round.leftN > round.rightN ? ">" : "="}{" "}{round.rightN}.
            </p>
          )}
        </>
      )}
    </GameShell>
  );
}
