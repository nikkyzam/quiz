import { useEffect, useState, useCallback } from "react";

/* Read-aloud (spec 3.2.9). Uses the browser's own speech synthesis, so no
   audio assets and no third-party service. Maths is spoken in words rather
   than symbols, because a screen reader saying "4 x 6" as "four ex six" is
   worse than useless to a child who cannot yet read the question. */
/* The rules that turn written maths into spoken maths, in priority order.

   Held as data rather than as a chain of .replace() calls because the same
   rules now have to do two jobs: produce the spoken string, and say WHICH
   part of the written text each spoken part came from. Highlighting needs the
   second one. */
type Rule = { re: RegExp; to: (m: RegExpExecArray) => string };

const FRACTION_NAMES: Record<string, string> = {
  "2": "half", "3": "third", "4": "quarter", "5": "fifth",
  "6": "sixth", "8": "eighth", "10": "tenth", "12": "twelfth"
};

const RULES: Rule[] = [
  { re: /(\d)\s*×\s*(\d)/y,        to: m => `${m[1]} times ${m[2]}` },
  { re: /(\d)\s*÷\s*(\d)/y,        to: m => `${m[1]} divided by ${m[2]}` },
  { re: /(\d)\s*\+\s*(\d)/y,       to: m => `${m[1]} plus ${m[2]}` },
  { re: /(\d)\s*-\s*(\d)/y,        to: m => `${m[1]} minus ${m[2]}` },
  { re: /(\d+)\s*:\s*(\d+)/y,      to: m => `${m[1]} to ${m[2]}` },
  { re: /\b(\d+)\/(\d+)\b/y,      to: m => {
      const unit = FRACTION_NAMES[m[2]] || `over ${m[2]}`;
      if (!FRACTION_NAMES[m[2]]) return `${m[1]} ${unit}`;
      return `${m[1]} ${unit}${Number(m[1]) === 1 ? "" : "s"}`;
    } },
  { re: /\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/y, to: m => `the point ${m[1]} comma ${m[2]}` },
  { re: /\|(-?\d+)\|/y,            to: m => `the absolute value of ${m[1]}` },
  { re: /(\d)%/y,                   to: m => `${m[1]} percent` }
];

export type SpeechSpan = { srcStart: number; srcEnd: number; outStart: number; outEnd: number };

/* Produce the spoken string AND a map from its character offsets back to the
   written text.

   This is the whole difficulty of highlighting while speaking. The browser's
   `boundary` event reports where it has reached in the string it was GIVEN,
   and that string is not the one on screen — "4 × 6" is spoken as "4 times
   6", so by the second word the two have already drifted apart. Highlighting
   on the raw index would underline the wrong word, and further wrong with
   every transformation. Each rule therefore records the source range it
   consumed against the output range it produced. */
export function speakableSpans(raw: string): { spoken: string; map: SpeechSpan[] } {
  /* Normalised first, one character for one character, so offsets still line
     up with the original string. */
  const src = raw.replace(/−/g, "-");
  const map: SpeechSpan[] = [];
  let out = "";
  let i = 0;

  while (i < src.length) {
    let matched = false;
    for (const rule of RULES) {
      rule.re.lastIndex = i;
      const m = rule.re.exec(src);
      if (m && m.index === i) {
        const text = rule.to(m);
        map.push({ srcStart: i, srcEnd: i + m[0].length, outStart: out.length, outEnd: out.length + text.length });
        out += text;
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      map.push({ srcStart: i, srcEnd: i + 1, outStart: out.length, outEnd: out.length + 1 });
      out += src[i];
      i++;
    }
  }

  /* Whitespace is collapsed last. Doing it up front would shift every offset
     already recorded, so instead the collapse is applied to the output and
     the map is walked alongside it. */
  const collapsed: string[] = [];
  const shift: number[] = new Array(out.length + 1).fill(0);
  let lastWasSpace = false;
  for (let k = 0; k < out.length; k++) {
    shift[k] = collapsed.length;
    const isSpace = /\s/.test(out[k]);
    if (isSpace) {
      if (!lastWasSpace) collapsed.push(" ");
      lastWasSpace = true;
    } else {
      collapsed.push(out[k]);
      lastWasSpace = false;
    }
  }
  shift[out.length] = collapsed.length;

  let spoken = collapsed.join("");
  const lead = spoken.length - spoken.trimStart().length;
  spoken = spoken.trim();

  const adjusted = map
    .map(sp => ({
      srcStart: sp.srcStart, srcEnd: sp.srcEnd,
      outStart: Math.max(0, shift[sp.outStart] - lead),
      outEnd: Math.max(0, shift[sp.outEnd] - lead)
    }))
    .filter(sp => sp.outEnd > sp.outStart);

  return { spoken, map: adjusted };
}

export function speakableText(raw: string): string {
  return speakableSpans(raw).spoken;
}

/* Which written characters correspond to a position in the spoken string. */
export function sourceRangeAt(map: SpeechSpan[], outIndex: number): { start: number; end: number } | null {
  const hit = map.find(sp => outIndex >= sp.outStart && outIndex < sp.outEnd);
  if (!hit) return null;
  return { start: hit.srcStart, end: hit.srcEnd };
}

/* Grow a character position out to the whole written word around it, because
   a child following along needs the word underlined, not one letter of it. */
export function wordRangeAt(text: string, index: number): { start: number; end: number } {
  const isWord = (ch: string) => ch !== undefined && !/\s/.test(ch);
  let start = Math.min(index, Math.max(0, text.length - 1));
  let end = start;
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  return { start, end };
}

/* The range of WRITTEN text to highlight for a position in the spoken text.

   A rule match is highlighted whole — "4 × 6" stays underlined for as long as
   "4 times 6" is being said, because underlining just the "4" while the voice
   says "times" is worse than not highlighting at all. A character that passed
   through untransformed grows out to its surrounding word. */
export function highlightRangeAt(text: string, map: SpeechSpan[], outIndex: number) {
  const src = sourceRangeAt(map, outIndex);
  if (!src) return null;
  if (src.end - src.start > 1) return src;
  return wordRangeAt(text, src.start);
}

export function ReadAloud({ text, label = "Read aloud" }: { text: string; label?: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => { try { window.speechSynthesis?.cancel(); } catch {} };
  }, []);

  const speak = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (synth.speaking) { synth.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(speakableText(text));
    u.rate = 0.9;                       // a little slower than default for children
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }, [supported, text]);

  if (!supported) return null;         // no affordance where it cannot work
  return (
    <button type="button" className="linkbtn readaloud" onClick={speak}
            aria-label={speaking ? "Stop reading" : label}>
      {speaking ? "◼ Stop" : "🔊 " + label}
    </button>
  );
}

/* Text that highlights itself word by word while being read (spec 3.2.9).

   Following text while it is read aloud is the point of the feature for a
   child who is still decoding: hearing a word and seeing which word it is are
   what connect to each other. Speech without a moving highlight is an
   audiobook.

   The highlight is an addition, never a requirement. Browsers differ on the
   `boundary` event — some fire it per word, some not at all — so when it does
   not arrive the text simply reads normally and the speech is unaffected. */
export function SpokenText({ text, className, label = "Read aloud" }: {
  text: string; className?: string; label?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => { try { window.speechSynthesis?.cancel(); } catch {} };
  }, []);
  /* A new question must not keep the previous one's highlight, and must not
     keep talking about it either. */
  useEffect(() => {
    setRange(null); setSpeaking(false);
    try { window.speechSynthesis?.cancel(); } catch {}
  }, [text]);

  const speak = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (synth.speaking) { synth.cancel(); setSpeaking(false); setRange(null); return; }

    const { spoken, map } = speakableSpans(text);
    const u = new SpeechSynthesisUtterance(spoken);
    u.rate = 0.9;
    u.onboundary = (e: SpeechSynthesisEvent) => {
      const r = highlightRangeAt(text, map, e.charIndex);
      if (r) setRange(r);
    };
    const done = () => { setSpeaking(false); setRange(null); };
    u.onend = done;
    u.onerror = done;
    setSpeaking(true);
    synth.speak(u);
  }, [supported, text]);

  const body = range
    ? (<>
        {text.slice(0, range.start)}
        <mark className="spoken-word">{text.slice(range.start, range.end)}</mark>
        {text.slice(range.end)}
      </>)
    : text;

  return (
    <div className="spokenblock">
      <p className={className}>{body}</p>
      {supported && (
        <button type="button" className="linkbtn readaloud" onClick={speak}
                aria-label={speaking ? "Stop reading" : label}>
          {speaking ? "◼ Stop" : "🔊 " + label}
        </button>
      )}
    </div>
  );
}
