/* Interactive simulations and dynamic geometry (spec 3.2.7).

   Each simulation is a small manipulable model the client draws and the
   learner changes by dragging or pressing. A simulation carries TASKS: goals
   the learner reaches by manipulating the model, checked server-side from
   the model's state so the client cannot declare success. The `check`
   functions are pure and take the state the client reports. */

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

export const SIMULATIONS = [
  {
    id: "sim-numberline", title: "Number Line Jumps", topicId: "g1-add20", grade: "1",
    blurb: "Drag the frog along the number line. Jumps add; jumps back subtract.",
    controls: [{ name: "start", type: "int", min: 0, max: 20 }, { name: "jumps", type: "int[]", min: -10, max: 10 }],
    initial: { start: 0, jumps: [] },
    tasks: [
      { id: "land-on-13", goal: "Start at 8 and land on 13 with one jump.",
        check: s => s.start === 8 && s.jumps.length === 1 && s.start + s.jumps[0] === 13 },
      { id: "two-jumps-to-15", goal: "Start at 6 and reach 15 in exactly two jumps.",
        check: s => s.start === 6 && s.jumps.length === 2 && s.jumps.reduce((a, b) => a + b, 6) === 15 },
      { id: "back-to-4", goal: "Start at 11 and jump back to 4.",
        check: s => s.start === 11 && s.jumps.length >= 1 && s.jumps.every(j => j < 0) && s.jumps.reduce((a, b) => a + b, 11) === 4 }
    ]
  },
  {
    id: "sim-area", title: "Stretch the Rectangle", topicId: "g3-area", grade: "3",
    blurb: "Drag the corner to change the rectangle. Watch the area and perimeter change.",
    controls: [{ name: "w", type: "int", min: 1, max: 12 }, { name: "h", type: "int", min: 1, max: 12 }],
    initial: { w: 4, h: 3 },
    tasks: [
      { id: "area-24", goal: "Make a rectangle with area 24.", check: s => s.w * s.h === 24 },
      { id: "perimeter-14-area-12", goal: "Make a rectangle with perimeter 14 and area 12.",
        check: s => 2 * (s.w + s.h) === 14 && s.w * s.h === 12 },
      { id: "square-36", goal: "Make a square with area 36.", check: s => s.w === s.h && s.w * s.h === 36 }
    ]
  },
  {
    id: "sim-angles", title: "Angle Explorer", topicId: "g4-protract", grade: "4",
    blurb: "Drag the arm to open and close the angle. Acute, right, obtuse or straight?",
    controls: [{ name: "degrees", type: "int", min: 0, max: 180 }],
    initial: { degrees: 45 },
    tasks: [
      { id: "right", goal: "Make a right angle.", check: s => s.degrees === 90 },
      { id: "obtuse-120", goal: "Make an obtuse angle of exactly 120°.", check: s => s.degrees === 120 },
      { id: "acute-under-30", goal: "Make an acute angle smaller than 30°.", check: s => s.degrees > 0 && s.degrees < 30 }
    ]
  },
  {
    id: "sim-reflect", title: "Mirror, Mirror", topicId: "g6-nscoord", grade: "6",
    blurb: "Drag the point; its reflection follows. Choose which axis is the mirror.",
    controls: [{ name: "x", type: "int", min: -8, max: 8 }, { name: "y", type: "int", min: -8, max: 8 }, { name: "axis", type: "enum", values: ["x", "y"] }],
    initial: { x: 3, y: 2, axis: "x" },
    tasks: [
      { id: "image-3-neg2", goal: "Place the point so that its reflection in the x-axis lands on (3, −2).",
        check: s => s.axis === "x" && s.x === 3 && s.y === 2 },
      { id: "image-neg5-4", goal: "Place the point so that its reflection in the y-axis lands on (−5, 4).",
        check: s => s.axis === "y" && s.x === 5 && s.y === 4 },
      { id: "on-mirror", goal: "Put the point somewhere its reflection is itself.",
        check: s => (s.axis === "x" && s.y === 0) || (s.axis === "y" && s.x === 0) }
    ]
  },
  {
    id: "sim-spinner", title: "Fair or Not?", topicId: "g4-simple", grade: "4",
    blurb: "Resize the spinner's sectors. Spin it many times and compare what happens to what you expect.",
    controls: [{ name: "sectors", type: "int[]", min: 1, max: 12, note: "sizes in twelfths, summing to 12" }],
    initial: { sectors: [4, 4, 4] },
    tasks: [
      { id: "half-red", goal: "Make red (the first sector) exactly half the spinner.",
        check: s => s.sectors.reduce((a, b) => a + b, 0) === 12 && s.sectors[0] === 6 },
      { id: "three-fair", goal: "Make three equal sectors.",
        check: s => s.sectors.length === 3 && s.sectors.every(v => v === 4) },
      { id: "quarter-blue", goal: "Make the second sector a quarter of the spinner.",
        check: s => s.sectors.reduce((a, b) => a + b, 0) === 12 && s.sectors[1] === 3 }
    ]
  },
  {
    id: "sim-triangle", title: "Triangle Angles", topicId: "g5-angletri", grade: "5",
    blurb: "Drag any vertex. The three angles change but always add to the same total.",
    controls: [{ name: "ax", type: "int" }, { name: "ay", type: "int" }, { name: "bx", type: "int" }, { name: "by", type: "int" }, { name: "cx", type: "int" }, { name: "cy", type: "int" }],
    initial: { ax: 0, ay: 0, bx: 6, by: 0, cx: 2, cy: 4 },
    tasks: [
      { id: "right-triangle", goal: "Make a right angle at A.",
        check: s => { const ux = s.bx - s.ax, uy = s.by - s.ay, vx = s.cx - s.ax, vy = s.cy - s.ay; return ux * vx + uy * vy === 0 && (ux || uy) && (vx || vy); } },
      { id: "isosceles", goal: "Make AB and AC the same length.",
        check: s => near((s.bx - s.ax) ** 2 + (s.by - s.ay) ** 2, (s.cx - s.ax) ** 2 + (s.cy - s.ay) ** 2) && !(s.bx === s.cx && s.by === s.cy) },
      { id: "obtuse-at-c", goal: "Make the angle at C obtuse.",
        check: s => { const ux = s.ax - s.cx, uy = s.ay - s.cy, vx = s.bx - s.cx, vy = s.by - s.cy; return ux * vx + uy * vy < 0; } }
    ]
  }
];

export const simulationById = id => SIMULATIONS.find(s => s.id === id) || null;
export const publicSimulation = s => ({
  id: s.id, title: s.title, topicId: s.topicId, grade: s.grade, blurb: s.blurb,
  controls: s.controls, initial: s.initial, tasks: s.tasks.map(t => ({ id: t.id, goal: t.goal }))
});

/* Validate the reported state against the declared controls before checking,
   so a malformed state can never satisfy a task by accident. */
export function validState(sim, state) {
  if (!state || typeof state !== "object") return false;
  for (const c of sim.controls) {
    const v = state[c.name];
    if (c.type === "int") { if (!Number.isInteger(v)) return false; if (c.min != null && (v < c.min || v > c.max)) return false; }
    else if (c.type === "int[]") { if (!Array.isArray(v) || !v.every(Number.isInteger)) return false; if (c.min != null && v.some(x => x < c.min || x > c.max)) return false; }
    else if (c.type === "enum") { if (!c.values.includes(v)) return false; }
  }
  return true;
}

export function checkTask(sim, taskId, state) {
  const task = sim.tasks.find(t => t.id === taskId);
  if (!task) return { error: "unknown_task" };
  if (!validState(sim, state)) return { error: "invalid_state" };
  let ok = false;
  try { ok = !!task.check(state); } catch { ok = false; }
  return { ok };
}
