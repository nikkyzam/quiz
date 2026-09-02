/* Run a subset of checks while developing, without the full suite.
   Usage: node requirements/run-check.mjs <check-id> [<check-id> ...] */
import { CHECKS, withServer } from "./checks.mjs";

const ids = process.argv.slice(2);
if (!ids.length) { console.error("usage: node requirements/run-check.mjs <check-id>..."); process.exit(2); }
for (const id of ids) if (!CHECKS[id]) { console.error(`unknown check "${id}"`); process.exit(2); }

let failed = 0;
await withServer(async () => {
  for (const id of ids) {
    const t0 = Date.now();
    try {
      const detail = await CHECKS[id]();
      console.log(`PASS  ${id.padEnd(22)} ${detail}  (${Date.now() - t0}ms)`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${id.padEnd(22)} ${e.message}`);
      if (process.env.STACK) console.log(e.stack);
    }
  }
});
process.exit(failed ? 1 : 0);
