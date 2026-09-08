/* Content approval workflow (spec 8.5, 3.5.5).

   Content is versioned already — it lives in the repository, so every change
   has an author, a diff and a history. What was missing is the other half of a
   workflow: a record that a human looked at a specific version and signed it
   off, and a way for a reviewer to see what a child would see.

   The design decision that matters is what an approval is attached to. An
   approval recorded against a topic id alone survives every later edit, so a
   bank approved in March still reads as approved after a rewrite in June that
   nobody checked — which is worse than no approval at all, because it looks
   like assurance. Here an approval is bound to a hash of the exact content,
   and the moment that content changes the approval stops applying and the
   topic goes back to needing review. */

import { createHash, randomUUID } from "node:crypto";
import { db, now } from "./db.js";

/* Hash the question bank exactly as authored, including answers and
   explanations, because a change to an explanation is a change a reviewer
   should see again. Field order is normalised so that reformatting the source
   without changing meaning does not invalidate a sign-off. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map(k => `${k}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function contentHash(bank) {
  /* Canonicalised all the way down, not just at the top level. Sorting only
     the outer keys and then JSON.stringify-ing the values left nested objects
     — fig, figA, plot — sensitive to the order their keys were written in, so
     reformatting a figure with no change of meaning revoked the approval on
     that whole topic and sent a reviewer back to re-read content nobody had
     touched. */
  const canonical = (bank || []).map(q => stable(q));
  return createHash("sha256").update(canonical.join("\n")).digest("hex").slice(0, 32);
}

export function record({ topicId, hash, status, reviewerId, notes }) {
  if (!["approved", "changes_requested"].includes(status))
    return { ok: false, error: "status must be approved or changes_requested" };
  const id = randomUUID();
  db.prepare(`INSERT INTO content_reviews (id, topic_id, content_hash, status, reviewer_id, notes, at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, topicId, hash, status, reviewerId, notes || null, now());
  return { ok: true, id };
}

/* The standing state of a topic against the content it holds RIGHT NOW.

   Three outcomes, and the third is the one this exists for: approved,
   never reviewed, or approved-but-since-edited. That last case is invisible
   to any scheme that records approvals against an id. */
export function statusFor(topicId, bank) {
  const hash = contentHash(bank);
  const latest = db.prepare(`SELECT * FROM content_reviews WHERE topic_id=? ORDER BY at DESC, rowid DESC LIMIT 1`)
    .get(topicId);
  if (!latest) return { topicId, hash, state: "unreviewed", reviewedHash: null, at: null };

  if (latest.content_hash !== hash)
    return {
      topicId, hash, state: "stale",
      reviewedHash: latest.content_hash, reviewedStatus: latest.status, at: latest.at,
      message: "This content has changed since it was last reviewed and needs looking at again."
    };
  return {
    topicId, hash,
    state: latest.status === "approved" ? "approved" : "changes_requested",
    reviewedHash: latest.content_hash, at: latest.at, notes: latest.notes
  };
}

export const historyFor = topicId =>
  db.prepare(`SELECT topic_id, content_hash, status, reviewer_id, notes, at
              FROM content_reviews WHERE topic_id=? ORDER BY at DESC, rowid DESC LIMIT 50`).all(topicId);
