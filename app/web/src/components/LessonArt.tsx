import { Beast, BEASTS } from "../beasts";

/* Small illustrated diagrams for the comic lessons. Deliberately simple SVG
   rather than imported art, so the visual language matches the rest of the
   app and there is nothing to license. */
export function LessonArt({ art }: { art: any }) {
  if (!art) return null;

  if (art.kind === "array") {
    const { rows, cols } = art;
    const cell = 30, pad = 14;
    const w = cols * cell + pad * 2, h = rows * cell + pad * 2;
    const dots = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        dots.push(<circle key={`${r}-${c}`} cx={pad + c * cell + cell / 2} cy={pad + r * cell + cell / 2}
                           r="10" fill="var(--accent)" />);
    return <svg viewBox={`0 0 ${w} ${h}`} width={Math.min(w, 260)} role="img"
                aria-label={`${rows} rows of ${cols}`}>{dots}</svg>;
  }

  if (art.kind === "bar") {
    const { parts, filled } = art;
    const w = 260, h = 60, seg = w / parts;
    const segs = Array.from({ length: parts }, (_, i) => (
      <rect key={i} x={i * seg + 2} y={4} width={seg - 4} height={h - 8} rx="8"
            fill={i < filled ? "var(--accent)" : "var(--chip)"}
            stroke="var(--line-strong)" strokeWidth="2" />
    ));
    return <svg viewBox={`0 0 ${w} ${h}`} width={260} role="img"
                aria-label={`${filled} of ${parts} parts shaded`}>{segs}</svg>;
  }

  if (art.kind === "compare") {
    const { left, right } = art;
    const bar = (n: number, y: number) => {
      const w = 220, seg = w / n;
      return Array.from({ length: n }, (_, i) => (
        <rect key={i} x={i * seg + 1} y={y} width={seg - 2} height="22" rx="5"
              fill="var(--accent)" opacity={0.35 + 0.65 * (1 / n)}
              stroke="var(--line-strong)" strokeWidth="1.5" />
      ));
    };
    return <svg viewBox="0 0 220 60" width={220} role="img"
                aria-label={`comparing pieces cut into ${left} versus ${right}`}>
      {bar(left, 4)}{bar(right, 34)}
    </svg>;
  }

  return null;
}
