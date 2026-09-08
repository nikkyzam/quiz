import { useMemo, useState } from "react";
import type { Learner } from "../api";
import { sfx } from "./sound";
import { recordGame } from "./store";
import { GameShell, LevelPicker, ResultCard, type Level } from "./common";

/* Math Match — memory, but a card only matches its answer. Kids end up doing
   every sum twice: once to know what is under the card, once to remember
   where it was. */

type Card = { id: number; pair: number; face: string; kind: "sum" | "ans" };

function rnd(n: number) { return Math.floor(Math.random() * n); }

function makeDeck(level: Level): Card[] {
  const pairs = level === "easy" ? 6 : 8;
  const used = new Set<number>();
  const cards: Card[] = [];
  let id = 0;
  for (let p = 0; p < pairs; p++) {
    let a: number, b: number, ans: number, face: string, guard = 0;
    do {
      if (level === "easy") { a = 1 + rnd(9); b = 1 + rnd(9); ans = a + b; face = `${a} + ${b}`; }
      else if (level === "medium") {
        if (rnd(2)) { a = 2 + rnd(8); b = 2 + rnd(8); ans = a * b; face = `${a} × ${b}`; }
        else { a = 8 + rnd(12); b = 2 + rnd(8); ans = a - b; face = `${a} − ${b}`; }
      } else {
        if (rnd(2)) { a = 4 + rnd(9); b = 4 + rnd(9); ans = a * b; face = `${a} × ${b}`; }
        else { b = 2 + rnd(9); ans = 3 + rnd(9); a = b * ans; face = `${a} ÷ ${b}`; }
      }
    } while (used.has(ans) && guard++ < 50);
    used.add(ans);
    cards.push({ id: id++, pair: p, face, kind: "sum" });
    cards.push({ id: id++, pair: p, face: String(ans), kind: "ans" });
  }
  /* Fisher–Yates so matches are never dealt adjacent by construction */
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function starsFor(moves: number, pairs: number): number {
  const perfect = pairs;                       // one move per pair, flawless
  if (moves <= perfect + 2) return 3;
  if (moves <= Math.ceil(perfect * 1.8)) return 2;
  if (moves <= Math.ceil(perfect * 2.6)) return 1;
  return 0;
}

export function Match({ learner, onArcade }: { learner: Learner; onArcade: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [deal, setDeal] = useState(0);
  const deck = useMemo(() => (level ? makeDeck(level) : []), [level, deal]);
  const [up, setUp] = useState<number[]>([]);          // face-up card ids (unmatched)
  const [solved, setSolved] = useState<Set<number>>(new Set());  // solved pair ids
  const [moves, setMoves] = useState(0);
  const [lock, setLock] = useState(false);
  const [result, setResult] = useState<{ moves: number; stars: number; newBest: boolean; best: number } | null>(null);
  const [cheer, setCheer] = useState(0);
  const [mood, setMood] = useState<"idle" | "happy" | "oops">("idle");

  function flip(card: Card) {
    if (lock || result || solved.has(card.pair) || up.includes(card.id)) return;
    sfx.pop();
    const nowUp = [...up, card.id];
    setUp(nowUp);
    if (nowUp.length < 2) return;
    setMoves(m => m + 1);
    const [a, b] = nowUp.map(id => deck.find(c => c.id === id)!);
    if (a.pair === b.pair) {
      setLock(true);
      setMood("happy");
      window.setTimeout(() => {
        const next = new Set(solved); next.add(a.pair);
        setSolved(next); setUp([]); setLock(false); setMood("idle");
        sfx.correct();
        if (level && next.size === deck.length / 2) {
          const m = moves + 1;
          const stars = starsFor(m, deck.length / 2);
          /* fewer moves is better, so best is stored as 999-moves internally */
          const rec = recordGame(learner.id, "match", 999 - m, stars);
          setResult({ moves: m, stars, newBest: rec.newBest, best: 999 - rec.best });
          setCheer(c => c + 1);
          if (stars > 0) sfx.win(); else sfx.done();
        }
      }, 420);
    } else {
      setLock(true);
      setMood("oops");
      window.setTimeout(() => { setUp([]); setLock(false); setMood("idle"); sfx.wrong(); }, 750);
    }
  }

  if (!level)
    return <LevelPicker icon="🃏" title="Math Match"
      blurb="Flip two cards. A sum only matches its answer — find every pair in as few moves as you can!"
      onPick={setLevel} onBack={onArcade} />;

  if (result)
    return <ResultCard beast={learner.beast} title="All matched!" score={result.moves} scoreLabel="moves"
      stars={result.stars} newBest={result.newBest} best={result.best} cheer={cheer}
      onAgain={() => { setDeal(d => d + 1); reset(); }} onLevels={() => { setLevel(null); reset(); }} onArcade={onArcade} />;

  function reset() {
    setUp([]); setSolved(new Set()); setMoves(0); setLock(false); setResult(null); setMood("idle");
  }

  const cols = level === "easy" ? 4 : 4;
  return (
    <GameShell beast={learner.beast} mood={mood} title="Math Match"
      hud={<span className="scorechip">🃏 {moves} moves · {solved.size}/{deck.length / 2} pairs</span>}>
      <div className="matchgrid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {deck.map(c => {
          const isUp = up.includes(c.id) || solved.has(c.pair);
          return (
            <button key={c.id} className={"mcard" + (isUp ? " up" : "") + (solved.has(c.pair) ? " solved" : "")}
              onClick={() => flip(c)}
              aria-label={isUp ? c.face : "Hidden card"}>
              <span className="mface mback" aria-hidden="true">?</span>
              <span className={"mface mfront mono" + (c.kind === "ans" ? " ans" : "")}>{c.face}</span>
            </button>
          );
        })}
      </div>
    </GameShell>
  );
}
