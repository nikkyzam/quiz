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

/* ---------- LaTeX input for authors (3.5.4) ----------
   A small, honest subset of LaTeX — what this curriculum needs — parsed into
   MathML with a spoken form. Anything outside the subset throws, so an
   author finds out at lint time rather than shipping garbled notation.

   Supported: numbers, single-letter variables, + - = < > , ( ), \times \div
   \cdot \pm \le \ge \ne, \frac{a}{b}, \sqrt{a}, \sqrt[n]{a}, ^{...} and
   _{...} (or a single token), \pi \theta \alpha \beta, \% and \deg. */

const GREEK = { pi: ["π", "pi"], theta: ["θ", "theta"], alpha: ["α", "alpha"], beta: ["β", "beta"] };
const BINOPS = { times: ["&#xD7;", "times"], div: ["&#xF7;", "divided by"], cdot: ["&#xB7;", "times"],
  pm: ["&#xB1;", "plus or minus"], le: ["&#x2264;", "is less than or equal to"], ge: ["&#x2265;", "is greater than or equal to"],
  ne: ["&#x2260;", "is not equal to"], leq: ["&#x2264;", "is less than or equal to"], geq: ["&#x2265;", "is greater than or equal to"],
  neq: ["&#x2260;", "is not equal to"] };
const PLAIN_OPS = { "+": ["+", "plus"], "-": ["&#x2212;", "minus"], "=": ["=", "equals"], "<": ["&lt;", "is less than"],
  ">": ["&gt;", "is greater than"], ",": [",", "comma"] };

function tokenizeLatex(src) {
  const out = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "\\") {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      if (j === i + 1) { out.push({ t: "cmd", v: s[j] }); i = j + 1; continue; }   // \% \{ etc.
      out.push({ t: "cmd", v: s.slice(i + 1, j) }); i = j; continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ t: "num", v: s.slice(i, j) }); i = j; continue;
    }
    if (/[a-zA-Z]/.test(ch)) { out.push({ t: "var", v: ch }); i++; continue; }
    if ("{}[]^_()".includes(ch) || PLAIN_OPS[ch]) { out.push({ t: "sym", v: ch }); i++; continue; }
    throw new Error(`unsupported character "${ch}" at ${i}`);
  }
  return out;
}

export function latexToMathML(src) {
  const toks = tokenizeLatex(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const expect = (t, v) => { const k = next(); if (!k || k.t !== t || (v !== undefined && k.v !== v)) throw new Error(`expected ${v || t}`); return k; };

  /* group := "{" expr "}" | atom */
  function group() {
    if (peek()?.t === "sym" && peek().v === "{") { next(); const r = expr("}"); expect("sym", "}"); return r; }
    return atom();
  }
  function atom() {
    const k = next();
    if (!k) throw new Error("unexpected end");
    if (k.t === "num") return { ml: `<mn>${k.v}</mn>`, say: k.v };
    if (k.t === "var") return { ml: `<mi>${k.v}</mi>`, say: k.v };
    if (k.t === "sym" && k.v === "(") { const r = expr(")"); expect("sym", ")"); return { ml: `<mrow><mo>(</mo>${r.ml}<mo>)</mo></mrow>`, say: `open bracket ${r.say} close bracket` }; }
    if (k.t === "cmd") {
      if (k.v === "frac") { const a = group(), b = group(); return { ml: `<mfrac>${wrap(a)}${wrap(b)}</mfrac>`, say: `${a.say} over ${b.say}` }; }
      if (k.v === "sqrt") {
        if (peek()?.t === "sym" && peek().v === "[") { next(); const n = expr("]"); expect("sym", "]"); const a = group();
          const nth = n.say === "3" ? "cube" : n.say === "4" ? "fourth" : `${n.say}th`;
          return { ml: `<mroot>${wrap(a)}${wrap(n)}</mroot>`, say: `the ${nth} root of ${a.say}` }; }
        const a = group(); return { ml: `<msqrt>${a.ml}</msqrt>`, say: `the square root of ${a.say}` };
      }
      if (GREEK[k.v]) return { ml: `<mi>${GREEK[k.v][0]}</mi>`, say: GREEK[k.v][1] };
      if (k.v === "%") return { ml: `<mo>%</mo>`, say: "percent" };
      if (k.v === "deg") return { ml: `<mo>&#xB0;</mo>`, say: "degrees" };
      if (BINOPS[k.v]) return { ml: `<mo>${BINOPS[k.v][0]}</mo>`, say: BINOPS[k.v][1] };
      throw new Error(`unsupported command \\${k.v}`);
    }
    if (k.t === "sym" && PLAIN_OPS[k.v]) return { ml: `<mo>${PLAIN_OPS[k.v][0]}</mo>`, say: PLAIN_OPS[k.v][1] };
    throw new Error(`unexpected ${k.v}`);
  }
  const wrap = r => r.ml.startsWith("<mrow>") || /^<m[nio]>[^<]*<\/m[nio]>$/.test(r.ml) ? r.ml : `<mrow>${r.ml}</mrow>`;

  /* expr := atom (^group | _group)* ... until a closing symbol */
  function expr(closer) {
    const parts = [], says = [];
    while (pos < toks.length && !(peek().t === "sym" && peek().v === closer)) {
      let base = atom();
      for (;;) {
        const p = peek();
        if (p?.t === "sym" && p.v === "^") { next(); const e = group(); base = { ml: `<msup>${wrap(base)}${wrap(e)}</msup>`, say: e.say === "2" ? `${base.say} squared` : e.say === "3" ? `${base.say} cubed` : `${base.say} to the power of ${e.say}` }; }
        else if (p?.t === "sym" && p.v === "_") { next(); const e = group(); base = { ml: `<msub>${wrap(base)}${wrap(e)}</msub>`, say: `${base.say} sub ${e.say}` }; }
        else break;
      }
      parts.push(base.ml); says.push(base.say);
    }
    return { ml: parts.length === 1 ? parts[0] : `<mrow>${parts.join("")}</mrow>`, say: says.join(" ") };
  }

  const r = expr(undefined);
  if (pos < toks.length) throw new Error("unbalanced expression");
  return {
    mathml: `<math xmlns="http://www.w3.org/1998/Math/MathML" role="math" aria-label="${esc(r.say)}">${r.ml}</math>`,
    spoken: r.say
  };
}
