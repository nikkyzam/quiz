/* Unit tests — summative assessment across a whole curriculum unit (spec 7.2).

   A mastery check asks about one topic. A unit test asks about everything in
   a unit, which is a different instrument: it is the thing that catches the
   child who can do each week's topic in isolation the week it is taught, and
   cannot tell afterwards which method the question in front of them wants.
   That gap is invisible to per-topic checks by construction, because each one
   tells the learner which topic they are in before asking anything.

   Two decisions carry the design.

   Coverage is guaranteed, not sampled. Drawing twelve questions at random
   from the pooled banks of a unit can miss an entire topic — more easily than
   it sounds, since banks differ in size, so the biggest topic crowds out the
   smallest. A test that silently skips a topic reports a unit as secure on
   evidence it never gathered. Questions are dealt one per topic in rotation
   instead, so every topic in the unit is represented and the counts differ by
   at most one.

   A unit needs at least two authored topics to be worth testing. With one, a
   "unit test" is a mastery check wearing a different name, and reporting it
   as unit-level evidence would overstate what was measured. Units below the
   floor are refused by name rather than served in a degraded form. */

import { CURRICULUM } from "../../shared/curriculum.mjs";
import { QUESTIONS } from "../../shared/questions.mjs";

export const MIN_TOPICS = 2;
export const UNIT_TEST_SIZE = 12;

/* A unit test shorter than this is not a summative assessment, whatever it is
   called. Units that cannot fill a balanced paper this long are not offered. */
export const MIN_TEST_SIZE = 6;

/* How many questions this unit's test actually runs to.

   Equal numbers from every topic, capped by the smallest bank in the unit.
   The alternative — always ask twelve and let the rotation run the small
   banks dry — quietly weights the score by how many questions each topic
   happens to have. In this curriculum that is a real effect: Counting &
   Cardinality has eight questions for counting and five for counting back,
   so a twelve-question paper is 7 to 5, and a child's unit percentage
   depends more on counting than on counting back for no reason connected to
   either skill. Ten questions, five and five, measures what it claims to.

   Rounded down to a whole number per topic so the paper is exactly balanced
   rather than nearly balanced. */
export function plannedSize(unit) {
  const n = unit.topics.length;
  if (!n) return 0;
  const smallestBank = Math.min(...unit.topics.map(t => QUESTIONS[t.id].length));
  const perTopic = Math.min(Math.floor(UNIT_TEST_SIZE / n), smallestBank);
  return perTopic * n;
}

/* Units in the curriculum have a name and a track but no id, so the key is
   derived from grade and name. It is stable as long as the name is, which is
   the same assumption the standards mapping already makes; if units gain real
   ids later this is the one place that changes. */
export const unitKey = (grade, name) =>
  `${grade}:${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/* Every unit, with the subset of its topics that actually has questions. */
export function allUnits() {
  const out = [];
  for (const [grade, gradeEntry] of Object.entries(CURRICULUM)) {
    for (const unit of gradeEntry.units || []) {
      const authored = (unit.topics || []).filter(t => Array.isArray(QUESTIONS[t.id]) && QUESTIONS[t.id].length);
      const entry = {
        key: unitKey(grade, unit.name),
        grade,
        name: unit.name,
        track: unit.track === "adv" ? "adv" : "core",
        topics: authored.map(t => ({ id: t.id, name: t.name })),
        topicCount: (unit.topics || []).length,
        authoredCount: authored.length
      };
      entry.size = authored.length >= MIN_TOPICS ? plannedSize(entry) : 0;
      entry.testable = authored.length >= MIN_TOPICS && entry.size >= MIN_TEST_SIZE;
      out.push(entry);
    }
  }
  return out;
}

/* Units a learner on this track may sit a test for. A core learner is not
   offered advanced units, matching how the curriculum itself is filtered. */
export function testableUnits(track = "core") {
  return allUnits().filter(u => u.testable && (track === "adv" || u.track === "core"));
}

export const findUnit = key => allUnits().find(u => u.key === key) || null;

/* Deal `size` questions across the unit's topics, one topic at a time in
   rotation, so coverage is a property of the draw rather than a hope about
   it. Returns [{ topicId, idx }].

   Within a topic the order is shuffled, so two learners sitting the same unit
   test do not get the same paper; across topics the rotation is fixed, which
   is what makes the coverage guarantee hold. */
export function drawQuestions(unit, size = plannedSize(unit), rand = Math.random) {
  const pools = unit.topics.map(t => {
    const idxs = QUESTIONS[t.id].map((_, i) => i);
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    return { topicId: t.id, idxs };
  });

  const picked = [];
  let exhausted = false;
  while (picked.length < size && !exhausted) {
    exhausted = true;
    for (const pool of pools) {
      if (picked.length >= size) break;
      const idx = pool.idxs.pop();
      if (idx === undefined) continue;
      picked.push({ topicId: pool.topicId, idx });
      exhausted = false;
    }
  }
  return picked;
}

/* Per-topic breakdown of a finished test, so the result names which part of
   the unit is weak rather than only whether the whole was passed. A unit test
   that returns one percentage tells a parent their child failed; this tells
   them what to do about it. */
export function breakdown(results, unit) {
  const byTopic = new Map();
  for (const r of results) {
    const entry = byTopic.get(r.topicId) || { asked: 0, correct: 0 };
    entry.asked++;
    if (r.correct) entry.correct++;
    byTopic.set(r.topicId, entry);
  }
  return unit.topics
    .filter(t => byTopic.has(t.id))
    .map(t => {
      const e = byTopic.get(t.id);
      const pct = Math.round((e.correct / e.asked) * 100);
      return {
        topicId: t.id,
        name: t.name,
        asked: e.asked,
        correct: e.correct,
        pct,
        level: pct >= 80 ? "secure" : pct >= 50 ? "developing" : "needs work"
      };
    })
    .sort((a, b) => a.pct - b.pct);
}
