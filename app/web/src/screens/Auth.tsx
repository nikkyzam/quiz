import { useState } from "react";
import { api, ApiError, type User } from "../api";
import { Beast } from "../beasts";

const MESSAGES: Record<string, string> = {
  invalid_or_expired_token: "That reset code has expired or been used. Request another.",
  too_many_reset_requests: "Too many reset attempts. Please wait and try again.",
  coppa_consent_required: "Please confirm you are the parent or guardian.",
  too_many_attempts: "Too many attempts. Please wait a few minutes and try again.",
  too_many_requests: "Too many attempts. Please wait a few minutes and try again.",
  bad_credentials: "That email and password don't match an account.",
  email_taken: "There's already an account with that email — try signing in.",
  weak_password: "Use at least 8 characters.",
  bad_email: "That doesn't look like an email address.",
  missing_name: "Please add your name."
};

export function AuthScreen({ onDone }: { onDone: (u: User) => void }) {
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "reset">("in");
  const [resetToken, setResetToken] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [name, setName] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (mode === "forgot") {
        const r = await api.forgot(email);
        setNotice(r.message);
        if (r.token) { setResetToken(r.token); setMode("reset"); }
        return;
      }
      if (mode === "reset") {
        const r = await api.resetPassword(resetToken, password);
        setNotice(r.message);
        setMode("in"); setPassword("");
        return;
      }
      const r = mode === "in"
        ? await api.login(email, password)
        : await api.register(email, password, name, consent);
      onDone(r.user);
    } catch (e) {
      const code = e instanceof ApiError ? e.message : "request_failed";
      setErr(MESSAGES[code] || "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="center">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <Beast kind="vex" size={52} />
          <div>
            <div className="eyebrow">Kindergarten → Grade 8</div>
            <h1 style={{ margin: 0, fontSize: "2rem" }}>Math Quest</h1>
          </div>
        </div>
        <p className="lede">
          {mode === "in" ? "Sign in to pick up where your learners left off."
                         : "Create a parent account. You'll add each child next."}
        </p>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "in"} className={"tab" + (mode === "in" ? " on" : "")} onClick={() => { setMode("in"); setErr(""); }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "up"} className={"tab" + (mode === "up" ? " on" : "")} onClick={() => { setMode("up"); setErr(""); }}>Create account</button>
        </div>
        <form className="card" onSubmit={submit} aria-describedby={err ? "authErr" : undefined}>
          {mode === "up" && (
            <div className="field">
              <label htmlFor="nm">Your name</label>
              <input id="nm" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          {mode !== "reset" && (
          <div className="field">
            <label htmlFor="em">Email</label>
            <input id="em" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          </div>)}
          {mode !== "forgot" && (
          <div className="field">
            <label htmlFor="pw">{mode === "reset" ? "New password" : "Password"}</label>
            <input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)}
                   autoComplete={mode === "in" ? "current-password" : "new-password"} />
            {(mode === "up" || mode === "reset") && <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>At least 8 characters.</p>}
          </div>)}
          {mode === "up" && (
            <div className="field consent">
              <label htmlFor="consent" className="checkline">
                <input id="consent" type="checkbox" checked={consent}
                       onChange={e => setConsent(e.target.checked)} />
                <span>I am the parent or legal guardian of the children I will add,
                  and I consent to their progress being stored in this account.</span>
              </label>
            </div>
          )}
          {notice && <p className="notice" role="status">{notice}</p>}
          {err && <p className="err" id="authErr" role="alert">{err}</p>}
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 8 }}>
            {busy ? "Working…"
              : mode === "in" ? "Sign in"
              : mode === "up" ? "Create account"
              : mode === "forgot" ? "Send me a reset code"
              : "Set new password"}
          </button>
          {mode === "in" && (
            <button type="button" className="linkbtn" style={{ marginTop: 12 }}
                    onClick={() => { setMode("forgot"); setErr(""); setNotice(""); }}>
              Forgotten your password?
            </button>
          )}
          {(mode === "forgot" || mode === "reset") && (
            <button type="button" className="linkbtn" style={{ marginTop: 12 }}
                    onClick={() => { setMode("in"); setErr(""); setNotice(""); }}>
              Back to sign in
            </button>
          )}
        </form>
    </div>
  );
}
