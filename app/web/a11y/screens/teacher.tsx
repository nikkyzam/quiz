/* Teacher and admin consoles rendered in their loaded state for the axe audit.
   Effects do not run here, so each screen is seeded through `initial`. */
import { renderToStaticMarkup } from "react-dom/server";
import { Teacher, type Curriculum } from "../../src/screens/Teacher";
import { Admin } from "../../src/screens/Admin";

const noop = () => {};
const user = { id: "u-teacher", email: "ms.okafor@example.org", name: "Ms Okafor" };
const admin = { id: "u-admin", email: "ops@example.org", name: "Dana Ops" };

const cur = {
  curriculum: {
    "6": { label: "Grade 6", beast: "vex", units: [
      { name: "The Number System", track: "core", topics: [{ id: "g6-nscoord", name: "Coordinate Plane" }, { id: "g6-ratios", name: "Ratios and Rates" }] },
      { name: "Number Theory", track: "adv", topics: [{ id: "g6-crt", name: "Chinese Remainder Theorem" }] }
    ]}
  },
  tiers: [
    { id: "practice", name: "Practice", blurb: "Learn the idea and get it solid." },
    { id: "challenge", name: "Challenge", blurb: "Multi-step problems." },
    { id: "boss", name: "Boss", blurb: "Work backwards." }
  ],
  counts: { "g6-nscoord": { practice: 40, challenge: 22, boss: 16 }, "g6-ratios": { practice: 30, challenge: 18, boss: 12 }, "g6-crt": { practice: 20, challenge: 10, boss: 8 } },
  thresholds: { "g6-nscoord": 90, "g6-ratios": 90, "g6-crt": 80 },
  mastery: { core: 90, adv: 80 }
} as Curriculum;

const classes = [
  { id: "c1", name: "6B Maths", joinCode: "K7Q2ZP", members: 3 },
  { id: "c2", name: "Enrichment club", joinCode: "M4X9AB", members: 1 }
];

const roster = [
  { id: "r1", name: "Ava Brown", externalId: "1001", guardianEmail: "ava.parent@example.org", claimCode: null, claimed: true, learnerName: "Ava" },
  { id: "r2", name: "Ben Carter", externalId: "1002", guardianEmail: null, claimCode: "7F3A9C2D", claimed: false, learnerName: null },
  { id: "r3", name: "Chloe Diaz", externalId: null, guardianEmail: "diaz.family@example.org", claimCode: "B81E4D0F", claimed: false, learnerName: null }
];

const progress = {
  class: { id: "c1", name: "6B Maths" },
  assignments: [
    { id: "a1", class_id: "c1", topic_id: "g6-nscoord", tier: "practice", due_at: "2026-09-12T23:59:00.000Z", group_id: null, created_at: "2026-09-01T09:00:00.000Z" },
    { id: "a2", class_id: "c1", topic_id: "g6-crt", tier: null, due_at: null, group_id: "g1", created_at: "2026-09-02T09:00:00.000Z" }
  ],
  learners: [
    { learnerId: "l1", name: "Ava", topicsMastered: 4, assignments: [
      { assignmentId: "a1", topicId: "g6-nscoord", groupId: null, bestPct: 95, mastered: true, attempted: true },
      { assignmentId: "a2", topicId: "g6-crt", groupId: "g1", bestPct: 60, mastered: false, attempted: true }
    ] },
    { learnerId: "l2", name: "Josiah", topicsMastered: 1, assignments: [
      { assignmentId: "a1", topicId: "g6-nscoord", groupId: null, bestPct: 0, mastered: false, attempted: false }
    ] },
    { learnerId: "l3", name: "Maya", topicsMastered: 2, assignments: [
      { assignmentId: "a1", topicId: "g6-nscoord", groupId: null, bestPct: 80, mastered: false, attempted: true }
    ] }
  ],
  heatmap: [
    { topicId: "g6-nscoord", groupId: null, assigned: 3, attempted: 2, averagePct: 58, mastered: 1 },
    { topicId: "g6-crt", groupId: "g1", assigned: 1, attempted: 1, averagePct: 60, mastered: 0 }
  ]
};

const overview = {
  users: 128, byRole: [{ role: "parent", c: 110 }, { role: "teacher", c: 16 }, { role: "admin", c: 2 }],
  learners: 214, classes: 19, runs: 8420, activeLearnersLast7Days: 97,
  attainment: { "0-49": 310, "50-69": 640, "70-89": 1210, "90-100": 1980 },
  hardestTopics: [
    { topicId: "g6-crt", name: "Chinese Remainder Theorem", attempts: 42, averagePct: 51 },
    { topicId: "g6-ratios", name: "Ratios and Rates", attempts: 180, averagePct: 63 }
  ]
};

export const SCREENS: Record<string, string> = {
  teacherClasses: renderToStaticMarkup(
    <div className="wrap"><main><Teacher user={user} cur={cur} onBack={noop} initial={{ classes }} /></main></div>),
  teacherRoster: renderToStaticMarkup(
    <div className="wrap"><main>
      <Teacher user={user} cur={cur} onBack={noop} initial={{ classes, selected: "c1", tab: "roster", roster, progress }} />
    </main></div>),
  adminOverview: renderToStaticMarkup(
    <div className="wrap"><main><Admin user={admin} onBack={noop} initial={{ overview }} /></main></div>)
};
