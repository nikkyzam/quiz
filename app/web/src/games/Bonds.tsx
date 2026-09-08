import { useState } from "react";
import type { Learner } from "../api";
import { sfx } from "./sound";
import { recordGame } from "./store";
import { GameShell, LevelPicker, ResultCard, type Level } from "./common";

/* Bond Builder — number bonds are the single best predictor of early maths
   confidence, so they get a whole game. Fill the missing part of the bond:
   10 = 7 + 🫧. Ten rounds, three near-miss bubbles to choose from. */

const ROUNDS = 10;

function rnd(n: number) { return Math.floor(Math.random() * n); }

function makeRound(level: Level) {
  const target = level === "easy" ? 10 : level === "medium" ? 20 : 100;
  const max = target;
  const part = level === "hard"
    ? (rnd(9) + 1) * 10 + (rnd(2) ? 0 : 5)          // 100 uses 5s and 10s
    : 1 + rnd(max - 1);
  const missing = target - part;
  const opts = new Set<number>([missing]);
  let guard = 0;
  while (opts.size < 4 && guard++ < 40) {
    const step = level === "hard" ? 5 * (1 + rnd(2)) : 1 + rnd(3);
    const d = missing + (rnd(2) ? step : -step);
    if (d >= 0 && d <= target) opts.add(d);
  }
  /* Top up from an advancing counter, never from opts.size: keyed on the size,
     a candidate already in the set left the size unchanged and the same value
     was recomputed for ever, freezing the tab. Bounded by the number of
     residues, so it always ends even if fewer than four can be found. */
  for (let k = 1; opts.size < 4 && k <= target; k++) opts.add((missing + k) % (target + 1));
  return { target, part, missing, opts: [...opts].sort(() => Math.random() - 0.5) };
}

export function Bonds({ learner, onArcade }: { learner: Learner; onArcade: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [round, setRound] = useState<ReturnType<typeof makeRound> | null>(null);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<{ score: number; stars: number; newBest: boolean; best: number } | null>(null);
  const [cheer, setCheer] = useState(0);

  function start(lv: Level | null) {
    setLevel(lv);
    if (lv) { setRound(makeRound(lv)); setIdx(0); setScore(0); setPicked(null); setResult(null); }
  }

  function pick(n: number) {
    if (!round || picked !== null || !level) return;
    const ok = n === round.missing;
    setPicked(n);
    if (ok) { setScore(s => s + 1); sfx.correct(); } else sfx.wrong();
    window.setTimeout(() => {
      const nextIdx = idx + 1;
      setPicked(null);
      if (nextIdx >= ROUNDS) {
        const finalScore = score + (ok ? 1 : 0);
        const stars = finalScore >= 9 ? 3 : finalScore >= 7 ? 2 : finalScore >= 5 ? 1 : 0;
        const rec = recordGame(learner.id, "bonds", finalScore, stars);
        setResult({ score: finalScore, stars, newBest: rec.newBest, best: rec.best });
        setCheer(c => c + 1);
        if (stars > 0) sfx.win(); else sfx.done();
      } else {
        setIdx(nextIdx);
        setRound(makeRound(level));
      }
    }, ok ? 420 : 700);
  }

  if (!level)
    return <LevelPicker icon="🫧" title="Bond Builder"
      blurb="Every number has best friends that build it. 10 = 7 + ? — pop the bubble that completes the bond!"
      onPick={start} onBack={onArcade} />;

  if (result)
    return <ResultCard beast={learner.beast} title="Bonds built!" score={`${result.score}/${ROUNDS}`} scoreLabel="correct"
      stars={result.stars} newBest={result.newBest} best={result.best} cheer={cheer}
      onAgain={() => start(level)} onLevels={() => start(null)} onArcade={onArcade} />;

  if (!round) return <div className="loading">Blowing bubbles…</div>;

  return (
    <GameShell beast={learner.beast}
      mood={picked === null ? "thinking" : picked === round.missing ? "happy" : "oops"}
      title="Bond Builder"
      hud={<span className="scorechip">🫧 {idx + 1}/{ROUNDS} · ⭐ {score}</span>}>
      <div className="track" aria-hidden="true">
        <div className="fill" style={{ width: `${(idx / ROUNDS) * 100}%` }} />
      </div>
      <div className="bondeq" role="status" aria-live="polite">
        <span className="bondnum target">{round.target}</span>
        <span className="bondop">=</span>
        <span className="bondnum">{round.part}</span>
        <span className="bondop">+</span>
        <span className="bondnum hole">?</span>
      </div>
      <div className="bubblerow">
        {round.opts.map((n, i) => (
          <button key={`${idx}-${n}-${i}`}
            className={"bubble" + (picked === n ? (n === round.missing ? " right" : " wrong") : "")}
            onClick={() => pick(n)}
            aria-label={`Choose ${n}`}>
            {n}
          </button>
        ))}
      </div>
      {picked !== null && picked !== round.missing && (
        <p className="hint" role="status">That bond makes {round.part + picked} — the missing friend is {round.missing}.</p>
      )}
    </GameShell>
  );
}
