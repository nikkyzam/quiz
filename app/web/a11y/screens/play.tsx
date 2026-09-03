/* Play area screens (mini-games, story, simulations, avatar) in their loaded
   state, for the axe audit. Effects do not run here, so each screen takes
   its data through `initial`. */
import { renderToStaticMarkup } from "react-dom/server";
import { Games, type GamesData } from "../../src/screens/Games";
import { Story, type StoryData } from "../../src/screens/Story";
import { Simulations, type SimsData } from "../../src/screens/Simulations";
import { Avatar, type AvatarData } from "../../src/screens/Avatar";

const noop = () => {};
const learner = { id: "l1", name: "Josiah", beast: "vex", stars: 2, topics: 1 };
const wrap = (el: JSX.Element) => renderToStaticMarkup(<div className="wrap"><main>{el}</main></div>);

const games: GamesData = { games: [
  { id: "factor-blast", title: "Factor Blast", topicId: "g4-factorpair", grade: "4", seconds: 60, blurb: "Tap every number on the board that divides the target. Fast!" },
  { id: "bond-catch", title: "Bond Catch", topicId: "g1-add20", grade: "1", seconds: 45, blurb: "Numbers fall from the sky. Catch the one that makes the target with the number you hold." },
  { id: "coordinate-hunt", title: "Coordinate Hunt", topicId: "g6-nscoord", grade: "6", seconds: 60, blurb: "A treasure appears on the grid. Type its coordinates before it sinks." },
  { id: "table-sprint", title: "Times Table Sprint", topicId: "g3-mult", grade: "3", seconds: 60, blurb: "Answer as many products as you can before the sand runs out." }
] };

const story: StoryData = {
  chapters: [
    { id: "ch1", title: "The Sleeping Forge", unlocked: true, unlockHint: "Available from the start", read: true, chosen: "left", intro: null,
      panels: [
        { art: "forge-dark", text: "Deep under the hill sits the BeastForge, cold and quiet. Nobody has lit it in a hundred years." },
        { art: "monster-wave", text: "Your monster nudges you towards the door. On it, a riddle glows: 'Only a counting mind may enter.'" },
        { art: "door-open", text: "You count the marks on the door. The lock clicks. Warm air breathes out of the dark." }
      ],
      choice: { prompt: "Two tunnels lead down. Which do you take?", options: [
        { id: "left", label: "The left tunnel, lit with blue crystals" }, { id: "right", label: "The right tunnel, where you hear water" }] } },
    { id: "ch2", title: "The First Ember", unlocked: true, unlockHint: "Finish a round", read: false, chosen: null,
      intro: "The blue crystals hum as you pass. Each one flickers when you solve something in your head.",
      panels: [
        { art: "ember", text: "At the bottom you find the forge's heart: a single ember, barely alive." },
        { art: "monster-blow", text: "Your monster blows on it. Nothing. 'It needs a pattern,' your monster says. 'Fires grow by doubling.'" },
        { art: "flame", text: "You say the pattern aloud. The ember catches. A small flame stands up and looks at you." }
      ],
      choice: { prompt: "The flame asks for a name. What do you call it?", options: [{ id: "spark", label: "Spark" }, { id: "glim", label: "Glim" }] } },
    { id: "ch3", title: "The Locked Bellows", unlocked: false, unlockHint: "Master your first topic", read: false, chosen: null, intro: null, panels: null, choice: null },
    { id: "ch4", title: "The Mirror Caves", unlocked: false, unlockHint: "Master three topics", read: false, chosen: null, intro: null, panels: null, choice: null }
  ],
  choices: { ch1: "left" },
  epilogue: null
};

const sims: SimsData = {
  simulations: [
    { id: "sim-area", title: "Stretch the Rectangle", topicId: "g3-area", grade: "3", blurb: "Drag the corner to change the rectangle. Watch the area and perimeter change.",
      controls: [{ name: "w", type: "int", min: 1, max: 12 }, { name: "h", type: "int", min: 1, max: 12 }], initial: { w: 4, h: 3 },
      tasks: [{ id: "area-24", goal: "Make a rectangle with area 24." }, { id: "perimeter-14-area-12", goal: "Make a rectangle with perimeter 14 and area 12." }, { id: "square-36", goal: "Make a square with area 36." }] },
    { id: "sim-angles", title: "Angle Explorer", topicId: "g4-protract", grade: "4", blurb: "Drag the arm to open and close the angle.",
      controls: [{ name: "degrees", type: "int", min: 0, max: 180 }], initial: { degrees: 45 },
      tasks: [{ id: "right", goal: "Make a right angle." }, { id: "obtuse-120", goal: "Make an obtuse angle of exactly 120°." }] }
  ],
  completed: [{ simulationId: "sim-area", taskId: "area-24" }]
};

const avatar: AvatarData = {
  gear: {
    slots: ["hat", "eyes", "held", "trail"],
    unlocked: [
      { id: "cap", slot: "hat", name: "Counting Cap", unlock: { badge: "first_steps" } },
      { id: "glasses", slot: "eyes", name: "Thinking Glasses", unlock: { badge: "unaided" } }
    ],
    equipped: { hat: "cap" },
    locked: [
      { id: "crown", slot: "hat", name: "Champion's Crown", hint: "Master five topics" },
      { id: "monocle", slot: "eyes", name: "Puzzler's Monocle", hint: "Solve three puzzles" },
      { id: "pencil", slot: "held", name: "Golden Pencil", hint: "Complete a proof" },
      { id: "sparkles", slot: "trail", name: "Sparkle Trail", hint: "Reach level 5" }
    ]
  },
  levels: {
    overall: { level: 3, points: 260, nextLevelAt: 450 },
    subjects: [
      { subject: "number", name: "Number", points: 200, level: 3, nextLevelAt: 450, prestige: 0, canPrestige: false },
      { subject: "numtheory", name: "Number theory", points: 5200, level: 11, nextLevelAt: 6050, prestige: 1, canPrestige: true },
      { subject: "geometry", name: "Geometry & measure", points: 60, level: 2, nextLevelAt: 200, prestige: 0, canPrestige: false }
    ],
    prestigeLevel: 10, prestigeSubjects: ["numtheory", "combinatorics", "algebra", "geometry", "data", "logic"]
  },
  unlocks: {
    areas: [
      { id: "vault", name: "The Vault", blurb: "A locked room under the forge, full of number puzzles that took centuries to crack.", unlocked: true, unlockHint: "Master the boss tier of any topic",
        puzzles: [{ id: "pz-vault-locker", title: "The Locker Problem", difficulty: 4 }] },
      { id: "observatory", name: "The Observatory", blurb: "A tower above the hill where the stars are counted, not just admired.", unlocked: false, unlockHint: "Solve three puzzles", puzzles: 1 }
    ],
    hiddenPuzzles: [{ id: "pz-vault-locker", title: "The Locker Problem", area: "vault" }],
    gear: ["cap", "glasses"]
  },
  streak: { days: 4, freezesAvailable: 1, freezesUsed: 0, freezesEarned: 1, nextFreezeAt: 7 }
};

export const SCREENS: Record<string, string> = {
  "play-games": wrap(<Games learner={learner} onBack={noop} initial={games} />),
  "play-story": wrap(<Story learner={learner} onBack={noop} initial={story} />),
  "play-simulations": wrap(<Simulations learner={learner} onBack={noop} initial={sims} />),
  "play-avatar": wrap(<Avatar learner={learner} onBack={noop} onChanged={noop} initial={avatar} />)
};
