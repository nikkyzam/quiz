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
  "g1-sub20":    ["1.OA.C.6"],
  "g1-equals":   ["1.OA.D.7", "1.OA.D.8"],
  "g1-wordprob": ["1.OA.A.1"],
  "g1-compare2": ["1.NBT.B.3"],
  "g1-length":   ["1.MD.A.1", "1.MD.A.2"],

  "g2-arrays":   ["2.OA.C.4"],
  "g2-place1000":["2.NBT.A.1", "2.NBT.A.3"],
  "g2-fluency":  ["2.OA.B.2"],
  "g2-add1000":  ["2.NBT.B.7"],
  "g2-money":    ["2.MD.C.8"],
  "g2-equalgrp": ["2.OA.C.4"],
  "g2-rulers":   ["2.MD.A.1", "2.MD.A.4"],
  "g2-time5":    ["2.MD.C.7"],

  "g3-mult":     ["3.OA.A.1", "3.OA.C.7"],
  "g3-fracnum":  ["3.NF.A.1"],
  "g3-area":     ["3.MD.C.5", "3.MD.C.7"],
  "g3-div":      ["3.OA.A.2", "3.OA.C.7"],
  "g3-round":    ["3.NBT.A.1"],
  "g3-fraccomp": ["3.NF.A.3", "3.NF.A.3.D"],
  "g3-timemin":  ["3.MD.A.1"],
  "g3-quads":    ["3.G.A.1"],

  "g4-multcomp": ["4.OA.A.1", "4.OA.A.2"],
  "g4-placemil": ["4.NBT.A.1", "4.NBT.A.2", "4.NBT.A.3"],
  "g4-fracadd":  ["4.NF.B.3"],
  "g4-areaform": ["4.MD.A.3"],

  "g5-express":  ["5.OA.A.1", "5.OA.A.2"],
  "g5-decops":   ["5.NBT.B.7"],
  "g5-unlike":   ["5.NF.A.1"],

  "g6-nscoord":  ["6.NS.C.6", "6.NS.C.8"],
  "g6-ratios":   ["6.RP.A.1", "6.RP.A.2", "6.RP.A.3"],
  "g6-percent":  ["6.RP.A.3.C"],
  "g6-unitconv": ["6.RP.A.3.D"],
  "g6-decimals": ["6.NS.B.3"],
  "g6-exprexp":  ["6.EE.A.1"],
  "g6-onevar":   ["6.EE.B.5", "6.EE.B.7", "6.EE.B.8"],

  "g7-unitfrac": ["7.RP.A.1"],
  "g7-propor":   ["7.RP.A.2"],
  "g7-ratops":   ["7.NS.A.1", "7.NS.A.2"],

  "g8-irrational":["8.NS.A.1", "8.NS.A.2"],
  "g8-radicals": ["8.EE.A.1", "8.EE.A.2"],
  "g8-linear":   ["8.EE.C.7"]
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
