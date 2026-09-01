/* Contest scoring, kept pure so the timing rules are testable without
   waiting out a real clock (spec 4.1.9, 13.12). */

export const CONTEST_FORMATS = {
  kangaroo:   { name: "Math Kangaroo style", questions: 12, minutes: 20 },
  moems:      { name: "MOEMS style",         questions: 5,  minutes: 30 },
  amc8:       { name: "AMC 8 style",         questions: 15, minutes: 40 },
  mathcounts: { name: "MATHCOUNTS sprint",   questions: 10, minutes: 20 },
  drill:      { name: "Quick drill",         questions: 6,  minutes: 6  }
};

/* A submission arriving after the deadline is still marked, so the learner
   sees what they got right, but it scores zero — the clock is part of the
   assessment, and the server owns it. */
export function isExpired(deadlineMs, atMs) {
  return atMs > deadlineMs;
}

export function scorePaper({ marks, expired }) {
  const total = marks.length;
  const correct = marks.filter(Boolean).length;
  const score = expired ? 0 : correct;
  return {
    score, total,
    correctBeforePenalty: correct,
    pct: total ? Math.round((score / total) * 100) : 0
  };
}
