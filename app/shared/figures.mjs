/* Figures and their text alternatives (spec 3.5.3).

   A question's `fig` / `figA` describes a coordinate-grid drawing: labelled
   points, an optional path and an optional polygon. The client draws it and
   labels the SVG with the same description this function produces, so what
   a screen reader hears is derived from the same data as what a sighted
   learner sees — the two cannot drift apart. The linter refuses a figure
   whose description would be generic ("Coordinate grid") because nothing in
   it is labelled: that is a picture with no alt text. */

const fmt = n => String(n).replace("-", "−");

export function figureAlt(spec) {
  if (!spec) return null;
  if (spec.alt) return String(spec.alt);
  const parts = [];
  const pts = (spec.pts || []).filter(p => p[2]);
  if (pts.length) parts.push(`points ${pts.map(p => `${p[2]} at (${fmt(p[0])}, ${fmt(p[1])})`).join("; ")}`);
  if (spec.path?.length > 1) parts.push(`a path from (${fmt(spec.path[0][0])}, ${fmt(spec.path[0][1])}) to (${fmt(spec.path.at(-1)[0])}, ${fmt(spec.path.at(-1)[1])}) in ${spec.path.length - 1} segment${spec.path.length === 2 ? "" : "s"}`);
  if (spec.poly?.length) parts.push(`a ${spec.poly.length}-sided shape with corners at ${spec.poly.map(p => `(${fmt(p[0])}, ${fmt(p[1])})`).join(", ")}`);
  return parts.length ? `Coordinate grid showing ${parts.join(", and ")}` : null;
}

/* True when the figure carries enough to describe itself. */
export const figureDescribable = spec => !!figureAlt(spec);
