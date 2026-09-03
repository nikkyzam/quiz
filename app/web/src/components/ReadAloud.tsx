import { useEffect, useState, useCallback, useRef } from "react";

/* Read-aloud (spec 3.2.9). Uses the browser's own speech synthesis, so no
   audio assets and no third-party service. Maths is spoken in words rather
   than symbols, because a screen reader saying "4 x 6" as "four ex six" is
   worse than useless to a child who cannot yet read the question. */
export function speakableText(raw: string): string {
  return raw
    .replace(/−/g, "-")
    .replace(/(\d)\s*×\s*(\d)/g, "$1 times $2")
    .replace(/(\d)\s*÷\s*(\d)/g, "$1 divided by $2")
    .replace(/(\d)\s*\+\s*(\d)/g, "$1 plus $2")
    .replace(/(\d)\s*-\s*(\d)/g, "$1 minus $2")
    .replace(/(\d+)\s*:\s*(\d+)/g, "$1 to $2")
    .replace(/\b(\d+)\/(\d+)\b/g, (_m, a, b) => {
      const names: Record<string, string> = { "2": "half", "3": "third", "4": "quarter",
        "5": "fifth", "6": "sixth", "8": "eighth", "10": "tenth", "12": "twelfth" };
      const unit = names[b] || `over ${b}`;
      if (!names[b]) return `${a} ${unit}`;
      return `${a} ${unit}${Number(a) === 1 ? "" : "s"}`;
    })
    .replace(/\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g, "the point $1 comma $2")
    .replace(/\|(-?\d+)\|/g, "the absolute value of $1")
    .replace(/(\d)%/g, "$1 percent")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- preferences ----------
   Stored under localStorage "readaloud" as { rate, highlight }. Reading is
   wrapped because storage can be blocked (private mode, kiosk browsers). */
export type ReadAloudPrefs = { rate: number; highlight: boolean };
export function readAloudPrefs(): ReadAloudPrefs {
  const d: ReadAloudPrefs = { rate: 0.9, highlight: true };   // a little slower for children
  try {
    const raw = localStorage.getItem("readaloud");
    if (!raw) return d;
    const p = JSON.parse(raw);
    const rate = Number(p?.rate);
    return {
      rate: Number.isFinite(rate) && rate >= 0.5 && rate <= 2 ? rate : d.rate,
      highlight: p?.highlight === undefined ? d.highlight : !!p.highlight
    };
  } catch { return d; }
}

/* ---------- word alignment ----------
   The utterance is the spoken form ("4 times 6"), but the highlight has to
   land on the words the learner sees ("4 × 6"). `boundary` events give a
   character offset into the spoken string, so each spoken token is mapped
   back to a visible word: exact or prefix matches advance a pointer, and
   words the transform added ("times", "the point", "percent") stick to the
   symbol they replaced or the word they describe. */
export const splitWords = (text: string) => text.split(/(\s+)/);          // keeps the spacing
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function alignWords(text: string, spoken: string): { starts: number[]; map: number[] } {
  const rawWords = splitWords(text).filter(w => w.trim());
  const starts: number[] = [], map: number[] = [];
  let last = -1;
  for (const m of spoken.matchAll(/\S+/g)) {
    const tok = m[0], n = norm(tok);
    let hit = -1;
    for (let i = last + 1; i <= Math.min(last + 2, rawWords.length - 1); i++) {
      const rn = norm(rawWords[i]);
      if (n ? (rn === n || rn.startsWith(n)) : rawWords[i] === tok) { hit = i; break; }
    }
    if (hit >= 0) last = hit;
    else {
      const nxt = rawWords[last + 1];
      hit = nxt !== undefined && !norm(nxt) ? last + 1 : Math.max(0, last);
    }
    starts.push(m.index ?? 0);
    map.push(Math.min(hit, Math.max(0, rawWords.length - 1)));
  }
  return { starts, map };
}

/* ---------- shared highlight state ----------
   The button that speaks and the text that highlights are separate
   components, so the active word is broadcast keyed by the text itself:
   whatever is being spoken is exactly what is highlighted. */
type HL = { text: string; word: number };
const listeners = new Set<(h: HL) => void>();
const broadcast = (h: HL) => listeners.forEach(fn => fn(h));

export function useReadAloud(text: string) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [activeWord, setActiveWord] = useState(-1);
  const timer = useRef<number | null>(null);
  const uttRef = useRef<SpeechSynthesisUtterance | null>(null);

  const setWord = useCallback((w: number) => { setActiveWord(w); broadcast({ text, word: w }); }, [text]);

  const stop = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch {}
    if (timer.current) { window.clearInterval(timer.current); timer.current = null; }
    uttRef.current = null;
    setSpeaking(false);
    setWord(-1);
  }, [setWord]);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);
  /* Playback stops on unmount and when the text changes (next question). */
  useEffect(() => () => { stop(); }, [stop]);

  const start = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    try { synth.cancel(); } catch {}
    const prefs = readAloudPrefs();
    const spoken = speakableText(text);
    const { starts, map } = alignWords(text, spoken);
    const u = new SpeechSynthesisUtterance(spoken);
    uttRef.current = u;
    u.rate = prefs.rate;
    let sawBoundary = false;
    const finish = () => { if (uttRef.current === u) stop(); };
    u.onend = finish;
    u.onerror = finish;
    if (prefs.highlight) {
      u.onboundary = (e: SpeechSynthesisEvent) => {
        if (e.name && e.name !== "word") return;
        sawBoundary = true;
        let i = 0;
        while (i + 1 < starts.length && starts[i + 1] <= e.charIndex) i++;
        setWord(map[i] ?? -1);
      };
      /* Engines that never fire boundary events (some mobile voices) get a
         paced estimate instead, so the highlight still moves. */
      const words = splitWords(text).filter(w => w.trim()).length;
      let k = 0;
      timer.current = window.setInterval(() => {
        if (sawBoundary || uttRef.current !== u) { if (timer.current) window.clearInterval(timer.current); timer.current = null; return; }
        if (k < words) setWord(k++);
      }, Math.round(380 / prefs.rate));
    }
    setSpeaking(true);
    setWord(prefs.highlight ? 0 : -1);
    synth.speak(u);
  }, [supported, text, setWord, stop]);

  return { speaking, start, stop, activeWord, supported };
}

/* The question text as one span per word. The block is aria-live="off" so
   the highlight moving does not make a screen reader re-announce the whole
   question on every word; the spoken audio is already doing that job. */
export function ReadAloudText({ text, id, className = "qtext" }: { text: string; id?: string; className?: string }) {
  const [word, setWord] = useState(-1);
  useEffect(() => {
    const fn = (h: HL) => { if (h.text === text) setWord(h.word); };
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, [text]);
  useEffect(() => setWord(-1), [text]);

  const parts = splitWords(text);
  let w = -1;
  return (
    <p className={className + " ra-text"} id={id} aria-live="off">
      {parts.map((p, i) => {
        if (!p.trim()) return p;
        w++;
        return w === word
          ? <mark key={i} className="ra-word ra-active" aria-current="true">{p}</mark>
          : <span key={i} className="ra-word">{p}</span>;
      })}
    </p>
  );
}

export function ReadAloud({ text, label = "Read aloud" }: { text: string; label?: string }) {
  const { speaking, start, stop, supported } = useReadAloud(text);
  if (!supported) return null;         // no affordance where it cannot work
  return (
    <button type="button" className="linkbtn readaloud" onClick={speaking ? stop : start}
            aria-label={speaking ? "Stop reading" : label} aria-pressed={speaking}>
      {speaking ? "◼ Stop" : "🔊 " + label}
    </button>
  );
}
