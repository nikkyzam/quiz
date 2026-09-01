import { useEffect, useState, useCallback } from "react";

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
