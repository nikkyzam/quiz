import { useEffect, useRef, useState } from "react";
import type { Learner } from "../api";
import { sfx } from "./sound";
import { recordGame } from "./store";
import { GameShell, LevelPicker, ResultCard, type Level } from "./common";

/* Number Sprint — sixty seconds, as many as you can. Streaks multiply the
   points, so careful and fast beats reckless and fast. All arithmetic is
   generated locally; nothing here needs the server. */

const DURATION = 60;

type Q = { text: string; answer: number; opts: number[] };

function rnd(n: number) { return Math.floor(Math.random() * n); }

function makeQ(level: Level): Q {
  let a: number, b: number, text: string, answer: number;
  if (level === "easy") {
    a = 1 + rnd(9); b = 1 + rnd(9);
    if (Math.random() < 0.5 || a < b) { text = `${a} + ${b}`; answer = a + b; }
    else { text = `${a} − ${b}`; answer = a - b; }
  } else if (level === "medium") {
    const op = rnd(3);
    if (op === 0) { a = 6 + rnd(14); b = 4 + rnd(14); text = `${a} + ${b}`; answer = a + b; }
    else if (op === 1) { a = 10 + rnd(15); b = 1 + rnd(a - 1); text = `${a} − ${b}`; answer = a - b; }
    else { a = 2 + rnd(5); b = 2 + rnd(5); text = `${a} × ${b}`; answer = a * b; }
  } else {
    const op = rnd(4);
    if (op === 0) { a = 15 + rnd(35); b = 11 + rnd(30); text = `${a} + ${b}`; answer = a + b; }
    else if (op === 1) { a = 30 + rnd(60); b = 5 + rnd(a - 6); text = `${a} − ${b}`; answer = a - b; }
    else if (op === 2) { a = 3 + rnd(10); b = 3 + rnd(10); text = `${a} × ${b}`; answer = a * b; }
    else { b = 2 + rnd(9); answer = 2 + rnd(9); a = b * answer; text = `${a} ÷ ${b}`; }
  }
  /* distractors: near misses, never duplicates, never negative */
  const opts = new Set<number>([answer]);
  let guard = 0;
  while (opts.size < 4 && guard++ < 40) {
    const d = answer + (rnd(2) ? 1 : -1) * (1 + rnd(Math.max(2, Math.ceil(Math.abs(answer) / 4))));
    if (d >= 0) opts.add(d);
  }
  /* Top up from an advancing counter, never from opts.size. Keyed on the
     size, a candidate that was already in the set left the size unchanged, so
     the next pass recomputed the same value and the loop spun for ever —
     a frozen tab rather than a wrong answer. */
  for (let k = 1; opts.size < 4; k++) opts.add(answer + k);
  return { text, answer, opts: [...opts].sort(() => Math.random() - 0.5) };
}

function starsFor(level: Level, score: number): number {
  const bar = { easy: [8, 12, 16], medium: [7, 11, 15], hard: [6, 10, 14] }[level];
  return score >= bar[2] ? 3 : score >= bar[1] ? 2 : score >= bar[0] ? 1 : 0;
}

export function Sprint({ learner, onArcade }: { learner: Learner; onArcade: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [q, setQ] = useState<Q | null>(null);
  const [time, setTime] = useState(DURATION);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);   // last tapped option
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [result, setResult] = useState<{ score: number; stars: number; newBest: boolean; best: number } | null>(null);
  const [cheer, setCheer] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /* Bumped by "Play again". The reset below keys off it as well as the level,
     because setLevel(level) with the level it already holds is a no-op React
     bails out of — the effect never re-ran, the result card never cleared,
     and the button did nothing. */
  const [deal, setDeal] = useState(0);

  useEffect(() => {
    if (!level) return;
    setQ(makeQ(level)); setTime(DURATION); setScore(0); setStreak(0);
    setResult(null); setPicked(null); setLastOk(null);
    const started = Date.now();
    timer.current = setInterval(() => {
      const left = Math.max(0, DURATION - Math.floor((Date.now() - started) / 1000));
      setTime(left);
      if (left <= 5 && left > 0) sfx.tick();
      if (left === 0 && timer.current) { clearInterval(timer.current); timer.current = null; }
    }, 250);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [level, deal]);

  /* When the clock hits zero, bank the run once. */
  const banked = useRef(false);
  useEffect(() => {
    if (time === 0 && level && !banked.current) {
      banked.current = true;
      const stars = starsFor(level, score);
      const rec = recordGame(learner.id, "sprint", score, stars);
      setResult({ score, stars, newBest: rec.newBest, best: rec.best });
      setCheer(c => c + 1);
      if (stars > 0) sfx.win(); else sfx.done();
    }
    if (time > 0) banked.current = false;
  }, [time, level, score, learner.id]);

  function pick(n: number) {
    /* `picked !== null` is the re-entry guard every other game has. Without
       it the answer stays tappable for the 260ms the feedback is on screen,
       and each tap scored again: ten fast taps on the right answer were ten
       points and a ten-long streak, and a double-tap on a touch screen
       double-counted by accident. */
    if (!level || time === 0 || !q || picked !== null) return;
    const ok = n === q.answer;
    setPicked(n); setLastOk(ok);
    if (ok) {
      const bonus = streak >= 4 ? 2 : 1;      // 5+ in a row counts double
      setScore(s => s + bonus);
      setStreak(s => {
        const ns = s + 1;
        if (ns > 0 && ns % 5 === 0) sfx.streak(); else sfx.correct();
        return ns;
      });
    } else {
      setStreak(0); sfx.wrong();
    }
    window.setTimeout(() => { setQ(makeQ(level)); setPicked(null); setLastOk(null); }, ok ? 260 : 550);
  }

  if (!level)
    return <LevelPicker icon="⚡" title="Number Sprint"
      blurb="How many can you crack in 60 seconds? Five in a row and every answer counts double!"
      onPick={setLevel} onBack={onArcade} />;

  if (result)
    return <ResultCard beast={learner.beast} title="Time!" score={result.score} scoreLabel="points"
      stars={result.stars} newBest={result.newBest} best={result.best} cheer={cheer}
      onAgain={() => setDeal(d => d + 1)} onLevels={() => setLevel(null)} onArcade={onArcade} />;

  if (!q) return <div className="loading">Get ready…</div>;

  return (
    <GameShell beast={learner.beast}
      mood={lastOk === null ? "idle" : lastOk ? "happy" : "oops"}
      title="Number Sprint"
      hud={<>
        <span className="scorechip">⚡ {score}{streak >= 5 && <span className="streak">×2 🔥</span>}</span>
        <span className={"timechip" + (time <= 10 ? " low" : "")}>⏱ {time}s</span>
      </>}>
      <div className="track" aria-hidden="true">
        <div className="fill" style={{ width: `${(time / DURATION) * 100}%` }} />
      </div>
      <div className="sprintq" role="status" aria-live="polite">{q.text} = ?</div>
      <div className="opts" style={{ gridTemplateColumns: "1fr 1fr", display: "grid" }}>
        {q.opts.map((n, i) => (
          <button key={`${q.text}-${n}-${i}`}
            className={"opt mono" + (picked === n ? (lastOk ? " right" : " wrong") : "")}
            onClick={() => pick(n)}>
            <span className="key">{["A", "B", "C", "D"][i]}</span>{n}
            {picked === n && <span className="mark">{lastOk ? "✓" : "✗"}</span>}
          </button>
        ))}
      </div>
      {streak >= 3 && <p className="streakline" aria-live="polite">🔥 {streak} in a row!</p>}
    </GameShell>
  );
}
