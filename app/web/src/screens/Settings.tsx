/* Settings (spec 8.4, 9.3, 9.4, 10.3, 10.8). Language, appearance and
   read-aloud live on the device; notification preferences, push
   subscriptions and data rights go through the account.

   Effects never run under the accessibility renderer, so the notification
   preferences arrive through `initial` there and through GET /me/preferences
   in the browser. */
import "../styles/settings.css";
import { useEffect, useId, useRef, useState } from "react";
import { call, post, put, ApiError, type User, type Learner } from "../api";
import { useI18n, formatNumber } from "../i18n";

/* ---------- server shapes ---------- */
export type Preferences = { emailAlerts: boolean; emailSummary: boolean; push: boolean; locale: string };
export type Channels = { email: boolean; push: boolean; inApp: boolean };
export type SettingsData = { preferences: Preferences; channels: Channels };
type AuditEntry = { action: string; detail: string | null; ip: string | null; at: string };

const getPreferences = () => call<SettingsData>("/me/preferences");
const savePreferences = (p: Partial<Preferences>) => put<{ preferences: Preferences }>("/me/preferences", p);
const vapidKey = () => call<{ publicKey: string }>("/push/vapid-public-key");
const registerPush = (sub: PushSubscriptionJSON) => post<{ ok: true; subscriptions: number }>("/me/push/subscribe", sub);
const forgetPush = (endpoint: string) =>
  call<{ deleted: number }>("/me/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) });
const exportData = () => call<unknown>("/me/export");
const auditTrail = () => call<{ entries: AuditEntry[] }>("/me/audit");
const changePassword = (current: string, password: string) =>
  post<{ ok: true; message: string }>("/auth/change-password", { current, password });
const deleteAccount = () => call<{ deleted: boolean }>("/me", { method: "DELETE" });

/* ---------- device-side preferences ---------- */
type Theme = "system" | "light" | "dark";
const THEME_KEY = "theme";

function readTheme(): Theme {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
    return v === "light" || v === "dark" ? v : "system";
  } catch { return "system"; }
}
function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (theme === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch { /* storage blocked: the attribute still applies for this visit */ }
}

type ReadAloudPrefs = { rate: number; highlight: boolean };
const READ_KEY = "readaloud";
function readReadAloud(): ReadAloudPrefs {
  const d: ReadAloudPrefs = { rate: 0.9, highlight: true };
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(READ_KEY) : null;
    if (!raw) return d;
    const p = JSON.parse(raw);
    const rate = Number(p?.rate);
    return {
      rate: Number.isFinite(rate) && rate >= 0.5 && rate <= 2 ? rate : d.rate,
      highlight: p?.highlight === undefined ? d.highlight : !!p.highlight
    };
  } catch { return d; }
}
function writeReadAloud(p: ReadAloudPrefs) {
  try { localStorage.setItem(READ_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}
const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/* ---------- web push helpers ---------- */
type PushState = "checking" | "unsupported" | "denied" | "on" | "off" | "busy";
const pushSupported = () =>
  typeof window !== "undefined" && "PushManager" in window && "serviceWorker" in navigator && "Notification" in window;

function vapidToBytes(key: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function swRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  try { return await navigator.serviceWorker.register("/sw.js"); } catch { return undefined; }
}

const messageFor = (e: unknown, fallback: string, signedOut: string) => {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return signedOut;
  return fallback;
};

/* ================================================================== */
export function Settings({ user, learner, onBack, onSignOut, initial }: {
  user: User; learner: Learner | null; onBack: () => void; onSignOut: () => void; initial?: SettingsData;
}) {
  const { t, locale, setLocale, locales, dir } = useI18n();
  const uid = useId();

  /* account preferences */
  const [data, setData] = useState<SettingsData | null>(initial ?? null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [prefStatus, setPrefStatus] = useState("");
  const [prefErr, setPrefErr] = useState("");

  useEffect(() => {
    if (initial) return;
    let live = true;
    getPreferences()
      .then(r => { if (live) setData(r); })
      .catch(e => { if (live) setLoadErr(messageFor(e, t("common.error"), t("common.signedOut"))); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  /* device preferences */
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [ra, setRa] = useState<ReadAloudPrefs>(readReadAloud);
  const speech = canSpeak();

  const pickTheme = (next: Theme) => { setTheme(next); applyTheme(next); };
  const updateRa = (patch: Partial<ReadAloudPrefs>) => {
    const next = { ...ra, ...patch };
    setRa(next);
    writeReadAloud(next);
  };
  const sample = () => {
    if (!speech) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t("settings.previewText"));
      u.rate = ra.rate;
      u.lang = locale;
      window.speechSynthesis.speak(u);
    } catch { /* speech blocked */ }
  };

  const pickLocale = (next: string) => {
    setLocale(next);
    if (!data) return;
    savePreferences({ locale: next })
      .then(r => setData(d => d ? { ...d, preferences: r.preferences } : d))
      .catch(() => { /* language still changes on this device */ });
  };

  const togglePref = (key: "emailAlerts" | "emailSummary" | "push", value: boolean) => {
    if (!data) return;
    const before = data.preferences;
    setData({ ...data, preferences: { ...before, [key]: value } });
    setPrefStatus(""); setPrefErr("");
    savePreferences({ [key]: value })
      .then(r => { setData(d => d ? { ...d, preferences: r.preferences } : d); setPrefStatus(t("common.saved")); })
      .catch(e => { setData(d => d ? { ...d, preferences: before } : d); setPrefErr(messageFor(e, t("common.error"), t("common.signedOut"))); });
  };

  /* push on this device */
  const [push, setPush] = useState<PushState>(() => (pushSupported() ? "checking" : "unsupported"));
  const [pushErr, setPushErr] = useState("");
  const subRef = useRef<PushSubscription | null>(null);

  useEffect(() => {
    if (!pushSupported()) return;
    let live = true;
    (async () => {
      try {
        if (Notification.permission === "denied") { if (live) setPush("denied"); return; }
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!live) return;
        subRef.current = sub;
        setPush(sub ? "on" : "off");
      } catch { if (live) setPush("off"); }
    })();
    return () => { live = false; };
  }, []);

  const pushOn = async () => {
    setPush("busy"); setPushErr("");
    try {
      const reg = await swRegistration();
      if (!reg) { setPush("unsupported"); return; }
      const { publicKey } = await vapidKey();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidToBytes(publicKey) });
      await registerPush(sub.toJSON());
      subRef.current = sub;
      setPush("on");
    } catch (e) {
      if (typeof Notification !== "undefined" && Notification.permission === "denied") setPush("denied");
      else { setPush("off"); setPushErr(messageFor(e, t("common.error"), t("common.signedOut"))); }
    }
  };
  const pushOff = async () => {
    setPush("busy"); setPushErr("");
    try {
      const sub = subRef.current;
      if (sub) {
        await forgetPush(sub.endpoint).catch(() => { /* server copy may already be gone */ });
        await sub.unsubscribe();
      }
      subRef.current = null;
      setPush("off");
    } catch (e) { setPush("on"); setPushErr(messageFor(e, t("common.error"), t("common.signedOut"))); }
  };

  /* data rights */
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState("");
  useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);

  const doExport = async () => {
    setExporting(true); setExportErr("");
    try {
      const body = await exportData();
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      setExportUrl(URL.createObjectURL(blob));
    } catch (e) { setExportErr(messageFor(e, t("common.error"), t("common.signedOut"))); }
    finally { setExporting(false); }
  };

  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditErr, setAuditErr] = useState("");
  const toggleAudit = async () => {
    if (auditOpen) { setAuditOpen(false); return; }
    setAuditOpen(true);
    if (audit) return;
    setAuditBusy(true); setAuditErr("");
    try { setAudit((await auditTrail()).entries); }
    catch (e) { setAuditErr(messageFor(e, t("common.error"), t("common.signedOut"))); }
    finally { setAuditBusy(false); }
  };

  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState("");
  const [pwDone, setPwDone] = useState(false);
  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwBusy(true); setPwErr("");
    try {
      await changePassword(current, password);
      setPwDone(true);
      setCurrent(""); setPassword("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setPwErr(t("settings.badCredentials"));
      else if (err instanceof ApiError && err.status === 400) setPwErr(t("settings.weakPassword"));
      else setPwErr(messageFor(err, t("common.error"), t("common.signedOut")));
    } finally { setPwBusy(false); }
  };

  const [armed, setArmed] = useState(false);
  const [sure, setSure] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState("");
  const doDelete = async () => {
    setDelBusy(true); setDelErr("");
    try { await deleteAccount(); onSignOut(); }
    catch (e) { setDelErr(messageFor(e, t("common.error"), t("common.signedOut"))); setDelBusy(false); }
  };

  const id = (s: string) => `${uid}-${s}`;
  const prefs = data?.preferences;
  const rtl = dir === "rtl";

  return (
    <>
      <button type="button" className="back" onClick={onBack}>← {t("nav.back")}</button>
      <div className="eyebrow">{t("app.name")}</div>
      <h1>{t("settings.title")}</h1>
      <p className="lede">{t("settings.lede")}</p>

      {/* ---------- account ---------- */}
      <section className="card set-section" aria-labelledby={id("account")}>
        <h2 id={id("account")}>{t("settings.account")}</h2>
        <p className="who-line"><span className="muted">{t("settings.signedInAs")}</span> <b>{user.name}</b> <span className="muted">({user.email})</span></p>
        {learner && <p className="who-line"><span className="muted">{t("settings.practisingAs")}</span> <b>{learner.name}</b></p>}
        <div className="set-actions">
          <button type="button" className="btn ghost" onClick={onSignOut}>{t("nav.signout")}</button>
        </div>
      </section>

      {/* ---------- language ---------- */}
      <section className="card set-section" aria-labelledby={id("lang")}>
        <h2 id={id("lang")}>{t("settings.language")}</h2>
        <div className="set-row">
          <div>
            <label className="set-lbl" htmlFor={id("locale")}>{t("settings.language")}</label>
            <p className="set-help">{t("settings.languageHelp")}</p>
          </div>
          <select id={id("locale")} className="set-select" value={locale} onChange={e => pickLocale(e.target.value)}>
            {locales.map(l => <option key={l.id} value={l.id} lang={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="rtl-preview" dir={dir} lang={locale}>
          <p><b>{t("settings.preview")}</b></p>
          <p>{t("settings.previewText")}</p>
          <p>{t("settings.previewNumbers")} <span className="num">{formatNumber(1234567.5)}</span></p>
        </div>
        {rtl && <p className="set-help" role="status">{t("settings.rtl")}</p>}
      </section>

      {/* ---------- appearance ---------- */}
      <section className="card set-section" aria-labelledby={id("look")}>
        <h2 id={id("look")}>{t("settings.appearance")}</h2>
        <fieldset className="set-fieldset">
          <legend className="set-lbl">{t("settings.theme")}</legend>
          <div className="set-choices">
            {(["system", "light", "dark"] as Theme[]).map(v => (
              <label key={v} className="set-check">
                <input type="radio" name={id("theme")} value={v} checked={theme === v} onChange={() => pickTheme(v)} />
                {t(v === "system" ? "settings.themeSystem" : v === "light" ? "settings.themeLight" : "settings.themeDark")}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {/* ---------- read aloud ---------- */}
      <section className="card set-section" aria-labelledby={id("read")}>
        <h2 id={id("read")}>{t("settings.readAloud")}</h2>
        <p className="set-help">{t("settings.readAloudHelp")}</p>
        {!speech && <p className="set-help" role="status">{t("settings.noSpeech")}</p>}
        <div className="set-row stack">
          <label className="set-lbl" htmlFor={id("rate")}>
            {t("settings.rate")} <span className="muted">({formatNumber(Math.round(ra.rate * 10) / 10)}×)</span>
          </label>
          <input id={id("rate")} className="set-range" type="range" min={0.5} max={2} step={0.1} value={ra.rate}
                 onChange={e => updateRa({ rate: Number(e.target.value) })} />
          <div className="set-scale" aria-hidden="true"><span>{t("settings.rateSlow")}</span><span>{t("settings.rateFast")}</span></div>
        </div>
        <div className="set-row">
          <label className="set-check">
            <input type="checkbox" checked={ra.highlight} onChange={e => updateRa({ highlight: e.target.checked })} />
            {t("settings.highlight")}
          </label>
          <button type="button" className="btn ghost" onClick={sample} disabled={!speech}>{t("settings.tryVoice")}</button>
        </div>
      </section>

      {/* ---------- notifications ---------- */}
      <section className="card set-section" aria-labelledby={id("notify")}>
        <h2 id={id("notify")}>{t("settings.notifications")}</h2>
        {!data && !loadErr && <div className="loading" role="status">{t("common.loading")}</div>}
        {loadErr && <p className="err" role="alert">{loadErr}</p>}
        {data && prefs && (
          <>
            {!data.channels.email && <p className="set-help">{t("settings.emailOff")}</p>}
            <div className="set-row">
              <label className={"set-check" + (data.channels.email ? "" : " off")}>
                <input type="checkbox" checked={prefs.emailAlerts} onChange={e => togglePref("emailAlerts", e.target.checked)} />
                {t("settings.emailAlerts")}
              </label>
            </div>
            <div className="set-row">
              <label className={"set-check" + (data.channels.email ? "" : " off")}>
                <input type="checkbox" checked={prefs.emailSummary} onChange={e => togglePref("emailSummary", e.target.checked)} />
                {t("settings.emailSummary")}
              </label>
            </div>
            <div className="set-row">
              <label className="set-check">
                <input type="checkbox" checked={prefs.push} onChange={e => togglePref("push", e.target.checked)} />
                {t("settings.pushPref")}
              </label>
            </div>
            <p className="set-status" role="status">{prefStatus}</p>
            {prefErr && <p className="err" role="alert">{prefErr}</p>}
          </>
        )}

        <h3>{t("settings.push")}</h3>
        <div className="set-row">
          <p className="set-help" role="status">
            {push === "checking" && t("common.loading")}
            {push === "unsupported" && t("settings.pushUnsupported")}
            {push === "denied" && t("settings.pushDenied")}
            {(push === "on" || push === "busy") && t("settings.pushEnabled")}
            {push === "off" && t("settings.pushDisabled")}
          </p>
          {(push === "on" || push === "off" || push === "busy") && (
            <button type="button" className="btn ghost" disabled={push === "busy"} onClick={push === "on" ? pushOff : pushOn}>
              {push === "on" ? t("settings.pushOff") : t("settings.pushOn")}
            </button>
          )}
        </div>
        {pushErr && <p className="err" role="alert">{pushErr}</p>}
      </section>

      {/* ---------- your data ---------- */}
      <section className="card set-section" aria-labelledby={id("data")}>
        <h2 id={id("data")}>{t("settings.data")}</h2>
        <p className="set-help">{t("settings.dataHelp")}</p>

        <div className="set-actions">
          <button type="button" className="btn ghost" onClick={doExport} disabled={exporting}>{t("settings.export")}</button>
          <button type="button" className="btn ghost" onClick={toggleAudit} aria-expanded={auditOpen} aria-controls={id("audit")}>
            {auditOpen ? t("settings.auditHide") : t("settings.audit")}
          </button>
        </div>
        <p className="set-status" role="status">
          {exporting && t("settings.exporting")}
          {exportUrl && !exporting && (
            <>
              {t("settings.exported")}{" "}
              <a className="linkbtn" href={exportUrl} download="mathquest-export.json">mathquest-export.json</a>
            </>
          )}
        </p>
        {exportErr && <p className="err" role="alert">{exportErr}</p>}

        <div id={id("audit")} hidden={!auditOpen}>
          {auditBusy && <div className="loading" role="status">{t("common.loading")}</div>}
          {auditErr && <p className="err" role="alert">{auditErr}</p>}
          {audit && !audit.length && <p className="set-help">{t("settings.auditEmpty")}</p>}
          {audit && audit.length > 0 && (
            <ul className="audit">
              {audit.map((a, i) => (
                <li key={i}>
                  <b>{a.action}</b>{a.detail ? ` · ${a.detail}` : ""}
                  <span className="when">{new Date(a.at).toLocaleString(locale)}{a.ip ? ` · ${a.ip}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <h3>{t("settings.password")}</h3>
        {pwDone ? (
          <div className="set-form">
            <p className="set-status" role="status">{t("settings.passwordChanged")}</p>
            <button type="button" className="btn" onClick={onSignOut}>{t("settings.signInAgain")}</button>
          </div>
        ) : (
          <form className="set-form" onSubmit={submitPassword}>
            <div className="field">
              <label htmlFor={id("cur")}>{t("settings.currentPassword")}</label>
              <input id={id("cur")} type="password" autoComplete="current-password" required value={current}
                     onChange={e => setCurrent(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={id("new")}>{t("settings.newPassword")}</label>
              <input id={id("new")} type="password" autoComplete="new-password" required minLength={8} value={password}
                     aria-describedby={id("pwhelp")} onChange={e => setPassword(e.target.value)} />
              <p className="set-help" id={id("pwhelp")}>{t("settings.passwordHelp")}</p>
            </div>
            {pwErr && <p className="err" role="alert">{pwErr}</p>}
            <button type="submit" className="btn" disabled={pwBusy || !current || password.length < 8}>{t("settings.password")}</button>
          </form>
        )}

        <div className="danger-zone card set-section">
          <h3>{t("settings.delete")}</h3>
          <p className="set-help">{t("settings.deleteWarn")}</p>
          {!armed ? (
            <div className="set-actions">
              <button type="button" className="btn danger" onClick={() => setArmed(true)}>{t("settings.delete")}</button>
            </div>
          ) : (
            <div className="confirm" role="group" aria-label={t("settings.delete")}>
              <label className="set-check">
                <input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} />
                {t("settings.deleteConfirm")}
              </label>
              <div className="set-actions">
                <button type="button" className="btn danger" disabled={!sure || delBusy} onClick={doDelete}>{t("settings.deleteNow")}</button>
                <button type="button" className="btn ghost" onClick={() => { setArmed(false); setSure(false); }}>{t("common.cancel")}</button>
              </div>
              {delErr && <p className="err" role="alert">{delErr}</p>}
            </div>
          )}
        </div>
      </section>

      <div className="endbtns">
        <button type="button" className="btn ghost" onClick={onSignOut}>{t("nav.signout")}</button>
      </div>
    </>
  );
}
