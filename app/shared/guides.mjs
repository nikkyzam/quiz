/* Contest Corner strategy guides (spec 3.3.5). Short, concrete, and about
   how to sit a paper, not just how to do maths. */

export const GUIDES = [
  { id: "guide-general", title: "Before any paper", format: null,
    points: [
      "Read every question once before answering any. Mark the ones you know cold and do those first.",
      "Never spend more than a fifth of the time on one question. Circle it, move on, come back.",
      "Guessing is not free on every paper. Check the format's rule below before you guess.",
      "Write down what you know. A number on paper is worth two in your head.",
      "Leave two minutes at the end to re-read your answers, not to start new questions." ] },
  { id: "guide-kangaroo", title: "Kangaroo style", format: "kangaroo",
    points: [
      "Questions get harder as you go: the last third is where the points hide, so pace for it.",
      "Multiple choice means you can test the options. Plug them in when the algebra is slow.",
      "Draw the picture. Most Kangaroo problems become obvious once drawn to scale.",
      "Look for the trick in the wording — 'at least', 'exactly', 'different' — before you compute." ] },
  { id: "guide-moems", title: "MOEMS style", format: "moems",
    points: [
      "Five problems, half an hour: six minutes each. Do not race; think.",
      "Write your answer in the form asked. A correct number in the wrong form scores nothing.",
      "Make a small table or list. Organised counting beats clever counting.",
      "Check your answer against the question one more time before you commit." ] },
  { id: "guide-amc8", title: "AMC 8 style", format: "amc8",
    points: [
      "No penalty for guessing, so answer everything. Eliminate what you can first.",
      "The answers are given: estimate first and rule out the ones that are far off.",
      "Problems 1–10 should be quick. Bank them, then slow down for 11–25.",
      "If a problem needs a big calculation, you have probably missed a shortcut." ] },
  { id: "guide-mathcounts", title: "MATHCOUNTS sprint", format: "mathcounts",
    points: [
      "Two minutes a problem, average. Skip anything that stalls you on the first read.",
      "Exact answers only: simplify fractions and give units where asked.",
      "Mental arithmetic wins sprints. Practise squares to 25 and the times tables to 15.",
      "Keep a running tally of which you skipped so you can return in order." ] },
  { id: "guide-drill", title: "Quick drill", format: "drill",
    points: [
      "A drill is about speed with accuracy, not about difficulty.",
      "Say the answer in your head before you write it — it catches slips.",
      "Do drills often and short. Ten minutes a day beats an hour on Sunday." ] }
];

export const guideFor = format => GUIDES.filter(g => g.format === null || g.format === format);
