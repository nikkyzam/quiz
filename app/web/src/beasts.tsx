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

export function Beast({ kind, size = 48, mood = "idle", still = false, gear }: {
  kind: string; size?: number; mood?: Mood; still?: boolean; gear?: string[];
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
        {gear && gear.length > 0 && <GearLayer gear={gear} eyes={ex} pupilY={pupilY} />}
      </svg>
    </span>
  );
}

/* Avatar accessories (spec 5.3): small original shapes layered on the
   monster. Purely decorative — the wardrobe names each item in text — so
   the whole layer is hidden from assistive technology. Illustration colours
   are fixed on purpose, like the monsters' own hues. */
const GEAR_IDS = ["cap", "crown", "wizard", "laurel", "halo", "glasses", "monocle", "stars",
  "pencil", "trophy", "hammer", "compass", "sparkles", "numbers", "flames"];

function starPoints(cx: number, cy: number, r: number) {
  return Array.from({ length: 10 }, (_, i) => {
    const a = (-90 + i * 36) * Math.PI / 180, rr = i % 2 ? r * 0.45 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}
const sparkle = (x: number, y: number, r: number) =>
  `M${x} ${y - r} L${x + r * .3} ${y - r * .3} L${x + r} ${y} L${x + r * .3} ${y + r * .3} L${x} ${y + r} L${x - r * .3} ${y + r * .3} L${x - r} ${y} L${x - r * .3} ${y - r * .3} Z`;

function GearLayer({ gear, eyes, pupilY }: { gear: string[]; eyes: number[]; pupilY: number }) {
  const gold = "#E8C14A", ink = "#2B1B3D", violet = "#8B6BF0", teal = "#2FB59A", orange = "#F2913B", rose = "#EF6F8E";
  const has = (id: string) => gear.includes(id);
  const last = eyes[eyes.length - 1];
  return (
    <g aria-hidden="true" className="gear">
      {/* hats */}
      {has("cap") && <>
        <path d="M30 27 Q50 6 70 27 Z" fill={teal} />
        <path d="M68 25 L90 27 L88 32 L68 30 Z" fill={teal} />
        <rect x="28" y="24" width="52" height="5" rx="2.5" fill={ink} opacity=".75" />
      </>}
      {has("crown") && <>
        <path d="M30 27 L33 10 L42 20 L50 5 L58 20 L67 10 L70 27 Z" fill={gold} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="33" cy="10" r="2.6" fill={rose} /><circle cx="50" cy="5" r="2.6" fill={rose} /><circle cx="67" cy="10" r="2.6" fill={rose} />
      </>}
      {has("wizard") && <>
        <path d="M34 27 L54 1 L68 27 Z" fill={violet} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
        <ellipse cx="51" cy="27" rx="23" ry="4" fill={violet} stroke={ink} strokeWidth="2" />
        <polygon points={starPoints(56, 15, 4)} fill={gold} />
      </>}
      {has("laurel") && <>
        <path d="M28 25 Q34 10 50 8 Q66 10 72 25" fill="none" stroke={teal} strokeWidth="3" strokeLinecap="round" />
        {[[32, 19, -50], [39, 12, -25], [61, 12, 25], [68, 19, 50]].map(([x, y, a]) =>
          <ellipse key={x} cx={x} cy={y} rx="5" ry="2.6" fill={teal} transform={`rotate(${a} ${x} ${y})`} />)}
      </>}
      {has("halo") && <ellipse cx="50" cy="7" rx="18" ry="5" fill="none" stroke={gold} strokeWidth="3" />}
      {/* eyes */}
      {has("glasses") && <>
        {eyes.map(x => <circle key={x} cx={x} cy="54" r="10.5" fill="none" stroke={ink} strokeWidth="2.5" />)}
        {eyes.slice(1).map((x, i) => <line key={x} x1={eyes[i] + 10.5} y1="54" x2={x - 10.5} y2="54" stroke={ink} strokeWidth="2.5" />)}
        <line x1={eyes[0] - 10.5} y1="54" x2="16" y2="50" stroke={ink} strokeWidth="2.5" />
        <line x1={last + 10.5} y1="54" x2="84" y2="50" stroke={ink} strokeWidth="2.5" />
      </>}
      {has("monocle") && <>
        <circle cx={last} cy="54" r="10.5" fill="none" stroke={gold} strokeWidth="2.5" />
        <path d={`M${last + 8} 61 Q${last + 16} 70 ${last + 12} 84`} fill="none" stroke={gold} strokeWidth="1.8" strokeDasharray="2 2" />
      </>}
      {has("stars") && eyes.map(x => <polygon key={x} points={starPoints(x, pupilY, 4.6)} fill={gold} />)}
      {/* held */}
      {has("pencil") && <g transform="rotate(-35 90 70)">
        <rect x="87" y="50" width="6" height="32" rx="1" fill={gold} />
        <rect x="87" y="50" width="6" height="4" fill={rose} />
        <path d="M87 82 L90 90 L93 82 Z" fill="#F6E7C8" />
        <path d="M89 87 L90 90 L91 87 Z" fill={ink} />
      </g>}
      {has("trophy") && <>
        <path d="M82 60 H96 V70 A7 7 0 0 1 82 70 Z" fill={gold} stroke={ink} strokeWidth="1.5" />
        <path d="M82 62 Q77 66 82 70 M96 62 Q100 66 96 70" fill="none" stroke={gold} strokeWidth="2.5" />
        <rect x="87" y="77" width="4" height="5" fill={gold} />
        <rect x="83" y="82" width="12" height="4" rx="1" fill={ink} />
      </>}
      {has("hammer") && <>
        <rect x="88" y="60" width="5" height="30" rx="2" fill="#B0703A" />
        <rect x="80" y="54" width="20" height="10" rx="2" fill={ink} />
      </>}
      {has("compass") && <>
        <circle cx="90" cy="72" r="8.5" fill="#fff" stroke={ink} strokeWidth="2" />
        <path d="M90 65 L92 72 L90 79 L88 72 Z" fill={rose} />
        <path d="M90 72 L92 72 L90 79 L88 72 Z" fill={ink} />
        <circle cx="90" cy="72" r="1.4" fill={ink} />
      </>}
      {/* trails */}
      {has("sparkles") && [[9, 58, 5], [13, 76, 4], [6, 92, 5]].map(([x, y, r]) =>
        <path key={x} d={sparkle(x, y, r)} fill={gold} />)}
      {has("numbers") && [[5, 63, "2"], [10, 81, "7"], [3, 97, "3"]].map(([x, y, t]) =>
        <text key={String(x)} x={x} y={y} fontSize="10" fontWeight="700" fontFamily="monospace" fill={violet}>{t}</text>)}
      {has("flames") && <>
        <path d="M22 100 Q23 88 30 90 Q31 82 36 88 Q41 84 42 100 Z" fill={orange} />
        <path d="M27 100 Q30 92 34 94 Q36 90 37 100 Z" fill={gold} />
        <path d="M58 100 Q60 90 66 92 Q68 86 72 90 Q77 88 78 100 Z" fill={orange} />
        <path d="M63 100 Q66 93 69 95 Q71 91 73 100 Z" fill={gold} />
      </>}
    </g>
  );
}
export { GEAR_IDS };

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
