/* Authoring tool screens in their loaded state (spec 8.1, 8.5, 3.5.5). */
import { renderToStaticMarkup } from "react-dom/server";
import { Authoring, type AuthoringData, type Draft, type Meta } from "../../src/screens/Authoring";

const noop = () => {};
const user = { id: "u1", email: "teacher@example.org", name: "Ms Okafor" };

const meta: Meta = {
  kinds: ["question", "puzzle", "lesson"],
  sections: { N: "Number", F: "Fractions", G: "Geometry & Measure", R: "Ratios & Rates", B: "Points & Quadrants", L: "Algebra" },
  artKinds: ["baskets", "fingers", "rods", "array", "pizza"],
  types: ["in", "mc", "multi", "order", "pair", "plot"],
  topics: [
    { id: "g6-percent", name: "Percents", grade: "Grade 6", unit: "Ratios & Rates" },
    { id: "g6-nscoord", name: "Coordinate Plane", grade: "Grade 6", unit: "The Number System" },
    { id: "g3-frac", name: "Fractions", grade: "Grade 3", unit: "Fractions" }
  ]
};

const drafts: Draft[] = [
  { id: "d1a2b3c4-0000-4000-8000-000000000001", kind: "question", topicId: "g6-percent", status: "submitted", version: 3,
    reviewNote: null, reviewedBy: null, createdAt: "2026-08-30T09:12:00Z", updatedAt: "2026-09-02T14:05:00Z",
    body: { sec: "R", type: "mc", q: "Which is the same as 40%?", lvl: 1, mono: true, opts: ["0.4", "4.0", "0.04", "40.0"], a: 0,
            hint: "Percent means per hundred.", expl: "40% = 40/100 = 0.4." } },
  { id: "d1a2b3c4-0000-4000-8000-000000000002", kind: "question", topicId: "g6-percent", status: "changes_requested", version: 2,
    reviewNote: "Add a hint that does not give the answer away.", reviewedBy: "admin-1", createdAt: "2026-08-28T10:00:00Z", updatedAt: "2026-09-01T08:40:00Z",
    body: { sec: "R", type: "order", q: "Put these in order from smallest to largest.", lvl: 2, items: ["25%", "0.4", "1/2", "70%"], ansOrder: ["25%", "0.4", "1/2", "70%"],
            hint: "Turn them all into decimals.", expl: "25% = 0.25, 1/2 = 0.5, 70% = 0.7, so the order is 25%, 0.4, 1/2, 70%." } },
  { id: "d1a2b3c4-0000-4000-8000-000000000003", kind: "question", topicId: "g6-nscoord", status: "approved", version: 4,
    reviewNote: "Clear and correct.", reviewedBy: "admin-1", createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-27T16:30:00Z",
    body: { sec: "B", type: "pair", q: "Start at (2, 3). Move 3 units left and 1 unit down. Where do you land?", lvl: 1, ansP: [-1, 2],
            hint: "Left changes x, down changes y.", expl: "2 - 3 = -1 and 3 - 1 = 2, so you land at (-1, 2)." } },
  { id: "d1a2b3c4-0000-4000-8000-000000000004", kind: "question", topicId: null, status: "draft", version: 1,
    reviewNote: null, reviewedBy: null, createdAt: "2026-09-03T07:00:00Z", updatedAt: "2026-09-03T07:00:00Z",
    body: { sec: "N", type: "in", q: "What is 25% of 80?", lvl: 1, ans: 20, hint: "", expl: "" } }
];

const editing: Draft = {
  id: "d1a2b3c4-0000-4000-8000-000000000005", kind: "question", topicId: "g6-percent", status: "draft", version: 2,
  reviewNote: null, reviewedBy: null, createdAt: "2026-09-02T11:00:00Z", updatedAt: "2026-09-03T08:15:00Z",
  body: { sec: "R", type: "multi", q: "Which of these equal one half?", lvl: 2, mono: true,
          opts: ["50%", "0.5", "2/5", "0.05"], aMulti: [0, 1], hint: "", expl: "Which of these equal one half?" }
};

const base: AuthoringData = { role: "admin", meta, drafts };

export const SCREENS: Record<string, string> = {
  authoringDrafts: renderToStaticMarkup(
    <div className="wrap"><main><Authoring user={user} onBack={noop} initial={{ ...base, tab: "drafts", allAuthors: true }} /></main></div>),
  authoringEditor: renderToStaticMarkup(
    <div className="wrap"><main><Authoring user={user} onBack={noop} initial={{
      ...base, tab: "editor", draft: editing,
      lint: { errors: ["draft: explanation merely repeats the question"], warnings: ["draft: the correct option is much longer than the others"] },
      preview: { question: { id: "draft", sec: "R", secName: "Ratios & Rates", type: "multi", q: editing.body.q, opts: editing.body.opts, mono: true, hint: null },
                 hints: ["Read the question again and name what you are being asked to find.", "Work out what you know first, then take it one step at a time."] },
      exportText: JSON.stringify({ kind: "question", topicId: "g6-percent", status: "draft", version: 2, body: editing.body }, null, 2)
    }} /></main></div>),
  authoringReview: renderToStaticMarkup(
    <div className="wrap"><main><Authoring user={user} onBack={noop} initial={{
      ...base, tab: "editor", draft: drafts[0], lint: { errors: [], warnings: [] },
      preview: { question: { id: "draft", sec: "R", secName: "Ratios & Rates", type: "mc", q: drafts[0].body.q, opts: drafts[0].body.opts, mono: true, hint: "Percent means per hundred." },
                 hints: ["Percent means per hundred.", "Work out what you know first, then take it one step at a time.", "40% = 40/100 = 0.4."] },
      previewFb: { correct: false, correctAnswer: "0.4", explanation: "40% = 40/100 = 0.4." }
    }} /></main></div>),
  authoringApprovals: renderToStaticMarkup(
    <div className="wrap"><main><Authoring user={user} onBack={noop} initial={{
      ...base, tab: "approvals",
      approvals: { ok: false, problems: 2, units: [
        { id: "bank:g6-percent", kind: "bank", hash: "3f9a1c2b7d8e4f60", items: 24, state: "approved", version: 3, approvedBy: "R. Chen", role: "educator", at: "2026-08-15T12:00:00Z", educator: true },
        { id: "bank:g6-nscoord", kind: "bank", hash: "a1b2c3d4e5f60718", items: 78, state: "changed", version: 2, approvedBy: "R. Chen", role: "editor", at: "2026-07-30T12:00:00Z", educator: false },
        { id: "puzzles", kind: "puzzles", hash: "0918273645abcdef", items: 12, state: "approved", version: 1, approvedBy: "M. Adeyemi", role: "author", at: "2026-08-01T09:00:00Z", educator: false },
        { id: "lesson:k-count-5", kind: "lesson", hash: "fedcba9876543210", items: 5, state: "unapproved", version: 0, approvedBy: null, role: null, at: null, educator: false }
      ] }
    }} /></main></div>),
  authoringAssets: renderToStaticMarkup(
    <div className="wrap"><main><Authoring user={user} onBack={noop} initial={{
      ...base, tab: "assets",
      assets: { licences: { "CC0-1.0": { name: "Creative Commons Zero 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/", commercial: true, attribution: false },
                            "proprietary": { name: "All rights reserved (owner licence required)", url: null, commercial: false, attribution: true } },
                assets: [
                  { id: "beast-pip", kind: "character", name: "Pip", tags: ["monster", "kindergarten", "warm"], licence: "CC0-1.0", author: "BeastForge", origin: "app/web/src/beasts.tsx", format: "svg-code" },
                  { id: "scene-pizza", kind: "scene", name: "Pizza cut into equal slices", tags: ["fractions", "grade-3"], licence: "CC0-1.0", author: "BeastForge", origin: "app/web/src/components/LessonArt.tsx", format: "svg-code", artKind: "pizza" },
                  { id: "photo-bridge", kind: "figure", name: "Suspension bridge photo", tags: ["geometry", "grade-8"], licence: "proprietary", author: "Stock Co", origin: "content/assets/bridge.jpg", format: "jpg" }
                ] }
    }} /></main></div>),
  authoringForbidden: renderToStaticMarkup(
    <div className="wrap"><main><Authoring user={user} onBack={noop} initial={{ role: "parent", forbidden: true, meta, drafts: [], tab: "drafts" }} /></main></div>)
};
