import { useState } from "react";
import type { Learner } from "../api";
import { sfx } from "./sound";
import { recordGame } from "./store";
import { GameShell, LevelPicker, ResultCard, type Level } from "./common";

/* Fraction Feast — the monster baked a pizza and ate some slices. Say how
   much is gone. Drawing real slices matters: a fraction you can see is a
   fraction you understand. */

const ROUNDS = 8;

function rnd(n: number) { return Math.floor(Math.random() * n); }

type Round = { slices: number; eaten: number; opts: string[]; answer: string };

function fmt(n: number, d: number) { return `${n}/${d}`; }

function makeRound(level: Level): Round {
  const denoms = level === "easy" ? [2, 4] : level === "medium" ? [3, 4, 6, 8] : [3, 4, 5, 6, 8, 10, 12];
  const slices = denoms[rnd(denoms.length)];
  const eaten = 1 + rnd(slices - 1);
  let answer = fmt(eaten, slices);
  /* hard mode sometimes asks for the fraction LEFT, not the fraction eaten */
  const askLeft = level === "hard" && rnd(2) === 1;
  const shown = askLeft ? slices - eaten : eaten;
  answer = fmt(shown, slices);

  const opts = new Set<string>([answer]);
  let guard = 0;
  while (opts.size < 4 && guard++ < 40) {
    const style = rnd(3);
    const d = style === 0 ? fmt(slices - shown, slices)      // the complement
      : style === 1 ? fmt(shown, Math.max(2, slices + (rnd(2) ? 2 : -2)))
      : fmt(Math.min(slices, shown + (rnd(2) ? 1 : -1)), slices);
    opts.add(d);
  }
  return { slices, eaten, opts: [...opts].sort(() => Math.random() - 0.5), answer };
}

/* The pizza: slices laid out around the circle, eaten ones ghosted. */
function Pizza({ slices, eaten }: { slices: number; eaten: number }) {
  const R = 90, C = 100;
  const parts = [];
  for (let i = 0; i < slices; i++) {
    const a0 = (i / slices) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / slices) * Math.PI * 2 - Math.PI / 2;
    const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
    const large = slices > 2 && (a1 - a0) > Math.PI ? 1 : 0;
    parts.push(
      <path key={i}
        d={`M${C} ${C} L${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`}
        className={"slice" + (i < eaten ? " eaten" : "")} />
    );
  }
  return (
    <svg viewBox="0 0 200 200" className="pizza" role="img"
      aria-label={`A pizza cut into ${slices} slices, ${eaten} eaten`}>
      <circle cx={C} cy={C} r={R + 6} className="crust" />
      {parts}
      <circle cx={C} cy={C} r={R} fill="none" className="rim" />
    </svg>
  );
}

export function Fractions({ learner, onArcade }: { learner: Learner; onArcade: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [askLeft, setAskLeft] = useState(false);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [result, setResult] = useState<{ score: number; stars: number; newBest: boolean; best: number } | null>(null);
  const [cheer, setCheer] = useState(0);

  function start(lv: Level | null) {
    setLevel(lv);
    if (lv) {
      const r = makeRound(lv);
      setRound(r);
      setAskLeft(lv === "hard" && r.answer === fmt(r.slices - r.eaten, r.slices) && r.slices - r.eaten !== r.eaten);
      setIdx(0); setScore(0); setPicked(null); setResult(null);
    }
  }

  function pick(s: string) {
    if (!round || picked !== null || !level) return;
    const ok = s === round.answer;
    setPicked(s);
    if (ok) { setScore(sc => sc + 1); sfx.correct(); } else sfx.wrong();
    window.setTimeout(() => {
      const nextIdx = idx + 1;
      setPicked(null);
      if (nextIdx >= ROUNDS) {
        const finalScore = score + (ok ? 1 : 0);
        const stars = finalScore >= 7 ? 3 : finalScore >= 5 ? 2 : finalScore >= 3 ? 1 : 0;
        const rec = recordGame(learner.id, "fractions", finalScore, stars);
        setResult({ score: finalScore, stars, newBest: rec.newBest, best: rec.best });
        setCheer(c => c + 1);
        if (stars > 0) sfx.win(); else sfx.done();
      } else {
        const r = makeRound(level);
        setRound(r);
        setAskLeft(level === "hard" && r.answer === fmt(r.slices - r.eaten, r.slices) && r.slices - r.eaten !== r.eaten);
        setIdx(nextIdx);
      }
    }, ok ? 420 : 750);
  }

  if (!level)
    return <LevelPicker icon="🍕" title="Fraction Feast"
      blurb="The monster baked a pizza and munched some slices. What fraction of the pizza is gone?"
      onPick={start} onBack={onArcade} />;

  if (result)
    return <ResultCard beast={learner.beast} title="Feast finished!" score={`${result.score}/${ROUNDS}`} scoreLabel="correct"
      stars={result.stars} newBest={result.newBest} best={result.best} cheer={cheer}
      onAgain={() => start(level)} onLevels={() => start(null)} onArcade={onArcade} />;

  if (!round) return <div className="loading">Baking…</div>;

  return (
    <GameShell beast={learner.beast}
      mood={picked === null ? "idle" : picked === round.answer ? "happy" : "oops"}
      title="Fraction Feast"
      hud={<span className="scorechip">🍕 {idx + 1}/{ROUNDS} · ⭐ {score}</span>}>
      <div className="track" aria-hidden="true">
        <div className="fill" style={{ width: `${(idx / ROUNDS) * 100}%` }} />
      </div>
      <p className="qtext" style={{ textAlign: "center" }}>
        {askLeft ? "What fraction of the pizza is left?" : "What fraction of the pizza was eaten?"}
      </p>
      <div className="fig"><Pizza slices={round.slices} eaten={round.eaten} /></div>
      <div className="fracrow" role="group" aria-label="Answer choices">
        {round.opts.map((s, i) => {
          const [n, d] = s.split("/");
          return (
            <button key={`${idx}-${s}-${i}`}
              className={"fracbtn" + (picked === s ? (s === round.answer ? " right" : " wrong") : "")}
              onClick={() => pick(s)}>
              <span className="frac"><span>{n}</span><span className="fbar" /><span>{d}</span></span>
            </button>
          );
        })}
      </div>
    </GameShell>
  );
}
