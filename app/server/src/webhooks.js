/* Outbound webhooks (spec 9.2).

   Lets a school's own systems react to what happens here — a learner reaching
   mastery, a contest being sat — without polling the API on a timer.

   The security problem this creates is worth stating plainly, because it is
   the whole reason most of this file exists. A webhook is a URL supplied by a
   user that the SERVER then fetches. Unguarded, that is a request forgery
   primitive: point it at 127.0.0.1 or 169.254.169.254 and the server will
   dutifully fetch an internal admin page or a cloud metadata endpoint from
   inside the network perimeter, and report back what it found. So the
   destination is checked against its RESOLVED address, not its hostname —
   a name under the registrant's control can point anywhere, and re-reading
   the hostname proves nothing about where the packet goes. */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { db, now } from "./db.js";

export const EVENTS = ["mastery.achieved", "contest.completed", "assignment.created"];

/* Local and internal destinations are refused unless explicitly allowed, which
   exists so the delivery path itself can be tested against a local receiver.
   It is never set in the deploy configs. */
const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === "1";

function isPrivateAddress(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd")) return true;   // unique local
    if (v.startsWith("fe80")) return true;                        // link local
    /* IPv4 mapped into IPv6 hides a private v4 address behind a v6 literal. */
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n))) return true;  // unparseable: refuse
  if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 169 && p[1] === 254) return true;   // link local, incl. cloud metadata
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;  // carrier NAT
  if (p[0] >= 224) return true;                    // multicast and reserved
  return false;
}

/* Returns { ok, address } or { ok:false, error }. `address` is the specific
   resolved IP that passed the check, and delivery is pinned to it — see
   deliver(). Returning it is what closes the gap between checking and
   connecting. */
export async function validateTarget(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl)); }
  catch { return { ok: false, error: "that is not a valid URL" }; }

  if (url.protocol !== "https:" && !(allowPrivate() && url.protocol === "http:"))
    return { ok: false, error: "webhook URLs must use https" };

  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    return { ok: false, error: "that host could not be resolved" };
  }
  if (!addresses.length) return { ok: false, error: "that host could not be resolved" };

  /* EVERY resolved address must be public. A name resolving to one public and
     one private address is not a partly-safe destination; it is a bypass. */
  if (!allowPrivate()) {
    const bad = addresses.find(a => isPrivateAddress(a.address));
    if (bad) return { ok: false, error: `that host resolves to a private address (${bad.address}) and cannot be reached from here` };
  }
  return { ok: true, address: addresses[0].address };
}

export async function register({ url, events, createdBy }) {
  /* Validated here, not only at the route. A function that persists a URL the
     server will later fetch has to be safe on its own terms — otherwise the
     guard depends on every caller remembering to call two things in the right
     order, and the one that forgets is the one that matters. */
  const target = await validateTarget(url);
  if (!target.ok) return { ok: false, error: target.error };
  const chosen = (Array.isArray(events) ? events : []).filter(e => EVENTS.includes(e));
  if (!chosen.length) return { ok: false, error: `events must include at least one of: ${EVENTS.join(", ")}` };
  const id = randomUUID();
  /* The secret is generated here and shown exactly once. A caller-supplied
     secret is usually a password someone already uses somewhere else. */
  const secret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  db.prepare(`INSERT INTO webhooks (id, url, secret, events, created_by, active, created_at)
              VALUES (?,?,?,?,?,1,?)`)
    .run(id, url, secret, JSON.stringify(chosen), createdBy || null, now());
  return { ok: true, webhook: { id, url, events: chosen, secret } };
}

export const sign = (secret, body) => createHmac("sha256", secret).update(body).digest("hex");

/* Constant-time comparison, exported so a receiver in this codebase — and the
   check — verifies the way a real one should rather than with ===. */
export function verify(secret, body, signature) {
  const expected = Buffer.from(sign(secret, body), "utf8");
  const given = Buffer.from(String(signature || ""), "utf8");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/* Deliver an event to every subscriber. Never throws and never blocks the
   request that caused it: a school's broken endpoint must not fail a child's
   round. Failures are recorded so they can be seen rather than guessed at. */
export async function emit(event, payload) {
  if (!EVENTS.includes(event)) return { delivered: 0 };
  const hooks = db.prepare("SELECT * FROM webhooks WHERE active = 1").all()
    .filter(h => { try { return JSON.parse(h.events).includes(event); } catch { return false; } });
  if (!hooks.length) return { delivered: 0 };

  const body = JSON.stringify({ event, at: now(), data: payload });

  /* Delivered concurrently. Sequentially, a handful of unreachable endpoints
     cost their timeouts one after another — five dead subscribers meant
     twenty-five seconds of wall clock for a single event — and the
     deliveries have nothing to do with each other. */
  const results = await Promise.allSettled(hooks.map(hook => deliver(hook, event, body)));
  const delivered = results.filter(r => r.status === "fulfilled" && r.value).length;
  return { delivered, attempted: hooks.length };
}

/* POST to `url`, but over a socket pinned to `address`.

   This is the difference between checking a destination and reaching the one
   that was checked. `fetch(url)` performs its own DNS lookup, so a name with
   a short TTL can answer the validation with a public address and the actual
   connection with 169.254.169.254 — the guard passes and the request still
   goes to the metadata service. Supplying `lookup` forces the connection to
   the address that was just approved, while the URL's hostname still drives
   SNI and certificate verification, so TLS is unaffected.

   Redirects are not followed: node's client does not follow them on its own,
   and a 3xx simply falls outside the 2xx success range. Following one would
   reopen the hole from the other end, since the new location is a destination
   nothing validated. */
function postPinned(url, address, body, headers, timeoutMs = 5000) {
  const u = new URL(url);
  const send = u.protocol === "https:" ? httpsRequest : httpRequest;
  const family = isIP(address);
  return new Promise((resolve, reject) => {
    const req = send(url, {
      method: "POST",
      headers: { ...headers, "content-length": Buffer.byteLength(body) },
      lookup: (_hostname, opts, cb) =>
        (opts && opts.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      timeout: timeoutMs
    }, res => {
      res.resume();                       // drain, so the socket can be freed
      resolve({ status: res.statusCode });
    });
    req.on("timeout", () => req.destroy(new Error(`no response within ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(body);
  });
}

async function deliver(hook, event, body) {
  const target = await validateTarget(hook.url);
  let status = "failed", error = null;
  if (!target.ok) {
    /* Re-checked at send time, not only at registration: DNS can be
       repointed at a private address after a URL has been approved. */
    error = target.error;
  } else {
    try {
      const res = await postPinned(hook.url, target.address, body, {
        "content-type": "application/json",
        "x-beastforge-event": event,
        "x-beastforge-signature": sign(hook.secret, body)
      });
      /* No counter here: deliver() reports its own outcome through its return
         value and emit() tallies them. An earlier version incremented a
         `delivered` variable that lives in emit's scope, which under a module's
         strict mode is a ReferenceError on the SUCCESS path — swallowed by the
         catch below and written into the row, so every delivered webhook was
         recorded with the error "delivered is not defined". */
      if (res.status >= 200 && res.status < 300) status = "delivered";
      else error = `receiver returned ${res.status}`;
    } catch (e) {
      error = String(e.message || e).slice(0, 200);
    }
  }
  db.prepare(`INSERT INTO webhook_deliveries (id, webhook_id, event, status, error, at)
              VALUES (?,?,?,?,?,?)`)
    .run(randomUUID(), hook.id, event, status, error, now());
  return status === "delivered";
}
