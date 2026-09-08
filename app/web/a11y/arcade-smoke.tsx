/* Arcade smoke test — plays every game for real, in jsdom.

   Not a mock-fest: each game is mounted with react-dom/client, buttons are
   clicked via real DOM events, and assertions run against the resulting DOM.
   Along the way it captures post-interaction HTML snapshots, which the
   `snapshots` mode wraps in the built stylesheet for headless screenshots.

   Run: npm run smoke  (bundles with esbuild, then executes with node) */

import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`,
  { url: "http://localhost/", pretendToBeVisual: true });

/* React and friends expect these globals before they are imported. */
for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "Node",
                 "localStorage", "getComputedStyle", "CustomEvent", "Event", "MouseEvent",
                 "requestAnimationFrame", "cancelAnimationFrame"]) {
  if ((dom.window as any)[k] === undefined) continue;
  try {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  } catch { /* read-only global (e.g. navigator on newer Node) — skip */ }
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const failures: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures.push(msg); console.error(`  ✗ ${msg}`); }
}

const learner = { id: "smoke-learner", name: "Josiah", beast: "pip" };
const noop = () => {};
const snapshots: Record<string, string> = {};

function snap(name: string) {
  snapshots[name] = document.getElementById("root")!.innerHTML;
}

function click(el: Element | null | undefined, what: string) {
  if (!el) { failures.push(`could not find ${what} to click`); console.error(`  ✗ no element: ${what}`); return; }
  (el as HTMLElement).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

const byText = (sel: string, text: string) =>
  [...document.querySelectorAll(sel)].find(e => (e.textContent || "").includes(text));

async function main() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { Arcade } = await import("../src/screens/Arcade");
  const { Sprint } = await import("../src/games/Sprint");
  const { Match } = await import("../src/games/Match");
  const { Bonds } = await import("../src/games/Bonds");
  const { Fractions } = await import("../src/games/Fractions");
  const { Compare } = await import("../src/games/Compare");

  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const show = (el: React.ReactElement) => { root.render(el); return sleep(60); };

  /* ---------- hub ---------- */
  console.log("\nArcade hub");
  await show(<Arcade learner={learner as any} onBack={noop} />);
  ok(document.querySelectorAll(".gamecard").length === 5, "hub lists all five games");
  ok(!!document.querySelector(".arcadehero"), "hero banner renders");
  ok(!!document.querySelector(".soundbtn"), "sound toggle present");
  ok((document.body.textContent || "").includes("arcade star"), "star total shown");
  snap("hub");

  /* click through from the hub once, to prove the wiring */
  click(byText(".gamecard", "Bond Builder"), "Bond Builder card");
  await sleep(60);
  ok((document.body.textContent || "").includes("Pick your challenge"), "hub → level picker navigates");

  /* ---------- sprint ---------- */
  console.log("\nNumber Sprint");
  await show(<Sprint learner={learner as any} onArcade={noop} />);
  click(byText(".levelcard", "Explorer"), "Explorer level");
  await sleep(80);
  const q1 = document.querySelector(".sprintq")?.textContent || "";
  ok(/= \?/.test(q1), `question rendered (${q1.trim()})`);
  ok(document.querySelectorAll(".opts .opt").length === 4, "four answer options");
  const t = (document.querySelector(".timechip")?.textContent || "");
  ok(/⏱ \d+s/.test(t), `timer shown (${t.trim()})`);
  /* solve it properly: parse the expression and click the right option */
  const expr = q1.replace("= ?", "").trim().split(/\s+/);
  const ans = expr[1] === "+" ? Number(expr[0]) + Number(expr[2])
    : expr[1] === "−" ? Number(expr[0]) - Number(expr[2])
    : expr[1] === "×" ? Number(expr[0]) * Number(expr[2])
    : Number(expr[0]) / Number(expr[2]);
  const rightOpt = [...document.querySelectorAll(".opts .opt")]
    .find(o => (o.textContent || "").replace(/^[A-D]/, "").trim() === String(ans));
  ok(!!rightOpt, `the correct answer (${ans}) is among the options`);
  click(rightOpt, "correct sprint answer");
  await sleep(450);
  ok((document.querySelector(".scorechip")?.textContent || "").includes("⚡ 1"),
     "correct sprint answer scored a point");
  ok(/= \?/.test(document.querySelector(".sprintq")?.textContent || ""),
     "answering advances to a fresh question");
  snap("sprint");

  /* ---------- match ---------- */
  console.log("\nMath Match");
  await show(<Match learner={learner as any} onArcade={noop} />);
  click(byText(".levelcard", "Sprout"), "Sprout level");
  await sleep(80);
  const cards = document.querySelectorAll(".mcard");
  ok(cards.length === 12, `12 cards dealt (got ${cards.length})`);
  click(cards[0], "first card"); await sleep(80);
  click(cards[1], "second card"); await sleep(900);
  ok((document.body.textContent || "").includes("1 moves"), "move counter incremented");
  snap("match");

  /* ---------- bonds: play a whole game to the result card ---------- */
  console.log("\nBond Builder");
  await show(<Bonds learner={learner as any} onArcade={noop} />);
  click(byText(".levelcard", "Sprout"), "Sprout level");
  await sleep(80);
  for (let roundNo = 1; roundNo <= 10; roundNo++) {
    const target = Number(document.querySelector(".bondnum.target")?.textContent);
    const part = Number(document.querySelectorAll(".bondnum")[1]?.textContent);
    if (roundNo === 1) ok(target === 10, "sprout bonds build 10");
    const missing = target - part;
    const bubbles = [...document.querySelectorAll(".bubble")];
    if (roundNo === 1) ok(bubbles.length === 4, "four bubbles offered");
    const right = bubbles.find(b => b.textContent === String(missing));
    if (roundNo === 1) ok(!!right, `the correct bubble (${missing}) is among the choices`);
    click(right, "correct bubble");
    await sleep(600);
  }
  ok(!!document.querySelector(".gdone"), "ten rounds end on the result card");
  ok((document.body.textContent || "").includes("10/10"), "perfect game scores 10/10");
  ok(document.querySelectorAll(".starburst .lit").length === 3, "perfect game earns 3 stars");
  snap("bonds");

  /* persistence: the finished game was recorded for this learner */
  const saved = JSON.parse(dom.window.localStorage.getItem("mq-arcade-smoke-learner") || "null");
  ok(saved?.bonds?.plays === 1 && saved?.bonds?.best === 10 && saved?.bonds?.stars === 3,
     "finished game persisted (plays, best, stars)");

  /* ---------- fractions ---------- */
  console.log("\nFraction Feast");
  await show(<Fractions learner={learner as any} onArcade={noop} />);
  click(byText(".levelcard", "Sprout"), "Sprout level");
  await sleep(80);
  const slices = document.querySelectorAll(".pizza .slice").length;
  ok(slices === 2 || slices === 4, `pizza cut into ${slices} slices`);
  ok(document.querySelectorAll(".pizza .slice.eaten").length >= 1, "some slices eaten");
  ok(document.querySelectorAll(".fracbtn").length === 4, "four fraction choices");
  click(document.querySelector(".fracbtn"), "a fraction choice");
  await sleep(900);
  ok(!!document.querySelector(".fracbtn.right, .fracbtn.wrong") ||
     (document.querySelector(".scorechip")?.textContent || "").match(/⭐/),
     "answer was judged");
  snap("fractions");

  /* ---------- compare ---------- */
  console.log("\nMonster Compare");
  await show(<Compare learner={learner as any} onArcade={noop} />);
  click(byText(".levelcard", "Sprout"), "Sprout level");
  await sleep(80);
  const plates = [...document.querySelectorAll(".plate")];
  ok(plates.length === 2, "two plates served");
  const counts = plates.map(p => p.querySelectorAll(".berries i").length);
  ok(counts[0] > 0 && counts[1] > 0 && counts[0] !== counts[1],
     `berry piles differ (${counts[0]} vs ${counts[1]})`);
  click(plates[counts[0] > counts[1] ? 0 : 1], "the bigger pile");
  await sleep(600);
  ok((document.querySelector(".scorechip")?.textContent || "").includes("⭐ 1"),
     "feeding the monster the bigger pile scores");
  snap("compare");

  /* champion mode shows sign buttons — fresh key forces a remount,
     because re-rendering the same component type keeps the old game state */
  await show(<Compare key="champion" learner={learner as any} onArcade={noop} />);
  click(byText(".levelcard", "Champion"), "Champion level");
  await sleep(80);
  ok(document.querySelectorAll(".signbtn").length === 3, "champion mode offers < = >");

  root.unmount();

  /* ---------- snapshot html for screenshots ---------- */
  if (process.argv.includes("--shots")) {
    const assets = readdirSync(new URL("../dist/assets", import.meta.url));
    const cssFile = assets.find(f => f.endsWith(".css"))!;
    const css = readFileSync(new URL(`../dist/assets/${cssFile}`, import.meta.url), "utf8");
    for (const [name, html] of Object.entries(snapshots)) {
      const page = `<!doctype html><html data-band="junior"><head><meta charset="utf-8">
<title>arcade-${name}</title><style>${css}</style></head>
<body><div class="wrap" style="padding-top:24px">${html}</div></body></html>`;
      writeFileSync(new URL(`./shots-${name}.html`, import.meta.url), page);
    }
    console.log(`\nwrote ${Object.keys(snapshots).length} snapshot pages to a11y/shots-*.html`);
  }

  console.log(failures.length ? `\nFAILED: ${failures.length}` : "\nALL PASS");
  process.exit(failures.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
