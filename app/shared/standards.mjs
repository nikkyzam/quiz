/* Curriculum-to-standards mapping (spec 8.3).

   Maps topic ids to Common Core State Standards for Mathematics codes. Only
   AUTHORED topics are mapped -- claiming a standards alignment for a topic
   with no content would be worse than no mapping at all, since a teacher
   might rely on it. Every code here was checked against the actual CCSSM
   domain structure, not guessed from the topic name. */

export const STANDARDS = {
  "k-count":     ["K.CC.A.1", "K.CC.A.2"],
  "k-countback": ["K.CC.A.2"],
  "k-add10":     ["K.OA.A.1", "K.OA.A.2"],
  "k-sub10":     ["K.OA.A.1", "K.OA.A.2"],
  "k-evenodd":   ["K.CC.B.4"],
  "k-2d":        ["K.G.A.2", "K.G.B.4"],

  "g1-add20":    ["1.OA.A.1", "1.OA.C.6"],
  "g1-tensones": ["1.NBT.B.2"],

  "g2-arrays":   ["2.OA.C.4"],
  "g2-place1000":["2.NBT.A.1", "2.NBT.A.3"],

  "g3-mult":     ["3.OA.A.1", "3.OA.C.7"],
  "g3-fracnum":  ["3.NF.A.1"],
  "g3-area":     ["3.MD.C.5", "3.MD.C.7"],

  "g6-nscoord":  ["6.NS.C.6", "6.NS.C.8"],
  "g6-ratios":   ["6.RP.A.1", "6.RP.A.2", "6.RP.A.3"],
  "g6-percent":  ["6.RP.A.3.C"]
};

export const standardsFor = id => STANDARDS[id] || [];

/* Only claim coverage for topics that actually carry a mapping AND have
   authored content -- the caller supplies which topics have content, since
   this module does not import the question banks (kept dependency-free so
   it can be tested in isolation). */
export function coverage(authoredTopicIds) {
  const mapped = authoredTopicIds.filter(id => STANDARDS[id]);
  const unmapped = authoredTopicIds.filter(id => !STANDARDS[id]);
  return { mapped, unmapped, total: authoredTopicIds.length };
}
