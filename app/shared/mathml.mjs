/* Accessible maths notation (spec 3.5.4).

   Renders the notation this curriculum actually uses — arithmetic, fractions,
   ratios, absolute value, coordinates, exponents — as MathML, which screen
   readers announce as mathematics rather than punctuation. Anything it does
   not recognise is returned as plain text rather than wrapped in markup that
   would lie about its structure.

   MathML is used rather than LaTeX because it needs no client library and is
   what assistive technology actually consumes. */

const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const OPS = { "×": "&#xD7;", "÷": "&#xF7;", "+": "+", "-": "&#x2212;", "−": "&#x2212;", "=": "=" };

/* Each matcher returns MathML for the fragment plus how it should be spoken. */
const PATTERNS = [
  { /* fraction: 3/4 */
    re: /^(\d+)\/(\d+)$/,
    build: (m) => ({
      ml: `<mfrac><mn>${m[1]}</mn><mn>${m[2]}</mn></mfrac>`,
      say: `${m[1]} over ${m[2]}`
    })
  },
  { /* absolute value: |-7| */
    re: /^\|(-?\d+)\|$/,
    build: (m) => ({
      ml: `<mrow><mo>|</mo><mn>${m[1].replace("-", "&#x2212;")}</mn><mo>|</mo></mrow>`,
      say: `the absolute value of ${m[1]}`
    })
  },
  { /* coordinate pair: (3, -2) */
    re: /^\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/,
    build: (m) => ({
      ml: `<mrow><mo>(</mo><mn>${m[1].replace("-", "&#x2212;")}</mn><mo>,</mo>` +
          `<mn>${m[2].replace("-", "&#x2212;")}</mn><mo>)</mo></mrow>`,
      say: `the point ${m[1]} comma ${m[2]}`
    })
  },
  { /* ratio: 4 : 6 */
    re: /^(\d+)\s*:\s*(\d+)$/,
    build: (m) => ({
      ml: `<mrow><mn>${m[1]}</mn><mo>:</mo><mn>${m[2]}</mn></mrow>`,
      say: `${m[1]} to ${m[2]}`
    })
  },
  { /* exponent: 2^5 */
    re: /^(\d+)\^(\d+)$/,
    build: (m) => ({
      ml: `<msup><mn>${m[1]}</mn><mn>${m[2]}</mn></msup>`,
      say: `${m[1]} to the power of ${m[2]}`
    })
  },
  { /* binary arithmetic: 7 × 8, 12 ÷ 3, 8 + 5, 9 - 4 */
    re: /^(-?\d+)\s*([×÷+\-−])\s*(-?\d+)$/,
    build: (m) => {
      const words = { "×": "times", "÷": "divided by", "+": "plus", "-": "minus", "−": "minus" };
      return {
        ml: `<mrow><mn>${m[1].replace("-", "&#x2212;")}</mn><mo>${OPS[m[2]]}</mo>` +
            `<mn>${m[3].replace("-", "&#x2212;")}</mn></mrow>`,
        say: `${m[1]} ${words[m[2]]} ${m[3]}`
      };
    }
  }
];

/* Render one expression. Returns null when nothing matches, so callers can
   fall back to plain text instead of emitting misleading markup. */
export function toMathML(expr) {
  const t = String(expr).trim();
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (m) {
      const { ml, say } = p.build(m);
      return {
        mathml: `<math xmlns="http://www.w3.org/1998/Math/MathML" role="math" aria-label="${esc(say)}">${ml}</math>`,
        spoken: say
      };
    }
  }
  return null;
}

/* Find the maths inside a sentence and mark it up, leaving prose alone. */
const TOKEN = /(\|-?\d+\||\(\s*-?\d+\s*,\s*-?\d+\s*\)|\d+\/\d+|\d+\s*:\s*\d+|\d+\^\d+|-?\d+\s*[×÷]\s*-?\d+)/g;

export function renderQuestion(text) {
  /* Split so prose and maths are handled separately: prose is always escaped,
     MathML is inserted as markup. Escaping the whole string afterwards would
     destroy the MathML; escaping neither would emit raw prose as markup. */
  const src = String(text);
  let found = 0, out = "", last = 0;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    const r = toMathML(m[0]);
    if (r) { out += r.mathml; found++; } else { out += esc(m[0]); }
    last = m.index + m[0].length;
  }
  out += esc(src.slice(last));
  return { html: out, mathCount: found };
}
