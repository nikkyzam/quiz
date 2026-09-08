import type { ReactNode } from "react";
import { Beast, Confetti, type Mood } from "../beasts";
import { sfx } from "./sound";

/* Shared furniture for arcade games so every game feels like the same toy box:
   a level picker with kid-sized labels, a shell with the learner's beast
   reacting to play, and a result card with stars and confetti. */

export type Level = "easy" | "medium" | "hard";

export const LEVELS: { id: Level; icon: string; name: string }[] = [
  { id: "easy",   icon: "🐣", name: "Sprout" },
  { id: "medium", icon: "🚀", name: "Explorer" },
  { id: "hard",   icon: "🦁", name: "Champion" }
];

export function LevelPicker({ icon, title, blurb, onPick, onBack }: {
  icon: string; title: string; blurb: string;
  onPick: (level: Level) => void; onBack: () => void;
}) {
  return (
    <>
      <button className="back" onClick={onBack}>← Arcade</button>
      <div className="gamehero">
        <span className="gicon big" aria-hidden="true">{icon}</span>
        <div>
          <div className="eyebrow">Arcade</div>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <p className="lede" style={{ marginBottom: 0 }}>{blurb}</p>
        </div>
      </div>
      <h2 style={{ marginTop: 22 }}>Pick your challenge</h2>
      <div className="levelrow">
        {LEVELS.map(l => (
          <button key={l.id} className="levelcard" onClick={() => { sfx.pop(); onPick(l.id); }}>
            <span className="lvlicon" aria-hidden="true">{l.icon}</span>
            <b>{l.name}</b>
          </button>
        ))}
      </div>
    </>
  );
}

export function GameShell({ beast, mood, title, hud, children }: {
  beast: string; mood: Mood; title: string;
  hud?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="card gamestage">
      <div className="gametop">
        <Beast kind={beast} size={44} mood={mood} />
        <div className="gamesec">{title}</div>
        <div className="gamehud">{hud}</div>
      </div>
      {children}
    </div>
  );
}

export function Stars({ n, size = 1 }: { n: number; size?: number }) {
  return (
    <span className="starburst" style={{ fontSize: `${1.6 * size}rem` }} role="img"
          aria-label={`${n} out of 3 stars`}>
      {[0, 1, 2].map(i => <span key={i} className={i < n ? "lit" : ""}>★</span>)}
    </span>
  );
}

export function ResultCard({ beast, title, score, scoreLabel, stars, newBest, best, cheer, onAgain, onLevels, onArcade }: {
  beast: string; title: string; score: string | number; scoreLabel: string;
  stars: number; newBest: boolean; best: number; cheer: number;
  onAgain: () => void; onLevels: () => void; onArcade: () => void;
}) {
  return (
    <div className="card gamestage">
      <Confetti fire={cheer} />
      <div className="gdone">
        <Beast kind={beast} size={72} mood={stars > 0 ? "happy" : "idle"} />
        <h2 style={{ margin: "10px 0 2px" }}>{title}</h2>
        <Stars n={stars} size={1.4} />
        <div className="bigscore" style={{ fontSize: "calc(2.8rem * var(--step))" }}>
          {score}<small> {scoreLabel}</small>
        </div>
        {newBest && <div className="newbest">🎉 New best!</div>}
        <p className="muted" style={{ margin: "4px 0 0" }}>Best so far: {best}</p>
        <div className="endbtns" style={{ justifyContent: "center" }}>
          <button className="btn" onClick={onAgain}>Play again</button>
          <button className="btn ghost" onClick={onLevels}>Change level</button>
          <button className="btn ghost" onClick={onArcade}>Arcade</button>
        </div>
      </div>
    </div>
  );
}
