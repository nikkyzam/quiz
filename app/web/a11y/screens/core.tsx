/* Core play screens in their loaded state, for the axe audit: a quiz round
   on a plot question (3.2.2), the same round played offline (10.6), adaptive
   practice, and the tier picker with an offline pack present. Effects do
   not run here, so each screen takes its data through props. */
import { renderToStaticMarkup } from "react-dom/server";
import { Quiz } from "../../src/screens/Quiz";
import { Practice } from "../../src/screens/Practice";
import { TierPicker } from "../../src/screens/Curriculum";
import type { Question } from "../../src/api";

const noop = () => {};
const learner = { id: "l1", name: "Josiah", beast: "vex", stars: 2, topics: 1 };
const wrap = (el: JSX.Element) => renderToStaticMarkup(<div className="wrap"><main>{el}</main></div>);

const plotQ = {
  id: "g6-nscoord:41", sec: "B", secName: "Plotting points", type: "plot" as const,
  q: "Plot the point (4, 2).", mono: false, hint: "Go right 4, then up 2.", fig: null,
  grid: { min: -6, max: 6 }
};
const mcQ: Question = {
  id: "g6-nscoord:2", sec: "A", secName: "Reading points", type: "mc",
  q: "Which quadrant holds the point (−3, 5)?", opts: ["I", "II", "III", "IV"],
  mono: false, hint: null, fig: null
};
/* The plot type widens Question locally, so the list is cast for the prop. */
const questions = [plotQ, mcQ] as unknown as Question[];

const tiers = [
  { id: "practice", name: "Practice", blurb: "Learn the idea and get it solid." },
  { id: "challenge", name: "Challenge", blurb: "Multi-step problems." },
  { id: "boss", name: "Boss", blurb: "Work backwards." }
];
const counts = { "g6-nscoord": { practice: 40, challenge: 22, boss: 16 } };

export const SCREENS: Record<string, string> = {
  quizPlot: wrap(
    <Quiz topicId="g6-nscoord" topicName="Coordinate Plane" tier="practice" advanced={false}
          threshold={90} learner={learner} onExit={noop} initial={questions} />),
  quizOffline: wrap(
    <Quiz topicId="g6-nscoord" topicName="Coordinate Plane" tier="practice" advanced={false}
          threshold={90} learner={learner} onExit={noop} initial={questions} initialOffline />),
  practicePlot: wrap(
    <Practice learner={learner} topicId="g6-nscoord" topicName="Coordinate Plane"
              onExit={noop} onRestart={noop}
              initial={{ sessionId: "s1", question: plotQ as unknown as Question, length: 10 }} />),
  tiersOffline: wrap(
    <TierPicker topicId="g6-nscoord" topicName="Coordinate Plane" advanced={false}
                tiers={tiers} counts={counts} threshold={90} learner={learner}
                onBack={noop} onStart={noop} onDiagnostic={noop} onMastery={noop} onPractice={noop}
                packs={["practice"]} />)
};
