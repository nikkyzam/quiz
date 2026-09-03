/* Comic lessons rendered in their loaded state for the axe audit. */
import { renderToStaticMarkup } from "react-dom/server";
import { Lessons, LessonPlayer, type LessonsData, type LessonDetail, type Curriculum } from "../../src/screens/Lessons";

const noop = () => {};
const learner = { id: "l1", name: "Josiah", beast: "vex", stars: 2, topics: 1 };
const cur = {
  curriculum: {
    "K": { label: "Kindergarten", beast: "pip", units: [{ name: "Counting", track: "core", topics: [{ id: "k-add10", name: "Adding within 10" }] }] },
    "3": { label: "Grade 3", beast: "nim", units: [{ name: "Fractions", track: "core", topics: [{ id: "g3-fracnum", name: "Fractions as numbers" }] }] },
    "6": { label: "Grade 6", beast: "vex", units: [{ name: "The Number System", track: "core", topics: [{ id: "g6-nscoord", name: "Coordinate Plane" }] }] }
  },
  tiers: [], counts: {}, thresholds: {}, mastery: { core: 90, adv: 80 }
} as unknown as Curriculum;

const library: LessonsData = {
  lessons: [
    { id: "les-k-add10", topicId: "k-add10", topic: "Adding within 10", grade: "K", title: "Pip and the Two Baskets", panels: 5, checks: 2 },
    { id: "les-g3-fracnum", topicId: "g3-fracnum", topic: "Fractions as numbers", grade: "3", title: "Nim Shares a Pizza", panels: 5, checks: 2 },
    { id: "les-g6-nscoord", topicId: "g6-nscoord", topic: "Coordinate Plane", grade: "6", title: "Vex Maps the Plane", panels: 5, checks: 2 }
  ],
  progress: [
    { id: "les-k-add10", title: "Pip and the Two Baskets", topicId: "k-add10", grade: "K", panels: 5, resumeAt: null, checksPassed: 2, completed: true },
    { id: "les-g3-fracnum", title: "Nim Shares a Pizza", topicId: "g3-fracnum", grade: "3", panels: 5, resumeAt: 2, checksPassed: 1, completed: false },
    { id: "les-g6-nscoord", title: "Vex Maps the Plane", topicId: "g6-nscoord", grade: "6", panels: 5, resumeAt: 0, checksPassed: 0, completed: false }
  ]
};

const lesson: LessonDetail = {
  id: "les-g6-nscoord", topicId: "g6-nscoord", grade: "6", title: "Vex Maps the Plane", panels: 5, checks: 2,
  topic: "Coordinate Plane", resumeAt: 2, checksPassed: 0, completed: false,
  panelList: [
    { index: 0, art: { kind: "plane", pts: [] }, alt: "A coordinate plane with the x-axis running left to right and the y-axis up and down, crossing at the origin.",
      text: "Vex unrolls a map. Two number lines cross at the origin, (0, 0). Left–right is x; up–down is y.", check: null },
    { index: 1, art: { kind: "plane", pts: [[3, 2, "A"]] }, alt: "The same plane with point A plotted 3 to the right and 2 up.",
      text: "A point is a pair: (x, y). To find (3, 2), go 3 right, then 2 up.", check: null },
    { index: 2, art: { kind: "plane", pts: [[-4, 1, "B"]] }, alt: "Point B plotted 4 to the left and 1 up.",
      text: "Negative x means left. (−4, 1) is 4 left and 1 up — that is Quadrant II.",
      check: { id: "les-g6-nscoord#2", type: "plot", q: "Plot the point (2, −3).", grid: { min: -5, max: 5 }, hint: "x first: 2 to the right. Then y: 3 down." } },
    { index: 3, art: { kind: "plane", pts: [[2, 3, "P"], [2, -1, "Q"]], path: [[2, 3], [2, -1]] }, alt: "Points P (2, 3) and Q (2, −1) joined by a vertical dashed line.",
      text: "Same x, different y: the distance is straight up and down. From 3 down to −1 is 4 units.",
      check: { id: "les-g6-nscoord#3", type: "in", q: "How far apart are (5, 2) and (5, −4)?", hint: "Same x, so count along y." } },
    { index: 4, art: { kind: "celebrate", stars: 3 }, alt: "Vex standing at the origin of a map dotted with points.",
      text: "Every point has an address. Read x, then y, and you can find anything on the plane.", check: null }
  ]
};

const mcLesson: LessonDetail = {
  id: "les-k-add10", topicId: "k-add10", grade: "K", title: "Pip and the Two Baskets", panels: 5, checks: 2,
  topic: "Adding within 10", resumeAt: 3, checksPassed: 1, completed: false,
  panelList: [
    { index: 0, art: { kind: "baskets", left: 3, right: 2 }, alt: "Two baskets. The left holds 3 apples, the right holds 2.",
      text: "Pip found two baskets of apples. 'How many altogether?' Pip wondered.", check: null },
    { index: 1, art: { kind: "baskets", left: 3, right: 2, merge: true }, alt: "The apples are tipped into one big basket: 3 and 2 make 5.",
      text: "'Put them together and count!' said Pip. 3... then 4, 5. Five apples!", check: null },
    { index: 2, art: { kind: "fingers", n: 5 }, alt: "A hand showing five fingers.",
      text: "You can add on your fingers too. Start at 3, then count on 2 more: 4, 5.",
      check: { id: "les-k-add10#2", type: "in", q: "2 + 3 = ?", hint: "Count on from 2." } },
    { index: 3, art: { kind: "baskets", left: 4, right: 4 }, alt: "Two baskets with 4 apples each.",
      text: "'What about 4 and 4?' asked Pip. That one is a double: 4 + 4 = 8.",
      check: { id: "les-k-add10#3", type: "mc", q: "Which pair makes 6?", opts: ["3 + 3", "4 + 1", "2 + 2", "5 + 2"], hint: null } },
    { index: 4, art: { kind: "celebrate", stars: 3 }, alt: "Pip cheering under three stars.",
      text: "Adding is putting together and counting. You did it!", check: null }
  ]
};

const wrap = (el: JSX.Element) => renderToStaticMarkup(<div className="wrap"><main>{el}</main></div>);

export const SCREENS: Record<string, string> = {
  lessons: wrap(<Lessons learner={learner} cur={cur} onBack={noop} onPractice={noop} initial={library} />),
  lessonPlayerPlot: wrap(<LessonPlayer learner={learner} lessonId="les-g6-nscoord" onExit={noop} onPractice={noop} initial={lesson} />),
  lessonPlayerMc: wrap(<LessonPlayer learner={learner} lessonId="les-k-add10" onExit={noop} onPractice={noop} initial={mcLesson} />)
};
