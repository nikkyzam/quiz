/* Comic lessons (spec 3.2.1, 4.1.3).

   A lesson is a sequence of panels. Each panel has a piece of art (an SVG
   scene the client draws from a small vocabulary of kinds), the text the
   character says, and an ALT description for readers who cannot see the
   art (3.5.3). Some panels carry an interactive check: a real question
   graded server-side before the learner moves on. Progress is saved per
   panel so a lesson can be resumed where it was left.

   Art is described, not drawn, here: `art.kind` picks a scene and `art`
   supplies its numbers, so the same panel renders at any size and in any
   theme, and the description stays in step with what is shown. */

export const LESSONS = [
  {
    id: "les-k-add10", topicId: "k-add10", grade: "K", title: "Pip and the Two Baskets",
    panels: [
      { art: { kind: "baskets", left: 3, right: 2 }, alt: "Two baskets. The left holds 3 apples, the right holds 2.",
        text: "Pip found two baskets of apples. 'How many altogether?' Pip wondered." },
      { art: { kind: "baskets", left: 3, right: 2, merge: true }, alt: "The apples are tipped into one big basket: 3 and 2 make 5.",
        text: "'Put them together and count!' said Pip. 3... then 4, 5. Five apples!" },
      { art: { kind: "fingers", n: 5 }, alt: "A hand showing five fingers.",
        text: "You can add on your fingers too. Start at 3, then count on 2 more: 4, 5.",
        check: { type: "in", q: "2 + 3 = ?", ans: 5, expl: "Start at 2 and count on 3: 3, 4, 5.", hint: "Count on from 2." } },
      { art: { kind: "baskets", left: 4, right: 4 }, alt: "Two baskets with 4 apples each.",
        text: "'What about 4 and 4?' asked Pip. That one is a double: 4 + 4 = 8.",
        check: { type: "mc", q: "Which pair makes 6?", opts: ["3 + 3", "4 + 1", "2 + 2", "5 + 2"], a: 0,
                 expl: "3 + 3 = 6. The others make 5, 4 and 7." } },
      { art: { kind: "celebrate", stars: 3 }, alt: "Pip cheering under three stars.",
        text: "Adding is putting together and counting. You did it!" }
    ]
  },
  {
    id: "les-g1-tensones", topicId: "g1-tensones", grade: "1", title: "The Tens Tower",
    panels: [
      { art: { kind: "rods", tens: 4, ones: 7 }, alt: "Four tall rods of ten cubes and seven single cubes.",
        text: "Pip builds towers of ten. Four towers and seven loose cubes. That number is 47." },
      { art: { kind: "rods", tens: 4, ones: 7, label: true }, alt: "The rods labelled 40 and the cubes labelled 7, making 47.",
        text: "The 4 says 'four tens' — that is 40. The 7 says 'seven ones'. 40 and 7 is 47." },
      { art: { kind: "rods", tens: 6, ones: 3 }, alt: "Six rods of ten and three single cubes.",
        text: "Now you: six towers and three cubes.",
        check: { type: "in", q: "What number is 6 tens and 3 ones?", ans: 63, expl: "6 tens is 60, plus 3 ones is 63.", hint: "Six tens first." } },
      { art: { kind: "rods", tens: 3, ones: 12 }, alt: "Three rods of ten and twelve single cubes, ten of which are being snapped into a new rod.",
        text: "Twelve loose cubes? Snap ten of them into a tower! Now it is 4 towers and 2 cubes: 42.",
        check: { type: "in", q: "What number is 2 tens and 15 ones?", ans: 35, expl: "15 ones is 1 ten and 5 ones, so 3 tens and 5 ones: 35.", hint: "Make a new ten." } },
      { art: { kind: "celebrate", stars: 3 }, alt: "Pip beside a tower of tens, cheering.",
        text: "Tens and ones: that is what every number is made of." }
    ]
  },
  {
    id: "les-g2-arrays", topicId: "g2-arrays", grade: "2", title: "Rows of Cookies",
    panels: [
      { art: { kind: "array", rows: 3, cols: 4 }, alt: "A tray of cookies in 3 rows of 4.",
        text: "Pip baked cookies in neat rows. 3 rows, 4 in each row. This is an array." },
      { art: { kind: "array", rows: 3, cols: 4, rowsum: true }, alt: "The same tray with 4 + 4 + 4 written beside the rows.",
        text: "Count a row at a time: 4 + 4 + 4 = 12. Twelve cookies." },
      { art: { kind: "array", rows: 2, cols: 5 }, alt: "Cookies in 2 rows of 5.",
        text: "Your turn.",
        check: { type: "in", q: "An array has 2 rows of 5. How many altogether?", ans: 10, expl: "5 + 5 = 10.", hint: "Add a row at a time." } },
      { art: { kind: "array", rows: 4, cols: 3, turn: true }, alt: "The 3-by-4 tray turned on its side becomes 4 rows of 3.",
        text: "Turn the tray and it is 4 rows of 3. Still 12! Rows and columns can swap.",
        check: { type: "mc", q: "Which addition matches 4 rows of 3?", opts: ["3 + 3 + 3 + 3", "4 + 3", "4 + 4 + 4", "3 + 4 + 3"], a: 0,
                 expl: "4 rows of 3 is 3 added four times." } },
      { art: { kind: "celebrate", stars: 3 }, alt: "Pip holding a full tray of cookies.",
        text: "Arrays turn counting into adding equal groups, which is the start of multiplying." }
    ]
  },
  {
    id: "les-g3-fracnum", topicId: "g3-fracnum", grade: "3", title: "Nim Shares a Pizza",
    panels: [
      { art: { kind: "pizza", slices: 4, shaded: 1 }, alt: "A pizza cut into 4 equal slices with 1 slice shaded.",
        text: "Nim cuts a pizza into 4 equal slices and eats one. Nim ate one quarter: 1/4." },
      { art: { kind: "pizza", slices: 4, shaded: 3 }, alt: "The same pizza with 3 of 4 slices shaded.",
        text: "The top number counts slices. The bottom number says how many slices make a whole. 3/4 is three of the four." },
      { art: { kind: "pizza", slices: 8, shaded: 1 }, alt: "A pizza cut into 8 slices with 1 shaded.",
        text: "Cut it into 8 and each slice is smaller. 1/8 is less than 1/4.",
        check: { type: "mc", q: "Which is bigger?", opts: ["1/3", "1/6", "They are the same"], a: 0,
                 expl: "Fewer slices means bigger slices. Thirds are bigger than sixths." } },
      { art: { kind: "pizza", slices: 2, shaded: 2 }, alt: "A pizza cut in half with both halves shaded.",
        text: "Two halves is the whole pizza: 2/2 = 1.",
        check: { type: "in", q: "How many quarters make one whole?", ans: 4, expl: "Four quarters make a whole.", hint: "Count the slices in a whole cut into quarters." } },
      { art: { kind: "celebrate", stars: 3 }, alt: "Nim with an empty pizza box, satisfied.",
        text: "A fraction is a number: it tells you how many equal parts, and how big each part is." }
    ]
  },
  {
    id: "les-g3-area", topicId: "g3-area", grade: "3", title: "Tiling the Floor",
    panels: [
      { art: { kind: "grid-rect", w: 5, h: 3 }, alt: "A rectangle 5 squares wide and 3 squares tall, tiled with unit squares.",
        text: "Nim is tiling a floor. 5 tiles across, 3 tiles down. How many tiles?" },
      { art: { kind: "grid-rect", w: 5, h: 3, count: true }, alt: "The same rectangle with the 15 tiles numbered.",
        text: "Count them: 15. Or multiply: 5 × 3 = 15. The space inside is the AREA: 15 square units." },
      { art: { kind: "grid-rect", w: 4, h: 4 }, alt: "A square 4 by 4.",
        text: "A square floor 4 by 4.",
        check: { type: "in", q: "What is the area of a 4 by 4 square, in square units?", ans: 16, expl: "4 × 4 = 16 square units.", hint: "Multiply the sides." } },
      { art: { kind: "grid-rect", w: 6, h: 2, perimeter: true }, alt: "A 6 by 2 rectangle with its outside edge highlighted.",
        text: "The line around the OUTSIDE is the perimeter: 6 + 2 + 6 + 2 = 16. Area and perimeter measure different things.",
        check: { type: "mc", q: "What does area measure?", opts: ["The space inside", "The distance around", "The number of corners"], a: 0,
                 expl: "Area is the inside; perimeter is the way round." } },
      { art: { kind: "celebrate", stars: 3 }, alt: "Nim standing on a finished tiled floor.",
        text: "Area is how many squares fit inside. Length times width gets you there without counting." }
    ]
  },
  {
    id: "les-g6-nscoord", topicId: "g6-nscoord", grade: "6", title: "Vex Maps the Plane",
    panels: [
      { art: { kind: "plane", pts: [] }, alt: "A coordinate plane with the x-axis running left to right and the y-axis up and down, crossing at the origin.",
        text: "Vex unrolls a map. Two number lines cross at the origin, (0, 0). Left–right is x; up–down is y." },
      { art: { kind: "plane", pts: [[3, 2, "A"]] }, alt: "The same plane with point A plotted 3 to the right and 2 up.",
        text: "A point is a pair: (x, y). To find (3, 2), go 3 right, then 2 up. Right-then-up, always in that order." },
      { art: { kind: "plane", pts: [[-4, 1, "B"]] }, alt: "Point B plotted 4 to the left and 1 up.",
        text: "Negative x means left. (−4, 1) is 4 left and 1 up — that is Quadrant II.",
        check: { type: "plot", q: "Plot the point (2, −3).", ansPt: [2, -3], grid: { min: -5, max: 5 },
                 expl: "2 right, then 3 down: Quadrant IV.", hint: "x first: 2 to the right. Then y: 3 down." } },
      { art: { kind: "plane", pts: [[2, 3, "P"], [2, -1, "Q"]], path: [[2, 3], [2, -1]] }, alt: "Points P (2, 3) and Q (2, −1) joined by a vertical dashed line.",
        text: "Same x, different y: the distance is straight up and down. From 3 down to −1 is 4 units.",
        check: { type: "in", q: "How far apart are (5, 2) and (5, −4)?", ans: 6, expl: "From 2 down to −4 is 2 + 4 = 6 units.", hint: "Same x, so count along y." } },
      { art: { kind: "celebrate", stars: 3 }, alt: "Vex standing at the origin of a map dotted with points.",
        text: "Every point has an address. Read x, then y, and you can find anything on the plane." }
    ]
  },
  {
    id: "les-g6-ratios", topicId: "g6-ratios", grade: "6", title: "The Lemonade Stand",
    panels: [
      { art: { kind: "jugs", lemons: 2, water: 6 }, alt: "Two lemons beside six cups of water.",
        text: "Vex's lemonade uses 2 lemons for every 6 cups of water. That is a ratio: 2 : 6." },
      { art: { kind: "jugs", lemons: 1, water: 3 }, alt: "One lemon beside three cups of water.",
        text: "Halve both and the taste is the same: 1 : 3. One lemon for every three cups. That is the simplest form." },
      { art: { kind: "jugs", lemons: 4, water: 12 }, alt: "Four lemons beside twelve cups.",
        text: "A big batch keeps the ratio too.",
        check: { type: "in", q: "With 1 lemon for every 3 cups, how many cups go with 5 lemons?", ans: 15, expl: "5 × 3 = 15 cups.", hint: "Three cups per lemon." } },
      { art: { kind: "jugs", lemons: 3, water: 6, price: 9 }, alt: "Three cups of lemonade with a price tag of 9 coins.",
        text: "3 cups cost 9 coins, so 1 cup costs 3 coins. That 'per one' amount is a unit rate.",
        check: { type: "in", q: "5 cups cost 20 coins. What does one cup cost?", ans: 4, expl: "20 ÷ 5 = 4 coins per cup.", hint: "Share the cost equally." } },
      { art: { kind: "celebrate", stars: 3 }, alt: "Vex behind a busy lemonade stand.",
        text: "Ratios compare amounts; unit rates tell you the amount for one. Both keep the recipe right." }
    ]
  },
  {
    id: "les-g3-mult", topicId: "g3-mult", grade: "3", title: "Spider Legs",
    panels: [
      { art: { kind: "groups", groups: 4, each: 8 }, alt: "Four spiders, each with eight legs.",
        text: "Nim counts spider legs. 4 spiders, 8 legs each. 8 + 8 + 8 + 8 is a long sum..." },
      { art: { kind: "groups", groups: 4, each: 8, times: true }, alt: "The four spiders with 4 × 8 = 32 written above.",
        text: "...so we write 4 × 8 = 32. Times means 'groups of'. 4 groups of 8." },
      { art: { kind: "groups", groups: 3, each: 6 }, alt: "Three boxes with six eggs each.",
        text: "Three boxes of six eggs.",
        check: { type: "in", q: "3 × 6 = ?", ans: 18, expl: "Three groups of six: 6 + 6 + 6 = 18.", hint: "Three groups of six." } },
      { art: { kind: "groups", groups: 6, each: 3, turn: true }, alt: "The eggs regrouped as six rows of three.",
        text: "Turn it round: 6 × 3 is also 18. Either order, same answer.",
        check: { type: "mc", q: "Which is the same as 7 × 5?", opts: ["5 × 7", "7 + 5", "5 + 5 + 5", "7 × 7"], a: 0,
                 expl: "Multiplication works in either order: 7 × 5 = 5 × 7 = 35." } },
      { art: { kind: "celebrate", stars: 3 }, alt: "Nim surrounded by neatly grouped objects.",
        text: "Multiplying is adding equal groups quickly. Learn the facts and the sums vanish." }
    ]
  }
];

export const ART_KINDS = ["baskets", "fingers", "rods", "array", "pizza", "grid-rect", "plane", "jugs", "groups", "celebrate"];

/* The lesson as served: checks without their answers. */
export function publicLesson(l) {
  return {
    id: l.id, topicId: l.topicId, grade: l.grade, title: l.title, panels: l.panels.length,
    checks: l.panels.filter(p => p.check).length,
    panelList: l.panels.map((p, i) => ({
      index: i, art: p.art, alt: p.alt, text: p.text,
      check: p.check ? {
        id: `${l.id}#${i}`, type: p.check.type, q: p.check.q,
        opts: p.check.type === "mc" ? p.check.opts : undefined,
        grid: p.check.type === "plot" ? p.check.grid : undefined,
        hint: p.check.hint || null
      } : null
    }))
  };
}

export const lessonById = id => LESSONS.find(l => l.id === id) || null;
export const lessonsForTopic = topicId => LESSONS.filter(l => l.topicId === topicId);
