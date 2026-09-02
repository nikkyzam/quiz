/* Narrative arc (spec 5.6).

   Six chapters of an original story, unlocked by real progress. Each chapter
   ends with a choice, and later chapters open differently depending on what
   the learner chose — the outcome is theirs, not a fixed script. The text is
   kept short and read-aloud friendly; the point is that the maths the child
   does moves the story, not the other way round.

   `unlock` predicates read the same statistics the badge rules do. */

export const CHAPTERS = [
  {
    id: "ch1", title: "The Sleeping Forge",
    unlock: () => true, unlockHint: "Available from the start",
    panels: [
      { art: "forge-dark", text: "Deep under the hill sits the BeastForge, cold and quiet. Nobody has lit it in a hundred years." },
      { art: "monster-wave", text: "Your monster nudges you towards the door. On it, a riddle glows: 'Only a counting mind may enter.'" },
      { art: "door-open", text: "You count the marks on the door. The lock clicks. Warm air breathes out of the dark." }
    ],
    choice: { prompt: "Two tunnels lead down. Which do you take?",
      options: [
        { id: "left", label: "The left tunnel, lit with blue crystals" },
        { id: "right", label: "The right tunnel, where you hear water" }
      ] }
  },
  {
    id: "ch2", title: "The First Ember",
    unlock: s => s.rounds >= 1, unlockHint: "Finish a round",
    intro: {
      left: "The blue crystals hum as you pass. Each one flickers when you solve something in your head.",
      right: "The tunnel opens onto an underground river. Numbers float past on the water like leaves."
    },
    panels: [
      { art: "ember", text: "At the bottom you find the forge's heart: a single ember, barely alive." },
      { art: "monster-blow", text: "Your monster blows on it. Nothing. 'It needs a pattern,' your monster says. 'Fires grow by doubling.'" },
      { art: "flame", text: "You say the pattern aloud. The ember catches. A small flame stands up and looks at you." }
    ],
    choice: { prompt: "The flame asks for a name. What do you call it?",
      options: [
        { id: "spark", label: "Spark" },
        { id: "glim", label: "Glim" }
      ] }
  },
  {
    id: "ch3", title: "The Locked Bellows",
    unlock: s => s.masteredTopics >= 1, unlockHint: "Master your first topic",
    intro: {
      spark: "Spark bounces ahead of you, throwing sparks that spell out sums on the walls.",
      glim: "Glim floats quietly beside you, glowing brighter whenever you get something right."
    },
    panels: [
      { art: "bellows", text: "The bellows that feed the forge are chained shut. Six chains, six locks, six number puzzles." },
      { art: "chains", text: "The first lock wants the number of sides on a hexagon. The chain falls. The second wants half of twelve." },
      { art: "bellows-open", text: "One by one the chains drop. The bellows heave. The little flame roars into a real fire." }
    ],
    choice: { prompt: "The forge is awake. What do you make first?",
      options: [
        { id: "shield", label: "A shield, to protect the forest above" },
        { id: "key", label: "A key, to open every door in the hill" }
      ] }
  },
  {
    id: "ch4", title: "The Mirror Caves",
    unlock: s => s.masteredTopics >= 3, unlockHint: "Master three topics",
    intro: {
      shield: "You carry the shield on your back. Twice it turns aside falling stones, and twice you notice its edge is a perfect circle.",
      key: "The key opens a door you had walked past a dozen times. Behind it: stairs going up."
    },
    panels: [
      { art: "mirrors", text: "The caves are lined with mirrors. Every shape you hold up is flipped in the glass, then flipped again." },
      { art: "monster-think", text: "'Reflections,' says your monster. 'Left becomes right. But flip it twice and it comes home.'" },
      { art: "exit", text: "You find the one mirror that shows the true way out, because it is the only one that does not flip." }
    ],
    choice: { prompt: "A voice in the caves offers a trade. What do you give?",
      options: [
        { id: "time", label: "An hour of your time, to teach it a puzzle" },
        { id: "secret", label: "A secret: the pattern that lit the forge" }
      ] }
  },
  {
    id: "ch5", title: "The Counting Storm",
    unlock: s => s.masteredTopics >= 5 || s.contests >= 1, unlockHint: "Master five topics, or finish a timed paper",
    intro: {
      time: "The voice kept its word. It taught you a trick for counting fast, and you feel it in your fingers now.",
      secret: "The voice knows the doubling pattern now. Somewhere behind you, a second fire has started."
    },
    panels: [
      { art: "storm", text: "Above the hill a storm of numbers breaks: hail of sevens, gusts of fractions, thunder that counts backwards." },
      { art: "monster-brace", text: "Your monster braces against the wind. 'Sort them!' it shouts. 'The storm only hits what it cannot sort!'" },
      { art: "calm", text: "You sort evens from odds, big from small, whole from part. The storm runs out of things to throw." }
    ],
    choice: { prompt: "The storm leaves a gift. Which do you keep?",
      options: [
        { id: "compass", label: "A compass that points to the hardest problem" },
        { id: "lantern", label: "A lantern that shows the easiest first step" }
      ] }
  },
  {
    id: "ch6", title: "The Forge-Master",
    unlock: s => s.masteredTopics >= 8 || s.masteredAdv >= 2, unlockHint: "Master eight topics, or two advanced ones",
    intro: {
      compass: "The compass needle swings towards the deepest part of the hill. That is where you go.",
      lantern: "The lantern shows the first step, then the next. Step by step, it leads you down."
    },
    panels: [
      { art: "master", text: "In the deepest chamber sits the old Forge-Master, made of iron and patience. 'You lit it,' it says. 'Now keep it lit.'" },
      { art: "hammer", text: "It hands you the hammer. 'Every problem you solve is a strike. Every strike keeps the forge warm for someone after you.'" },
      { art: "monster-proud", text: "Your monster stands a little taller. The story does not end here — it starts again, with you holding the hammer." }
    ],
    choice: { prompt: "What will you forge first as Forge-Master?",
      options: [
        { id: "bridge", label: "A bridge, so others can find the forge" },
        { id: "bell", label: "A bell, so the whole hill hears when a problem falls" }
      ] }
  }
];

/* Epilogue lines that depend on the whole path taken. */
export function epilogue(choices) {
  const parts = [];
  parts.push(choices.ch1 === "left" ? "The blue crystals still hum when you pass." : "The river still carries numbers past your feet.");
  parts.push(choices.ch2 === "spark" ? "Spark has grown into a bonfire." : "Glim has grown into a steady star.");
  parts.push(choices.ch3 === "shield" ? "The forest above has never been safer." : "Every door in the hill stands open.");
  parts.push(choices.ch4 === "time" ? "The voice in the caves sends you a new puzzle every spring." : "The second fire burns on, a little wilder than yours.");
  parts.push(choices.ch6 === "bridge" ? "Travellers cross your bridge every day." : "Your bell rings whenever anyone, anywhere, solves something hard.");
  return parts.join(" ");
}

/* The chapter as the learner should see it: intro chosen by earlier choices,
   locked chapters stripped to their title and hint. */
export function renderChapter(ch, choices, stats) {
  const unlocked = ch.unlock(stats);
  const prev = CHAPTERS[CHAPTERS.indexOf(ch) - 1];
  const intro = ch.intro && prev ? (ch.intro[choices[prev.id]] || null) : null;
  return {
    id: ch.id, title: ch.title, unlocked, unlockHint: ch.unlockHint,
    read: !!choices[ch.id], chosen: choices[ch.id] || null,
    intro: unlocked ? intro : null,
    panels: unlocked ? ch.panels : null,
    choice: unlocked ? ch.choice : null
  };
}
