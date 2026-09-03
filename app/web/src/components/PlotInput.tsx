import { useEffect, useId, useRef, useState } from "react";
import type { Question } from "../api";

/* Plot / graph input (spec 3.2.2). The learner places a point on a lattice
   instead of typing coordinates. Three equivalent ways in:
   - click or tap the grid (nearest lattice point wins),
   - focus the grid and steer with the arrow keys, Enter to plot,
   - type x and y into two number inputs.
   Grading is server-side (`ansPt`); this component only produces [x, y]. */

export type PlotGrid = { min: number; max: number };

/* api.ts is shared and cannot change, so the local question type widens it
   here: "plot" joins the union and carries its grid bounds. */
export type AnyQuestion = Omit<Question, "type"> & {
  type: Question["type"] | "plot";
  grid?: PlotGrid;
};

export const fmtPt = (p: [number, number]) => `(${p[0]}, ${p[1]})`;

/* "(3, -2)" -> [3, -2]; used to draw the correct point from feedback text. */
export function parsePt(s: string | undefined | null): [number, number] | undefined {
  const m = String(s ?? "").replace(/−/g, "-").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2])];
}

export function PlotInput({ grid, disabled, onSubmit, label = "Coordinate grid", reveal }: {
  grid: { min: number; max: number }; disabled?: boolean;
  onSubmit: (pt: [number, number]) => void; label?: string;
  reveal?: [number, number];
}) {
  const min = Math.floor(Math.min(grid.min, grid.max));
  const max = Math.ceil(Math.max(grid.min, grid.max));
  const span = Math.max(1, max - min);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));

  const [cur, setCur] = useState<[number, number]>([0, 0]);
  const [placed, setPlaced] = useState(false);
  const [xText, setXText] = useState("0");
  const [yText, setYText] = useState("0");
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId();
  const liveId = `plot-live-${uid}`;

  /* A new grid means a new question: back to the origin. */
  useEffect(() => { setCur([0, 0]); setPlaced(false); setXText("0"); setYText("0"); }, [min, max]);

  const setPoint = (x: number, y: number, from: "grid" | "input" = "grid") => {
    const p: [number, number] = [clamp(x), clamp(y)];
    setCur(p); setPlaced(true);
    if (from === "grid") { setXText(String(p[0])); setYText(String(p[1])); }
  };

  /* Geometry: a square viewBox, one unit per cell, with a margin for labels. */
  const PAD = 1.2;
  const size = span + PAD * 2;
  const sx = (x: number) => PAD + (x - min);
  const sy = (y: number) => PAD + (max - y);

  const fromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const ux = ((e.clientX - r.left) / r.width) * size - PAD + min;
    const uy = max - (((e.clientY - r.top) / r.height) * size - PAD);
    setPoint(ux, uy);
  };

  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step]
    };
    if (moves[e.key]) { e.preventDefault(); setPoint(cur[0] + moves[e.key][0], cur[1] + moves[e.key][1]); }
    else if (e.key === "Home") { e.preventDefault(); setPoint(0, 0); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (placed) onSubmit(cur); else setPoint(cur[0], cur[1]); }
  };

  const applyInputs = () => {
    const x = Number(xText.replace(/−/g, "-")), y = Number(yText.replace(/−/g, "-"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    setPoint(x, y, "input");
  };

  const ticks: number[] = [];
  for (let v = min; v <= max; v++) ticks.push(v);
  const every = span > 12 ? 2 : 1;                  // label density on big grids
  const font = size * 0.045;

  return (
    <div className="plotbox">
      <svg ref={svgRef} className={"plotsvg" + (disabled ? " done" : "")} viewBox={`0 0 ${size} ${size}`}
           role="group" tabIndex={disabled ? -1 : 0}
           aria-label={`${label}, from ${min} to ${max} on both axes. Arrow keys move the cursor, Enter plots the point.`}
           aria-describedby={liveId}
           onPointerDown={e => { if (!disabled) { e.preventDefault(); fromEvent(e); svgRef.current?.focus(); } }}
           onKeyDown={onKey}>
        {ticks.map(v => (
          <g key={v}>
            <line className="gl" x1={sx(v)} y1={sy(min)} x2={sx(v)} y2={sy(max)} />
            <line className="gl" x1={sx(min)} y1={sy(v)} x2={sx(max)} y2={sy(v)} />
          </g>
        ))}
        {min <= 0 && max >= 0 && (
          <>
            <line className="ax" x1={sx(min)} y1={sy(0)} x2={sx(max)} y2={sy(0)} />
            <line className="ax" x1={sx(0)} y1={sy(min)} x2={sx(0)} y2={sy(max)} />
          </>
        )}
        {ticks.filter(v => v !== 0 && v % every === 0).map(v => (
          <g key={"t" + v} aria-hidden="true">
            <text className="tick" x={sx(v)} y={sy(Math.max(min, Math.min(0, max))) + font * 1.2}
                  textAnchor="middle" fontSize={font} style={{ fontSize: font }}>{v}</text>
            <text className="tick" x={sx(Math.max(min, Math.min(0, max))) - font * 0.4} y={sy(v) + font * 0.35}
                  textAnchor="end" fontSize={font} style={{ fontSize: font }}>{v}</text>
          </g>
        ))}
        {reveal && (
          <g className="plot-reveal" aria-hidden="true">
            <circle className="pt2" cx={sx(reveal[0])} cy={sy(reveal[1])} r={0.34} />
          </g>
        )}
        <g className={"plot-cursor" + (placed ? " placed" : "")} aria-hidden="true">
          <circle className="plot-ring" cx={sx(cur[0])} cy={sy(cur[1])} r={0.5} />
          <circle className="pt" cx={sx(cur[0])} cy={sy(cur[1])} r={placed ? 0.3 : 0.16} />
        </g>
      </svg>

      <div className="visually-hidden" id={liveId} role="status" aria-live="polite">
        {placed ? `Point at ${fmtPt(cur)}` : `Cursor at the origin ${fmtPt(cur)}`}
      </div>

      <div className="plotin">
        <label className="plotfield">
          <span>x</span>
          <input type="number" inputMode="numeric" className="ansin" min={min} max={max} step={1}
                 value={xText} disabled={disabled}
                 onChange={e => setXText(e.target.value)} onBlur={applyInputs}
                 onKeyDown={e => { if (e.key === "Enter") { applyInputs(); } }} />
        </label>
        <label className="plotfield">
          <span>y</span>
          <input type="number" inputMode="numeric" className="ansin" min={min} max={max} step={1}
                 value={yText} disabled={disabled}
                 onChange={e => setYText(e.target.value)} onBlur={applyInputs}
                 onKeyDown={e => { if (e.key === "Enter") { applyInputs(); } }} />
        </label>
        <button type="button" className="btn" disabled={disabled}
                onClick={() => {
                  const x = Number(xText.replace(/−/g, "-")), y = Number(yText.replace(/−/g, "-"));
                  const p: [number, number] = Number.isFinite(x) && Number.isFinite(y) ? [clamp(x), clamp(y)] : cur;
                  setPoint(p[0], p[1]); onSubmit(p);
                }}>
          Plot {fmtPt(placed ? cur : [clamp(Number(xText) || 0), clamp(Number(yText) || 0)])}
        </button>
      </div>
      <p className="muted plothelp">Tap the grid, use the arrow keys, or type x and y.</p>
    </div>
  );
}
