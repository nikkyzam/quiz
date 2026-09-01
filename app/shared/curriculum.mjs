/* ============================================================
   Curriculum map, K through 8.
   Each grade has units; each unit has topics. A topic is the unit
   of practice — it holds three tiers of questions (practice /
   challenge / boss). Topics with no authored questions yet are
   shown but marked, so the map never pretends to have content
   it doesn't have.
   ============================================================ */

const CURRICULUM = {
  K: { label:"Kindergarten", beast:"pip", units:[
    { name:"Counting", topics:[
      {id:"k-count20",   name:"Count to 20"},
      {id:"k-compare",   name:"More, Less, Equal"} ]},
    { name:"First Arithmetic", topics:[
      {id:"k-add10",     name:"Add Within 10"},
      {id:"k-sub10",     name:"Subtract Within 10"} ]},
    { name:"Shapes", topics:[
      {id:"k-shapes",    name:"Flat & Solid Shapes"} ]}
  ]},

  1: { label:"Grade 1", beast:"pip", units:[
    { name:"Adding & Subtracting", topics:[
      {id:"g1-add20",    name:"Add Within 20"},
      {id:"g1-sub20",    name:"Subtract Within 20"},
      {id:"g1-wordprob", name:"Word Problems"} ]},
    { name:"Place Value", topics:[
      {id:"g1-tens",     name:"Tens & Ones"},
      {id:"g1-to120",    name:"Numbers to 120"} ]},
    { name:"Measure & Shape", topics:[
      {id:"g1-length",   name:"Comparing Length"},
      {id:"g1-time",     name:"Telling Time"} ]}
  ]},

  2: { label:"Grade 2", beast:"pip", units:[
    { name:"Bigger Arithmetic", topics:[
      {id:"g2-add100",   name:"Add Within 100"},
      {id:"g2-sub100",   name:"Subtract Within 100"} ]},
    { name:"Place Value", topics:[
      {id:"g2-to1000",   name:"Hundreds, Tens & Ones"},
      {id:"g2-skip",     name:"Skip Counting"} ]},
    { name:"Groups & Money", topics:[
      {id:"g2-arrays",   name:"Arrays & Equal Groups"},
      {id:"g2-money",    name:"Money"} ]}
  ]},

  3: { label:"Grade 3", beast:"nim", units:[
    { name:"Multiplication", topics:[
      {id:"g3-mult",     name:"Multiplication Facts"},
      {id:"g3-div",      name:"Division"},
      {id:"g3-multprob", name:"Multiply & Divide Word Problems"} ]},
    { name:"Fractions Begin", topics:[
      {id:"g3-fracnum",  name:"Fractions as Numbers"},
      {id:"g3-fraceq",   name:"Equivalent Fractions"} ]},
    { name:"Measurement", topics:[
      {id:"g3-area",     name:"Area"},
      {id:"g3-perim",    name:"Perimeter"} ]}
  ]},

  4: { label:"Grade 4", beast:"nim", units:[
    { name:"Multi-Digit Arithmetic", topics:[
      {id:"g4-multidig", name:"Multi-Digit Multiplication"},
      {id:"g4-divrem",   name:"Division with Remainders"},
      {id:"g4-factors",  name:"Factors & Multiples"} ]},
    { name:"Fractions", topics:[
      {id:"g4-fraceq",   name:"Equivalence & Comparison"},
      {id:"g4-fracadd",  name:"Adding Fractions"} ]},
    { name:"Geometry", topics:[
      {id:"g4-angles",   name:"Angles"},
      {id:"g4-lines",    name:"Lines & Symmetry"} ]}
  ]},

  5: { label:"Grade 5", beast:"nim", units:[
    { name:"Decimals", topics:[
      {id:"g5-decplace", name:"Decimal Place Value"},
      {id:"g5-decops",   name:"Decimal Operations"} ]},
    { name:"Fractions", topics:[
      {id:"g5-fracmult", name:"Multiplying Fractions"},
      {id:"g5-fracdiv",  name:"Dividing Fractions"} ]},
    { name:"Measurement & Graphing", topics:[
      {id:"g5-volume",   name:"Volume"},
      {id:"g5-coordintro", name:"The Coordinate Plane"} ]}
  ]},

  6: { label:"Grade 6", beast:"vex", units:[
    { name:"The Number System", topics:[
      {id:"g6-nscoord",  name:"Coordinate Plane & Rational Numbers"},
      {id:"g6-fracdiv",  name:"Dividing Fractions"} ]},
    { name:"Ratios & Rates", topics:[
      {id:"g6-ratios",   name:"Ratios & Unit Rates"},
      {id:"g6-percent",  name:"Percents"} ]},
    { name:"Expressions & Equations", topics:[
      {id:"g6-express",  name:"Expressions"},
      {id:"g6-equations",name:"One-Step Equations"} ]},
    { name:"Statistics", topics:[
      {id:"g6-stats",    name:"Mean, Median & Spread"} ]}
  ]},

  7: { label:"Grade 7", beast:"vex", units:[
    { name:"Proportions", topics:[
      {id:"g7-propor",   name:"Proportional Relationships"},
      {id:"g7-scale",    name:"Scale & Similar Figures"} ]},
    { name:"Rational Numbers", topics:[
      {id:"g7-ratops",   name:"Operations with Rationals"},
      {id:"g7-negatives",name:"Negative Numbers in Context"} ]},
    { name:"Algebra & Geometry", topics:[
      {id:"g7-express",  name:"Expressions & Equations"},
      {id:"g7-circles",  name:"Circles"} ]},
    { name:"Probability", topics:[
      {id:"g7-prob",     name:"Chance & Probability"} ]}
  ]},

  8: { label:"Grade 8", beast:"vex", units:[
    { name:"Linear Algebra", topics:[
      {id:"g8-linear",   name:"Linear Equations"},
      {id:"g8-slope",    name:"Slope & Graphs"},
      {id:"g8-systems",  name:"Systems of Equations"} ]},
    { name:"Functions", topics:[
      {id:"g8-functions",name:"Introducing Functions"} ]},
    { name:"Geometry", topics:[
      {id:"g8-transform",name:"Transformations"},
      {id:"g8-pythag",   name:"The Pythagorean Theorem"} ]},
    { name:"Exponents", topics:[
      {id:"g8-exponents",name:"Exponents & Scientific Notation"} ]}
  ]}
};

const TIERS = [
  {id:"practice",  name:"Practice",  blurb:"Learn the idea and get it solid."},
  {id:"challenge", name:"Challenge", blurb:"Multi-step problems that stretch it."},
  {id:"boss",      name:"Boss",      blurb:"Work backwards. Think it through."}
];


export { CURRICULUM, TIERS };
