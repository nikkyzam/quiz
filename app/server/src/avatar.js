/* Avatar customisation earned through achievement (spec 5.3, 5.7, 4.1.2).

   Accessories unlock by holding a badge, not by spending points. That is a
   deliberate difference: points accumulate with time spent, so a
   points-priced shop rewards whoever sat there longest, and the child who
   grinds easy rounds ends up looking the most decorated. A badge is earned
   for doing a specific thing, so what a learner is wearing says what they
   actually did.

   Locked items are shown, with the badge that unlocks them named. Hiding them
   would make the collection invisible until it was already complete, which
   removes the only reason it works — a child needs to see the thing they have
   not got yet, and know what earns it. */

import { db, now } from "./db.js";
import { BADGES } from "./rewards.js";

export const ACCESSORIES = {
  starter_scarf:   { name: "Explorer's Scarf",   slot: "neck",  badge: "first_steps" },
  clean_crown:     { name: "Clean Sweep Crown",  slot: "head",  badge: "perfect_round" },
  no_hint_goggles: { name: "Unaided Goggles",    slot: "eyes",  badge: "unaided" },
  mastery_cape:    { name: "Mastery Cape",       slot: "back",  badge: "topic_mastered" },
  deep_end_fins:   { name: "Deep End Fins",      slot: "back",  badge: "advanced_starter" },
  prime_lantern:   { name: "Prime Lantern",      slot: "hand",  badge: "number_theory" },
  counting_charm:  { name: "Counting Charm",     slot: "neck",  badge: "combinatorics" },
  grit_badge:      { name: "Grit Badge",         slot: "chest", badge: "persistent" },
  contest_sash:    { name: "Contest Sash",       slot: "chest", badge: "contest_ready" },
  streak_flame:    { name: "Streak Flame",       slot: "hand",  badge: "streak_3" },
  week_halo:       { name: "Week-Long Halo",     slot: "head",  badge: "streak_7" },
  elegance_quill:  { name: "Elegance Quill",     slot: "hand",  badge: "elegant_solution" }
};

/* Every accessory must unlock from a badge that actually exists, or a child
   is shown a requirement they can never meet. Checked at import so a typo
   fails the server on boot rather than quietly stranding an item. */
for (const [id, item] of Object.entries(ACCESSORIES)) {
  if (!BADGES[item.badge]) throw new Error(`accessory ${id} requires unknown badge ${item.badge}`);
}

export const SLOTS = [...new Set(Object.values(ACCESSORIES).map(a => a.slot))];

const heldBadges = learnerId => new Set(
  db.prepare("SELECT code FROM awards WHERE learner_id=? AND kind='badge'").all(learnerId).map(r => r.code)
);

export const isUnlocked = (learnerId, accessoryId) => {
  const item = ACCESSORIES[accessoryId];
  return Boolean(item) && heldBadges(learnerId).has(item.badge);
};

/* The full collection: what is worn, what is earned, and what each locked
   item would take. */
export function wardrobe(learnerId) {
  const held = heldBadges(learnerId);
  const equipped = new Set(
    db.prepare("SELECT accessory_id FROM avatar_equipped WHERE learner_id=?").all(learnerId)
      .map(r => r.accessory_id));

  const items = Object.entries(ACCESSORIES).map(([id, item]) => ({
    id, name: item.name, slot: item.slot,
    unlocked: held.has(item.badge),
    equipped: equipped.has(id),
    /* Named rather than hidden: an unexplained locked slot is a puzzle, and
       the point of the collection is that a child knows what earns it. */
    unlockedBy: BADGES[item.badge].name,
    unlockHint: BADGES[item.badge].hint
  }));

  return {
    slots: SLOTS,
    unlockedCount: items.filter(i => i.unlocked).length,
    total: items.length,
    items
  };
}

/* Equip or remove an accessory.

   Refuses anything not yet earned. This is an authorisation check, not a
   presentation detail: without it a learner could wear the contest sash by
   posting its id, and every badge on display would stop meaning anything. */
export function equip(learnerId, accessoryId, on) {
  const item = ACCESSORIES[accessoryId];
  if (!item) return { ok: false, error: "unknown_accessory" };
  if (!on) {
    db.prepare("DELETE FROM avatar_equipped WHERE learner_id=? AND accessory_id=?")
      .run(learnerId, accessoryId);
    return { ok: true, wardrobe: wardrobe(learnerId) };
  }
  if (!isUnlocked(learnerId, accessoryId))
    return { ok: false, error: "not_unlocked", message: `${item.name} is earned with the ${BADGES[item.badge].name} badge: ${BADGES[item.badge].hint}.` };

  /* One item per slot, so equipping a second hat replaces the first rather
     than stacking two. */
  const sameSlot = Object.entries(ACCESSORIES)
    .filter(([, a]) => a.slot === item.slot).map(([id]) => id);
  for (const other of sameSlot)
    db.prepare("DELETE FROM avatar_equipped WHERE learner_id=? AND accessory_id=?").run(learnerId, other);

  db.prepare("INSERT INTO avatar_equipped (learner_id, accessory_id, slot, at) VALUES (?,?,?,?)")
    .run(learnerId, accessoryId, item.slot, now());
  return { ok: true, wardrobe: wardrobe(learnerId) };
}
