/* Email transport (spec 9.4, 4.2.4).

   A small SMTP client on node:net / node:tls — EHLO, optional STARTTLS,
   AUTH PLAIN or LOGIN, MAIL FROM, RCPT TO, DATA — because a dependency that
   must be kept patched is a worse deal than eighty lines that only speak the
   subset of SMTP a transactional sender needs.

   Configured entirely from the environment:
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
     SMTP_TLS = "tls" (implicit TLS) | "starttls" | "none" (development only)
   With SMTP_HOST unset nothing is sent and `configured()` says so; the
   notification outbox simply waits. */

import net from "node:net";
import tls from "node:tls";

export function config() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host, port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || "", pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || `no-reply@${host}`,
    tlsMode: process.env.SMTP_TLS || "starttls",
    timeoutMs: Number(process.env.SMTP_TIMEOUT_MS || 10_000)
  };
}
export const configured = () => !!config();

/* Line-oriented SMTP conversation over a socket. */
function talk(socket, timeoutMs) {
  let buffer = "";
  const waiters = [];
  const push = () => {
    /* A reply is complete when its last line has a space after the code. */
    const lines = buffer.split("\r\n");
    let end = -1;
    for (let i = 0; i < lines.length - 1; i++) if (/^\d{3} /.test(lines[i])) { end = i; break; }
    if (end < 0) return;
    const reply = lines.slice(0, end + 1).join("\r\n");
    buffer = lines.slice(end + 1).join("\r\n");
    const w = waiters.shift();
    if (w) w.resolve(reply);
    if (buffer.length && waiters.length) push();
  };
  socket.on("data", d => { buffer += d.toString("utf8"); push(); });
  socket.on("error", e => { while (waiters.length) waiters.shift().reject(e); });
  socket.on("close", () => { while (waiters.length) waiters.shift().reject(new Error("smtp connection closed")); });
  const read = () => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("smtp timeout")), timeoutMs);
    waiters.push({ resolve: r => { clearTimeout(t); resolve(r); }, reject: e => { clearTimeout(t); reject(e); } });
    if (buffer.length) push();
  });
  const send = async (line, expect = /^2|^3/) => {
    socket.write(line + "\r\n");
    const reply = await read();
    if (!expect.test(reply)) throw new Error(`smtp: "${line.split(" ")[0]}" got ${reply.split("\r\n")[0]}`);
    return reply;
  };
  return { read, send };
}

const dot = text => text.split("\r\n").map(l => (l.startsWith(".") ? "." + l : l)).join("\r\n");
const b64 = s => Buffer.from(s, "utf8").toString("base64");

export function buildMessage({ from, to, subject, text, html }) {
  const boundary = "bf" + Date.now().toString(36);
  const headers = [
    `From: ${from}`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@beastforge>`,
    "MIME-Version: 1.0"
  ];
  if (html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [`--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", text,
                  `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", html, `--${boundary}--`, ""];
    return headers.join("\r\n") + "\r\n\r\n" + body.join("\r\n");
  }
  headers.push("Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit");
  return headers.join("\r\n") + "\r\n\r\n" + text;
}

export async function sendMail({ to, subject, text, html }, cfg = config()) {
  if (!cfg) throw new Error("smtp not configured");
  if (!/^[^\s@]+@[^\s@]+$/.test(String(to))) throw new Error("bad recipient");
  let socket = cfg.tlsMode === "tls"
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : net.connect({ host: cfg.host, port: cfg.port });
  await new Promise((res, rej) => { socket.once(cfg.tlsMode === "tls" ? "secureConnect" : "connect", res); socket.once("error", rej); });
  let conv = talk(socket, cfg.timeoutMs);
  try {
    await conv.read();                                   // greeting
    let ehlo = await conv.send("EHLO beastforge.local");
    if (cfg.tlsMode === "starttls") {
      if (!/STARTTLS/i.test(ehlo)) throw new Error("server does not offer STARTTLS");
      await conv.send("STARTTLS", /^220/);
      socket = tls.connect({ socket, servername: cfg.host });
      await new Promise((res, rej) => { socket.once("secureConnect", res); socket.once("error", rej); });
      conv = talk(socket, cfg.timeoutMs);
      ehlo = await conv.send("EHLO beastforge.local");
    }
    if (cfg.user) {
      if (/AUTH[^\r\n]*PLAIN/i.test(ehlo)) await conv.send("AUTH PLAIN " + b64(`\0${cfg.user}\0${cfg.pass}`), /^235/);
      else { await conv.send("AUTH LOGIN", /^334/); await conv.send(b64(cfg.user), /^334/); await conv.send(b64(cfg.pass), /^235/); }
    }
    await conv.send(`MAIL FROM:<${cfg.from.replace(/^.*<|>.*$/g, "")}>`, /^250/);
    await conv.send(`RCPT TO:<${to}>`, /^25/);
    await conv.send("DATA", /^354/);
    await conv.send(dot(buildMessage({ from: cfg.from, to, subject, text, html })) + "\r\n.", /^250/);
    await conv.send("QUIT", /^221/).catch(() => {});
    return { ok: true };
  } finally { socket.destroy(); }
}
