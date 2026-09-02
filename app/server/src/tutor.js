/* AI tutor (spec 4.1.11, 13.5): chat hints, misconception detection and
   safety filters.

   Two layers, and the safety layer does not depend on the model:

   1. Rules. Every message passes an INPUT filter (personal-information
      requests, contact-seeking, harmful topics) before anything else sees
      it, and every reply passes an OUTPUT filter that redacts the correct
      answer, so a tutor can never hand the answer over however it is asked.
      Misconception detection uses the same classifier as error analysis.
      With no provider configured the rules also write the reply: a
      Socratic nudge built from the hint ladder, which never reaches the
      worked solution.

   2. Provider. With ANTHROPIC_API_KEY set the reply comes from Claude
      through the official SDK, with a hard latency budget: if the model has
      not answered inside TUTOR_TIMEOUT_MS (default 3000, spec 13.5) the
      rules answer instead, and the latency is recorded either way. The
      learner's name and account never leave the server — the model sees the
      question, the hint ladder and the conversation, nothing else. */

import Anthropic from "@anthropic-ai/sdk";
import { classify, CATEGORIES } from "./errors.js";
import { hintLadder, gradeAnswer } from "./helpers.js";
import { track } from "./analytics.js";

export const TIMEOUT_MS = Number(process.env.TUTOR_TIMEOUT_MS || 3000);

/* ---------- safety: input ---------- */
const BLOCKED_INPUT = [
  { re: /\b(phone|mobile|cell)\s*(number)?\b|\b(what'?s|whats|give me) your (address|number)\b|\bwhere do you live\b|\bhome address\b/i, kind: "personal_info" },
  { re: /\b(meet( up)?|hang out|come over|send (me )?(a )?(pic|photo|selfie))\b|\b(snapchat|instagram|tiktok|discord|whatsapp)\b/i, kind: "contact_seeking" },
  { re: /\b(kill|hurt|cut) (myself|me)\b|\bsuicide\b|\bwant to die\b/i, kind: "self_harm" },
  { re: /\b(fuck|shit|bitch|asshole|cunt)\b/i, kind: "profanity" },
  { re: /\b(password|credit card|social security|ssn|bank)\b/i, kind: "sensitive_data" },
  { re: /ignore (all|the|your) (previous|above|earlier) instructions|you are now|pretend (you are|to be)|system prompt/i, kind: "prompt_injection" }
];
const SAFE_REPLIES = {
  personal_info: "I only talk about maths here, and I never share or ask for personal details. Back to the problem — what have you tried so far?",
  contact_seeking: "I'm a maths helper, not a friend to meet or message. Let's stick to the question. Which part is tricky?",
  self_harm: "It sounds like you might be having a hard time. Please tell a parent, teacher or another trusted adult right now — they want to help. I'm here for the maths whenever you're ready.",
  profanity: "Let's keep it friendly. What part of the question is bothering you?",
  sensitive_data: "Never type passwords or card details into a chat, even with me. Now, about the question — where are you stuck?",
  prompt_injection: "Nice try! I only help with the maths in front of us. What do you know about this question so far?"
};
export function filterInput(text) {
  const t = String(text || "").slice(0, 1000);
  for (const b of BLOCKED_INPUT) if (b.re.test(t)) return { blocked: true, kind: b.kind, reply: SAFE_REPLIES[b.kind] };
  return { blocked: false, text: t };
}

/* ---------- safety: output ----------
   The correct answer is redacted from any reply, whatever produced it, in
   every form we can recognise: the raw answer, its digits with spacing, and
   an option's text for multiple choice. */
export function redactAnswer(reply, q) {
  const forms = new Set();
  const { correctAnswer } = gradeAnswer(q, "__");
  forms.add(String(correctAnswer));
  if (q.type === "in") { forms.add(String(q.ans)); forms.add(String(q.ans).replace("-", "−")); }
  if (q.type === "mc") forms.add(String(q.opts[q.a]));
  if (q.type === "pair") { forms.add(`(${q.ansP[0]}, ${q.ansP[1]})`); forms.add(`(${q.ansP[0]},${q.ansP[1]})`); }
  if (q.type === "plot") forms.add(`(${q.ansPt[0]}, ${q.ansPt[1]})`);
  if (q.type === "multi") for (const i of q.aMulti) forms.add(String(q.opts[i]));
  if (q.type === "order") forms.add(q.ansOrder.join(", "));
  let out = String(reply), redacted = false;
  for (const f of [...forms].filter(x => x && x.length).sort((a, b) => b.length - a.length)) {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = /^[\d.\-−]+$/.test(f) ? new RegExp(`(?<![\\d.])${esc}(?![\\d.])`, "g") : new RegExp(esc, "gi");
    if (re.test(out)) { out = out.replace(re, "[the answer]"); redacted = true; }
  }
  /* "The answer is [the answer]" is no use: replace the whole sentence with a nudge. */
  if (redacted) out = out.replace(/[^.!?]*\[the answer\][^.!?]*[.!?]?/g, " I can't say the answer itself — but you're close. ").replace(/\s+/g, " ").trim();
  return { text: out, redacted };
}

/* ---------- misconception detection ---------- */
export function misconceptionFor(q, lastAnswer) {
  if (lastAnswer === undefined || lastAnswer === null || lastAnswer === "") return null;
  const category = classify(q, lastAnswer);
  if (category === "unclassified") return null;
  return { category, label: CATEGORIES[category] };
}

const NUDGES = {
  sign_error: "Your number is the right size but pointing the wrong way. Which direction should it go — think about what negative means here.",
  reversed_pair: "You have the two coordinates the wrong way round. Which one comes first in (x, y)?",
  place_value: "You are out by a factor of ten. Check where the decimal point or the zero should sit.",
  off_by_one: "So close — you are one away. Recount the last step carefully.",
  operation_swap: "Check which operation the question actually needs. Are you adding when it wants multiplying?",
  partial_selection: "Some of your picks are right, but there is at least one more that also works. Look again at the ones you left out.",
  over_selection: "You have the right ones, plus one that does not belong. Which pick can you not justify?",
  order_reversed: "Your order is exactly backwards. Read the question again: smallest first or largest first?",
  order_adjacent: "Nearly there — two neighbours are swapped. Compare each pair side by side.",
  blank: "Have a go, even a guess. Then we can talk about it."
};

/* ---------- rule-based tutor ---------- */
export function rulesReply({ q, history = [], misconception }) {
  if (misconception) return NUDGES[misconception.category] || NUDGES.blank;
  const turns = history.filter(h => h.role === "tutor").length;
  const ladder = hintLadder(q);
  if (turns === 0) return `Let's start with what the question asks. In your own words: what do you need to find? Here's a nudge — ${ladder[0]}`;
  if (turns === 1) return `Good. ${ladder[1]} What do you get when you try that?`;
  return "You have everything you need now. Write down each step and check it as you go — I won't give the final answer, but tell me what you get and I'll say if you're on track.";
}

/* ---------- provider ---------- */
let client = null;
function provider() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.TUTOR_API_URL || undefined,
                                        timeout: TIMEOUT_MS, maxRetries: 0 });
  return client;
}

const SYSTEM = `You are a patient maths tutor for a child aged 5 to 14. Rules you never break:
- Never state the final answer, never write it in any form, never confirm a guess as "correct". Guide with one question or one small step at a time.
- Two or three short sentences at most. Plain words a child understands. No markdown.
- Stay on this maths question. If the child asks about anything else, gently steer back.
- Never ask for or mention personal details.`;

async function providerReply({ q, message, history, misconception }) {
  const c = provider();
  if (!c) return null;
  const ladder = hintLadder(q);
  const context = `Question: ${q.q}\nCorrect answer (NEVER reveal): ${gradeAnswer(q, "__").correctAnswer}\n` +
    `Hint ladder the tutor may draw on: 1) ${ladder[0]} 2) ${ladder[1]}\n` +
    (misconception ? `The child's last wrong answer looks like: ${misconception.label}.\n` : "");
  const messages = [
    ...history.slice(-6).map(h => ({ role: h.role === "tutor" ? "assistant" : "user", content: String(h.text).slice(0, 500) })),
    { role: "user", content: message }
  ];
  const res = await c.messages.create({
    model: process.env.TUTOR_MODEL || "claude-opus-5",
    max_tokens: 300,
    output_config: { effort: "low" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }, { type: "text", text: context }],
    messages
  });
  if (res.stop_reason === "refusal") return null;
  return res.content.filter(b => b.type === "text").map(b => b.text).join(" ").trim() || null;
}

/* ---------- entry point ---------- */
export async function chat({ learnerId, q, message, lastAnswer, history = [] }) {
  const t0 = Date.now();
  const filtered = filterInput(message);
  if (filtered.blocked) {
    track("tutor.blocked", { kind: filtered.kind }, { learnerId });
    return { reply: filtered.reply, source: "safety", blocked: filtered.kind, misconception: null, redacted: false, latencyMs: Date.now() - t0 };
  }
  const misconception = misconceptionFor(q, lastAnswer);
  let source = "rules", raw = null, error = null;
  if (provider()) {
    try {
      raw = await Promise.race([
        providerReply({ q, message: filtered.text, history, misconception }),
        new Promise(res => setTimeout(() => res(null), TIMEOUT_MS))
      ]);
      if (raw) source = "llm"; else error = "timeout_or_empty";
    } catch (e) { error = String(e.message || e).slice(0, 120); }
  }
  if (!raw) raw = rulesReply({ q, history, misconception });
  const { text, redacted } = redactAnswer(raw, q);
  const latencyMs = Date.now() - t0;
  track("tutor.reply", { source, redacted, latencyMs, misconception: misconception?.category || null, error }, { learnerId });
  return { reply: text, source, misconception, redacted, latencyMs, fallbackReason: source === "rules" && provider() ? error : null };
}
