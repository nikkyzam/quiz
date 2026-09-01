/* Error analysis (spec 7.5).

   Classifies a wrong answer into a named mistake type, so remediation can
   target the misconception rather than just the topic. Rules are ordered:
   the first that matches wins, and anything unmatched is reported as
   "unclassified" rather than forced into a category. */

const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const num = v => {
  const n = parseFloat(String(v).replace(/−/g, "-").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
};

export const CATEGORIES = {
  sign_error:        "Sign error — right size, wrong direction",
  reversed_pair:     "Coordinates reversed — (y, x) instead of (x, y)",
  place_value:       "Place value — out by a factor of ten",
  off_by_one:        "Off by one",
  operation_swap:    "Wrong operation — added instead of multiplied, or similar",
  partial_selection: "Incomplete selection — some correct options missed",
  over_selection:    "Over-selection — correct options plus extras",
  order_reversed:    "Ordering reversed — smallest-to-largest the wrong way round",
  order_adjacent:    "Ordering nearly right — two neighbours swapped",
  blank:             "No answer given",
  unclassified:      "Not a recognised pattern"
};

export function classify(q, raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "" ||
      (Array.isArray(raw) && raw.length === 0)) return "blank";

  if (q.type === "pair") {
    const p = String(raw).replace(/−/g, "-").replace(/[^0-9.,\-]/g, "").split(",").filter(Boolean).map(Number);
    if (p.length === 2) {
      const [x, y] = q.ansP;
      if (near(p[0], y) && near(p[1], x) && !(near(x, y))) return "reversed_pair";
      if (near(Math.abs(p[0]), Math.abs(x)) && near(Math.abs(p[1]), Math.abs(y))) return "sign_error";
    }
    return "unclassified";
  }

  if (q.type === "in") {
    const got = num(raw), want = q.ans;
    if (got === null) return "unclassified";
    if (near(got, -want) && want !== 0) return "sign_error";
    if (want !== 0 && (near(got, want * 10) || near(got, want / 10))) return "place_value";
    if (near(Math.abs(got - want), 1)) return "off_by_one";
    return "unclassified";
  }

  if (q.type === "multi") {
    const got = new Set((Array.isArray(raw) ? raw : []).map(Number));
    const want = new Set(q.aMulti);
    const missing = [...want].filter(i => !got.has(i));
    const extra = [...got].filter(i => !want.has(i));
    if (missing.length && !extra.length) return "partial_selection";
    if (!missing.length && extra.length) return "over_selection";
    return "unclassified";
  }

  if (q.type === "order") {
    const got = (Array.isArray(raw) ? raw : []).map(String);
    const want = q.ansOrder;
    if (got.length !== want.length) return "unclassified";
    if (got.join("|") === [...want].reverse().join("|")) return "order_reversed";
    const wrong = got.filter((v, i) => v !== want[i]);
    if (wrong.length === 2) return "order_adjacent";
    return "unclassified";
  }

  if (q.type === "mc") {
    const picked = Number(raw);
    const chosen = q.opts?.[picked];
    const correct = q.opts?.[q.a];
    if (chosen && correct) {
      const c = num(chosen), r = num(correct);
      if (c !== null && r !== null) {
        if (near(c, -r) && r !== 0) return "sign_error";
        if (r !== 0 && (near(c, r * 10) || near(c, r / 10))) return "place_value";
      }
      // a reversed ratio like "6 : 4" for "4 : 6"
      const rev = s => String(s).split(/\s*:\s*/).reverse().join(" : ");
      if (rev(chosen) === String(correct)) return "operation_swap";
    }
    return "unclassified";
  }
  return "unclassified";
}

/* Roll a set of recorded mistakes into a report, commonest first. */
export function summarise(mistakes) {
  const counts = {};
  for (const m of mistakes) counts[m.category] = (counts[m.category] || 0) + 1;
  return Object.entries(counts)
    .map(([category, count]) => ({ category, label: CATEGORIES[category] || category, count }))
    .sort((a, b) => b.count - a.count);
}
