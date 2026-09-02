/* Mini-games (spec 5.9).

   Short, fast rounds that drill one idea. A round is generated from a seed
   on the server and scored on the server from that same seed, so the client
   cannot invent a score. The client is responsible only for the play — the
   timer, the animation, the input — and sends back what the learner did. */

import { rng } from "./generators.mjs";

const pick = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

export const GAMES = {
  /* Factor Blast: for each target number, pick every factor from a board. */
  "factor-blast": {
    title: "Factor Blast", topicId: "g4-factorpair", grade: "4", seconds: 60,
    blurb: "Tap every number on the board that divides the target. Fast!",
    build(r) {
      const items = [];
      for (let i = 0; i < 6; i++) {
        const target = [12, 18, 20, 24, 28, 30, 36, 40, 42, 45, 48][pick(r, 0, 10)];
        const board = new Set();
        while (board.size < 8) board.add(pick(r, 2, 12));
        const b = [...board];
        items.push({ target, board: b, answer: b.filter(n => target % n === 0) });
      }
      return items;
    },
    /* Each item scores 1 for a perfect selection; a wrong pick costs the item. */
    score(items, responses) {
      let pts = 0;
      items.forEach((it, i) => {
        const got = new Set((responses[i] || []).map(Number));
        const want = new Set(it.answer);
        if (got.size === want.size && [...want].every(x => got.has(x))) pts++;
      });
      return pts;
    },
    public: it => ({ target: it.target, board: it.board })
  },

  /* Bond Catch: catch the number that makes the bond to the target. */
  "bond-catch": {
    title: "Bond Catch", topicId: "g1-add20", grade: "1", seconds: 45,
    blurb: "Numbers fall from the sky. Catch the one that makes the target with the number you hold.",
    build(r) {
      const items = [];
      for (let i = 0; i < 8; i++) {
        const target = [10, 10, 10, 20, 20, 15][pick(r, 0, 5)];
        const hold = pick(r, 1, target - 1);
        const answer = target - hold;
        const falling = new Set([answer]);
        while (falling.size < 4) falling.add(pick(r, 1, target - 1));
        const f = [...falling].sort(() => r() - 0.5);
        items.push({ target, hold, falling: f, answer });
      }
      return items;
    },
    score(items, responses) { return items.filter((it, i) => Number(responses[i]) === it.answer).length; },
    public: it => ({ target: it.target, hold: it.hold, falling: it.falling })
  },

  /* Coordinate Hunt: name the point where the treasure is. */
  "coordinate-hunt": {
    title: "Coordinate Hunt", topicId: "g6-nscoord", grade: "6", seconds: 60,
    blurb: "A treasure appears on the grid. Type its coordinates before it sinks.",
    build(r) {
      const items = [];
      for (let i = 0; i < 6; i++) items.push({ x: pick(r, -6, 6), y: pick(r, -6, 6) });
      return items;
    },
    score(items, responses) {
      return items.filter((it, i) => {
        const p = Array.isArray(responses[i]) ? responses[i].map(Number) : [];
        return p.length === 2 && p[0] === it.x && p[1] === it.y;
      }).length;
    },
    public: it => ({ x: it.x, y: it.y, prompt: "Where is the treasure?" })
  },

  /* Times Table Sprint: as many products as possible. */
  "table-sprint": {
    title: "Times Table Sprint", topicId: "g3-mult", grade: "3", seconds: 60,
    blurb: "Answer as many products as you can before the sand runs out.",
    build(r) {
      const items = [];
      for (let i = 0; i < 20; i++) { const a = pick(r, 2, 12), b = pick(r, 2, 12); items.push({ a, b, answer: a * b }); }
      return items;
    },
    score(items, responses) { return items.filter((it, i) => Number(responses[i]) === it.answer).length; },
    public: it => ({ a: it.a, b: it.b })
  }
};

export function buildRound(gameId, seed) {
  const g = GAMES[gameId];
  if (!g) return null;
  const items = g.build(rng(seed));
  return { gameId, seed, seconds: g.seconds, items: items.map(g.public), total: items.length };
}

export function scoreRound(gameId, seed, responses) {
  const g = GAMES[gameId];
  if (!g) return null;
  const items = g.build(rng(seed));
  const score = g.score(items, Array.isArray(responses) ? responses : []);
  return { score, total: items.length };
}

export const publicGame = (id) => ({ id, title: GAMES[id].title, topicId: GAMES[id].topicId, grade: GAMES[id].grade,
  seconds: GAMES[id].seconds, blurb: GAMES[id].blurb });
