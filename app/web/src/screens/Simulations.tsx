import "../styles/play.css";
import { useEffect, useState } from "react";
import { call, post, ApiError, type Learner } from "../api";
import { Beast, Grid } from "../beasts";

/* Interactive simulations and dynamic geometry (spec 3.2.7). The model is
   drawn here and changed with sliders and number fields; a task is only
   marked complete when the server checks the reported state. */

export type SimControl = { name: string; type: "int" | "int[]" | "enum"; min?: number; max?: number; values?: string[]; note?: string };
export type SimTask = { id: string; goal: string };
export type Sim = {
  id: string; title: string; topicId: string; grade: string; blurb: string;
  controls: SimControl[]; initial: Record<string, any>; tasks: SimTask[];
};
export type SimsData = { simulations: Sim[]; completed: { simulationId: string; taskId: string }[] };
type SimState = Record<string, any>;

const simsApi = {
  list: () => call<{ simulations: Sim[] }>("/simulations"),
  done: (learnerId: string) => call<{ completed: SimsData["completed"] }>(`/learners/${learnerId}/simulations`),
  check: (id: string, learnerId: string, taskId: string, state: SimState) =>
    post<{ ok: boolean; message: string }>(`/simulations/${id}/check`, { learnerId, taskId, state })
};

function friendly(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Please sign in again to keep exploring.";
    if (e.status === 403) return "This learner is not on your account.";
    if (e.status === 400) return "Something in the model is out of range. Nudge it back and try again.";
  }
  return fallback;
}

export function Simulations({ learner, onBack, initial }: { learner: Learner; onBack: () => void; initial?: SimsData }) {
  const [data, setData] = useState<SimsData | null>(initial ?? null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, SimState>>({});
  const [msgs, setMsgs] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (initial) return;
    Promise.all([simsApi.list(), simsApi.done(learner.id).catch(() => ({ completed: [] }))])
      .then(([s, d]) => setData({ simulations: s.simulations, completed: d.completed }))
      .catch(e => setError(friendly(e, "Couldn't load the simulations. Check the server is running.")));
  }, [learner.id, initial]);

  const isDone = (simId: string, taskId: string) =>
    !!data?.completed.some(c => c.simulationId === simId && c.taskId === taskId);

  async function check(sim: Sim, task: SimTask, state: SimState) {
    const key = `${sim.id}:${task.id}`;
    setBusy(key); setError("");
    try {
      const r = await simsApi.check(sim.id, learner.id, task.id, state);
      setMsgs(m => ({ ...m, [key]: { ok: r.ok, text: r.message } }));
      if (r.ok && data && !isDone(sim.id, task.id))
        setData({ ...data, completed: [...data.completed, { simulationId: sim.id, taskId: task.id }] });
    } catch (e) {
      setMsgs(m => ({ ...m, [key]: { ok: false, text: friendly(e, "Couldn't check that task.") } }));
    } finally { setBusy(""); }
  }

  const sim = data?.simulations.find(s => s.id === openId) || null;

  if (sim) {
    const state = states[sim.id] || sim.initial;
    const setState = (next: SimState) => setStates(s => ({ ...s, [sim.id]: next }));
    return (
      <>
        <button className="back" onClick={() => setOpenId(null)}>← All simulations</button>
        <div className="play-head">
          <Beast kind={learner.beast} size={48} mood="thinking" />
          <div><div className="eyebrow">Simulation · Grade {sim.grade}</div><h1>{sim.title}</h1></div>
        </div>
        <p className="lede">{sim.blurb}</p>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="card">
          <SimView sim={sim} state={state} onChange={setState} />
        </div>
        <h2>Tasks</h2>
        <ul className="tasklist">
          {sim.tasks.map(t => {
            const key = `${sim.id}:${t.id}`;
            const done = isDone(sim.id, t.id);
            const m = msgs[key];
            return (
              <li key={t.id} className={"task" + (done ? " done" : "")}>
                <span className="goal">{done && <span className="tick" aria-hidden="true">✓ </span>}{t.goal}
                  {done && <span className="visually-hidden"> (complete)</span>}</span>
                <button className={"btn" + (done ? " ghost" : "")} disabled={busy === key}
                        onClick={() => check(sim, t, state)}>{done ? "Check again" : "Check"}</button>
                <p className={"msg " + (m ? (m.ok ? "ok" : "no") : "")} role="status">{m?.text || ""}</p>
              </li>
            );
          })}
        </ul>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setState(sim.initial)}>Reset the model</button>
      </>
    );
  }

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="play-head">
        <Beast kind={learner.beast} size={48} />
        <div><div className="eyebrow">Simulations</div><h1>Move it and see</h1></div>
      </div>
      <p className="lede">Change a shape and watch the maths change with it. Each one has three tasks to crack.</p>
      {error && <p className="err" role="alert">{error}</p>}
      {!data && !error && <div className="loading" role="status">Loading simulations…</div>}
      {data && (
        <ul className="play-list" style={{ listStyle: "none", padding: 0 }}>
          {data.simulations.map(s => {
            const n = s.tasks.filter(t => isDone(s.id, t.id)).length;
            return (
              <li className="drow" key={s.id}>
                <div className="dhead"><b>{s.title}</b>
                  <span className={"pill" + (n === s.tasks.length ? " good" : "")}>{n}/{s.tasks.length} tasks</span></div>
                <div className="dsub">Grade {s.grade} · {s.blurb}</div>
                <div className="play-actions">
                  <button className="btn" onClick={() => setOpenId(s.id)}>Open {s.title}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/* ---------------- the models ---------------- */

function SimView({ sim, state, onChange }: { sim: Sim; state: SimState; onChange: (s: SimState) => void }) {
  const set = (k: string, v: any) => onChange({ ...state, [k]: v });
  switch (sim.id) {
    case "sim-numberline": return <NumberLine state={state} set={set} onChange={onChange} />;
    case "sim-area": return <AreaSim state={state} set={set} />;
    case "sim-angles": return <AngleSim state={state} set={set} />;
    case "sim-reflect": return <ReflectSim state={state} set={set} />;
    case "sim-spinner": return <SpinnerSim state={state} set={set} />;
    case "sim-triangle": return <TriangleSim state={state} set={set} />;
    default: return <GenericSim sim={sim} state={state} set={set} />;
  }
}

/* A labelled slider with its live value beside the label. */
function Range({ id, label, value, min, max, onChange }: {
  id: string; label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div className="ctrl">
      <label htmlFor={id}>{label} <output htmlFor={id}>{value}</output></label>
      <input id={id} type="range" min={min} max={max} step={1} value={value}
             onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

function NumberField({ id, label, value, min, max, onChange }: {
  id: string; label: string; value: number; min?: number; max?: number; onChange: (v: number) => void;
}) {
  return (
    <div className="ctrl">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={min} max={max} step={1} value={value}
             onChange={e => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) onChange(n); }} />
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* Number Line Jumps: start plus a list of jumps; arcs show each hop. */
function NumberLine({ state, set, onChange }: { state: SimState; set: (k: string, v: any) => void; onChange: (s: SimState) => void }) {
  const start: number = state.start ?? 0;
  const jumps: number[] = state.jumps ?? [];
  const [jump, setJump] = useState(3);
  const W = 460, x0 = 20, unit = (W - 40) / 20, Y = 70;
  const X = (n: number) => x0 + clamp(n, -1, 21) * unit;
  let cur = start;
  const arcs = jumps.map((j, i) => {
    const a = cur, b = cur + j; cur = b;
    const mid = (X(a) + X(b)) / 2, lift = Math.min(40, 10 + Math.abs(j) * 4);
    return <path key={i} className={"sim-arc" + (j < 0 ? " back" : "")} d={`M${X(a)} ${Y} Q${mid} ${Y - lift} ${X(b)} ${Y}`} />;
  });
  const land = start + jumps.reduce((s, j) => s + j, 0);
  return (
    <>
      <div className="sim-fig">
        <svg viewBox={`0 0 ${W} 100`} role="img"
             aria-label={`Number line from 0 to 20. Frog starts at ${start}${jumps.length ? `, jumps ${jumps.map(j => (j > 0 ? "+" : "") + j).join(", ")} and lands on ${land}` : ""}.`}>
          <line className="sim-axis" x1={x0} y1={Y} x2={W - 20} y2={Y} />
          {Array.from({ length: 21 }, (_, i) => (
            <g key={i}>
              <line className="sim-axis" x1={X(i)} y1={Y - 5} x2={X(i)} y2={Y + 5} />
              <text className="sim-tick" x={X(i)} y={Y + 20} textAnchor="middle">{i}</text>
            </g>
          ))}
          {arcs}
          <circle className="sim-frog" cx={X(start)} cy={Y - 8} r={8} />
          {jumps.length > 0 && <polygon className="sim-land" points={`${X(land)},${Y - 14} ${X(land) - 7},${Y - 26} ${X(land) + 7},${Y - 26}`} />}
        </svg>
      </div>
      <p className="readout">Start <b>{start}</b>{jumps.length ? <> {jumps.map(j => (j < 0 ? " − " : " + ") + Math.abs(j)).join("")} = lands on <b>{land}</b></> : " · add a jump to hop"}</p>
      <div className="ctrls">
        <Range id="nl-start" label="Start the frog at" value={start} min={0} max={20} onChange={v => set("start", v)} />
        <div className="ctrl-row">
          <NumberField id="nl-jump" label="Jump size (negative jumps back)" value={jump} min={-10} max={10} onChange={v => setJump(clamp(v, -10, 10))} />
          <button className="btn" onClick={() => onChange({ ...state, jumps: [...jumps, clamp(jump, -10, 10)] })}>Add jump</button>
        </div>
        {jumps.length > 0 && (
          <div>
            <span className="flabel">Jumps so far</span>
            <ul className="chips" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {jumps.map((j, i) => (
                <li key={i} className="chip">{j > 0 ? "+" : ""}{j}
                  <button type="button" aria-label={`Remove jump ${j > 0 ? "+" : ""}${j}`}
                          onClick={() => set("jumps", jumps.filter((_, k) => k !== i))}>×</button>
                </li>
              ))}
            </ul>
            <button className="linkbtn" onClick={() => set("jumps", [])}>Clear all jumps</button>
          </div>
        )}
      </div>
    </>
  );
}

/* Stretch the Rectangle: width and height on a unit grid. */
function AreaSim({ state, set }: { state: SimState; set: (k: string, v: any) => void }) {
  const w: number = state.w ?? 4, h: number = state.h ?? 3;
  const c = 28, pad = 10, S = 12 * c + pad * 2;
  return (
    <>
      <div className="sim-fig">
        <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Rectangle ${w} by ${h} on a grid. Area ${w * h}, perimeter ${2 * (w + h)}.`}>
          {Array.from({ length: 13 }, (_, i) => (
            <g key={i}>
              <line className="sim-grid" x1={pad + i * c} y1={pad} x2={pad + i * c} y2={S - pad} />
              <line className="sim-grid" x1={pad} y1={pad + i * c} x2={S - pad} y2={pad + i * c} />
            </g>
          ))}
          <rect className="sim-shape" x={pad} y={S - pad - h * c} width={w * c} height={h * c} />
          <text className="sim-lbl" x={pad + (w * c) / 2} y={S - pad - h * c - 8} textAnchor="middle">{w}</text>
          <text className="sim-lbl" x={pad + w * c + 8} y={S - pad - (h * c) / 2 + 4}>{h}</text>
        </svg>
      </div>
      <p className="readout">Area <b>{w} × {h} = {w * h}</b> square units · Perimeter <b>2 × ({w} + {h}) = {2 * (w + h)}</b> units{w === h ? " · it's a square" : ""}</p>
      <div className="ctrls cols">
        <Range id="ar-w" label="Width" value={w} min={1} max={12} onChange={v => set("w", v)} />
        <Range id="ar-h" label="Height" value={h} min={1} max={12} onChange={v => set("h", v)} />
      </div>
    </>
  );
}

/* Angle Explorer: one fixed arm, one that swings. */
function AngleSim({ state, set }: { state: SimState; set: (k: string, v: any) => void }) {
  const d: number = state.degrees ?? 45;
  const cx = 60, cy = 150, L = 170, r = 42;
  const rad = (d * Math.PI) / 180;
  const ex = cx + L * Math.cos(rad), ey = cy - L * Math.sin(rad);
  const ax = cx + r * Math.cos(rad), ay = cy - r * Math.sin(rad);
  const kind = d === 0 ? "zero" : d < 90 ? "acute" : d === 90 ? "right" : d < 180 ? "obtuse" : "straight";
  return (
    <>
      <div className="sim-fig">
        <svg viewBox="0 0 300 180" role="img" aria-label={`An angle of ${d} degrees, which is ${kind}.`}>
          {d === 90
            ? <path className="sim-arc" d={`M${cx + 16} ${cy} L${cx + 16} ${cy - 16} L${cx} ${cy - 16}`} />
            : <path className="sim-arc" d={`M${cx + r} ${cy} A${r} ${r} 0 ${d > 180 ? 1 : 0} 0 ${ax} ${ay}`} />}
          <line className="sim-arm" x1={cx} y1={cy} x2={cx + L} y2={cy} />
          <line className="sim-arm" x1={cx} y1={cy} x2={ex} y2={ey} />
          <circle className="sim-dot" cx={cx} cy={cy} r={5} />
          <text className="sim-lbl" x={cx + r + 10} y={cy - r / 2}>{d}°</text>
        </svg>
      </div>
      <p className="readout"><b>{d}°</b> · {kind === "zero" ? "closed, no angle yet" : `a${kind === "acute" || kind === "obtuse" ? "n" : ""} ${kind} angle`}</p>
      <div className="ctrls">
        <Range id="an-deg" label="Open the angle (degrees)" value={d} min={0} max={180} onChange={v => set("degrees", v)} />
      </div>
    </>
  );
}

/* Mirror, Mirror: a point and its image in an axis. */
function ReflectSim({ state, set }: { state: SimState; set: (k: string, v: any) => void }) {
  const x: number = state.x ?? 3, y: number = state.y ?? 2, axis: "x" | "y" = state.axis === "y" ? "y" : "x";
  const ix = axis === "x" ? x : -x, iy = axis === "x" ? -y : y;
  const mirror = axis === "x" ? { path: [[-9, 0], [9, 0]] } : { path: [[0, -9], [0, 9]] };
  const fmt = (n: number) => String(n).replace("-", "−");
  return (
    <>
      <div className="sim-fig"><div className="fig">
        <Grid spec={{ pts: [[x, y, "P"], [ix, iy, "P′", "pt2"]], ...mirror }} />
      </div></div>
      <p className="readout">P at <b>({fmt(x)}, {fmt(y)})</b> reflects in the {axis}-axis to P′ at <b>({fmt(ix)}, {fmt(iy)})</b></p>
      <div className="ctrls">
        <div className="ctrls cols">
          <Range id="rf-x" label="P's x" value={x} min={-8} max={8} onChange={v => set("x", v)} />
          <Range id="rf-y" label="P's y" value={y} min={-8} max={8} onChange={v => set("y", v)} />
        </div>
        <fieldset className="radios">
          <legend>Which axis is the mirror?</legend>
          {(["x", "y"] as const).map(a => (
            <label key={a} className={"radio" + (axis === a ? " on" : "")}>
              <input type="radio" name="rf-axis" value={a} checked={axis === a} onChange={() => set("axis", a)} />
              the {a}-axis
            </label>
          ))}
        </fieldset>
      </div>
    </>
  );
}

/* Fair or Not?: sectors in twelfths, plus a spin experiment to compare
   expected and observed. */
const SECTOR_NAMES = ["red", "purple", "green", "gold", "grey", "teal"];
function SpinnerSim({ state, set }: { state: SimState; set: (k: string, v: any) => void }) {
  const sectors: number[] = state.sectors ?? [4, 4, 4];
  const sum = sectors.reduce((a, b) => a + b, 0) || 1;
  const [tally, setTally] = useState<number[]>([]);
  const [last, setLast] = useState("");
  const cx = 110, cy = 110, R = 100;
  let acc = 0;
  const paths = sectors.map((s, i) => {
    const a0 = (acc / sum) * 2 * Math.PI - Math.PI / 2; acc += s;
    const a1 = (acc / sum) * 2 * Math.PI - Math.PI / 2;
    const large = s / sum > 0.5 ? 1 : 0;
    const d = s === sum
      ? `M${cx} ${cy - R} A${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} Z`
      : `M${cx} ${cy} L${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} A${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)} Z`;
    return <path key={i} className={`sim-sector sec${i % 6}`} d={d} />;
  });
  const spin = (n: number) => {
    const t = sectors.map((_, i) => tally[i] || 0);
    let lastHit = 0;
    for (let k = 0; k < n; k++) {
      let r = Math.random() * sum, i = 0;
      while (i < sectors.length - 1 && r >= sectors[i]) { r -= sectors[i]; i++; }
      t[i]++; lastHit = i;
    }
    setTally(t);
    setLast(`Spun ${n} times. Last spin landed on sector ${lastHit + 1} (${SECTOR_NAMES[lastHit % 6]}).`);
  };
  const spins = tally.reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="sim-fig">
        <svg viewBox="0 0 220 220" role="img"
             aria-label={`Spinner with ${sectors.length} sectors sized ${sectors.join(", ")} twelfths${sum !== 12 ? ` (total ${sum}, which is not 12)` : ""}.`}>
          {paths}
          <line className="sim-needle" x1={cx} y1={cy} x2={cx} y2={cy - R + 12} />
          <circle className="sim-dot" cx={cx} cy={cy} r={6} />
        </svg>
      </div>
      <p className="readout">Sizes add to <b>{sum}</b> of 12{sum !== 12 && <> · <span style={{ color: "var(--bad)" }}>make them add to 12 for a full spinner</span></>}</p>
      <div className="ctrls">
        <div className="ctrls cols">
          {sectors.map((s, i) => (
            <div className="ctrl" key={i}>
              <label htmlFor={`sp-${i}`}><span><span className={`swatch sec${i % 6}`} aria-hidden="true" />Sector {i + 1} ({SECTOR_NAMES[i % 6]})</span><output htmlFor={`sp-${i}`}>{s}/12</output></label>
              <input id={`sp-${i}`} type="range" min={1} max={12} step={1} value={s}
                     onChange={e => set("sectors", sectors.map((v, k) => (k === i ? Number(e.target.value) : v)))} />
            </div>
          ))}
        </div>
        <div className="play-actions">
          <button className="btn ghost" disabled={sectors.length >= 6} onClick={() => { set("sectors", [...sectors, 1]); setTally([]); }}>Add a sector</button>
          <button className="btn ghost" disabled={sectors.length <= 2} onClick={() => { set("sectors", sectors.slice(0, -1)); setTally([]); }}>Remove last sector</button>
          <button className="btn" onClick={() => spin(12)}>Spin 12 times</button>
          <button className="btn ghost" onClick={() => spin(120)}>Spin 120 times</button>
          {spins > 0 && <button className="linkbtn" onClick={() => { setTally([]); setLast("Tally cleared."); }}>Clear tally</button>}
        </div>
        <p className="visually-hidden" role="status">{last}</p>
        {spins > 0 && (
          <table className="tally">
            <caption className="visually-hidden">Expected against observed landings after {spins} spins</caption>
            <thead><tr><th scope="col">Sector</th><th scope="col">Expected</th><th scope="col">Landed</th></tr></thead>
            <tbody>
              {sectors.map((s, i) => (
                <tr key={i}>
                  <th scope="row"><span className={`swatch sec${i % 6}`} aria-hidden="true" />{i + 1} ({SECTOR_NAMES[i % 6]})</th>
                  <td>{Math.round((s / sum) * spins)}</td>
                  <td>{tally[i] || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* Triangle Angles: three draggable-by-number vertices; angles always sum to 180. */
function TriangleSim({ state, set }: { state: SimState; set: (k: string, v: any) => void }) {
  const P = { ax: 0, ay: 0, bx: 6, by: 0, cx: 2, cy: 4, ...state } as Record<string, number>;
  const A = [P.ax, P.ay], B = [P.bx, P.by], C = [P.cx, P.cy];
  const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const ang = (v: number[], p: number[], q: number[]) => {
    const a = dist(v, p), b = dist(v, q), c = dist(p, q);
    if (!a || !b) return 0;
    return (Math.acos(clamp((a * a + b * b - c * c) / (2 * a * b), -1, 1)) * 180) / Math.PI;
  };
  const aA = ang(A, B, C), aB = ang(B, A, C), aC = ang(C, A, B);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const degenerate = aA + aB + aC < 179;
  const lo = -2, hi = 10, c = 28, pad = 16, S = (hi - lo) * c + pad * 2;
  const X = (v: number) => pad + (clamp(v, lo, hi) - lo) * c, Y = (v: number) => S - pad - (clamp(v, lo, hi) - lo) * c;
  const kind = (d: number) => (Math.abs(d - 90) < 0.05 ? "right" : d < 90 ? "acute" : "obtuse");
  return (
    <>
      <div className="sim-fig">
        <svg viewBox={`0 0 ${S} ${S}`} role="img"
             aria-label={`Triangle with A at (${A}), B at (${B}), C at (${C}). Angles ${r1(aA)}, ${r1(aB)} and ${r1(aC)} degrees.`}>
          {Array.from({ length: hi - lo + 1 }, (_, i) => (
            <g key={i}>
              <line className="sim-grid" x1={pad + i * c} y1={pad} x2={pad + i * c} y2={S - pad} />
              <line className="sim-grid" x1={pad} y1={pad + i * c} x2={S - pad} y2={pad + i * c} />
            </g>
          ))}
          <line className="sim-axis" x1={X(lo)} y1={Y(0)} x2={X(hi)} y2={Y(0)} />
          <line className="sim-axis" x1={X(0)} y1={Y(lo)} x2={X(0)} y2={Y(hi)} />
          <polygon className="sim-shape" points={`${X(A[0])},${Y(A[1])} ${X(B[0])},${Y(B[1])} ${X(C[0])},${Y(C[1])}`} />
          {[["A", A], ["B", B], ["C", C]].map(([n, p]) => (
            <g key={n as string}>
              <circle className="sim-dot" cx={X((p as number[])[0])} cy={Y((p as number[])[1])} r={6} />
              <text className="sim-lbl" x={X((p as number[])[0]) + 9} y={Y((p as number[])[1]) - 8}>{n as string}</text>
            </g>
          ))}
        </svg>
      </div>
      <p className="readout">
        {degenerate ? <b>The points are in a line, so there is no triangle yet.</b> : <>
          A <b>{r1(aA)}°</b> ({kind(aA)}) · B <b>{r1(aB)}°</b> ({kind(aB)}) · C <b>{r1(aC)}°</b> ({kind(aC)}) · total <b>{Math.round(aA + aB + aC)}°</b>
          <br />AB {r1(dist(A, B))} · AC {r1(dist(A, C))} · BC {r1(dist(B, C))}
        </>}
      </p>
      <div className="ctrls cols">
        {(["ax", "ay", "bx", "by", "cx", "cy"] as const).map(k => (
          <NumberField key={k} id={`tr-${k}`} label={`${k[0].toUpperCase()} ${k[1]}`} value={P[k]} min={lo} max={hi}
                       onChange={v => set(k, clamp(v, lo, hi))} />
        ))}
      </div>
    </>
  );
}

/* A simulation this client has no drawing for: expose its controls so the
   tasks can still be attempted. */
function GenericSim({ sim, state, set }: { sim: Sim; state: SimState; set: (k: string, v: any) => void }) {
  return (
    <div className="ctrls cols">
      {sim.controls.map(c => c.type === "int"
        ? <NumberField key={c.name} id={`g-${c.name}`} label={c.name} value={Number(state[c.name] ?? 0)} min={c.min} max={c.max} onChange={v => set(c.name, v)} />
        : c.type === "enum"
          ? <div className="ctrl" key={c.name}>
              <label htmlFor={`g-${c.name}`}>{c.name}</label>
              <select id={`g-${c.name}`} value={String(state[c.name] ?? "")} onChange={e => set(c.name, e.target.value)}>
                {(c.values || []).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          : <div className="ctrl" key={c.name}>
              <label htmlFor={`g-${c.name}`}>{c.name} (comma separated)</label>
              <input id={`g-${c.name}`} type="text" value={(state[c.name] || []).join(", ")}
                     onChange={e => set(c.name, e.target.value.split(",").map(s => Number(s.trim())).filter(Number.isInteger))} />
            </div>)}
    </div>
  );
}
