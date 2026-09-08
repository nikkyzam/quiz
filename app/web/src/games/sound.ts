/* Tiny WebAudio synth for game feedback — no audio assets, no dependencies.
   Every sound is a couple of oscillators scheduled on one shared context.
   The context is created lazily on the first user gesture (browsers refuse
   to start audio before that), and a global mute is persisted so a parent
   can silence the arcade once and have it stay silenced. */

const MUTE_KEY = "mq-muted";

let ctx: AudioContext | null = null;
/* Guarded like every write in this file. `typeof localStorage` is "object" in
   a sandboxed iframe or with site data blocked, and the property access is
   what throws — at module scope, which meant the whole bundle failed to
   evaluate and the app rendered nothing, over a mute button. */
let muted = (() => {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
})();

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* private mode */ }
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}

/* One enveloped tone. freq ramp gives the "boing"/"ding" character. */
function tone(freq: number, at: number, dur: number, type: OscillatorType = "sine", vol = 0.18, glideTo?: number) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  /* right answer: bright two-note ding */
  correct() { tone(660, 0, 0.12, "triangle"); tone(880, 0.09, 0.18, "triangle"); },
  /* wrong answer: soft low buzz, never harsh */
  wrong() { tone(220, 0, 0.18, "sawtooth", 0.06, 160); },
  /* card flip / button tap */
  pop() { tone(520, 0, 0.07, "square", 0.07, 760); },
  /* streak milestone: quick rising arpeggio */
  streak() { tone(523, 0, 0.09, "triangle"); tone(659, 0.07, 0.09, "triangle"); tone(784, 0.14, 0.16, "triangle"); },
  /* countdown tick in the last seconds */
  tick() { tone(990, 0, 0.05, "square", 0.05); },
  /* game over fanfare */
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.16, "triangle", 0.16));
    tone(1319, 0.46, 0.3, "triangle", 0.14);
  },
  /* gentle "game over, try again" cadence */
  done() { tone(784, 0, 0.12, "triangle", 0.12); tone(659, 0.12, 0.22, "triangle", 0.12); }
};
