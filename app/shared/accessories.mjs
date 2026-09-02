/* Avatar accessories (spec 5.3), each unlocked by an achievement. Original,
   drawn in SVG by the client; the server only decides what is unlocked and
   what is equipped. */

export const SLOTS = ["hat", "eyes", "held", "trail"];

export const ACCESSORIES = [
  { id: "cap",        slot: "hat",   name: "Counting Cap",       unlock: { badge: "first_steps" } },
  { id: "crown",      slot: "hat",   name: "Champion's Crown",   unlock: { badge: "mastered_5" } },
  { id: "wizard",     slot: "hat",   name: "Number Wizard Hat",  unlock: { badge: "strand_nt_first" } },
  { id: "laurel",     slot: "hat",   name: "Contest Laurel",     unlock: { badge: "contest_ready" } },
  { id: "halo",       slot: "hat",   name: "Streak Halo",        unlock: { badge: "streak_7" } },
  { id: "glasses",    slot: "eyes",  name: "Thinking Glasses",   unlock: { badge: "unaided" } },
  { id: "monocle",    slot: "eyes",  name: "Puzzler's Monocle",  unlock: { badge: "puzzles_3" } },
  { id: "stars",      slot: "eyes",  name: "Starry Eyes",        unlock: { badge: "perfect_5" } },
  { id: "pencil",     slot: "held",  name: "Golden Pencil",      unlock: { badge: "proofs_1" } },
  { id: "trophy",     slot: "held",  name: "Little Trophy",      unlock: { badge: "gold_puzzles_1" } },
  { id: "hammer",     slot: "held",  name: "Forge Hammer",       unlock: { badge: "story_6" } },
  { id: "compass",    slot: "held",  name: "Explorer's Compass", unlock: { badge: "grade_k_explorer" } },
  { id: "sparkles",   slot: "trail", name: "Sparkle Trail",      unlock: { level: 5 } },
  { id: "numbers",    slot: "trail", name: "Number Trail",       unlock: { level: 10 } },
  { id: "flames",     slot: "trail", name: "Forge Flames",       unlock: { badge: "boss_5" } }
];

export function unlockedAccessories({ badges, level }) {
  const held = new Set(badges);
  return ACCESSORIES.filter(a => (a.unlock.badge && held.has(a.unlock.badge)) || (a.unlock.level && level >= a.unlock.level));
}
