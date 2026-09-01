/* Runs axe-core over the real rendered markup of each screen.
   Returns { screen: violations[] } — empty means WCAG 2.1 A/AA clean. */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { SCREENS } from "./render.mjs";

const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

export async function auditAll() {
  const out = {};
  for (const [name, html] of Object.entries(SCREENS)) {
    const dom = new JSDOM(
      `<!doctype html><html lang="en"><head><title>Math Quest</title><style>${css}</style></head><body>${html}</body></html>`,
      { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" }
    );
    dom.window.eval(axeSource);
    const results = await dom.window.axe.run(dom.window.document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      // jsdom cannot compute layout, so colour-contrast is checked separately
      // by requirements/checks.mjs against the token palette directly.
      rules: { "color-contrast": { enabled: false } }
    });
    out[name] = results.violations.map(v => ({
      id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.slice(0, 3).map(n => n.html.slice(0, 120))
    }));
    dom.window.close();
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await auditAll();
  let total = 0;
  for (const [screen, vs] of Object.entries(r)) {
    console.log(`\n${screen}: ${vs.length ? vs.length + " violation(s)" : "clean"}`);
    vs.forEach(v => { total++; console.log(`  [${v.impact}] ${v.id} — ${v.help}`); v.nodes.forEach(n => console.log(`      ${n}`)); });
  }
  console.log(`\nTOTAL: ${total}`);
  process.exit(total ? 1 : 0);
}
