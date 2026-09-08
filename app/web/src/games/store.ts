/* Arcade progress, kept per learner in localStorage.

   The server owns curriculum stars; arcade stars are play rewards, so they
   live on the device — no sign-in round-trip, works offline, and a deleted
   learner leaves nothing behind once their key is removed. */

export type GameId = "sprint" | "match" | "bonds" | "fractions" | "compare";

export type GameRecord = {
  best: number;      // best score (meaning depends on the game)
  stars: number;     // best star rating, 0–3
  plays: number;
};

export type ArcadeSave = Record<GameId, GameRecord>;

const EMPTY: GameRecord = { best: 0, stars: 0, plays: 0 };

const key = (learnerId: string) => `mq-arcade-${learnerId}`;

export function loadArcade(learnerId: string): ArcadeSave {
  try {
    const raw = localStorage.getItem(key(learnerId));
    if (raw) return { ...blank(), ...JSON.parse(raw) };
  } catch { /* corrupted or unavailable storage — start fresh */ }
  return blank();
}

function blank(): ArcadeSave {
  return { sprint: { ...EMPTY }, match: { ...EMPTY }, bonds: { ...EMPTY },
           fractions: { ...EMPTY }, compare: { ...EMPTY } };
}

/* Records a finished game: bumps plays, keeps the best score and the best
   star rating, and returns the updated row so the result screen can say
   "new best!" without a second read. */
export function recordGame(learnerId: string, game: GameId, score: number, stars: number): GameRecord & { newBest: boolean } {
  const save = loadArcade(learnerId);
  const prev = save[game] || { ...EMPTY };
  const next: GameRecord = {
    best: Math.max(prev.best, score),
    stars: Math.max(prev.stars, stars),
    plays: prev.plays + 1
  };
  save[game] = next;
  try { localStorage.setItem(key(learnerId), JSON.stringify(save)); } catch { /* private mode */ }
  return { ...next, newBest: score > prev.best && prev.plays > 0 };
}

export function totalStars(save: ArcadeSave): number {
  return (Object.values(save) as GameRecord[]).reduce((a, r) => a + r.stars, 0);
}
