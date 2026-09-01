/* Algorithmically generated problem variants (spec 3.2.3).

   A template describes a family of problems plus a rule for computing the
   answer and the explanation. Generation is seeded, so the same seed always
   yields the same problem — that makes a generated question reproducible for
   marking, review and reporting, which a purely random generator could not be.

   Templates carry the same shape as authored questions once generated, so
   everything downstream (grading, hints, error analysis) works unchanged. */

/* Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

export const TEMPLATES = {
  /* Grade 3 multiplication facts */
  "g3-mult": {
    lvl: 1, sec: "N",
    build(r) {
      const a = pick(r, 2, 9), b = pick(r, 2, 9);
      return {
        type: "in", q: `${a} × ${b} = ?`, ans: a * b,
        hint: `${a} groups of ${b}.`,
        expl: `${a} × ${b} = ${a * b}.`
      };
    }
  },
  /* Grade 2 adding within 100 */
  "g2-add100": {
    lvl: 1, sec: "N",
    build(r) {
      const a = pick(r, 12, 79), b = pick(r, 11, 20);
      return {
        type: "in", q: `${a} + ${b} = ?`, ans: a + b,
        hint: "Add the tens, then the ones.",
        expl: `${a} + ${b} = ${a + b}. Adding the tens first gives ${a + (b - b % 10)}, then ${b % 10} more.`
      };
    }
  },
  /* Grade 6 percents of an amount */
  "g6-percent": {
    lvl: 1, sec: "R",
    build(r) {
      const pcts = [10, 20, 25, 50, 75];
      const p = pcts[pick(r, 0, pcts.length - 1)];
      const base = pick(r, 2, 20) * 20;                 // keeps the answer whole
      return {
        type: "in", q: `What is ${p}% of ${base}?`, ans: (base * p) / 100,
        hint: p === 10 ? "Ten percent is one tenth." : `${p}% means ${p} out of every 100.`,
        expl: `${p}% of ${base} is ${base} × ${p} ÷ 100 = ${(base * p) / 100}.`
      };
    }
  },
  /* Grade 6 coordinate distance — horizontal or vertical only */
  "g6-nscoord": {
    lvl: 2, sec: "C",
    build(r) {
      const horizontal = r() < 0.5;
      const fixed = pick(r, -8, 8);
      let a = pick(r, -9, 9), b = pick(r, -9, 9);
      if (a === b) b = a + 1 > 9 ? a - 1 : a + 1;
      const dist = Math.abs(a - b);
      const p1 = horizontal ? `(${a}, ${fixed})` : `(${fixed}, ${a})`;
      const p2 = horizontal ? `(${b}, ${fixed})` : `(${fixed}, ${b})`;
      return {
        type: "in",
        q: `What is the distance between ${p1} and ${p2}, in units?`,
        ans: dist,
        hint: horizontal ? "The y-values match, so count along x." : "The x-values match, so count along y.",
        expl: `The ${horizontal ? "y" : "x"}-values are the same, so the distance is ` +
              `|${a}| and |${b}| measured along the ${horizontal ? "x" : "y"}-axis: ${dist} units.`
      };
    }
  },
  /* Grade 6 unit rates */
  "g6-ratios": {
    lvl: 1, sec: "R",
    build(r) {
      const per = pick(r, 2, 12), count = pick(r, 3, 9);
      const total = per * count;
      return {
        type: "in",
        q: `${count} identical boxes hold ${total} pencils altogether. How many pencils are in one box?`,
        ans: per,
        hint: "Share the total equally between the boxes.",
        expl: `${total} ÷ ${count} = ${per} pencils per box.`
      };
    }
  }
};

/* Build one generated question. `seed` makes it reproducible. */
export function generate(topicId, seed) {
  const t = TEMPLATES[topicId];
  if (!t) return null;
  const q = t.build(rng(seed));
  return { ...q, sec: t.sec, lvl: t.lvl, generated: true, seed };
}

export const generatedTopics = () => Object.keys(TEMPLATES);
