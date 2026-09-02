/* GraphQL read API (spec 9.2).

   A typed, queryable view of the same data the REST API serves, with the
   same ownership rules: a query only ever sees the caller's own learners.
   Read-only by design — writes go through REST where the grading and
   auditing live. */

import { buildSchema, graphql } from "graphql";
import { db } from "./db.js";
import { CURRICULUM } from "../../shared/curriculum.mjs";
import { QUESTIONS } from "../../shared/questions.mjs";
import { describe, trackOf } from "./helpers.js";
import { thresholdFor, masteryState } from "./policy.js";
import * as rewards from "./rewards.js";
import { standardsFor } from "../../shared/standards.mjs";

export const schema = buildSchema(`
  type Query {
    me: User
    learners: [Learner!]!
    learner(id: ID!): Learner
    grades: [Grade!]!
    topic(id: ID!): Topic
  }
  type User { id: ID!, email: String!, name: String!, role: String! }
  type Learner {
    id: ID!, name: String!, beast: String!, track: String!
    progress: [Progress!]!
    recentRuns(limit: Int = 10): [Run!]!
    rewards: Rewards!
    mastery: [Mastery!]!
  }
  type Progress { topicId: ID!, topic: Topic!, tier: String!, bestPct: Int!, runs: Int!, lastAt: String! }
  type Run { topicId: ID!, tier: String!, score: Int!, total: Int!, pct: Int!, seconds: Int!, finishedAt: String! }
  type Rewards { points: Int!, level: Int!, badges: [Badge!]!, streak: Int! }
  type Badge { code: ID!, name: String!, hint: String!, category: String, at: String! }
  type Mastery { topicId: ID!, topic: Topic!, state: String!, threshold: Int!, bestPct: Int! }
  type Grade { key: ID!, label: String!, units: [Unit!]! }
  type Unit { name: String!, track: String!, topics: [Topic!]! }
  type Topic { id: ID!, name: String!, grade: String, unit: String, track: String, questions: Int!, standards: Standards }
  type Standards { framework: String!, codes: [String!]!, strand: String }
`);

const topicOf = id => {
  const d = describe(id);
  const st = standardsFor(id);
  return { id, name: d.name, grade: d.grade || null, unit: d.unit || null, track: trackOf(id),
           questions: (QUESTIONS[id] || []).length,
           standards: st ? { framework: st.framework, codes: st.codes, strand: st.strand?.code || null } : null };
};

const learnerOf = (row) => ({
  id: row.id, name: row.name, beast: row.beast, track: row.track,
  progress: () => db.prepare("SELECT * FROM progress WHERE learner_id=?").all(row.id).map(p => ({
    topicId: p.topic_id, topic: topicOf(p.topic_id), tier: p.tier, bestPct: p.best_pct, runs: p.runs, lastAt: p.last_at })),
  recentRuns: ({ limit }) => db.prepare("SELECT * FROM runs WHERE learner_id=? ORDER BY finished_at DESC LIMIT ?").all(row.id, Math.min(100, Math.max(1, limit || 10)))
    .map(r => ({ topicId: r.topic_id, tier: r.tier, score: r.score, total: r.total, pct: r.pct, seconds: r.seconds, finishedAt: r.finished_at })),
  rewards: () => { const t = rewards.totals(row.id); return { points: t.points, level: t.level, badges: t.badges, streak: rewards.streak(row.id) }; },
  mastery: () => db.prepare("SELECT topic_id, MAX(best_pct) b FROM progress WHERE learner_id=? GROUP BY topic_id").all(row.id)
    .map(r => ({ topicId: r.topic_id, topic: topicOf(r.topic_id), ...masteryState(row.id, r.topic_id, r.b) }))
});

export function rootFor(user) {
  const mine = () => user ? db.prepare("SELECT id, name, beast, track FROM learners WHERE user_id=? ORDER BY created_at").all(user.id) : [];
  return {
    me: () => user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null,
    learners: () => mine().map(learnerOf),
    learner: ({ id }) => { const row = mine().find(l => l.id === id); return row ? learnerOf(row) : null; },
    grades: () => Object.entries(CURRICULUM).map(([key, g]) => ({ key, label: g.label,
      units: g.units.map(u => ({ name: u.name, track: u.track, topics: u.topics.map(t => topicOf(t.id)) })) })),
    topic: ({ id }) => describe(id).grade ? topicOf(id) : null
  };
}

export async function execute({ query, variables, user }) {
  if (typeof query !== "string" || query.length > 10_000) return { errors: [{ message: "bad_query" }] };
  return graphql({ schema, source: query, rootValue: rootFor(user), variableValues: variables || {} });
}
