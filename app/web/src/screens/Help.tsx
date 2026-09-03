/* Help and FAQ (spec 10.7). A searchable accordion: every question is a
   real button with aria-expanded, so screen readers and keyboards get the
   same experience as a tap. */
import "../styles/settings.css";
import { useId, useMemo, useState } from "react";
import { useI18n } from "../i18n";

type Item = { id: string; q: string; a: string[] };
type Group = { id: string; title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    id: "practice", title: "Practising", items: [
      { id: "start", q: "How do I start a round?", a: [
        "Pick a grade, then a topic on its map, then a tier. Practice is the friendly one, Challenge mixes ideas, Boss makes you work backwards.",
        "A round is ten questions. Your best score for each tier is kept, so you can always try again."
      ] },
      { id: "adapt", q: "Why do the questions change difficulty?", a: [
        "Adaptive practice watches how you are doing. A run of correct answers brings harder questions; a few misses bring easier ones so you can rebuild.",
        "It also spots when you are guessing fast and suggests slowing down or taking a hint."
      ] },
      { id: "types", q: "What kinds of questions are there?", a: [
        "Multiple choice, typed answers, matching pairs, putting things in order and pick-all-that-apply. Typed answers accept fractions like 3/4 and decimals like 0.75."
      ] },
      { id: "diagnostic", q: "What is the diagnostic?", a: [
        "A short placement check for a topic. It finds which skills are solid and which need work, then recommends a tier to start on. Nothing from it counts as a score."
      ] }
    ]
  },
  {
    id: "hints", title: "Hints and feedback", items: [
      { id: "hint", q: "Do hints cost anything?", a: [
        "Hints cost stars but never marks. Take one when you are stuck. Each question has up to three hints, each more direct than the last.",
        "A mastery check has no hints, which is what makes it a check."
      ] },
      { id: "wrong", q: "What happens when I get one wrong?", a: [
        "You see the correct answer and a short explanation straight away, and the question comes back later in the round or in your review queue."
      ] }
    ]
  },
  {
    id: "mastery", title: "Stars and mastery", items: [
      { id: "master", q: "How do I master a topic?", a: [
        "Mastery means scoring the pass mark on a check with no hints. Core topics need 90%, advanced topics 80%.",
        "Once a tier reaches the pass mark it earns a star, and the next core topic on the map opens up."
      ] },
      { id: "review", q: "What is the review queue?", a: [
        "Topics you nearly mastered, sorted by how close you are. It is the quickest way to turn a near miss into a star."
      ] },
      { id: "streak", q: "How do streaks and daily goals work?", a: [
        "Play on consecutive days to build a streak. The daily goal is a small number of questions; meeting it keeps the streak alive and adds a bonus."
      ] }
    ]
  },
  {
    id: "contests", title: "Contests and proofs", items: [
      { id: "contest", q: "What is Contest Corner?", a: [
        "Timed sets in the style of maths competitions, with a leaderboard among your class or family. Scores there are separate from mastery."
      ] },
      { id: "proofs", q: "How do proofs work?", a: [
        "Proof puzzles give you the statements and ask you to put them in a valid order, or to fill in the missing justification. There is no timer; think it through."
      ] }
    ]
  },
  {
    id: "grownups", title: "Parents and teachers", items: [
      { id: "parent", q: "How do I see my child's progress?", a: [
        "Tap Progress in the top bar while their profile is active. You will see every topic, the best score per tier, and the last rounds played.",
        "A weekly summary can be emailed to you; switch it on in Settings under Notifications."
      ] },
      { id: "learners", q: "Can I have more than one learner?", a: [
        "Yes. Each learner has a name, a beast and their own progress. Switch between them from the top bar."
      ] },
      { id: "teacher", q: "How do teachers set up a class?", a: [
        "Create a class from the teacher view and share its join code. Parents enter the code to link a child, or you can import a roster. Assignments and class progress live in the same view."
      ] }
    ]
  },
  {
    id: "access", title: "Accessibility", items: [
      { id: "readaloud", q: "Can questions be read aloud?", a: [
        "Yes. Every question and hint has a Read aloud button that uses your device's voice. Speed, voice and word highlighting are in Settings under Read aloud."
      ] },
      { id: "keyboard", q: "Can I use the keyboard?", a: [
        "Everything works without a mouse. Press Tab to move between choices, Space or Enter to pick one, and Enter in a typed answer to check it. A Skip to main content link appears when you press Tab on any screen."
      ] },
      { id: "contrast", q: "Is there a high-contrast or dark mode?", a: [
        "Pick Dark, Light or Match my device in Settings under Appearance. Both themes meet WCAG AA contrast, and the app respects your system's reduce-motion setting."
      ] },
      { id: "language", q: "Can I change the language?", a: [
        "Settings offers English, Spanish and Arabic. Arabic reads right to left and the whole screen mirrors to match. The maths itself never changes."
      ] }
    ]
  },
  {
    id: "privacy", title: "Privacy and data", items: [
      { id: "data", q: "What do you store about my child?", a: [
        "A name, a chosen beast and their answers. No photos, no location, no advertising. Accounts belong to a parent or teacher, who consents when signing up."
      ] },
      { id: "export", q: "Can I download or delete our data?", a: [
        "Yes, both are in Settings under Your data. Download gives you a JSON file of everything; Delete removes the account, its learners and all progress for good."
      ] },
      { id: "activity", q: "Can I see who accessed the account?", a: [
        "Settings shows an activity log of sign-ins, exports and other important actions with their time."
      ] }
    ]
  }
];

export function Help({ onBack }: { onBack: () => void }) {
  const { t, dir } = useI18n();
  const uid = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map(g => ({
      ...g,
      items: g.items.filter(i => (i.q + " " + i.a.join(" ")).toLowerCase().includes(q))
    })).filter(g => g.items.length);
  }, [query]);
  const count = groups.reduce((n, g) => n + g.items.length, 0);

  const toggle = (id: string) => setOpen(o => ({ ...o, [id]: !o[id] }));
  const setAll = (v: boolean) => {
    const next: Record<string, boolean> = {};
    GROUPS.forEach(g => g.items.forEach(i => { next[i.id] = v; }));
    setOpen(next);
  };

  return (
    <>
      <button type="button" className="back" onClick={onBack}>{dir === "rtl" ? "→" : "←"} {t("nav.back")}</button>
      <div className="eyebrow">{t("help.title")}</div>
      <h1>Help</h1>
      <p className="lede">Short answers about practising, stars, hints, grown-up tools, accessibility and privacy.</p>

      <div className="help-search">
        <div className="field">
          <label htmlFor={uid + "-q"}>{t("help.search")}</label>
          <input id={uid + "-q"} type="search" value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="hints, stars, keyboard…" autoComplete="off" />
        </div>
      </div>
      <p className="help-count" role="status">
        {count ? t("help.results", { n: count }) : t("help.none")}
      </p>
      <div className="help-tools">
        <button type="button" className="linkbtn" onClick={() => setAll(true)}>{t("help.expandAll")}</button>
        <button type="button" className="linkbtn" onClick={() => setAll(false)}>{t("help.collapseAll")}</button>
      </div>

      {groups.map(g => (
        <section className="faq-group" key={g.id} aria-labelledby={uid + "-" + g.id}>
          <h2 id={uid + "-" + g.id}>{g.title}</h2>
          <ul className="faq-list">
            {g.items.map(item => {
              const isOpen = !!open[item.id] || (!!query.trim() && count <= 3);
              const panel = uid + "-p-" + item.id, btn = uid + "-b-" + item.id;
              return (
                <li key={item.id}>
                  <h3 className="faq-q">
                    <button type="button" id={btn} aria-expanded={isOpen} aria-controls={panel}
                            onClick={() => toggle(item.id)}>
                      <span>{item.q}</span>
                      <span className="chev" aria-hidden="true">{isOpen ? "−" : "+"}</span>
                    </button>
                  </h3>
                  <div id={panel} className="faq-a" role="region" aria-labelledby={btn} hidden={!isOpen}>
                    {item.a.map((p, i) => <p key={i}>{p}</p>)}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="hintbox">
        <b>{t("help.mastery")}</b>
      </div>
    </>
  );
}
