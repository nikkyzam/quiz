import { useMemo, useState } from "react";
import type { Learner } from "../api";
import { Beast } from "../beasts";
import { isMuted, setMuted, sfx } from "../games/sound";
import { loadArcade, totalStars, type GameId } from "../games/store";
import { Sprint } from "../games/Sprint";
import { Match } from "../games/Match";
import { Bonds } from "../games/Bonds";
import { Fractions } from "../games/Fractions";
import { Compare } from "../games/Compare";
import { Stars } from "../games/common";

/* The Arcade — five fast games that train number sense between curriculum
   sessions. Everything runs on the device: no waiting, no wrong time to play. */

const GAMES: { id: GameId; icon: string; name: string; blurb: string; skill: string }[] = [
  { id: "sprint",    icon: "⚡", name: "Number Sprint",   blurb: "60 seconds. How many can you crack?",     skill: "fluency" },
  { id: "match",     icon: "🃏", name: "Math Match",      blurb: "Flip cards and match sums to answers.",   skill: "memory + facts" },
  { id: "bonds",     icon: "🫧", name: "Bond Builder",    blurb: "Pop the bubble that completes the bond.", skill: "number bonds" },
  { id: "fractions", icon: "🍕", name: "Fraction Feast",  blurb: "What fraction of the pizza is gone?",     skill: "fractions" },
  { id: "compare",   icon: "👹", name: "Monster Compare", blurb: "Feed the monster the bigger pile.",       skill: "comparing" }
];

export function Arcade({ learner, onBack }: { learner: Learner; onBack: () => void }) {
  const [game, setGame] = useState<GameId | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  /* bump to re-read the save after a game finishes */
  const [version, setVersion] = useState(0);
  const save = useMemo(() => loadArcade(learner.id), [learner.id, version]);
  const stars = totalStars(save);

  if (game) {
    const exit = () => { setGame(null); setVersion(v => v + 1); };
    return (
      <>
        {game === "sprint" && <Sprint learner={learner} onArcade={exit} />}
        {game === "match" && <Match learner={learner} onArcade={exit} />}
        {game === "bonds" && <Bonds learner={learner} onArcade={exit} />}
        {game === "fractions" && <Fractions learner={learner} onArcade={exit} />}
        {game === "compare" && <Compare learner={learner} onArcade={exit} />}
      </>
    );
  }

  return (
    <>
      <button className="back" onClick={onBack}>← Home</button>
      <div className="arcadehero">
        <Beast kind={learner.beast} size={64} mood="happy" />
        <div>
          <div className="eyebrow">Math Arcade</div>
          <h1 style={{ margin: 0 }}>Ready to play, {learner.name}?</h1>
          <p style={{ margin: "4px 0 0" }}>
            ⭐ {stars} arcade star{stars === 1 ? "" : "s"} earned
          </p>
        </div>
        <button className="soundbtn" aria-pressed={muted}
          aria-label={muted ? "Turn sound on" : "Turn sound off"}
          onClick={() => { const m = !muted; setMuted(m); setMutedState(m); if (!m) sfx.pop(); }}>
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      <div className="gameGrid">
        {GAMES.map(g => {
          const rec = save[g.id];
          return (
            <button key={g.id} className="gamecard" onClick={() => { sfx.pop(); setGame(g.id); }}>
              <span className="gicon" aria-hidden="true">{g.icon}</span>
              <span className="ginfo">
                <span className="gname2">{g.name}</span>
                <span className="gblurb">{g.blurb}</span>
                <span className="gskill">{g.skill}</span>
              </span>
              <span className="gmeta2">
                <Stars n={rec.stars} size={0.8} />
                {rec.plays > 0
                  ? <span className="gplays">{rec.plays} play{rec.plays === 1 ? "" : "s"}</span>
                  : <span className="gplays new">NEW!</span>}
              </span>
            </button>
          );
        })}
      </div>

      <p className="muted" style={{ textAlign: "center", marginTop: 18, fontSize: "calc(.88rem * var(--step))" }}>
        Arcade stars are kept on this device. Curriculum stars are earned in quizzes — both count!
      </p>
    </>
  );
}
