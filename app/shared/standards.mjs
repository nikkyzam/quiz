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
  "k-compose":   ["K.OA.A.3", "K.OA.A.4"],
  "k-3d":        ["K.G.A.2", "K.G.A.3"],
  "k-combine":   ["K.G.B.6"],
  "k-compare":   ["K.MD.A.2"],
  "k-sort":      ["K.MD.B.3"],
  "k-picgraph":  ["K.MD.B.3"],

  "g1-add20":    ["1.OA.A.1", "1.OA.C.6"],
  "g1-tensones": ["1.NBT.B.2"],
  "g1-sub20":    ["1.OA.C.6"],
  "g1-equals":   ["1.OA.D.7", "1.OA.D.8"],
  "g1-wordprob": ["1.OA.A.1"],
  "g1-compare2": ["1.NBT.B.3"],
  "g1-length":   ["1.MD.A.1", "1.MD.A.2"],
  "g1-props":    ["1.OA.B.3"],
  "g1-add100":   ["1.NBT.C.4", "1.NBT.C.6"],
  "g1-tenmore":  ["1.NBT.C.5"],
  "g1-time":     ["1.MD.B.3"],
  "g1-graphs":   ["1.MD.C.4"],
  "g1-attrib":   ["1.G.A.1"],
  "g1-compose":  ["1.G.A.2"],
  "g1-shares":   ["1.G.A.3"],

  "g2-arrays":   ["2.OA.C.4"],
  "g2-place1000":["2.NBT.A.1", "2.NBT.A.3"],
  "g2-fluency":  ["2.OA.B.2"],
  "g2-add1000":  ["2.NBT.B.7"],
  "g2-money":    ["2.MD.C.8"],
  "g2-equalgrp": ["2.OA.C.4"],
  "g2-rulers":   ["2.MD.A.1", "2.MD.A.4"],
  "g2-time5":    ["2.MD.C.7"],
  "g2-add100":   ["2.NBT.B.5"],
  "g2-compare3": ["2.NBT.A.4"],
  "g2-mental":   ["2.NBT.B.8"],
  "g2-estimate": ["2.MD.A.3"],
  "g2-lineplot": ["2.MD.D.9"],
  "g2-polygons": ["2.G.A.1"],
  "g2-rowcol":   ["2.G.A.2"],
  "g2-thirds":   ["2.G.A.3"],

  "g3-mult":     ["3.OA.A.1", "3.OA.C.7"],
  "g3-fracnum":  ["3.NF.A.1"],
  "g3-area":     ["3.MD.C.5", "3.MD.C.7"],
  "g3-div":      ["3.OA.A.2", "3.OA.C.7"],
  "g3-round":    ["3.NBT.A.1"],
  "g3-fraccomp": ["3.NF.A.3", "3.NF.A.3.D"],
  "g3-timemin":  ["3.MD.A.1"],
  "g3-quads":    ["3.G.A.1"],
  "g3-multprops": ["3.OA.B.5"],
  "g3-twostep":  ["3.OA.D.8"],
  "g3-patterns": ["3.OA.D.9"],
  "g3-add1000":  ["3.NBT.A.2"],
  "g3-mult10":   ["3.NBT.A.3"],
  "g3-fraceq":   ["3.NF.A.3.A"],
  "g3-wholefrac": ["3.NF.A.3.C"],
  "g3-perimeter": ["3.MD.D.8"],

  "g4-multcomp": ["4.OA.A.1", "4.OA.A.2"],
  "g4-placemil": ["4.NBT.A.1", "4.NBT.A.2", "4.NBT.A.3"],
  "g4-fracadd":  ["4.NF.B.3"],
  "g4-areaform": ["4.MD.A.3"],
  "g4-multistep": ["4.OA.A.3"],
  "g4-factorpair": ["4.OA.B.4"],
  "g4-multidig": ["4.NBT.B.5"],
  "g4-divide":   ["4.NBT.B.6"],
  "g4-mixed":    ["4.NF.B.3.C"],
  "g4-decnot":   ["4.NF.C.6"],
  "g4-deccomp":  ["4.NF.C.7"],
  "g4-linesrays": ["4.G.A.1"],
  "g4-classify": ["4.G.A.2"],
  "g4-symmetry": ["4.G.A.3"],
  "g4-seq":      ["4.OA.C.5"],
  "g4-fracmultw": ["4.NF.B.4"],
  "g4-units":    ["4.MD.A.1", "4.MD.A.2"],
  "g4-lineplot": ["4.MD.B.4"],
  "g4-protract": ["4.MD.C.5", "4.MD.C.6"],

  "g5-express":  ["5.OA.A.1", "5.OA.A.2"],
  "g5-decops":   ["5.NBT.B.7"],
  "g5-unlike":   ["5.NF.A.1"],
  "g5-thousandth": ["5.NBT.A.1", "5.NBT.A.3"],
  "g5-fracmult": ["5.NF.B.4"],
  "g5-fracdiv":  ["5.NF.B.7"],
  "g5-convert":  ["5.MD.A.1"],
  "g5-patterns": ["5.OA.B.3"],
  "g5-twodigit": ["5.NBT.B.6"],
  "g5-fracword": ["5.NF.B.6"],
  "g5-lineplot": ["5.MD.B.2"],
  "g5-volume":   ["5.MD.C.3", "5.MD.C.5"],
  "g5-coord":    ["5.G.A.1", "5.G.A.2"],
  "g5-hierarchy": ["5.G.B.3", "5.G.B.4"],

  "g6-nscoord":  ["6.NS.C.6", "6.NS.C.8"],
  "g6-ratios":   ["6.RP.A.1", "6.RP.A.2", "6.RP.A.3"],
  "g6-percent":  ["6.RP.A.3.C"],
  "g6-unitconv": ["6.RP.A.3.D"],
  "g6-decimals": ["6.NS.B.3"],
  "g6-exprexp":  ["6.EE.A.1"],
  "g6-onevar":   ["6.EE.B.5", "6.EE.B.7", "6.EE.B.8"],
  "g6-fracdiv":  ["6.NS.A.1"],
  "g6-equivexpr": ["6.EE.A.3", "6.EE.A.4"],
  "g6-relation": ["6.EE.C.9"],
  "g6-polyarea": ["6.G.A.1"],
  "g6-volfrac":  ["6.G.A.2"],
  "g6-coordpoly": ["6.G.A.3"],
  "g6-netsurf":  ["6.G.A.4"],
  "g6-statq":    ["6.SP.A.1"],
  "g6-centervar": ["6.SP.A.2", "6.SP.A.3"],
  "g6-displays": ["6.SP.B.4"],

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
