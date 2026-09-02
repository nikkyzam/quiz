/* Unlockable content and hidden areas (spec 5.7).

   An area is a place on the map that does not appear until it is earned.
   Each holds hidden puzzles and grants an accessory on entry. The unlock
   rules read the same learner statistics as the badge rules. */

export const AREAS = [
  { id: "vault", name: "The Vault", blurb: "A locked room under the forge, full of number puzzles that took centuries to crack.",
    unlock: s => s.bossMastered >= 1, unlockHint: "Master the boss tier of any topic",
    grants: { badge: "area_vault" } },
  { id: "observatory", name: "The Observatory", blurb: "A tower above the hill where the stars are counted, not just admired.",
    unlock: s => s.puzzlesSolved >= 3, unlockHint: "Solve three puzzles",
    grants: { badge: "area_observatory" } },
  { id: "workshop", name: "The Proof Workshop", blurb: "Benches, chalk, and arguments that have to be watertight.",
    unlock: s => s.proofs >= 2, unlockHint: "Complete two proofs",
    grants: { badge: "area_workshop" } }
];

export const AREA_BADGES = {
  area_vault:       { name: "Vault Key",          hint: "Unlock the Vault", category: "story" },
  area_observatory: { name: "Stargazer",          hint: "Unlock the Observatory", category: "story" },
  area_workshop:    { name: "Workshop Pass",      hint: "Unlock the Proof Workshop", category: "story" }
};

export function areaStatus(stats) {
  return AREAS.map(a => ({ id: a.id, name: a.name, blurb: a.blurb,
    unlocked: !!a.unlock(stats), unlockHint: a.unlockHint }));
}
