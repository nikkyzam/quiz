/* Plot-input questions (spec 3.2.2): the learner places a point on a grid
   instead of typing coordinates. Graded server-side against `ansPt`. */
export const PLOT_G6 = [
  { sec: "B", type: "plot", q: "Plot the point (4, 2).", ansPt: [4, 2], grid: { min: -6, max: 6 },
    hint: "x first: 4 to the right. Then y: 2 up.", expl: "From the origin go 4 right and 2 up. That is (4, 2), in Quadrant I." },
  { sec: "B", type: "plot", q: "Plot the point (−3, −5).", ansPt: [-3, -5], grid: { min: -6, max: 6 },
    hint: "Both negative: left, then down.", expl: "3 left and 5 down lands in Quadrant III at (−3, −5)." },
  { lvl: 2, sec: "B", type: "plot", q: "Plot the point that lies on the y-axis, 4 units above the origin.", ansPt: [0, 4], grid: { min: -6, max: 6 },
    hint: "On the y-axis means x is 0.", expl: "Points on the y-axis have x = 0. Four up from the origin is (0, 4)." },
  { lvl: 2, sec: "D", type: "plot", q: "Plot the reflection of (2, 3) in the x-axis.", ansPt: [2, -3], grid: { min: -6, max: 6 },
    hint: "Reflecting in the x-axis flips the sign of y.", expl: "The x-coordinate stays 2 and y flips from 3 to −3: (2, −3)." },
  { lvl: 3, sec: "C", type: "plot", q: "Start at (−5, 1). Move 6 units right and 3 units down. Plot where you land.", ansPt: [1, -2], grid: { min: -6, max: 6 },
    hint: "Right adds to x; down subtracts from y.", expl: "−5 + 6 = 1 and 1 − 3 = −2, so you land on (1, −2)." }
];
