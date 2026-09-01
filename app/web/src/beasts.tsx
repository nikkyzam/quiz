/* Original characters — deliberately not anyone else's. */
export const BEASTS: Record<string, { name: string; hue: string; horns: number; eyes: number }> = {
  pip: { name: "Pip", hue: "#F2A63B", horns: 2, eyes: 2 },
  nim: { name: "Nim", hue: "#3FB27F", horns: 3, eyes: 1 },
  vex: { name: "Vex", hue: "#6C7BE8", horns: 2, eyes: 3 }
};

export function Beast({ kind, size = 48 }: { kind: string; size?: number }) {
  const b = BEASTS[kind] || BEASTS.pip;
  const horns = Array.from({ length: b.horns }, (_, i) => {
    const step = b.horns > 1 ? 48 / (b.horns - 1) : 0;
    const x = 26 + i * step;
    return <path key={i} d={`M${x} 26 L${x + 5} 8 L${x + 11} 26 Z`} fill={b.hue} />;
  });
  const ex = b.eyes === 1 ? [50] : b.eyes === 2 ? [38, 62] : [32, 50, 68];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${b.name} the monster`}>
      {horns}
      <rect x="18" y="26" width="64" height="58" rx="24" fill={b.hue} />
      {ex.map(x => (
        <g key={x}>
          <circle cx={x} cy="55" r="8" fill="#fff" />
          <circle cx={x} cy="56" r="4" fill="#17263F" />
        </g>
      ))}
      <path d="M36 72 Q50 82 64 72" stroke="#17263F" strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* Coordinate grid, ported from the static app. */
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
      els.push(<text key={`tx${v}`} className="tick" x={X(v)} y={W / 2 + 13} textAnchor="middle">{lb}</text>);
      els.push(<text key={`ty${v}`} className="tick" x={W / 2 - 5} y={Y(v) + 3.5} textAnchor="end">{lb}</text>);
    });
  }
  pts.forEach((p, i) => {
    const [x, y, lb, cls] = p;
    els.push(<circle key={`p${i}`} className={cls || "pt"} cx={X(x)} cy={Y(y)} r={4.6} />);
    if (lb) {
      const left = X(x) > W - 64;
      els.push(<text key={`l${i}`} className="plb" x={X(x) + (left ? -9 : 9)} y={Y(y) - 7}
                     textAnchor={left ? "end" : "start"}>{lb}</text>);
    }
  });
  const p = 18;
  const desc = pts.filter(q => q[2]).map(q => `${q[2]} at (${q[0]}, ${q[1]})`).join("; ");
  return <svg viewBox={`${-p} ${-p} ${W + 2 * p} ${W + 2 * p}`} role="img"
              aria-label={desc ? `Coordinate grid showing ${desc}` : "Coordinate grid"}>{els}</svg>;
}
