/* Asset registry (spec 8.2).

   Every visual asset the product ships — characters, lesson scenes, figure
   kinds, icons, accessories — is registered here with tags, its licence and
   its origin. Nothing is drawn from a file that is not on this list, and the
   linter refuses a lesson that names an art kind that is not registered.
   All current assets are original work drawn in code, licensed CC0 so the
   question of "may we ship this" has one answer. */

export const LICENCES = {
  "CC0-1.0": { name: "Creative Commons Zero 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/", commercial: true, attribution: false },
  "CC-BY-4.0": { name: "Creative Commons Attribution 4.0", url: "https://creativecommons.org/licenses/by/4.0/", commercial: true, attribution: true },
  "proprietary": { name: "All rights reserved (owner licence required)", url: null, commercial: false, attribution: true }
};

export const ASSETS = [
  { id: "beast-pip", kind: "character", name: "Pip", tags: ["monster", "kindergarten", "grade-1", "grade-2", "warm"],
    licence: "CC0-1.0", author: "BeastForge", origin: "app/web/src/beasts.tsx", format: "svg-code" },
  { id: "beast-nim", kind: "character", name: "Nim", tags: ["monster", "grade-3", "grade-4", "grade-5", "teal"],
    licence: "CC0-1.0", author: "BeastForge", origin: "app/web/src/beasts.tsx", format: "svg-code" },
  { id: "beast-vex", kind: "character", name: "Vex", tags: ["monster", "grade-6", "grade-7", "grade-8", "violet"],
    licence: "CC0-1.0", author: "BeastForge", origin: "app/web/src/beasts.tsx", format: "svg-code" },
  { id: "icon-app", kind: "icon", name: "App icon", tags: ["pwa", "favicon"],
    licence: "CC0-1.0", author: "BeastForge", origin: "app/web/public/icon.svg", format: "svg-file" },
  { id: "figure-grid", kind: "figure", name: "Coordinate grid", tags: ["geometry", "coordinates", "grade-5", "grade-6"],
    licence: "CC0-1.0", author: "BeastForge", origin: "app/web/src/beasts.tsx", format: "svg-code" },
  /* Lesson scenes: one entry per art kind a panel may use. */
  ...[["baskets", "Baskets of apples", ["counting", "addition", "kindergarten"]],
      ["fingers", "Counting on fingers", ["counting", "kindergarten"]],
      ["rods", "Tens rods and ones cubes", ["place-value", "grade-1"]],
      ["array", "Array of objects", ["multiplication", "arrays", "grade-2"]],
      ["pizza", "Pizza cut into equal slices", ["fractions", "grade-3"]],
      ["grid-rect", "Rectangle on a square grid", ["area", "perimeter", "grade-3"]],
      ["plane", "Coordinate plane with points", ["coordinates", "grade-6"]],
      ["jugs", "Lemons and cups of water", ["ratios", "grade-6"]],
      ["groups", "Equal groups of objects", ["multiplication", "grade-3"]],
      ["celebrate", "Character celebrating under stars", ["celebration", "all-grades"]]]
    .map(([id, name, tags]) => ({ id: `scene-${id}`, kind: "scene", name, tags, licence: "CC0-1.0", author: "BeastForge",
      origin: "app/web/src/components/LessonArt.tsx", format: "svg-code", artKind: id })),
  /* Accessories (5.3). */
  ...["cap", "crown", "wizard", "laurel", "halo", "glasses", "monocle", "stars", "pencil", "trophy", "hammer", "compass", "sparkles", "numbers", "flames"]
    .map(id => ({ id: `gear-${id}`, kind: "accessory", name: `Accessory: ${id}`, tags: ["avatar", "gear"], licence: "CC0-1.0",
      author: "BeastForge", origin: "app/web/src/beasts.tsx", format: "svg-code" }))
];

export const assetById = id => ASSETS.find(a => a.id === id) || null;
export const sceneKinds = () => ASSETS.filter(a => a.kind === "scene").map(a => a.artKind);
export const byTag = tag => ASSETS.filter(a => a.tags.includes(tag));

/* Registry integrity, used by the linter. */
export function lintAssets() {
  const errors = [];
  const ids = new Set();
  for (const a of ASSETS) {
    if (ids.has(a.id)) errors.push(`asset ${a.id}: duplicate id`);
    ids.add(a.id);
    if (!LICENCES[a.licence]) errors.push(`asset ${a.id}: unknown licence "${a.licence}"`);
    if (!a.tags?.length) errors.push(`asset ${a.id}: no tags`);
    if (!a.author || !a.origin) errors.push(`asset ${a.id}: no author or origin`);
    if (a.licence === "proprietary" && !a.licenceNote) errors.push(`asset ${a.id}: proprietary asset without a licence note`);
  }
  return errors;
}
