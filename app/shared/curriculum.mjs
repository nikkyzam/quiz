/* K-8 curriculum, transcribed from the BeastForge spec, Appendix A.
   Every unit carries a `track`: "core" (standards coverage) or "adv"
   (advanced / extended, for enrichment and competition readiness).
   Topic ids are stable — question banks join to them. */

const CURRICULUM = {
  K: { label: "Kindergarten", beast: "pip", units: [
    { name: "Counting & Cardinality", track: "core", topics: [
      { id: "k-count",      name: "Counting to 120" },
      { id: "k-countback",  name: "Counting Backward" },
      { id: "k-ordinal",    name: "Ordinal Numbers" } ]},
    { name: "Operations & Algebraic Thinking", track: "core", topics: [
      { id: "k-add10",      name: "Adding Within 10" },
      { id: "k-sub10",      name: "Subtracting Within 10" },
      { id: "k-compose",    name: "Composing & Decomposing Numbers" } ]},
    { name: "Geometry", track: "core", topics: [
      { id: "k-2d",         name: "Flat Shapes" },
      { id: "k-3d",         name: "Solid Shapes" },
      { id: "k-combine",    name: "Combining Shapes" } ]},
    { name: "Measurement & Data", track: "core", topics: [
      { id: "k-compare",    name: "Comparing Size & Weight" },
      { id: "k-sort",       name: "Sorting & Classifying" },
      { id: "k-picgraph",   name: "Picture Graphs" } ]},
    { name: "Patterns & Logic", track: "core", topics: [
      { id: "k-patterns",   name: "Repeating Patterns" },
      { id: "k-logic",      name: "Logic Puzzles" } ]},
    { name: "Number Theory", track: "adv", topics: [
      { id: "k-evenodd",    name: "Even & Odd" },
      { id: "k-skip",       name: "Skip Counting" },
      { id: "k-half",       name: "Halves" } ]},
    { name: "Spatial Reasoning", track: "adv", topics: [
      { id: "k-symmetry",   name: "Symmetry" },
      { id: "k-blocks",     name: "Building with Pattern Blocks" },
      { id: "k-turns",      name: "Turns & Flips" } ]},
    { name: "Combinatorics", track: "adv", topics: [
      { id: "k-combos",     name: "Counting Combinations" },
      { id: "k-trees",      name: "Picture Tree Diagrams" } ]},
    { name: "Strategy", track: "adv", topics: [
      { id: "k-games",      name: "Winning Moves" } ]}
  ]},

  1: { label: "Grade 1", beast: "pip", units: [
    { name: "Operations & Algebraic Thinking", track: "core", topics: [
      { id: "g1-add20",     name: "Adding Within 20" },
      { id: "g1-sub20",     name: "Subtracting Within 20" },
      { id: "g1-equals",    name: "The Equal Sign & Balance" },
      { id: "g1-wordprob",  name: "Word Problems with Unknowns" },
      { id: "g1-props",     name: "Commutative & Associative Properties" } ]},
    { name: "Number & Operations in Base Ten", track: "core", topics: [
      { id: "g1-tensones",  name: "Tens & Ones" },
      { id: "g1-compare2",  name: "Comparing Two-Digit Numbers" },
      { id: "g1-add100",    name: "Adding & Subtracting Within 100" },
      { id: "g1-tenmore",   name: "Ten More, Ten Less" } ]},
    { name: "Measurement & Data", track: "core", topics: [
      { id: "g1-length",    name: "Measuring Length" },
      { id: "g1-time",      name: "Telling Time" },
      { id: "g1-graphs",    name: "Bar & Picture Graphs" },
      { id: "g1-coins",     name: "Coins & Their Values" } ]},
    { name: "Geometry", track: "core", topics: [
      { id: "g1-attrib",    name: "Defining Attributes" },
      { id: "g1-compose",   name: "Composing Shapes" },
      { id: "g1-shares",    name: "Halves & Fourths" } ]},
    { name: "Number Theory", track: "adv", topics: [
      { id: "g1-evenodd",   name: "Odd & Even to 100" },
      { id: "g1-factors",   name: "First Factors" },
      { id: "g1-div25",     name: "Divisibility by 2 and 5" } ]},
    { name: "Patterns & Functions", track: "adv", topics: [
      { id: "g1-machines",  name: "Input/Output Machines" },
      { id: "g1-growing",   name: "Growing Patterns" } ]},
    { name: "Logic & Reasoning", track: "adv", topics: [
      { id: "g1-grid",      name: "Logic Grid Puzzles" },
      { id: "g1-deduce",    name: "Deductive Reasoning" },
      { id: "g1-twostep",   name: "Two-Step Problems" } ]},
    { name: "Combinatorics", track: "adv", topics: [
      { id: "g1-arrange",   name: "Arranging Objects" },
      { id: "g1-choose",    name: "Choosing Without Order" } ]}
  ]},

  2: { label: "Grade 2", beast: "pip", units: [
    { name: "Operations & Algebraic Thinking", track: "core", topics: [
      { id: "g2-fluency",   name: "Fluency Within 20" },
      { id: "g2-add100",    name: "Adding & Subtracting Within 100" },
      { id: "g2-equalgrp",  name: "Equal Groups" },
      { id: "g2-arrays",    name: "Arrays" } ]},
    { name: "Number & Operations in Base Ten", track: "core", topics: [
      { id: "g2-place1000", name: "Place Value to 1000" },
      { id: "g2-compare3",  name: "Comparing Three-Digit Numbers" },
      { id: "g2-add1000",   name: "Adding & Subtracting Within 1000" },
      { id: "g2-mental",    name: "Mental Math with 10 and 100" } ]},
    { name: "Measurement & Data", track: "core", topics: [
      { id: "g2-rulers",    name: "Measuring with Rulers" },
      { id: "g2-estimate",  name: "Estimating Length" },
      { id: "g2-time5",     name: "Time to Five Minutes" },
      { id: "g2-money",     name: "Money Problems" },
      { id: "g2-lineplot",  name: "Line Plots" } ]},
    { name: "Geometry", track: "core", topics: [
      { id: "g2-polygons",  name: "Drawing Shapes by Attribute" },
      { id: "g2-rowcol",    name: "Rows & Columns" },
      { id: "g2-thirds",    name: "Halves, Thirds & Fourths" } ]},
    { name: "Number Theory", track: "adv", topics: [
      { id: "g2-prime20",   name: "Prime & Composite to 20" },
      { id: "g2-divrules",  name: "Divisibility Rules" },
      { id: "g2-gcf",       name: "Greatest Common Factor" } ]},
    { name: "Multiplication & Division", track: "adv", topics: [
      { id: "g2-repeated",  name: "Multiplication as Repeated Addition" },
      { id: "g2-sharing",   name: "Division as Sharing" },
      { id: "g2-multprob",  name: "Multiplication Word Problems" } ]},
    { name: "Algebraic Thinking", track: "adv", topics: [
      { id: "g2-missing",   name: "Missing Numbers" },
      { id: "g2-symbols",   name: "Symbols for Unknowns" },
      { id: "g2-rule",      name: "What's My Rule?" } ]},
    { name: "Combinatorics", track: "adv", topics: [
      { id: "g2-trees",     name: "Tree Diagrams" },
      { id: "g2-perm4",     name: "Permutations of Four" },
      { id: "g2-permcomb",  name: "Order Matters, Or Not" } ]},
    { name: "Geometry Extended", track: "adv", topics: [
      { id: "g2-perimeter", name: "Perimeter" },
      { id: "g2-symmetry",  name: "Lines of Symmetry" },
      { id: "g2-tangram",   name: "Tangram Puzzles" } ]}
  ]},

  3: { label: "Grade 3", beast: "nim", units: [
    { name: "Operations & Algebraic Thinking", track: "core", topics: [
      { id: "g3-mult",      name: "Multiplication" },
      { id: "g3-div",       name: "Division" },
      { id: "g3-multprops", name: "Properties of Multiplication" },
      { id: "g3-twostep",   name: "Two-Step Word Problems" },
      { id: "g3-patterns",  name: "Arithmetic Patterns" } ]},
    { name: "Number & Operations in Base Ten", track: "core", topics: [
      { id: "g3-round",     name: "Rounding" },
      { id: "g3-add1000",   name: "Adding & Subtracting Within 1000" },
      { id: "g3-mult10",    name: "Multiplying by Multiples of Ten" } ]},
    { name: "Fractions", track: "core", topics: [
      { id: "g3-fracnum",   name: "Fractions as Numbers" },
      { id: "g3-fraccomp",  name: "Comparing Fractions" },
      { id: "g3-fraceq",    name: "Equivalent Fractions" },
      { id: "g3-wholefrac", name: "Whole Numbers as Fractions" } ]},
    { name: "Measurement & Data", track: "core", topics: [
      { id: "g3-timemin",   name: "Time to the Minute" },
      { id: "g3-volmass",   name: "Liquid Volume & Mass" },
      { id: "g3-scaled",    name: "Scaled Graphs" },
      { id: "g3-area",      name: "Area" },
      { id: "g3-perimeter", name: "Perimeter" } ]},
    { name: "Geometry", track: "core", topics: [
      { id: "g3-quads",     name: "Classifying Quadrilaterals" },
      { id: "g3-equalarea", name: "Equal Areas as Fractions" },
      { id: "g3-areaperim", name: "Area versus Perimeter" } ]},
    { name: "Number Theory", track: "adv", topics: [
      { id: "g3-primefact", name: "Prime Factorisation" },
      { id: "g3-divrules",  name: "Divisibility Rules 3, 4, 6, 9" },
      { id: "g3-lcm",       name: "Least Common Multiple" },
      { id: "g3-gcdlcm",    name: "GCD & LCM by Factorisation" } ]},
    { name: "Operations with Fractions", track: "adv", topics: [
      { id: "g3-fracadd",   name: "Adding Like Denominators" },
      { id: "g3-fracmultw", name: "Fraction Times a Whole Number" },
      { id: "g3-benchmark", name: "Comparing with Benchmarks" } ]},
    { name: "Algebraic Reasoning", track: "adv", topics: [
      { id: "g3-simpleeq",  name: "Simple Equations" },
      { id: "g3-varpat",    name: "Variables in Patterns" },
      { id: "g3-evaluate",  name: "Evaluating Expressions" } ]},
    { name: "Combinatorics", track: "adv", topics: [
      { id: "g3-syslist",   name: "Systematic Lists" },
      { id: "g3-multprin",  name: "The Multiplication Principle" } ]},
    { name: "Geometry Extended", track: "adv", topics: [
      { id: "g3-composite", name: "Composite Areas" },
      { id: "g3-volpack",   name: "Volume by Packing" },
      { id: "g3-angles",    name: "Right, Acute & Obtuse Angles" },
      { id: "g3-lines",     name: "Parallel & Perpendicular Lines" } ]}
  ]},

  4: { label: "Grade 4", beast: "nim", units: [
    { name: "Operations & Algebraic Thinking", track: "core", topics: [
      { id: "g4-multcomp",  name: "Multiplication as Comparison" },
      { id: "g4-multistep", name: "Multi-Step Word Problems" },
      { id: "g4-factorpair",name: "Factor Pairs, Prime & Composite" },
      { id: "g4-seq",       name: "Number & Shape Patterns" } ]},
    { name: "Number & Operations in Base Ten", track: "core", topics: [
      { id: "g4-placemil",  name: "Place Value to a Million" },
      { id: "g4-multidig",  name: "Multi-Digit Multiplication" },
      { id: "g4-divide",    name: "Division with Remainders" } ]},
    { name: "Fractions & Decimals", track: "core", topics: [
      { id: "g4-fracadd",   name: "Adding & Subtracting Fractions" },
      { id: "g4-mixed",     name: "Mixed Numbers" },
      { id: "g4-fracmultw", name: "Multiplying Fractions by Whole Numbers" },
      { id: "g4-decnot",    name: "Decimal Notation" },
      { id: "g4-deccomp",   name: "Comparing Decimals" } ]},
    { name: "Measurement & Data", track: "core", topics: [
      { id: "g4-units",     name: "Units of Measure" },
      { id: "g4-areaform",  name: "Area & Perimeter Formulas" },
      { id: "g4-lineplot",  name: "Line Plots with Fractions" },
      { id: "g4-protract",  name: "Measuring Angles" } ]},
    { name: "Geometry", track: "core", topics: [
      { id: "g4-linesrays", name: "Points, Lines, Rays & Angles" },
      { id: "g4-classify",  name: "Classifying Figures" },
      { id: "g4-symmetry",  name: "Lines of Symmetry" } ]},
    { name: "Number Theory", track: "adv", topics: [
      { id: "g4-primefact", name: "Prime Factorisation with Exponents" },
      { id: "g4-divrules",  name: "Divisibility Rules 2-11" },
      { id: "g4-clockmod",  name: "Clock Arithmetic" },
      { id: "g4-euclid",    name: "The Euclidean Algorithm" } ]},
    { name: "Pre-Algebra", track: "adv", topics: [
      { id: "g4-evalexpr",  name: "Expressions with Parentheses" },
      { id: "g4-liketerms", name: "Combining Like Terms" },
      { id: "g4-onestep",   name: "One-Step Equations" },
      { id: "g4-inequal",   name: "Simple Inequalities" },
      { id: "g4-writeeq",   name: "Writing Equations from Words" } ]},
    { name: "Combinatorics", track: "adv", topics: [
      { id: "g4-factorial", name: "Permutations & Factorials" },
      { id: "g4-combin",    name: "Combinations" },
      { id: "g4-paths",     name: "Counting Paths on a Grid" },
      { id: "g4-starsbars", name: "Sharing Out Objects" } ]},
    { name: "Geometry Extended", track: "adv", topics: [
      { id: "g4-tri-area",  name: "Area of Triangles" },
      { id: "g4-para-area", name: "Parallelograms & Trapezoids" },
      { id: "g4-circle",    name: "Circumference & Area of Circles" },
      { id: "g4-nets",      name: "Surface Area from Nets" },
      { id: "g4-volprism",  name: "Volume of Prisms" } ]},
    { name: "Probability", track: "adv", topics: [
      { id: "g4-exptheo",   name: "Experimental & Theoretical Probability" },
      { id: "g4-simple",    name: "Probability of Simple Events" },
      { id: "g4-compl",     name: "Complementary Events" } ]}
  ]},

  5: { label: "Grade 5", beast: "nim", units: [
    { name: "Operations & Algebraic Thinking", track: "core", topics: [
      { id: "g5-express",   name: "Numerical Expressions" },
      { id: "g5-patterns",  name: "Patterns & Ordered Pairs" } ]},
    { name: "Number & Operations in Base Ten", track: "core", topics: [
      { id: "g5-thousandth",name: "Place Value to Thousandths" },
      { id: "g5-decops",    name: "Decimal Operations" },
      { id: "g5-twodigit",  name: "Two-Digit Divisors" } ]},
    { name: "Fractions", track: "core", topics: [
      { id: "g5-unlike",    name: "Unlike Denominators" },
      { id: "g5-fracmult",  name: "Multiplying Fractions" },
      { id: "g5-fracdiv",   name: "Dividing with Unit Fractions" },
      { id: "g5-fracword",  name: "Fraction Word Problems" } ]},
    { name: "Measurement & Data", track: "core", topics: [
      { id: "g5-convert",   name: "Converting Units" },
      { id: "g5-lineplot",  name: "Line Plots with Fractions" },
      { id: "g5-volume",    name: "Volume" } ]},
    { name: "Geometry", track: "core", topics: [
      { id: "g5-coord",     name: "The Coordinate Plane" },
      { id: "g5-hierarchy", name: "Classifying Figures by Hierarchy" } ]},
    { name: "Number Theory", track: "adv", topics: [
      { id: "g5-modarith",  name: "Modular Arithmetic" },
      { id: "g5-congru",    name: "Linear Congruences" },
      { id: "g5-fermat",    name: "Fermat's Little Theorem" },
      { id: "g5-diophant",  name: "Diophantine Equations" },
      { id: "g5-bases",     name: "Number Bases" } ]},
    { name: "Algebra", track: "adv", topics: [
      { id: "g5-multistep", name: "Multi-Step Equations" },
      { id: "g5-inequal",   name: "Graphing Inequalities" },
      { id: "g5-rateeq",    name: "Equations for Rates & Percents" },
      { id: "g5-formulas",  name: "Rearranging Formulas" },
      { id: "g5-functions", name: "Introducing Functions" } ]},
    { name: "Geometry Extended", track: "adv", topics: [
      { id: "g5-pythag",    name: "The Pythagorean Theorem" },
      { id: "g5-distance",  name: "Distance Between Points" },
      { id: "g5-angletri",  name: "Angles in Triangles & Quadrilaterals" },
      { id: "g5-circarea",  name: "Areas of Circles & Sectors" },
      { id: "g5-cylinder",  name: "Cylinders" } ]},
    { name: "Combinatorics", track: "adv", topics: [
      { id: "g5-permrep",   name: "Permutations with Repetition" },
      { id: "g5-combrep",   name: "Combinations with Repetition" },
      { id: "g5-subsets",   name: "Counting Subsets" },
      { id: "g5-inclexcl",  name: "Inclusion-Exclusion" },
      { id: "g5-pascal",    name: "Pascal's Triangle" } ]},
    { name: "Probability", track: "adv", topics: [
      { id: "g5-compound",  name: "Compound Events" },
      { id: "g5-expected",  name: "Expected Value" },
      { id: "g5-geoprob",   name: "Geometric Probability" },
      { id: "g5-condition", name: "Conditional Probability" } ]}
  ]},

  6: { label: "Grade 6", beast: "vex", units: [
    { name: "Ratios & Proportional Relationships", track: "core", topics: [
      { id: "g6-ratios",    name: "Ratios & Unit Rates" },
      { id: "g6-percent",   name: "Percents" },
      { id: "g6-unitconv",  name: "Converting Units with Ratios" } ]},
    { name: "The Number System", track: "core", topics: [
      { id: "g6-nscoord",   name: "Coordinate Plane & Rational Numbers" },
      { id: "g6-fracdiv",   name: "Dividing Fractions" },
      { id: "g6-decimals",  name: "Multi-Digit Decimal Operations" } ]},
    { name: "Expressions & Equations", track: "core", topics: [
      { id: "g6-exprexp",   name: "Expressions with Exponents" },
      { id: "g6-equivexpr", name: "Equivalent Expressions" },
      { id: "g6-onevar",    name: "One-Variable Equations & Inequalities" },
      { id: "g6-relation",  name: "Dependent & Independent Variables" } ]},
    { name: "Geometry", track: "core", topics: [
      { id: "g6-polyarea",  name: "Area of Polygons" },
      { id: "g6-volfrac",   name: "Volume with Fractional Edges" },
      { id: "g6-coordpoly", name: "Polygons on the Coordinate Plane" },
      { id: "g6-netsurf",   name: "Nets & Surface Area" } ]},
    { name: "Statistics & Probability", track: "core", topics: [
      { id: "g6-statq",     name: "Statistical Questions" },
      { id: "g6-centervar", name: "Centre & Variability" },
      { id: "g6-displays",  name: "Dot Plots, Histograms & Box Plots" } ]},
    { name: "Number Theory", track: "adv", topics: [
      { id: "g6-modexp",    name: "Modular Exponents & Inverses" },
      { id: "g6-crt",       name: "The Chinese Remainder Theorem" },
      { id: "g6-diophant",  name: "Diophantine Equations" },
      { id: "g6-basearith", name: "Arithmetic in Other Bases" },
      { id: "g6-contfrac",  name: "Continued Fractions" },
      { id: "g6-perfect",   name: "Perfect, Abundant & Deficient Numbers" } ]},
    { name: "Algebra", track: "adv", topics: [
      { id: "g6-bothsides", name: "Variables on Both Sides" },
      { id: "g6-compound",  name: "Compound Inequalities" },
      { id: "g6-literal",   name: "Literal Equations" },
      { id: "g6-slope",     name: "Slope & Graphing Lines" },
      { id: "g6-systems",   name: "Systems of Equations" } ]},
    { name: "Geometry Extended", track: "adv", topics: [
      { id: "g6-pythag",    name: "Pythagorean Theorem & Converse" },
      { id: "g6-specialtri",name: "Special Right Triangles" },
      { id: "g6-apothem",   name: "Regular Polygons & the Apothem" },
      { id: "g6-solids",    name: "Prisms, Cylinders, Pyramids & Cones" },
      { id: "g6-transvers", name: "Parallel Lines & Transversals" },
      { id: "g6-transform", name: "Transformations & Dilations" } ]},
    { name: "Combinatorics", track: "adv", topics: [
      { id: "g6-permcomb",  name: "Permutations & Combinations" },
      { id: "g6-binomial",  name: "The Binomial Theorem" },
      { id: "g6-symmetry",  name: "Counting with Symmetry" },
      { id: "g6-recursion", name: "Recursion & Fibonacci" },
      { id: "g6-catalan",   name: "Catalan Numbers" } ]},
    { name: "Probability", track: "adv", topics: [
      { id: "g6-replace",   name: "With & Without Replacement" },
      { id: "g6-bayes",     name: "Conditional Probability & Bayes" },
      { id: "g6-randvar",   name: "Random Variables & Expected Value" },
      { id: "g6-distrib",   name: "Geometric & Binomial Distributions" } ]}
  ]},

  7: { label: "Grade 7", beast: "vex", units: [
    { name: "Ratios & Proportional Relationships", track: "core", topics: [
      { id: "g7-unitfrac",  name: "Unit Rates with Fractions" },
      { id: "g7-propor",    name: "Proportional Relationships" },
      { id: "g7-percentapp",name: "Markups, Discounts & Interest" } ]},
    { name: "The Number System", track: "core", topics: [
      { id: "g7-ratops",    name: "Operations with Rational Numbers" },
      { id: "g7-todecimal", name: "Terminating & Repeating Decimals" } ]},
    { name: "Expressions & Equations", track: "core", topics: [
      { id: "g7-expand",    name: "Expanding & Factoring" },
      { id: "g7-multistep", name: "Multi-Step Problems" },
      { id: "g7-eqineq",    name: "Equations & Inequalities" } ]},
    { name: "Geometry", track: "core", topics: [
      { id: "g7-scaledraw", name: "Scale Drawings" },
      { id: "g7-construct", name: "Constructing Figures" },
      { id: "g7-circles",   name: "Circles" },
      { id: "g7-anglerel",  name: "Angle Relationships" },
      { id: "g7-solids",    name: "Volume & Surface Area" } ]},
    { name: "Statistics & Probability", track: "core", topics: [
      { id: "g7-sampling",  name: "Random Sampling" },
      { id: "g7-probmodel", name: "Probability Models" },
      { id: "g7-compound",  name: "Compound Events" } ]},
    { name: "Number Theory", track: "adv", topics: [
      { id: "g7-modpow",    name: "Modular Powers & Inverses" },
      { id: "g7-euler",     name: "Fermat & Euler's Totient" },
      { id: "g7-triples",   name: "Pythagorean Triples" },
      { id: "g7-contfrac",  name: "Continued Fractions & Convergents" },
      { id: "g7-rsa",       name: "How RSA Works" } ]},
    { name: "Algebra", track: "adv", topics: [
      { id: "g7-absval",    name: "Absolute Value Equations" },
      { id: "g7-systems",   name: "Systems in Two & Three Variables" },
      { id: "g7-factorquad",name: "Factoring Quadratics" },
      { id: "g7-solvequad", name: "Solving Quadratics" },
      { id: "g7-graphquad", name: "Graphing Linear & Quadratic Functions" },
      { id: "g7-exponen",   name: "Exponential Growth & Decay" } ]},
    { name: "Geometry Extended", track: "adv", topics: [
      { id: "g7-proofs",    name: "Congruence & Similarity Proofs" },
      { id: "g7-centers",   name: "Triangle Centres & the Euler Line" },
      { id: "g7-circthm",   name: "Circle Theorems" },
      { id: "g7-heron",     name: "Heron's Formula" },
      { id: "g7-frustum",   name: "Spheres, Cones & Frustums" },
      { id: "g7-coordgeo",  name: "Coordinate Geometry" } ]},
    { name: "Combinatorics", track: "adv", topics: [
      { id: "g7-inclexcl3", name: "Inclusion-Exclusion for Three Sets" },
      { id: "g7-genfunc",   name: "Generating Functions" },
      { id: "g7-partitions",name: "Partitions of Integers" },
      { id: "g7-graphtheo", name: "Graph Theory Basics" },
      { id: "g7-ramsey",    name: "Ramsey Theory" } ]},
    { name: "Probability", track: "adv", topics: [
      { id: "g7-bayes",     name: "Bayes' Rule" },
      { id: "g7-joint",     name: "Joint & Marginal Distributions" },
      { id: "g7-variance",  name: "Expected Value & Variance" },
      { id: "g7-distrib",   name: "Binomial, Geometric & Poisson" },
      { id: "g7-markov",    name: "Markov Chains" } ]}
  ]},

  8: { label: "Grade 8", beast: "vex", units: [
    { name: "The Number System", track: "core", topics: [
      { id: "g8-irrational",name: "Irrational Numbers" },
      { id: "g8-radicals",  name: "Radicals & Integer Exponents" },
      { id: "g8-scinot",    name: "Scientific Notation" } ]},
    { name: "Expressions & Equations", track: "core", topics: [
      { id: "g8-propgraph", name: "Proportional Graphs & Slope" },
      { id: "g8-linear",    name: "Linear Equations" },
      { id: "g8-systems",   name: "Simultaneous Equations" } ]},
    { name: "Functions", track: "core", topics: [
      { id: "g8-funcdef",   name: "What a Function Is" },
      { id: "g8-funccomp",  name: "Comparing Functions" },
      { id: "g8-funcmodel", name: "Modelling with Functions" },
      { id: "g8-funcgraph", name: "Reading Function Graphs" } ]},
    { name: "Geometry", track: "core", topics: [
      { id: "g8-transform", name: "Transformations & Congruence" },
      { id: "g8-dilations", name: "Dilations & Similarity" },
      { id: "g8-angleAA",   name: "Angle Facts & the AA Criterion" },
      { id: "g8-pythag",    name: "The Pythagorean Theorem" },
      { id: "g8-solids",    name: "Cylinders, Cones & Spheres" } ]},
    { name: "Statistics & Probability", track: "core", topics: [
      { id: "g8-scatter",   name: "Scatter Plots" },
      { id: "g8-fitline",   name: "Fitting a Line" },
      { id: "g8-twoway",    name: "Two-Way Tables" } ]},
    { name: "Number Theory", track: "adv", topics: [
      { id: "g8-modfull",   name: "Modular Arithmetic & CRT" },
      { id: "g8-quadres",   name: "Quadratic Residues" },
      { id: "g8-pell",      name: "Pell's Equation" },
      { id: "g8-flt",       name: "Diophantine Equations & Fermat's Last Theorem" },
      { id: "g8-primality", name: "Primality Testing" },
      { id: "g8-rsa",       name: "RSA Encryption" } ]},
    { name: "Algebra", track: "adv", topics: [
      { id: "g8-polynom",   name: "Polynomials & the Factor Theorem" },
      { id: "g8-rational",  name: "Rational Expressions" },
      { id: "g8-radicaleq", name: "Radical Equations" },
      { id: "g8-vieta",     name: "Discriminant & Vieta's Formulas" },
      { id: "g8-nonlinear", name: "Nonlinear Systems" },
      { id: "g8-inequal",   name: "Quadratic & Rational Inequalities" },
      { id: "g8-series",    name: "Sequences & Series" },
      { id: "g8-complex",   name: "Complex Numbers" } ]},
    { name: "Geometry Extended", track: "adv", topics: [
      { id: "g8-ceva",      name: "Cevians, Menelaus & Ceva" },
      { id: "g8-power",     name: "Power of a Point & Cyclic Quadrilaterals" },
      { id: "g8-trig",      name: "Trigonometry & the Laws of Sines and Cosines" },
      { id: "g8-euler",     name: "Euler's Formula & Platonic Solids" },
      { id: "g8-vectors",   name: "Parametric Equations & Vectors" },
      { id: "g8-noneuclid", name: "Non-Euclidean Geometry" } ]},
    { name: "Combinatorics", track: "adv", topics: [
      { id: "g8-genfunc",   name: "Generating Functions & Recurrences" },
      { id: "g8-polya",     name: "Burnside & Polya Counting" },
      { id: "g8-planar",    name: "Planar Graphs & Colouring" },
      { id: "g8-ramsey",    name: "Ramsey Numbers" },
      { id: "g8-designs",   name: "Latin & Magic Squares" } ]},
    { name: "Probability", track: "adv", topics: [
      { id: "g8-pgf",       name: "Probability Generating Functions" },
      { id: "g8-randwalk",  name: "Random Walks & Gambler's Ruin" },
      { id: "g8-continuous",name: "Continuous Probability" },
      { id: "g8-clt",       name: "The Central Limit Theorem" },
      { id: "g8-entropy",   name: "Entropy" } ]}
  ]}
};

const TIERS = [
  { id: "practice",  name: "Practice",  blurb: "Learn the idea and get it solid." },
  { id: "challenge", name: "Challenge", blurb: "Multi-step problems that stretch it." },
  { id: "boss",      name: "Boss",      blurb: "Work backwards. Think it through." }
];

export { CURRICULUM, TIERS };
