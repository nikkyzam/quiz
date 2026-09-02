import { useEffect, useState } from "react";

/* Original characters — deliberately not anyone else's.
   Each has a mood, because a monster that reacts is the difference between a
   worksheet and a companion. */
export const BEASTS: Record<string, { name: string; hue: string; dark: string; horns: number; eyes: number }> = {
  pip: { name: "Pip", hue: "#F2913B", dark: "#C24A00", horns: 2, eyes: 2 },
  nim: { name: "Nim", hue: "#2FB59A", dark: "#0F6E5C", horns: 3, eyes: 1 },
  vex: { name: "Vex", hue: "#8B6BF0", dark: "#5A32C9", horns: 2, eyes: 3 }
};

export type Mood = "idle" | "happy" | "oops" | "thinking";

export function Beast({ kind, size = 48, mood = "idle", still = false }: {
  kind: string; size?: number; mood?: Mood; still?: boolean;
}) {
  const b = BEASTS[kind] || BEASTS.pip;

  const horns = Array.from({ length: b.horns }, (_, i) => {
    const step = b.horns > 1 ? 48 / (b.horns - 1) : 0;
    const x = 26 + i * step;
    return <path key={i} d={`M${x} 27 L${x + 5} 6 L${x + 11} 27 Z`} fill={b.dark} />;
  });

  const ex = b.eyes === 1 ? [50] : b.eyes === 2 ? [37, 63] : [31, 50, 69];
  /* Eyes narrow when thinking, squeeze shut when cheering. */
  const eyeR = mood === "thinking" ? 6 : 8;
  const pupilY = mood === "thinking" ? 58 : mood === "oops" ? 59 : 56;

  const mouth =
    mood === "happy" ? "M34 70 Q50 86 66 70"          // big grin
    : mood === "oops" ? "M36 78 Q50 68 64 78"         // downturn
    : mood === "thinking" ? "M40 76 L60 74"           // flat, considering
    : "M36 72 Q50 82 64 72";                          // easy smile

  const cls = still ? "beast"
    : mood === "happy" ? "beast beast-cheer"
    : mood === "oops" ? "beast beast-oops"
    : "beast beast-idle";

  return (
    <span className="beast-wrap">
      <svg className={cls} viewBox="0 0 100 100" width={size} height={size}
           role="img" aria-label={`${b.name} the monster`}>
        {horns}
        <rect x="16" y="27" width="68" height="58" rx="26" fill={b.hue} />
        {/* a lighter belly gives the body some form */}
        <ellipse cx="50" cy="66" rx="22" ry="16" fill="#fff" opacity=".18" />
        {ex.map(x => (
          <g key={x}>
            <circle cx={x} cy="54" r={eyeR} fill="#fff" />
            <circle cx={x} cy={pupilY} r={eyeR / 2} fill="#2B1B3D" />
          </g>
        ))}
        {mood === "happy" && (
          <>
            <circle cx="26" cy="66" r="5" fill="#fff" opacity=".35" />
            <circle cx="74" cy="66" r="5" fill="#fff" opacity=".35" />
          </>
        )}
        <path d={mouth} stroke="#2B1B3D" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/* A short burst of confetti. Drawn here rather than pulled from a library:
   a dozen divs is cheaper than a dependency, and it respects reduced motion
   through CSS rather than a runtime check. */
export function Confetti({ fire }: { fire: number }) {
  const [pieces, setPieces] = useState<{ id: number; style: React.CSSProperties }[]>([]);

  useEffect(() => {
    if (!fire) return;
    const colours = ["#F2913B", "#2FB59A", "#8B6BF0", "#E8C14A", "#EF6F8E"];
    const made = Array.from({ length: 18 }, (_, i) => ({
      id: fire * 100 + i,
      style: {
        left: `${5 + Math.random() * 90}%`,
        background: colours[i % colours.length],
        animationDuration: `${1.1 + Math.random() * 0.9}s`,
        animationDelay: `${Math.random() * 0.25}s`
      } as React.CSSProperties
    }));
    setPieces(made);
    const t = setTimeout(() => setPieces([]), 2400);
    return () => clearTimeout(t);
  }, [fire]);

  if (!pieces.length) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map(p => <i key={p.id} style={p.style} />)}
    </div>
  );
}

/* Coordinate grid, unchanged in behaviour but drawn with the new palette. */
export function Grid({ spec }: { spec: any }) {
  if (!spec) return null;
  const pts: any[] = spec.pts || [];
  let m = 5;
  const feed = pts.map(p => [p[0], p[1]]).concat(spec.path || [], spec.poly || []);
  feed.forEach((p: any) => { m = Math.max(m, Math.abs(p[0]), Math.abs(p[1])); });
  m = Math.ceil(m) + 1;
  const step = m > 9 ? 5 : m > 6 ? 2 : 1;
  const W = 280, c = W / (2 * m), X = (x: number) => W / 2 + x * c, Y = (y: number) => W / 2 - y * c;
  const els: JSX.Element[] = [];
  for (let i = -m; i <= m; i++) {
    els.push(<line key={`v${i}`} className="gl" x1={X(i)} y1={0} x2={X(i)} y2={W} />);
    els.push(<line key={`h${i}`} className="gl" x1={0} y1={Y(i)} x2={W} y2={Y(i)} />);
  }
  els.push(<line key="ax" className="ax" x1={0} y1={W / 2} x2={W} y2={W / 2} />);
  els.push(<line key="ay" className="ax" x1={W / 2} y1={0} x2={W / 2} y2={W} />);
  if (spec.poly)
    els.push(<polygon key="poly" className="poly" points={spec.poly.map((p: any) => `${X(p[0])},${Y(p[1])}`).join(" ")} />);
  if (spec.path)
    els.push(<polyline key="path" className="seg" points={spec.path.map((p: any) => `${X(p[0])},${Y(p[1])}`).join(" ")} />);
  for (let i = step; i <= m; i += step) {
    [i, -i].forEach(v => {
      const lb = String(v).replace("-", "−");
      els.push(<text key={`tx${v}`} className="tick" x={X(v)} y={W / 2 + 14} textAnchor="middle">{lb}</text>);
      els.push(<text key={`ty${v}`} className="tick" x={W / 2 - 6} y={Y(v) + 4} textAnchor="end">{lb}</text>);
    });
  }
  pts.forEach((p, i) => {
    const [x, y, lb, cls] = p;
    els.push(<circle key={`p${i}`} className={cls || "pt"} cx={X(x)} cy={Y(y)} r={5.5} />);
    if (lb) {
      const left = X(x) > W - 64;
      els.push(<text key={`l${i}`} className="plb" x={X(x) + (left ? -10 : 10)} y={Y(y) - 8}
                     textAnchor={left ? "end" : "start"}>{lb}</text>);
    }
  });
  const p = 20;
  const desc = pts.filter(q => q[2]).map(q => `${q[2]} at (${q[0]}, ${q[1]})`).join("; ");
  return <svg viewBox={`${-p} ${-p} ${W + 2 * p} ${W + 2 * p}`} role="img"
              aria-label={desc ? `Coordinate grid showing ${desc}` : "Coordinate grid"}>{els}</svg>;
}
