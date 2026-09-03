/* First-run tour (spec 10.7). Four short steps, skippable at any point,
   remembered on the device so it never nags twice. Copy comes through the
   localisation store so the tour follows the chosen language. */
import "../styles/settings.css";
import { useState } from "react";
import { useI18n } from "../i18n";

const KEY = "onboarded";
let shownThisSession = false;

export function needsOnboarding(): boolean {
  if (typeof window === "undefined" || shownThisSession) return false;
  try { return localStorage.getItem(KEY) !== "1"; }
  catch { return !shownThisSession; }
}

function markDone() {
  shownThisSession = true;
  try { localStorage.setItem(KEY, "1"); } catch { /* storage blocked: the session flag covers it */ }
}

type Step = { art: string; title: string; body: string; points?: { ico: string; head: string; text: string }[] };

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t, dir } = useI18n();
  const [step, setStep] = useState(0);

  const steps: Step[] = [
    {
      art: "🐲", title: t("onboarding.welcome"),
      body: "BeastForge is a maths playground from Kindergarten to Grade 8. Each learner picks a beast, then a grade and a topic, and the questions adapt as they go.",
      points: [
        { ico: "🗺️", head: t("onboarding.step1"), text: "Every grade is a map of units. Core topics unlock in order; advanced ones sit beside them for the curious." },
        { ico: "🎯", head: t("onboarding.step2"), text: "Get things right and the questions get harder. Miss a few and they ease off." }
      ]
    },
    {
      art: "🏆", title: "Three tiers per topic",
      body: "Every topic comes in three sizes. Start wherever feels right; nothing is locked behind the one before.",
      points: [
        { ico: "🌱", head: "Practice", text: "Learn the idea and get it solid. Friendly questions with hints on tap." },
        { ico: "⚡", head: "Challenge", text: "Multi-step problems that mix ideas together." },
        { ico: "👑", head: "Boss", text: "Work backwards, spot the trick, prove you own it." }
      ]
    },
    {
      art: "⭐", title: "Stars and mastery",
      body: t("onboarding.step3"),
      points: [
        { ico: "✅", head: "Pass mark", text: "Core topics need 90%, advanced topics 80%. A mastery check is a short quiz with no hints." },
        { ico: "💡", head: "Hints", text: t("help.hint") },
        { ico: "🔁", head: "Review", text: "Topics you nearly mastered come back in your review queue so they stick." }
      ]
    },
    {
      art: "👪", title: "For parents and teachers",
      body: "Grown-ups get their own view without getting in the way of play.",
      points: [
        { ico: "📈", head: "Progress", text: "Tap Progress in the top bar to see every topic, tier and recent round for a learner." },
        { ico: "✉️", head: "Weekly summary", text: "A short email each week if you want it. Turn it on or off in Settings." },
        { ico: "🏫", head: "Classes", text: "Teachers create a class and share its join code; parents link a child with one tap." }
      ]
    }
  ];

  const total = steps.length;
  const cur = steps[step];
  const last = step === total - 1;
  const finish = () => { markDone(); onDone(); };
  const back = () => (step === 0 ? finish() : setStep(step - 1));
  const next = () => (last ? finish() : setStep(step + 1));

  return (
    <div className="ob">
      <button type="button" className="back" onClick={back}>
        {dir === "rtl" ? "→" : "←"} {step === 0 ? t("onboarding.skip") : t("nav.back")}
      </button>
      <div className="card ob-card">
        <ol className="ob-dots" aria-label="Tour progress">
          {steps.map((s, i) => (
            <li key={i} aria-current={i === step ? "step" : undefined}>
              <span>{s.title}</span>
            </li>
          ))}
        </ol>
        <p className="eyebrow" role="status">{t("onboarding.step", { n: step + 1, total })}</p>
        <div className="ob-art" aria-hidden="true">{cur.art}</div>
        <h1>{cur.title}</h1>
        <p className="lede" style={{ margin: "0 auto 12px" }}>{cur.body}</p>
        {cur.points && (
          <ul className="ob-list">
            {cur.points.map(p => (
              <li key={p.head}>
                <span className="ico" aria-hidden="true">{p.ico}</span>
                <span><b>{p.head}</b>{p.text}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="ob-nav">
          <button type="button" className="linkbtn" onClick={finish}>{t("onboarding.skip")}</button>
          <button type="button" className="btn" onClick={next}>
            {last ? t("onboarding.done") : t("onboarding.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
