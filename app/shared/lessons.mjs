/* Comic lessons (spec 3.2.1, 4.1.3).

   A lesson is a short sequence of panels. Each panel has a speaker (one of the
   monsters), a line of dialogue, and optionally a figure or an inline check.
   The check is the point: a panel that asks something before moving on is the
   difference between reading and learning.

   Panels are deliberately short. A child reading a wall of text has already
   stopped reading. */

export const LESSONS = {
  "g2-arrays": {
    id: "les-arrays", topicId: "g2-arrays", title: "Rows and Columns",
    blurb: "Why arrays make counting quicker.",
    panels: [
      { speaker: "pip", text: "Look at these apples. Someone has lined them up in neat rows." },
      { speaker: "pip", text: "There are 3 rows. Each row has 4 apples in it.",
        art: { kind: "array", rows: 3, cols: 4 } },
      { speaker: "nim", text: "You could count every apple one by one… but that is slow, and it is easy to lose your place." },
      { speaker: "pip", text: "Instead, add one row at a time: 4, then 8, then 12." },
      { speaker: "pip", text: "So 3 rows of 4 is 12. That is what an array does — it turns counting into adding.",
        art: { kind: "array", rows: 3, cols: 4 } },
      { check: { q: "This array has 2 rows of 5. How many altogether?",
                 art: { kind: "array", rows: 2, cols: 5 },
                 type: "in", ans: 10,
                 expl: "2 rows of 5 is 5 + 5 = 10." } },
      { speaker: "nim", text: "Nicely done. Rows of the same size are the whole trick." }
    ]
  },

  "g3-fracnum": {
    id: "les-fracnum", topicId: "g3-fracnum", title: "What a Fraction Really Is",
    blurb: "Equal parts, and why the bottom number matters.",
    panels: [
      { speaker: "nim", text: "Here is one whole chocolate bar." ,
        art: { kind: "bar", parts: 1, filled: 0 } },
      { speaker: "nim", text: "Now I have snapped it into 4 equal pieces. Equal is the important word.",
        art: { kind: "bar", parts: 4, filled: 0 } },
      { speaker: "nim", text: "If I eat one piece, I have eaten 1 out of 4. We write that as 1/4.",
        art: { kind: "bar", parts: 4, filled: 1 } },
      { speaker: "vex", text: "The bottom number says how many pieces the whole was cut into. The top says how many you have." },
      { check: { q: "This bar is cut into 8 equal pieces and 3 are shaded. What fraction is shaded?",
                 art: { kind: "bar", parts: 8, filled: 3 },
                 type: "mc", opts: ["3/8", "8/3", "3/5", "1/3"], a: 0,
                 expl: "3 shaded pieces out of 8 equal pieces is 3/8." } },
      { speaker: "vex", text: "Here is the surprise: the MORE pieces you cut something into, the SMALLER each piece is.",
        art: { kind: "compare", left: 2, right: 8 } },
      { speaker: "nim", text: "So 1/2 is bigger than 1/8, even though 8 is the bigger number. That trips up nearly everyone once." }
    ]
  },

  "g6-ratios": {
    id: "les-ratios", topicId: "g6-ratios", title: "Ratios and the Unit Rate",
    blurb: "Getting to 'per one' is almost always the move.",
    panels: [
      { speaker: "vex", text: "A ratio compares two amounts. Four red marbles to six blue is written 4 : 6." },
      { speaker: "vex", text: "Ratios scale. Double both sides and nothing changes about the mixture: 4 : 6 is the same as 8 : 12." },
      { speaker: "nim", text: "The most useful thing you can do with a ratio is find the UNIT rate — how much for exactly one." },
      { speaker: "nim", text: "Six apples cost £3. Divide both by 6, and one apple costs 50p. Now you can price any number of apples." },
      { check: { q: "5 identical notebooks cost £10. What does ONE notebook cost, in pounds?",
                 type: "in", ans: 2,
                 expl: "£10 shared between 5 notebooks is £10 ÷ 5 = £2 each." } },
      { speaker: "vex", text: "Once you know the price of one, every other question is just multiplication." },
      { check: { q: "So what would 7 of those notebooks cost, in pounds?",
                 type: "in", ans: 14,
                 expl: "One costs £2, so seven cost 7 × £2 = £14." } },
      { speaker: "vex", text: "That is the whole method. Get to one, then scale up." }
    ]
  }
};

/* Strip the answers before sending a lesson to the browser. */
export function publicLesson(l) {
  return {
    id: l.id, topicId: l.topicId, title: l.title, blurb: l.blurb,
    panels: l.panels.map((p, i) => p.check
      ? { i, kind: "check", q: p.check.q, type: p.check.type,
          opts: p.check.type === "mc" ? p.check.opts : undefined, art: p.check.art || null }
      : { i, kind: "panel", speaker: p.speaker, text: p.text, art: p.art || null })
  };
}

export function checkPanel(lesson, index, answer) {
  const p = lesson.panels[index];
  if (!p || !p.check) return null;
  const c = p.check;
  if (c.type === "mc") return { correct: Number(answer) === c.a, correctAnswer: c.opts[c.a], expl: c.expl };
  const n = parseFloat(String(answer).replace(/−/g, "-").replace(/[^0-9.\-]/g, ""));
  return { correct: !isNaN(n) && Math.abs(n - c.ans) < 1e-9, correctAnswer: String(c.ans), expl: c.expl };
}

export const lessonForTopic = id => LESSONS[id] || null;
export const allLessons = () => Object.values(LESSONS);
