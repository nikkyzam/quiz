import { useState, useEffect } from "react";

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
