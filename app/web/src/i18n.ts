/* Localisation for the web client (spec 8.4, 10.8).

   A tiny external store: the chosen locale lives in localStorage, the string
   tables come from GET /i18n (one fetch per locale, cached for the session)
   and the English strings below cover every key this client uses, so a
   screen never shows a bare key while the table is loading or offline.
   Whenever the locale changes the document's `lang` and `dir` are stamped
   so right-to-left layout comes from the stylesheet, not from components. */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { call } from "./api";

export type LocaleInfo = { id: string; name: string; rtl: boolean };
type Table = Record<string, string>;
type State = { locale: string; locales: LocaleInfo[]; tables: Record<string, Table> };

const DEFAULT_LOCALE = "en";
const STORAGE_KEY = "locale";

const BUILTIN_LOCALES: LocaleInfo[] = [
  { id: "en", name: "English", rtl: false },
  { id: "es", name: "Español", rtl: false },
  { id: "ar", name: "العربية", rtl: true }
];

/* English fallbacks. Keys shared with app/shared/i18n.mjs match it exactly;
   the rest are client-only and fall back here until the shared table grows. */
export const EN: Table = {
  "app.name": "Math Quest",
  "nav.back": "Back", "nav.signout": "Sign out", "nav.settings": "Settings", "nav.home": "Home", "nav.progress": "Progress", "nav.map": "Map", "nav.family": "Family", "nav.teacher": "Teacher", "nav.switch": "Switch",
  "common.loading": "Loading…", "common.error": "Something went wrong. Please try again.", "common.close": "Close",
  "common.save": "Save", "common.saved": "Saved.", "common.cancel": "Cancel", "common.signedOut": "Please sign in again.",

  "settings.title": "Settings",
  "settings.lede": "Language, look and feel, reading help, notifications and your data. Everything here is saved on this device or in your account.",
  "settings.language": "Language", "settings.theme": "Theme", "settings.motion": "Reduce motion",
  "settings.languageHelp": "Menus, buttons and help change language. The maths stays the same.",
  "settings.preview": "Preview", "settings.previewText": "Question 3 of 10: what is 7 × 8?",
  "settings.previewNumbers": "Numbers in this language look like",
  "settings.rtl": "This language reads right to left, so the screen mirrors.",
  "settings.appearance": "Appearance",
  "settings.themeSystem": "Match my device", "settings.themeLight": "Light", "settings.themeDark": "Dark",
  "settings.readAloud": "Read aloud", "settings.readAloudHelp": "Questions and hints can be spoken. Choose how they sound.",
  "settings.voice": "Voice", "settings.voiceDefault": "Default voice for this language",
  "settings.rate": "Speaking speed", "settings.rateSlow": "Slower", "settings.rateFast": "Faster",
  "settings.highlight": "Highlight each word as it is read", "settings.tryVoice": "Hear a sample",
  "settings.noSpeech": "This browser cannot speak, so the read-aloud button stays hidden in quizzes.",
  "settings.notifications": "Notifications",
  "settings.emailAlerts": "Email me when a learner masters a topic or needs help",
  "settings.emailSummary": "Send a weekly progress summary by email",
  "settings.pushPref": "Allow push notifications from this account",
  "settings.emailOff": "Email is not set up on this server, so email options are saved but nothing is sent.",
  "settings.push": "Push on this device",
  "settings.pushOn": "Turn on push", "settings.pushOff": "Turn off push",
  "settings.pushEnabled": "This device receives push notifications.",
  "settings.pushDisabled": "This device does not receive push notifications.",
  "settings.pushDenied": "Notifications are blocked in the browser settings for this site.",
  "settings.pushUnsupported": "This browser does not support push notifications.",
  "settings.data": "Your data",
  "settings.dataHelp": "You can take a copy of everything stored about this account, see who did what, or delete it all.",
  "settings.export": "Download my data", "settings.exporting": "Preparing your file…",
  "settings.exported": "Your data was downloaded as a JSON file.",
  "settings.audit": "Show account activity", "settings.auditHide": "Hide account activity",
  "settings.auditEmpty": "No activity recorded yet.",
  "settings.password": "Change password", "settings.currentPassword": "Current password",
  "settings.newPassword": "New password", "settings.passwordHelp": "At least 8 characters. You will be signed out afterwards.",
  "settings.passwordChanged": "Password changed. Please sign in again.", "settings.signInAgain": "Sign in again",
  "settings.badCredentials": "That current password is not right.", "settings.weakPassword": "Choose a longer password.",
  "settings.delete": "Delete my account",
  "settings.deleteWarn": "This removes the account, every learner in it and all of their progress. There is no undo.",
  "settings.deleteConfirm": "I understand that everything will be deleted",
  "settings.deleteNow": "Delete for good",
  "settings.account": "Account", "settings.signedInAs": "Signed in as", "settings.practisingAs": "Practising as",

  "onboarding.welcome": "Welcome!", "onboarding.step1": "Pick a grade and a topic.",
  "onboarding.step2": "Practise: the questions adapt to you.",
  "onboarding.step3": "Master a topic to earn stars and unlock more.", "onboarding.done": "Let's go",
  "onboarding.next": "Next", "onboarding.skip": "Skip tour", "onboarding.step": "Step {n} of {total}",

  "help.title": "How this works", "help.hint": "Hints cost stars but never marks. Take one when you are stuck.",
  "help.mastery": "Mastery means scoring the pass mark on a check with no hints.",
  "help.search": "Search help", "help.results": "{n} answers", "help.none": "No matches. Try another word.",
  "help.expandAll": "Open all", "help.collapseAll": "Close all"
};

function readStoredLocale(): string {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return v && BUILTIN_LOCALES.some(l => l.id === v) ? v : DEFAULT_LOCALE;
  } catch { return DEFAULT_LOCALE; }
}

let state: State = { locale: readStoredLocale(), locales: BUILTIN_LOCALES, tables: { en: EN } };
const listeners = new Set<() => void>();
const requested = new Set<string>();

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const getSnapshot = () => state;
const emit = () => listeners.forEach(fn => fn());

const infoOf = (id: string): LocaleInfo =>
  state.locales.find(l => l.id === id) || state.locales.find(l => l.id === DEFAULT_LOCALE) || BUILTIN_LOCALES[0];

export const dirOf = (id: string): "ltr" | "rtl" => (infoOf(id).rtl ? "rtl" : "ltr");

function stamp() {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.lang = state.locale;
  el.dir = dirOf(state.locale);
}

type I18nResponse = {
  locale: string; dir: string;
  locales: Record<string, { name: string; dir: string }>;
  strings: Record<string, string>;
};

/* One request per locale per session; a failure is forgotten so a later
   call can retry once the network is back. */
async function load(locale: string) {
  if (requested.has(locale)) return;
  requested.add(locale);
  try {
    const r = await call<I18nResponse>(`/i18n?locale=${encodeURIComponent(locale)}`);
    const locales = Object.entries(r.locales || {}).map(([id, v]) => ({ id, name: v.name, rtl: v.dir === "rtl" }));
    state = {
      ...state,
      locales: locales.length ? locales : state.locales,
      tables: { ...state.tables, [r.locale]: { ...(state.tables[r.locale] || {}), ...(r.strings || {}) } }
    };
    stamp();
    emit();
  } catch { requested.delete(locale); }
}

export function setLocale(next: string) {
  if (!state.locales.some(l => l.id === next) || next === state.locale) return;
  state = { ...state, locale: next };
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode or blocked storage */ }
  stamp();
  emit();
  void load(next);
}

export function translate(key: string, vars?: Record<string, string | number>, locale = state.locale): string {
  const table = state.tables[locale] || {};
  let s = table[key] ?? EN[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/* Numbers follow the locale; the maths itself does not change. */
export function formatNumber(n: number, locale: string = state.locale): string {
  try { return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : locale).format(n); }
  catch { return String(n); }
}

export function useI18n(): {
  t: (key: string, vars?: Record<string, string | number>) => string;
  locale: string;
  setLocale: (l: string) => void;
  locales: LocaleInfo[];
  dir: "ltr" | "rtl";
} {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => { void load(s.locale); }, [s.locale]);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(key, vars, s.locale),
    // the table object changes identity when a fetch lands, which re-renders callers
    [s.locale, s.tables]  // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { t, locale: s.locale, setLocale, locales: s.locales, dir: dirOf(s.locale) };
}

if (typeof document !== "undefined") stamp();
