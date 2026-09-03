/* Lesson scenes (spec 3.2.1, 8.2). Every art kind registered in
   app/shared/assets.mjs is drawn here in code, so a panel's `art` object is
   a description rather than a file: the same numbers render at any size, in
   both themes, and the ALT text the author wrote stays in step with what is
   shown. Colours come only from the design tokens. */

type P = Record<string, any>;

const INK = "var(--ink)";
const MUTED = "var(--muted)";
const LINE = "var(--line-strong, var(--line))";
const ACCENT = "var(--accent)";
const SOFT = "var(--accent-soft)";
const GOOD = "var(--good)";
const BAD = "var(--bad)";
const STAR = "var(--star)";
const CARD = "var(--card)";
const CHIP = "var(--chip)";
const FONT = "600 14px var(--display)";
const BIG = "600 20px var(--display)";

function Apple({ x, y, r = 9 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={BAD} />
      <path d={`M${x} ${y - r} q1 -5 4 -6`} stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
      <ellipse cx={x + 5} cy={y - r - 2} rx="4" ry="2.2" fill={GOOD} transform={`rotate(-25 ${x + 5} ${y - r - 2})`} />
    </g>
  );
}

function Basket({ x, y, w, apples, label }: { x: number; y: number; w: number; apples: number; label?: string }) {
  /* apples sit in rows of up to five inside the rim */
  const perRow = Math.max(1, Math.min(5, Math.floor((w - 20) / 22)));
  const dots = Array.from({ length: apples }, (_, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const inRow = Math.min(perRow, apples - row * perRow);
    const start = x + w / 2 - ((inRow - 1) * 22) / 2;
    return <Apple key={i} x={start + col * 22} y={y - 6 - row * 20} />;
  });
  return (
    <g>
      <path d={`M${x} ${y} L${x + 12} ${y + 44} L${x + w - 12} ${y + 44} L${x + w} ${y} Z`} fill={STAR} />
      {dots}
      <rect x={x - 4} y={y - 4} width={w + 8} height="12" rx="6" fill={STAR} stroke={INK} strokeWidth="2" />
      <path d={`M${x + 14} ${y + 12} L${x + 22} ${y + 44} M${x + w - 14} ${y + 12} L${x + w - 22} ${y + 44} M${x + w / 2} ${y + 12} L${x + w / 2} ${y + 44}`}
            stroke={INK} strokeWidth="1.5" opacity=".35" />
      {label && <text x={x + w / 2} y={y + 66} textAnchor="middle" fill={INK} style={{ font: BIG }}>{label}</text>}
    </g>
  );
}

function Baskets({ left = 0, right = 0, merge = false }: P) {
  if (merge) {
    return (
      <>
        <Basket x={90} y={110} w={140} apples={left + right} label={`${left} + ${right} = ${left + right}`} />
      </>
    );
  }
  return (
    <>
      <Basket x={30} y={110} w={110} apples={left} label={String(left)} />
      <text x="160" y="140" textAnchor="middle" fill={ACCENT} style={{ font: "600 28px var(--display)" }}>+</text>
      <Basket x={180} y={110} w={110} apples={right} label={String(right)} />
    </>
  );
}

function Fingers({ n = 5 }: P) {
  const raised = Math.max(0, Math.min(5, Number(n)));
  /* thumb first, then four fingers; a folded finger is drawn short */
  const fingers = [
    { x: 92, top: 96, w: 22, angle: -30 },
    { x: 128, top: 40, w: 22, angle: 0 },
    { x: 154, top: 28, w: 22, angle: 0 },
    { x: 180, top: 34, w: 22, angle: 0 },
    { x: 206, top: 52, w: 20, angle: 0 }
  ];
  return (
    <>
      <rect x="118" y="100" width="112" height="90" rx="26" fill={STAR} stroke={INK} strokeWidth="2.5" />
      {fingers.map((f, i) => {
        const up = i < raised;
        if (i === 0 && !up) return null;
        const top = up ? f.top : 92;
        return (
          <rect key={i} x={f.x} y={top} width={f.w} height={i === 0 ? 60 : 120 - top + 20} rx="11"
                fill={STAR} stroke={INK} strokeWidth="2.5"
                transform={i === 0 ? `rotate(${f.angle} ${f.x + 11} 150)` : undefined} />
        );
      })}
      <rect x="120" y="102" width="108" height="86" rx="24" fill={STAR} />
      <text x="290" y="120" textAnchor="middle" fill={ACCENT} style={{ font: "600 44px var(--display)" }}>{raised}</text>
    </>
  );
}

function Rods({ tens = 0, ones = 0, label = false }: P) {
  const t = Math.max(0, Math.min(9, Number(tens)));
  const o = Math.max(0, Math.min(19, Number(ones)));
  const rodW = 18, cube = 11;
  const rods = Array.from({ length: t }, (_, i) => (
    <g key={i}>
      <rect x={24 + i * (rodW + 8)} y={40} width={rodW} height={cube * 10} fill={ACCENT} stroke={INK} strokeWidth="1.5" />
      {Array.from({ length: 9 }, (_, k) => (
        <line key={k} x1={24 + i * (rodW + 8)} y1={40 + (k + 1) * cube} x2={24 + i * (rodW + 8) + rodW} y2={40 + (k + 1) * cube}
              stroke={INK} strokeWidth="1" opacity=".5" />
      ))}
    </g>
  ));
  const onesX = 24 + t * (rodW + 8) + 28;
  const cubes = Array.from({ length: o }, (_, i) => {
    const col = Math.floor(i / 5), row = i % 5;
    const snap = o >= 10 && i < 10;
    return (
      <rect key={i} x={onesX + col * (cube + 5)} y={150 - row * (cube + 4)} width={cube} height={cube}
            fill={snap ? SOFT : GOOD} stroke={snap ? ACCENT : INK} strokeWidth="1.5"
            strokeDasharray={snap ? "2 2" : undefined} />
    );
  });
  return (
    <>
      <line x1="16" y1="152" x2="304" y2="152" stroke={LINE} strokeWidth="2" />
      {rods}
      {cubes}
      {o >= 10 && (
        <rect x={onesX - 4} y={150 - 4 * (cube + 4) - 4} width={2 * (cube + 5) + 3} height={5 * (cube + 4) + 4} rx="4"
              fill="none" stroke={ACCENT} strokeWidth="2" strokeDasharray="4 3" />
      )}
      {label && (
        <>
          <text x={24 + (t * (rodW + 8) - 8) / 2} y="180" textAnchor="middle" fill={ACCENT} style={{ font: BIG }}>{t * 10}</text>
          <text x={onesX + 14} y="180" textAnchor="middle" fill={GOOD} style={{ font: BIG }}>{o}</text>
          <text x="290" y="180" textAnchor="end" fill={INK} style={{ font: BIG }}>= {t * 10 + o}</text>
        </>
      )}
    </>
  );
}

function Cookie({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="12" fill={STAR} stroke={INK} strokeWidth="1.5" />
      <circle cx={x - 4} cy={y - 3} r="2" fill={INK} />
      <circle cx={x + 4} cy={y + 2} r="2" fill={INK} />
      <circle cx={x - 1} cy={y + 6} r="1.6" fill={INK} />
    </g>
  );
}

function ArrayScene({ rows = 1, cols = 1, rowsum = false, turn = false }: P) {
  const r = Math.max(1, Math.min(6, Number(rows))), c = Math.max(1, Math.min(8, Number(cols)));
  const gap = 32;
  const w = c * gap, h = r * gap;
  const x0 = (rowsum ? 120 : 160) - w / 2 + gap / 2, y0 = 100 - h / 2 + gap / 2;
  return (
    <>
      <rect x={x0 - gap / 2 - 6} y={y0 - gap / 2 - 6} width={w + 12} height={h + 12} rx="10" fill={CHIP} stroke={LINE} strokeWidth="2" />
      {Array.from({ length: r * c }, (_, i) => (
        <Cookie key={i} x={x0 + (i % c) * gap} y={y0 + Math.floor(i / c) * gap} />
      ))}
      {rowsum && Array.from({ length: r }, (_, i) => (
        <text key={i} x={x0 + w + 4} y={y0 + i * gap + 5} fill={ACCENT} style={{ font: FONT }}>
          {i === 0 ? "" : "+ "}{c}
        </text>
      ))}
      {rowsum && (
        <text x={x0 + w + 4} y={y0 + r * gap + 2} fill={INK} style={{ font: BIG }}>= {r * c}</text>
      )}
      {turn && (
        <path d="M262 56 a 30 30 0 1 1 -12 40 M250 96 l 4 -12 l 10 8" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      )}
      <text x="160" y="190" textAnchor="middle" fill={MUTED} style={{ font: FONT }}>{r} rows of {c}</text>
    </>
  );
}

function Pizza({ slices = 4, shaded = 0 }: P) {
  const n = Math.max(1, Math.min(16, Number(slices)));
  const k = Math.max(0, Math.min(n, Number(shaded)));
  const cx = 120, cy = 100, R = 78;
  const wedge = (i: number) => {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const large = 1 / n > 0.5 ? 1 : 0;
    return `M${cx} ${cy} L${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
  };
  return (
    <>
      <circle cx={cx} cy={cy} r={R + 6} fill={STAR} />
      <circle cx={cx} cy={cy} r={R} fill={CARD} />
      {Array.from({ length: n }, (_, i) => (
        <path key={i} d={n === 1 ? "" : wedge(i)} fill={i < k ? ACCENT : CARD} stroke={INK} strokeWidth="2" />
      ))}
      {n === 1 && <circle cx={cx} cy={cy} r={R} fill={k ? ACCENT : CARD} stroke={INK} strokeWidth="2" />}
      <text x="250" y="92" textAnchor="middle" fill={INK} style={{ font: "600 34px var(--display)" }}>{k}</text>
      <line x1="222" y1="102" x2="278" y2="102" stroke={INK} strokeWidth="3" />
      <text x="250" y="136" textAnchor="middle" fill={INK} style={{ font: "600 34px var(--display)" }}>{n}</text>
    </>
  );
}

function GridRect({ w = 1, h = 1, count = false, perimeter = false }: P) {
  const W = Math.max(1, Math.min(10, Number(w))), H = Math.max(1, Math.min(8, Number(h)));
  const cell = Math.min(28, 260 / W, 150 / H);
  const x0 = 160 - (W * cell) / 2, y0 = 96 - (H * cell) / 2;
  return (
    <>
      {Array.from({ length: W * H }, (_, i) => {
        const cx = x0 + (i % W) * cell, cy = y0 + Math.floor(i / W) * cell;
        return (
          <g key={i}>
            <rect x={cx} y={cy} width={cell} height={cell} fill={SOFT} stroke={LINE} strokeWidth="1.5" />
            {count && <text x={cx + cell / 2} y={cy + cell / 2 + 4} textAnchor="middle" fill={INK}
                            style={{ font: `600 ${Math.round(cell * 0.42)}px var(--mono)` }}>{i + 1}</text>}
          </g>
        );
      })}
      <rect x={x0} y={y0} width={W * cell} height={H * cell} fill="none"
            stroke={perimeter ? BAD : INK} strokeWidth={perimeter ? 5 : 2} />
      <text x={x0 + (W * cell) / 2} y={y0 - 8} textAnchor="middle" fill={MUTED} style={{ font: FONT }}>{W}</text>
      <text x={x0 - 8} y={y0 + (H * cell) / 2 + 5} textAnchor="end" fill={MUTED} style={{ font: FONT }}>{H}</text>
      <text x="160" y="190" textAnchor="middle" fill={INK} style={{ font: FONT }}>
        {perimeter ? `perimeter ${W} + ${H} + ${W} + ${H} = ${2 * (W + H)}` : `${W} × ${H} = ${W * H} squares`}
      </text>
    </>
  );
}

export function Plane({ pts = [], path, min = -5, max = 5, pick }: P) {
  const lo = Number(min), hi = Number(max);
  const span = hi - lo;
  const size = 180, ox = 160 - size / 2, oy = 100 - size / 2;
  const sx = (x: number) => ox + ((x - lo) / span) * size;
  const sy = (y: number) => oy + ((hi - y) / span) * size;
  const ticks = Array.from({ length: span + 1 }, (_, i) => lo + i);
  return (
    <>
      {ticks.map(t => (
        <g key={t}>
          <line x1={sx(t)} y1={oy} x2={sx(t)} y2={oy + size} stroke={LINE} strokeWidth="1" />
          <line x1={ox} y1={sy(t)} x2={ox + size} y2={sy(t)} stroke={LINE} strokeWidth="1" />
        </g>
      ))}
      <line x1={ox} y1={sy(0)} x2={ox + size} y2={sy(0)} stroke={MUTED} strokeWidth="2" />
      <line x1={sx(0)} y1={oy} x2={sx(0)} y2={oy + size} stroke={MUTED} strokeWidth="2" />
      <text x={ox + size + 6} y={sy(0) + 4} fill={MUTED} style={{ font: "600 12px var(--mono)" }}>x</text>
      <text x={sx(0) - 4} y={oy - 4} textAnchor="end" fill={MUTED} style={{ font: "600 12px var(--mono)" }}>y</text>
      {[lo, hi].map(t => (
        <g key={"lab" + t}>
          <text x={sx(t)} y={sy(0) + 14} textAnchor="middle" fill={MUTED} style={{ font: "11px var(--mono)" }}>{t}</text>
          <text x={sx(0) - 5} y={sy(t) + 4} textAnchor="end" fill={MUTED} style={{ font: "11px var(--mono)" }}>{t}</text>
        </g>
      ))}
      {Array.isArray(path) && path.length > 1 && (
        <polyline points={path.map((p: number[]) => `${sx(p[0])},${sy(p[1])}`).join(" ")}
                  fill="none" stroke={ACCENT} strokeWidth="3" strokeDasharray="6 5" />
      )}
      {(pts as any[]).map((p, i) => (
        <g key={i}>
          <circle cx={sx(p[0])} cy={sy(p[1])} r="6" fill={ACCENT} stroke={CARD} strokeWidth="2" />
          {p[2] && <text x={sx(p[0]) + 9} y={sy(p[1]) - 8} fill={INK} style={{ font: "600 13px var(--mono)" }}>
            {p[2]} ({p[0]}, {p[1]})</text>}
        </g>
      ))}
      {Array.isArray(pick) && pick.length === 2 && (
        <g>
          <circle cx={sx(pick[0])} cy={sy(pick[1])} r="8" fill={GOOD} stroke={CARD} strokeWidth="2" />
          <line x1={sx(pick[0]) - 12} y1={sy(pick[1])} x2={sx(pick[0]) + 12} y2={sy(pick[1])} stroke={GOOD} strokeWidth="2" />
          <line x1={sx(pick[0])} y1={sy(pick[1]) - 12} x2={sx(pick[0])} y2={sy(pick[1]) + 12} stroke={GOOD} strokeWidth="2" />
        </g>
      )}
    </>
  );
}

function Lemon({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx="14" ry="10" fill={STAR} stroke={INK} strokeWidth="1.5" transform={`rotate(-20 ${x} ${y})`} />
      <ellipse cx={x + 12} cy={y - 8} rx="4" ry="2.5" fill={GOOD} transform={`rotate(-30 ${x + 12} ${y - 8})`} />
    </g>
  );
}

function Cup({ x, y, lemonade }: { x: number; y: number; lemonade?: boolean }) {
  return (
    <g>
      <path d={`M${x} ${y} L${x + 4} ${y + 34} L${x + 22} ${y + 34} L${x + 26} ${y} Z`} fill={CARD} stroke={INK} strokeWidth="1.5" />
      <path d={`M${x + 1.5} ${y + 12} L${x + 4} ${y + 34} L${x + 22} ${y + 34} L${x + 24.5} ${y + 12} Z`}
            fill={lemonade ? STAR : ACCENT} opacity=".8" />
    </g>
  );
}

function Jugs({ lemons = 0, water = 0, price }: P) {
  const L = Math.max(0, Math.min(12, Number(lemons))), W = Math.max(0, Math.min(12, Number(water)));
  const hasPrice = price !== undefined && price !== null;
  const lemonRow = (i: number) => ({ x: 40 + (i % 4) * 32, y: 60 + Math.floor(i / 4) * 30 });
  const cupRow = (i: number) => ({ x: 176 + (i % 4) * 32, y: 40 + Math.floor(i / 4) * 42 });
  return (
    <>
      {!hasPrice && Array.from({ length: L }, (_, i) => <Lemon key={i} {...lemonRow(i)} />)}
      {!hasPrice && Array.from({ length: W }, (_, i) => <Cup key={i} {...cupRow(i)} />)}
      {!hasPrice && (
        <>
          <text x="86" y="176" textAnchor="middle" fill={INK} style={{ font: BIG }}>{L} lemon{L === 1 ? "" : "s"}</text>
          <text x="160" y="176" textAnchor="middle" fill={ACCENT} style={{ font: BIG }}>:</text>
          <text x="236" y="176" textAnchor="middle" fill={INK} style={{ font: BIG }}>{W} cup{W === 1 ? "" : "s"}</text>
        </>
      )}
      {hasPrice && (
        <>
          {Array.from({ length: L }, (_, i) => <Cup key={i} x={60 + i * 44} y={70} lemonade />)}
          <rect x="216" y="60" width="80" height="54" rx="10" fill={CHIP} stroke={STAR} strokeWidth="3" />
          <circle cx="226" cy="70" r="4" fill={STAR} />
          <text x="256" y="96" textAnchor="middle" fill={INK} style={{ font: BIG }}>{price} coins</text>
          <text x="160" y="160" textAnchor="middle" fill={MUTED} style={{ font: FONT }}>
            {L} cups for {price} coins is {Number(price) / (L || 1)} coins each
          </text>
        </>
      )}
    </>
  );
}

function Groups({ groups = 1, each = 1, times = false, turn = false }: P) {
  const g = Math.max(1, Math.min(8, Number(groups))), e = Math.max(1, Math.min(12, Number(each)));
  const cols = g > 4 ? Math.ceil(g / 2) : g;
  const rows = Math.ceil(g / cols);
  const boxW = Math.min(80, 280 / cols), boxH = Math.min(70, 130 / rows);
  const inner = Math.ceil(Math.sqrt(e));
  const dot = Math.min(10, (boxW - 12) / inner, (boxH - 12) / inner);
  const x0 = 160 - (cols * (boxW + 8)) / 2, y0 = (times ? 50 : 34) + (2 - rows) * (boxH / 2);
  return (
    <>
      {times && (
        <text x="160" y="30" textAnchor="middle" fill={INK} style={{ font: "600 24px var(--display)" }}>
          {g} × {e} = {g * e}
        </text>
      )}
      {Array.from({ length: g }, (_, i) => {
        const bx = x0 + (i % cols) * (boxW + 8), by = y0 + Math.floor(i / cols) * (boxH + 8);
        return (
          <g key={i}>
            <rect x={bx} y={by} width={boxW} height={boxH} rx="10" fill={CHIP} stroke={turn ? ACCENT : LINE} strokeWidth="2" />
            {Array.from({ length: e }, (_, k) => (
              <circle key={k} cx={bx + 8 + dot / 2 + (k % inner) * dot} cy={by + 8 + dot / 2 + Math.floor(k / inner) * dot}
                      r={dot * 0.36} fill={ACCENT} />
            ))}
          </g>
        );
      })}
      <text x="160" y="190" textAnchor="middle" fill={MUTED} style={{ font: FONT }}>{g} groups of {e}</text>
    </>
  );
}

function Celebrate({ stars = 3 }: P) {
  const n = Math.max(0, Math.min(5, Number(stars)));
  const star = (cx: number, cy: number, r: number) =>
    Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      return `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
    }).join(" ");
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const cx = 160 + (i - (n - 1) / 2) * 52, cy = 42 + (i % 2) * 10;
        return <polygon key={i} points={star(cx, cy, 18)} fill={STAR} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />;
      })}
      {/* a small original creature, arms up */}
      <path d="M118 128 L98 104 M202 128 L222 104" stroke={ACCENT} strokeWidth="9" strokeLinecap="round" />
      <path d="M130 88 L138 66 L148 88 M172 88 L182 66 L190 88" fill={ACCENT} />
      <rect x="120" y="86" width="80" height="72" rx="30" fill={ACCENT} />
      <ellipse cx="160" cy="132" rx="26" ry="16" fill={CARD} opacity=".22" />
      <circle cx="146" cy="116" r="8" fill={CARD} /><circle cx="174" cy="116" r="8" fill={CARD} />
      <circle cx="146" cy="117" r="4" fill={INK} /><circle cx="174" cy="117" r="4" fill={INK} />
      <path d="M144 134 Q160 150 176 134" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="80" cy="150" r="5" fill={GOOD} /><circle cx="248" cy="140" r="5" fill={BAD} />
      <circle cx="62" cy="96" r="4" fill={ACCENT} /><circle cx="262" cy="80" r="4" fill={GOOD} />
      <line x1="60" y1="176" x2="260" y2="176" stroke={LINE} strokeWidth="3" strokeLinecap="round" />
    </>
  );
}

const SCENES: Record<string, (p: P) => JSX.Element> = {
  baskets: Baskets, fingers: Fingers, rods: Rods, array: ArrayScene, pizza: Pizza,
  "grid-rect": GridRect, plane: Plane, jugs: Jugs, groups: Groups, celebrate: Celebrate
};

export const LESSON_ART_KINDS = Object.keys(SCENES);

export function LessonArt({ kind, props, alt }: { kind: string; props?: any; alt: string }) {
  const Scene = SCENES[kind];
  return (
    <svg className="lessonart" viewBox="0 0 320 200" role="img" aria-label={alt}
         xmlns="http://www.w3.org/2000/svg">
      <title>{alt}</title>
      <rect x="0" y="0" width="320" height="200" rx="18" fill={CHIP} />
      {Scene ? <Scene {...(props || {})} /> : (
        <text x="160" y="106" textAnchor="middle" fill={MUTED} style={{ font: FONT }}>picture coming soon</text>
      )}
    </svg>
  );
}
