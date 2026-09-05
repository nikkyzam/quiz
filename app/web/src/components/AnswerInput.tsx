import { useState, useEffect, type KeyboardEvent } from "react";

/* Ordering: keyboard-operable rather than drag-only, so it stays usable
   without a mouse or on touch (WCAG 2.1.1). Each row moves up or down. */
export function OrderAnswer({ items, disabled, onSubmit }: {
  items: string[]; disabled: boolean; onSubmit: (order: string[]) => void;
}) {
  const [list, setList] = useState<string[]>(items);
  useEffect(() => setList(items), [items]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };

  return (
    <div className="orderbox">
      <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
        Use the arrows to put these in order, then check.
      </p>
      <ol className="orderlist">
        {list.map((it, i) => (
          <li key={it} className="orderrow">
            <span className="orderpos" aria-hidden="true">{i + 1}</span>
            <span className="orderlabel">{it}</span>
            <span className="orderbtns">
              <button type="button" className="movebtn" disabled={disabled || i === 0}
                      aria-label={`Move ${it} up`} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="movebtn" disabled={disabled || i === list.length - 1}
                      aria-label={`Move ${it} down`} onClick={() => move(i, 1)}>↓</button>
            </span>
          </li>
        ))}
      </ol>
      <button className="btn" disabled={disabled} onClick={() => onSubmit(list)}>Check this order</button>
    </div>
  );
}

/* Plotting points on a coordinate grid (spec 3.2.2).

   Pointer and keyboard are equal ways in, not a main path and a fallback. A
   click-only grid would put this question type out of reach of any child who
   cannot use a mouse — and on a maths topic where plotting IS the skill being
   assessed, that is not a missing convenience, it is being unable to answer.

   So the grid is a single focusable widget holding a cursor: arrow keys move
   it one unit, Enter or Space places or lifts a point, Backspace clears. The
   cursor position and every placement are announced through a live region,
   because a sighted child gets that feedback from the dot appearing and a
   screen-reader user would otherwise get nothing at all. */
export function PlotAnswer({ plot, disabled, onSubmit }: {
  plot: { xMin: number; xMax: number; yMin: number; yMax: number; need: number };
  disabled: boolean;
  onSubmit: (points: [number, number][]) => void;
}) {
  const { xMin, xMax, yMin, yMax, need } = plot;
  const [points, setPoints] = useState<[number, number][]>([]);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [said, setSaid] = useState("");
  /* Reset on the grid's VALUES, not on the prop object's identity.

     Depending on `plot` itself means any caller passing an inline object —
     `plot={{ ...q.plot, need }}` — hands over a new reference on every
     render, and this effect then clears the child's points underneath them
     mid-question: every placement vanishes the moment anything else on the
     screen changes. Found by driving the component in a browser, where a
     submit re-rendered the parent and wiped the answer that had just been
     submitted. Primitives compare by value, so the reset now fires when the
     grid actually changes, which is the only time it should. */
  useEffect(() => { setPoints([]); setCursor([0, 0]); setSaid(""); },
            [xMin, xMax, yMin, yMax, need]);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const at = (p: [number, number]) =>
    points.findIndex(q => q[0] === p[0] && q[1] === p[1]);

  const toggle = (p: [number, number]) => {
    const i = at(p);
    if (i >= 0) {
      setPoints(ps => ps.filter((_, j) => j !== i));
      setSaid(`Removed the point at ${p[0]}, ${p[1]}.`);
      return;
    }
    /* At the limit the oldest point drops off rather than the click being
       ignored: silently refusing a placement reads as a broken grid, and the
       child has no way to tell which of their points the machine disliked. */
    setPoints(ps => {
      const next: [number, number][] = ps.length >= need ? ps.slice(1) : [...ps];
      return [...next, p];
    });
    setSaid(points.length >= need
      ? `Placed a point at ${p[0]}, ${p[1]}. That is ${need} of ${need}, so the earliest point was removed.`
      : `Placed a point at ${p[0]}, ${p[1]}. ${points.length + 1} of ${need} placed.`);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]
    };
    if (step[e.key]) {
      e.preventDefault();
      const next: [number, number] = [
        clamp(cursor[0] + step[e.key][0], xMin, xMax),
        clamp(cursor[1] + step[e.key][1], yMin, yMax)
      ];
      setCursor(next);
      setSaid(`${next[0]}, ${next[1]}${at(next) >= 0 ? " — a point is here" : ""}`);
      return;
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(cursor); return; }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      setPoints([]);
      setSaid("Cleared every point.");
    }
  };

  /* Screen geometry. One unit is 28px; y is negated because SVG counts down. */
  const U = 28, pad = 18;
  const w = (xMax - xMin) * U + pad * 2, h = (yMax - yMin) * U + pad * 2;
  const sx = (x: number) => pad + (x - xMin) * U;
  const sy = (y: number) => pad + (yMax - y) * U;

  const lines = [];
  for (let x = xMin; x <= xMax; x++)
    lines.push(<line key={`v${x}`} x1={sx(x)} y1={sy(yMax)} x2={sx(x)} y2={sy(yMin)}
                     stroke="currentColor" strokeWidth={x === 0 ? 1.6 : 0.4} opacity={x === 0 ? 0.9 : 0.25} />);
  for (let y = yMin; y <= yMax; y++)
    lines.push(<line key={`h${y}`} x1={sx(xMin)} y1={sy(y)} x2={sx(xMax)} y2={sy(y)}
                     stroke="currentColor" strokeWidth={y === 0 ? 1.6 : 0.4} opacity={y === 0 ? 0.9 : 0.25} />);

  return (
    <div className="plotbox">
      <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
        {need === 1 ? "Place one point." : `Place ${need} points.`} Click the grid, or use the
        arrow keys to move and Enter to place.
      </p>
      <svg
        className="plotgrid"
        width={w} height={h} viewBox={`0 0 ${w} ${h}`}
        role="application"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Coordinate grid from ${xMin} to ${xMax} across and ${yMin} to ${yMax} up. Arrow keys move, Enter places a point.`}
        onKeyDown={onKey}
        onClick={e => {
          if (disabled) return;
          const box = (e.target as SVGElement).ownerSVGElement?.getBoundingClientRect()
            ?? (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = Math.round((e.clientX - box.left - pad) / U) + xMin;
          const y = yMax - Math.round((e.clientY - box.top - pad) / U);
          if (x < xMin || x > xMax || y < yMin || y > yMax) return;
          setCursor([x, y]);
          toggle([x, y]);
        }}
      >
        {lines}
        {!disabled && (
          <rect x={sx(cursor[0]) - 7} y={sy(cursor[1]) - 7} width={14} height={14}
                fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 2" />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r={6} fill="currentColor" />
        ))}
      </svg>

      {/* Placements are also listed as text: a dot on a grid is not available
          to a screen reader, and reading back what has been placed is the only
          way to check your own work without sight. */}
      <p className="plotlist" style={{ fontSize: ".85rem" }}>
        {points.length
          ? `Placed: ${points.map(p => `(${p[0]}, ${p[1]})`).join(", ")}`
          : "No points placed yet."}
      </p>
      <p aria-live="polite" className="visually-hidden">{said}</p>

      <button className="btn" disabled={disabled || points.length !== need}
              onClick={() => onSubmit(points)}>
        {points.length === need ? "Check these points" : `Place ${need - points.length} more`}
      </button>
    </div>
  );
}

/* Select-all-that-apply. Checkboxes, because radio semantics would be a lie. */
export function MultiAnswer({ opts, disabled, onSubmit }: {
  opts: string[]; disabled: boolean; onSubmit: (picked: number[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  useEffect(() => setPicked([]), [opts]);
  const toggle = (i: number) =>
    setPicked(p => (p.includes(i) ? p.filter(x => x !== i) : [...p, i]));

  return (
    <fieldset className="multibox">
      <legend className="multilegend">Select every correct answer</legend>
      {opts.map((o, i) => (
        <label className={"multirow" + (picked.includes(i) ? " on" : "")} key={i}>
          <input type="checkbox" checked={picked.includes(i)} disabled={disabled}
                 onChange={() => toggle(i)} />
          <span>{o}</span>
        </label>
      ))}
      <button className="btn" disabled={disabled || !picked.length}
              onClick={() => onSubmit(picked)}>
        Check {picked.length ? `${picked.length} selected` : "answer"}
      </button>
    </fieldset>
  );
}
