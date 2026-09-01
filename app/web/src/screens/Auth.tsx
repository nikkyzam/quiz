import { useState } from "react";
import { api, ApiError, type User } from "../api";
import { Beast } from "../beasts";

const MESSAGES: Record<string, string> = {
  bad_credentials: "That email and password don't match an account.",
  email_taken: "There's already an account with that email — try signing in.",
  weak_password: "Use at least 8 characters.",
  bad_email: "That doesn't look like an email address.",
  missing_name: "Please add your name."
};

export function AuthScreen({ onDone }: { onDone: (u: User) => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [name, setName] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = mode === "in"
        ? await api.login(email, password)
        : await api.register(email, password, name);
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
          <div className="field">
            <label htmlFor="em">Email</label>
            <input id="em" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)}
                   autoComplete={mode === "in" ? "current-password" : "new-password"} />
            {mode === "up" && <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>At least 8 characters.</p>}
          </div>
          {err && <p className="err" id="authErr" role="alert">{err}</p>}
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 8 }}>
            {busy ? "Working…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>
    </div>
  );
}
