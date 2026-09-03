/* Renders each screen's real markup for the accessibility audit.
   Hooks that fetch don't run under renderToStaticMarkup, so screens are
   given the props they'd have once loaded. */
import { renderToStaticMarkup } from "react-dom/server";
import { AuthScreen } from "../src/screens/Auth";
import { LearnerPicker } from "../src/screens/Learners";
import { GradeList, GradeMap, TierPicker } from "../src/screens/Curriculum";

const noop = () => {};
const learner = { id: "l1", name: "Josiah", beast: "vex", stars: 2, topics: 1 };
const tiers = [
  { id: "practice", name: "Practice", blurb: "Learn the idea and get it solid." },
  { id: "challenge", name: "Challenge", blurb: "Multi-step problems." },
  { id: "boss", name: "Boss", blurb: "Work backwards." }
];
const cur = {
  curriculum: {
    "6": { label: "Grade 6", beast: "vex", units: [
      { name: "The Number System", track: "core", topics: [{ id: "g6-nscoord", name: "Coordinate Plane" }] },
      { name: "Number Theory", track: "adv", topics: [{ id: "g6-crt", name: "Chinese Remainder Theorem" }] }
    ]}
  },
  tiers,
  counts: { "g6-nscoord": { practice: 40, challenge: 22, boss: 16 } },
  thresholds: { "g6-nscoord": 90, "g6-crt": 80 }
};

/* Screens added by the feature areas; each file exports its own SCREENS. */
import { SCREENS as HOME } from "./screens/home";
import { SCREENS as LESSONS } from "./screens/lessons";
import { SCREENS as CONTEST } from "./screens/contest";
import { SCREENS as PROOFS } from "./screens/proofs";
import { SCREENS as PLAY } from "./screens/play";
import { SCREENS as AUTHORING } from "./screens/authoring";
import { SCREENS as SETTINGS } from "./screens/settings";
import { SCREENS as FAMILY } from "./screens/family";
import { SCREENS as TEACHER } from "./screens/teacher";
import { SCREENS as CORE } from "./screens/core";

export const SCREENS: Record<string, string> = {
  ...HOME, ...LESSONS, ...CONTEST, ...PROOFS, ...PLAY, ...AUTHORING, ...SETTINGS, ...FAMILY, ...TEACHER, ...CORE,
  auth: renderToStaticMarkup(<AuthScreen onDone={noop} />),
  learners: renderToStaticMarkup(
    <LearnerPicker userName="Sam" learners={[learner]} onPick={noop}
                   onChanged={async () => []} onSignOut={noop} />),
  grades: renderToStaticMarkup(
    <div className="wrap"><main><GradeList order={["6"]} cur={cur as any} onOpen={noop} /></main></div>),
  gradeMap: renderToStaticMarkup(
    <div className="wrap"><main><GradeMap gradeKey="6" cur={cur as any} onBack={noop} onOpen={noop} /></main></div>),
  tiers: renderToStaticMarkup(
    <div className="wrap"><main>
      <TierPicker topicId="g6-nscoord" topicName="Coordinate Plane" advanced={false}
                  tiers={tiers} counts={cur.counts} threshold={90} learner={learner as any}
                  onBack={noop} onStart={noop} onDiagnostic={noop} onMastery={noop} onPractice={noop} />
    </main></div>)
};
