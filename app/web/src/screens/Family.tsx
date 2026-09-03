/* Parent portal (spec 4.2.1 - 4.2.7).

   One learner at a time: overview, alerts and notifications, weekly goals,
   the curriculum track, a curriculum overview with sample problems, the
   weekly summary, and report downloads. Everything the screen shows is
   fetched in one bundle so the accessibility render can pass it in whole. */
import "../styles/family.css";
import { useEffect, useId, useState } from "react";
import { api, call, post, put, ApiError, type User, type Learner, type Question, type ProgressRow } from "../api";
import { Beast } from "../beasts";

export type Curriculum = Awaited<ReturnType<typeof api.curriculum>>;

/* ---------- server shapes ---------- */
export type Section = "overview" | "alerts" | "goals" | "track" | "curriculum" | "weekly" | "reports";

type TopicMeta = { topicId: string; name: string; grade?: string; gradeKey?: string; unit?: string; track?: string };
export type TimeData = {
  totalSeconds: number; last7DaysSeconds: number; rounds: number;
  byDay: { day: string; seconds: number }[];
  byTopic: (TopicMeta & { seconds: number })[];
};
export type Readiness = {
  level: number; points: number; title: { code: string; name: string } | null;
  mastery: { core: number; advanced: number; started: number };
  knownSkills: number; contests: { papers: number; best: number };
  readiness: {
    advanced: { ready: boolean; reason: string };
    competition: { ready: boolean; reason: string };
    advancedTopicsTried: number;
  };
};
export type Alert = { kind: "struggling" | "inactive" | "ready_to_advance"; topicId?: string; topic?: string; detail: string };
export type Notification = {
  id: string; learnerId: string | null; learnerName: string | null; kind: string; kindLabel?: string;
  title: string; body: string; createdAt: string; readAt: string | null; deliveredVia: string | null;
};
export type Inbox = { notifications: Notification[]; unread: number; kinds: Record<string, string> };
export type GoalData = {
  goal: { roundsPerWeek: number; minutesPerWeek: number; setAt?: string } | null;
  roundsThisWeek: number; percentOfGoal?: number | null; met?: boolean | null; atRisk?: boolean | null;
};
export type TrackData = {
  track: string; tracks: Record<string, { name: string; blurb: string }>;
  recommended: { track: string; reason: string };
};
export type ProgressData = {
  progress: ProgressRow[];
  recent: { topic_id: string; tier: string; score: number; total: number; pct: number; finished_at: string }[];
};
type ErrorCount = { category: string; label: string; count: number };
export type ErrorsData = {
  total: number; byCategory: ErrorCount[];
  byTopic: { topicId: string; count: number; categories: ErrorCount[] }[];
  categories: Record<string, string>;
};
export type MasteryData = {
  topics: (TopicMeta & { state: "not_yet" | "decayed" | "mastered"; threshold: number; bestPct: number })[];
};
export type SkillsData = {
  skills: { skillId: string; name: string; known: boolean; confidence: number; grade?: string; unit?: string }[];
  masteryThreshold: number; minObservations: number;
};
export type StreakData = { days: number; freezesAvailable: number; freezesUsed: number; freezesEarned: number; nextFreezeAt: number };
export type WeeklySummary = {
  week: string;
  learners: { learnerId: string; name: string; rounds: number; minutes: number; mastered: string[]; badges: string[]; streak: number; text: string }[];
  text: string;
};
export type OverviewTopic = {
  id: string; name: string; threshold: number; questions: number;
  standards: { framework: string; codes: string[]; strand: { code: string; name: string } | null; note: string | null } | null;
  sample: Question | null;
};
export type Overview = { grade: string; label: string; units: { name: string; track?: string; topics: OverviewTopic[] }[] };

export type FamilyData = {
  time: TimeData; readiness: Readiness; alerts: Alert[]; inbox: Inbox; goal: GoalData; track: TrackData;
  progress: ProgressData; errors: ErrorsData; mastery: MasteryData; skills: SkillsData; streak: StreakData;
  weekly: WeeklySummary;
  /* Optional presentation state, so a caller (or the accessibility render)
     can open the portal on a given section with an overview already loaded. */
  section?: Section; grade?: string; overviews?: Record<string, Overview>;
};

/* ---------- API helpers ---------- */
const fam = {
  time:      (id: string) => call<TimeData>(`/learners/${id}/time`),
  readiness: (id: string) => call<Readiness>(`/learners/${id}/readiness`),
  alerts:    (id: string) => call<{ alerts: Alert[] }>(`/learners/${id}/alerts`),
  inbox:     () => call<Inbox>("/me/notifications"),
  markRead:  (nid: string) => post<{ updated: number }>(`/me/notifications/${nid}/read`),
  readAll:   () => post<{ updated: number }>("/me/notifications/read-all"),
  goal:      (id: string) => call<GoalData>(`/learners/${id}/goal`),
  setGoal:   (id: string, roundsPerWeek: number, minutesPerWeek: number) =>
               put<{ goal: { roundsPerWeek: number; minutesPerWeek: number } }>(`/learners/${id}/goal`, { roundsPerWeek, minutesPerWeek }),
  track:     (id: string) => call<TrackData>(`/learners/${id}/track`),
  setTrack:  (id: string, track: string) => put<{ track: string }>(`/learners/${id}/track`, { track }),
  progress:  (id: string) => call<ProgressData>(`/learners/${id}/progress`),
  errors:    (id: string) => call<ErrorsData>(`/learners/${id}/errors`),
  mastery:   (id: string) => call<MasteryData>(`/learners/${id}/mastery`),
  skills:    (id: string) => call<SkillsData>(`/learners/${id}/skills`),
  streak:    (id: string) => call<StreakData>(`/learners/${id}/streak`),
  weekly:    () => call<WeeklySummary>("/me/weekly-summary"),
  overview:  (grade: string) => call<Overview>(`/curriculum/overview/${encodeURIComponent(grade)}`)
};

async function loadFamily(id: string): Promise<FamilyData> {
  const [time, readiness, alerts, inbox, goal, track, progress, errors, mastery, skills, streak, weekly] =
    await Promise.all([
      fam.time(id), fam.readiness(id), fam.alerts(id), fam.inbox(), fam.goal(id), fam.track(id),
      fam.progress(id), fam.errors(id), fam.mastery(id), fam.skills(id), fam.streak(id), fam.weekly()
    ]);
  return { time, readiness, alerts: alerts.alerts, inbox, goal, track, progress, errors, mastery, skills, streak, weekly };
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Your session has ended. Sign in again to see the parent portal.";
    if (e.status === 403) return "That learner is not on your account.";
    if (e.status === 404) return "That was not found.";
    return `The server could not complete the request (${e.message}).`;
  }
  return "The server could not be reached. Check the connection and try again.";
}

/* ---------- small formatters ---------- */
const mins = (sec: number) => Math.round(sec / 60);
const minsText = (sec: number) => `${mins(sec)} min`;
const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" });
const dateText = (iso: string) => new Date(iso).toLocaleDateString();
const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8"];

function topicMeta(cur: Curriculum, id: string) {
  for (const g of Object.values(cur.curriculum))
    for (const u of g.units) {
      const t = u.topics.find(t => t.id === id);
      if (t) return { name: t.name, unit: u.name, grade: g.label, adv: u.track === "adv" };
    }
  return { name: id, unit: "", grade: "", adv: false };
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "alerts", label: "Alerts" },
  { id: "goals", label: "Goals" },
  { id: "track", label: "Track" },
  { id: "curriculum", label: "Curriculum overview" },
  { id: "weekly", label: "Weekly summary" },
  { id: "reports", label: "Reports" }
];

/* ============================================================ */
export function Family({ user, learner, cur, onBack, onOpenTopic, initial }: {
  user: User; learner: Learner; cur: Curriculum; onBack: () => void;
  onOpenTopic: (topicId: string, topicName: string, advanced: boolean) => void;
  initial?: FamilyData;
}) {
  const [data, setData] = useState<FamilyData | null>(initial ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(initial?.section ?? "overview");
  const uid = useId();

  useEffect(() => {
    if (initial) return;
    let live = true;
    setData(null); setErr(null);
    loadFamily(learner.id).then(d => { if (live) setData(d); }).catch(e => { if (live) setErr(describeError(e)); });
    return () => { live = false; };
  }, [learner.id, initial]);

  const patch = (p: Partial<FamilyData>) => setData(d => (d ? { ...d, ...p } : d));

  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = SECTIONS.findIndex(s => s.id === section);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % SECTIONS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + SECTIONS.length) % SECTIONS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SECTIONS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setSection(SECTIONS[next].id);
    document.getElementById(`${uid}-tab-${SECTIONS[next].id}`)?.focus();
  };

  return (
    <div className="family">
      <button className="back" onClick={onBack}>← Back</button>
      <div className="maphead">
        <Beast kind={learner.beast} size={44} />
        <div>
          <div className="eyebrow">Parent portal</div>
          <h1 style={{ margin: 0, fontSize: "1.8rem" }}>{learner.name}</h1>
        </div>
      </div>
      <p className="lede">Signed in as {user.name}. Progress, time on task, alerts and goals for {learner.name}.</p>

      {err && <p className="err" role="alert">{err}</p>}
      {!err && !data && <div className="loading" role="status">Loading the parent portal…</div>}

      {data && (
        <>
          <div className="tabs fam-tabs" role="tablist" aria-label="Parent portal sections" onKeyDown={onTabKey}>
            {SECTIONS.map(s => {
              const unread = s.id === "alerts" ? data.inbox.unread + data.alerts.length : 0;
              return (
                <button key={s.id} role="tab" id={`${uid}-tab-${s.id}`} type="button"
                  className={"tab" + (section === s.id ? " on" : "")}
                  aria-selected={section === s.id} aria-controls={`${uid}-panel-${s.id}`}
                  tabIndex={section === s.id ? 0 : -1}
                  onClick={() => setSection(s.id)}>
                  {s.label}{unread > 0 && <span className="fam-count"><span className="visually-hidden">, </span>{unread}<span className="visually-hidden"> to look at</span></span>}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id={`${uid}-panel-${section}`} aria-labelledby={`${uid}-tab-${section}`} tabIndex={0} className="fam-panel">
            {section === "overview" && <OverviewSection d={data} cur={cur} learner={learner} />}
            {section === "alerts" && <AlertsSection d={data} cur={cur} learner={learner} onOpenTopic={onOpenTopic} patch={patch} go={setSection} />}
            {section === "goals" && <GoalsSection d={data} learner={learner} patch={patch} />}
            {section === "track" && <TrackSection d={data} learner={learner} patch={patch} />}
            {section === "curriculum" && <CurriculumSection d={data} cur={cur} onOpenTopic={onOpenTopic} patch={patch} uid={uid} />}
            {section === "weekly" && <WeeklySection d={data} learner={learner} />}
            {section === "reports" && <ReportsSection d={data} cur={cur} learner={learner} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Overview (4.2.1, 4.2.3) ---------------- */
function OverviewSection({ d, cur, learner }: { d: FamilyData; cur: Curriculum; learner: Learner }) {
  const r = d.readiness, t = d.time;
  const maxDay = Math.max(1, ...t.byDay.map(x => x.seconds));
  const weekTotal = t.byDay.reduce((a, x) => a + x.seconds, 0);
  const topTopics = t.byTopic.slice(0, 5);
  const mastery = d.mastery.topics;
  const stateLabel = { mastered: "Mastered", decayed: "Needs a refresh", not_yet: "Not yet" } as const;

  return (
    <>
      <h2>Overview</h2>
      <div className="statgrid fam-stats">
        <div className="stat"><b>{r.level}</b><span>Level</span></div>
        <div className="stat"><b>{r.mastery.core}</b><span>Core mastered</span></div>
        <div className="stat"><b>{r.mastery.advanced}</b><span>Advanced mastered</span></div>
        <div className="stat"><b>{r.mastery.started}</b><span>Topics started</span></div>
        <div className="stat"><b>{r.knownSkills}</b><span>Skills confident</span></div>
        <div className="stat"><b>{d.streak.days}</b><span>Day streak</span></div>
      </div>
      <p className="dsub">
        {r.points} points{r.title ? `, title: ${r.title.name}` : ""}.
        {d.streak.freezesAvailable > 0 ? ` ${d.streak.freezesAvailable} streak freeze${d.streak.freezesAvailable === 1 ? "" : "s"} available.` : ""}
        {r.contests.papers > 0 ? ` ${r.contests.papers} timed paper${r.contests.papers === 1 ? "" : "s"}, best ${r.contests.best}%.` : ""}
      </p>

      <h3 className="fam-h3">Time spent</h3>
      <div className="statgrid fam-stats3">
        <div className="stat"><b>{mins(t.last7DaysSeconds)}</b><span>Minutes this week</span></div>
        <div className="stat"><b>{mins(t.totalSeconds)}</b><span>Minutes in total</span></div>
        <div className="stat"><b>{t.rounds}</b><span>Rounds in total</span></div>
      </div>
      <table className="fam-days">
        <caption>Minutes practised per day over the last seven days ({minsText(weekTotal)} in all)</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Minutes</th></tr></thead>
        <tbody>
          {t.byDay.map(x => (
            <tr key={x.day}>
              <th scope="row">{dayLabel(x.day)}</th>
              <td>
                <span className="fam-bar" aria-hidden="true"><i style={{ width: `${Math.round((x.seconds / maxDay) * 100)}%` }} /></span>
                <span className="fam-min">{mins(x.seconds)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {topTopics.length > 0 && (
        <>
          <p className="dsub">Where the time went:</p>
          <ul className="fam-list">
            {topTopics.map(x => <li key={x.topicId}>{x.name}{x.grade ? ` (${x.grade})` : ""}: {minsText(x.seconds)}</li>)}
          </ul>
        </>
      )}
      {t.rounds === 0 && <p className="muted">No rounds recorded yet. Time appears here after {learner.name} finishes a round.</p>}

      <h3 className="fam-h3">Readiness</h3>
      <ul className="fam-ready">
        <li className={"drow fam-readycard" + (r.readiness.advanced.ready ? " yes" : "")}>
          <div className="dhead"><b>Advanced strands</b>
            <span className={"pill" + (r.readiness.advanced.ready ? " good" : "")}>{r.readiness.advanced.ready ? "Ready" : "Not yet"}</span></div>
          <div className="dsub">Why: {r.readiness.advanced.reason}.</div>
        </li>
        <li className={"drow fam-readycard" + (r.readiness.competition.ready ? " yes" : "")}>
          <div className="dhead"><b>Competition papers</b>
            <span className={"pill" + (r.readiness.competition.ready ? " good" : "")}>{r.readiness.competition.ready ? "Ready" : "Not yet"}</span></div>
          <div className="dsub">Why: {r.readiness.competition.reason}.</div>
        </li>
      </ul>
      <p className="dsub">Advanced topics tried so far: {r.readiness.advancedTopicsTried}. Mastery means {cur.mastery.core}% on a core topic and {cur.mastery.adv}% on an advanced one.</p>

      <h3 className="fam-h3">Mastery by topic</h3>
      {mastery.length === 0 && <p className="muted">Nothing started yet.</p>}
      {mastery.length > 0 && (
        <ul className="fam-list plain">
          {mastery.map(m => (
            <li key={m.topicId} className="drow">
              <div className="dhead">
                <b>{m.name}{m.track === "adv" && <span className="badge adv">advanced</span>}</b>
                <span className={"pill" + (m.state === "mastered" ? " good" : m.state === "decayed" ? " warn" : "")}>{stateLabel[m.state]}</span>
              </div>
              <div className="dsub">{m.grade ? `${m.grade} · ` : ""}{m.unit ? `${m.unit} · ` : ""}best {m.bestPct}% of {m.threshold}% needed</div>
            </li>
          ))}
        </ul>
      )}

      {d.progress.recent.length > 0 && (
        <>
          <h3 className="fam-h3">Recent rounds</h3>
          <ul className="fam-list plain">
            {d.progress.recent.slice(0, 6).map((x, i) => (
              <li key={i} className="drow">
                <div className="dhead"><b>{topicMeta(cur, x.topic_id).name}</b>
                  <span className="pill">{x.score}/{x.total} · {x.pct}%</span></div>
                <div className="dsub">{x.tier} · {new Date(x.finished_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/* ---------------- Alerts and notifications (4.2.5, 4.2.6) ---------------- */
const KIND_LABEL: Record<Alert["kind"], string> = {
  struggling: "Struggling", inactive: "Inactive", ready_to_advance: "Ready to advance"
};
const SUGGEST: Record<Alert["kind"], string> = {
  struggling: "Open the topic at the Practice tier with hints on, or run the diagnostic to find the exact gap.",
  inactive: "One short round today restarts the streak. A weekly goal sends a reminder when the week is slipping.",
  ready_to_advance: "Move the track up so advanced strands are recommended alongside the core work."
};

function AlertsSection({ d, cur, learner, onOpenTopic, patch, go }: {
  d: FamilyData; cur: Curriculum; learner: Learner;
  onOpenTopic: (topicId: string, topicName: string, advanced: boolean) => void;
  patch: (p: Partial<FamilyData>) => void; go: (s: Section) => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inbox = d.inbox;

  const markRead = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      await fam.markRead(id);
      const now = new Date().toISOString();
      const notifications = inbox.notifications.map(n => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n));
      patch({ inbox: { ...inbox, notifications, unread: notifications.filter(n => !n.readAt).length } });
      setMsg("Marked as read.");
    } catch (e) { setMsg(describeError(e)); }
    setBusy(false);
  };
  const readAll = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fam.readAll();
      const now = new Date().toISOString();
      patch({ inbox: { ...inbox, unread: 0, notifications: inbox.notifications.map(n => ({ ...n, readAt: n.readAt ?? now })) } });
      setMsg(`${r.updated} notification${r.updated === 1 ? "" : "s"} marked as read.`);
    } catch (e) { setMsg(describeError(e)); }
    setBusy(false);
  };

  return (
    <>
      <h2>Alerts</h2>
      <p className="lede">Computed from {learner.name}'s record right now. Each alert also lands in the notification inbox below.</p>
      {d.alerts.length === 0 && <p className="notice fam-clear">No alerts for {learner.name} at the moment.</p>}
      {d.alerts.length > 0 && (
        <ul className="fam-list plain">
          {d.alerts.map((a, i) => {
            const meta = a.topicId ? topicMeta(cur, a.topicId) : null;
            return (
              <li key={i} className={"drow fam-alert " + a.kind}>
                <div className="dhead"><b>{KIND_LABEL[a.kind]}{a.topic ? `: ${a.topic}` : ""}</b>
                  <span className={"pill" + (a.kind === "ready_to_advance" ? " good" : a.kind === "struggling" ? " warn" : "")}>{KIND_LABEL[a.kind]}</span></div>
                <div className="dsub">{a.detail}</div>
                <p className="fam-suggest"><b>Suggested action:</b> {SUGGEST[a.kind]}</p>
                <div className="rowbtns">
                  {a.kind === "struggling" && a.topicId && meta && (
                    <button className="btn ghost" type="button" onClick={() => onOpenTopic(a.topicId!, meta.name, meta.adv)}>Open {meta.name}</button>
                  )}
                  {a.kind === "inactive" && <button className="btn ghost" type="button" onClick={() => go("goals")}>Set a weekly goal</button>}
                  {a.kind === "ready_to_advance" && <button className="btn ghost" type="button" onClick={() => go("track")}>Change the track</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="fam-h3">Notifications</h3>
      <div className="fam-inboxhead">
        <p className="dsub">{inbox.unread === 0 ? "Everything has been read." : `${inbox.unread} unread.`} Goal notifications ("met" and "at risk") arrive here too.</p>
        {inbox.unread > 0 && <button className="btn ghost" type="button" disabled={busy} onClick={readAll}>Mark all read</button>}
      </div>
      <p className="fam-status" role="status">{msg ?? ""}</p>
      {inbox.notifications.length === 0 && <p className="muted">No notifications yet.</p>}
      {inbox.notifications.length > 0 && (
        <ul className="fam-list plain">
          {inbox.notifications.map(n => (
            <li key={n.id} className={"drow fam-note" + (n.readAt ? "" : " unread")}>
              <div className="dhead">
                <b>{!n.readAt && <span className="visually-hidden">Unread: </span>}{n.title}</b>
                <span className="pill">{inbox.kinds[n.kind] ?? n.kindLabel ?? n.kind}</span>
              </div>
              <div className="dsub">{n.learnerName ? `${n.learnerName} · ` : ""}{dateText(n.createdAt)}</div>
              <p className="fam-body">{n.body}</p>
              {!n.readAt && (
                <button className="linkbtn" type="button" disabled={busy} onClick={() => markRead(n.id)}
                  aria-label={`Mark read: ${n.title}`}>Mark read</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------------- Goals (4.2.6) ---------------- */
function GoalsSection({ d, learner, patch }: { d: FamilyData; learner: Learner; patch: (p: Partial<FamilyData>) => void }) {
  const g = d.goal;
  const [rounds, setRounds] = useState(String(g.goal?.roundsPerWeek ?? 5));
  const [minutes, setMinutes] = useState(String(g.goal?.minutesPerWeek ?? 60));
  const [msg, setMsg] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = Number(rounds) || 0, m = Number(minutes) || 0;
    if (!r && !m) { setFormErr("Set at least one target: rounds or minutes."); return; }
    setFormErr(null); setBusy(true); setMsg(null);
    try {
      await fam.setGoal(learner.id, r, m);
      patch({ goal: await fam.goal(learner.id) });
      setMsg("Goal saved.");
    } catch (err) { setMsg(describeError(err)); }
    setBusy(false);
  };

  const minsWeek = mins(d.time.last7DaysSeconds);
  const minTarget = g.goal?.minutesPerWeek ?? 0;
  const roundTarget = g.goal?.roundsPerWeek ?? 0;
  const roundPct = roundTarget ? Math.min(100, Math.round((g.roundsThisWeek / roundTarget) * 100)) : 0;
  const minPct = minTarget ? Math.min(100, Math.round((minsWeek / minTarget) * 100)) : 0;
  const minMet = minTarget ? minsWeek >= minTarget : null;
  const status = !g.goal ? null : g.met || (roundTarget === 0 && minMet) ? "met" : g.atRisk ? "at risk" : "on track";

  return (
    <>
      <h2>Weekly goals</h2>
      <p className="lede">A target for the week. You get a notification when it is met, and another when the week is nearly over with the target still short.</p>

      {g.goal && (
        <div className="drow">
          <div className="dhead"><b>This week</b>
            <span className={"pill" + (status === "met" ? " good" : status === "at risk" ? " warn" : "")}>{status === "met" ? "Met" : status === "at risk" ? "At risk" : "On track"}</span></div>
          {roundTarget > 0 && (
            <div className="secrow fam-goalrow">
              <div className="lbl"><b>Rounds</b><span>{g.roundsThisWeek} of {roundTarget} ({roundPct}%)</span></div>
              <div className="bar" aria-hidden="true"><i style={{ width: `${roundPct}%`, background: g.met ? "var(--good)" : "var(--accent)" }} /></div>
            </div>
          )}
          {minTarget > 0 && (
            <div className="secrow fam-goalrow">
              <div className="lbl"><b>Minutes</b><span>{minsWeek} of {minTarget} ({minPct}%)</span></div>
              <div className="bar" aria-hidden="true"><i style={{ width: `${minPct}%`, background: minMet ? "var(--good)" : "var(--accent)" }} /></div>
            </div>
          )}
          <div className="dsub">Set {g.goal.setAt ? dateText(g.goal.setAt) : "earlier"}. Rounds count the last seven days; minutes come from time on task.</div>
        </div>
      )}
      {!g.goal && <p className="muted">No goal yet. {learner.name} has done {g.roundsThisWeek} round{g.roundsThisWeek === 1 ? "" : "s"} in the last seven days.</p>}

      <form onSubmit={save} className="card fam-form" aria-labelledby={`${uid}-goalh`}>
        <h3 id={`${uid}-goalh`}>{g.goal ? "Change the goal" : "Set a goal"}</h3>
        <div className="field">
          <label htmlFor={`${uid}-rounds`}>Rounds per week (0 to 100)</label>
          <input id={`${uid}-rounds`} type="number" min={0} max={100} inputMode="numeric" value={rounds} onChange={e => setRounds(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-minutes`}>Minutes per week (0 to 2000)</label>
          <input id={`${uid}-minutes`} type="number" min={0} max={2000} inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} />
        </div>
        {formErr && <p className="err" role="alert">{formErr}</p>}
        <div className="rowbtns">
          <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save goal"}</button>
        </div>
        <p className="fam-status" role="status">{msg ?? ""}</p>
      </form>
    </>
  );
}

/* ---------------- Track (4.2.2) ---------------- */
const TRACK_WHY: Record<string, string> = {
  core: "Best for building grade-level fluency. Advanced topics stay visible but are marked optional, so nothing is hidden.",
  enrichment: "For a learner who finds the core work comfortable. Advanced strands are recommended next to each unit.",
  competition: "For a learner preparing for contests. Advanced strands come first, with timed papers and proofs in the plan."
};

function TrackSection({ d, learner, patch }: { d: FamilyData; learner: Learner; patch: (p: Partial<FamilyData>) => void }) {
  const t = d.track;
  const [sel, setSel] = useState(t.track);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fam.setTrack(learner.id, sel);
      patch({ track: { ...t, track: r.track } });
      setMsg(`${learner.name} is now on the ${t.tracks[r.track]?.name ?? r.track} track.`);
    } catch (e) { setMsg(describeError(e)); }
    setBusy(false);
  };

  return (
    <>
      <h2>Curriculum track</h2>
      <p className="lede">The track shapes what is recommended to {learner.name}, never what is allowed. A child on any track can open any topic.</p>
      <p className="hintbox"><b>Recommended: {t.tracks[t.recommended.track]?.name ?? t.recommended.track}</b>, because {t.recommended.reason}.</p>

      <fieldset className="fam-fieldset">
        <legend className="flabel">Choose a track</legend>
        <div className="multibox fam-radios">
          {Object.entries(t.tracks).map(([id, tr]) => (
            <label key={id} className={"multirow fam-radio" + (sel === id ? " on" : "")} htmlFor={`${uid}-${id}`}>
              <input type="radio" id={`${uid}-${id}`} name={`${uid}-track`} value={id} checked={sel === id} onChange={() => setSel(id)} />
              <span>
                <b className="fam-radioname">{tr.name}{t.track === id && <span className="badge">current</span>}{t.recommended.track === id && <span className="badge adv">recommended</span>}</b>
                <span className="dsub">{tr.blurb} {TRACK_WHY[id] ?? ""}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="rowbtns">
        <button className="btn" type="button" disabled={busy || sel === t.track} onClick={save}>{busy ? "Saving…" : "Save track"}</button>
      </div>
      <p className="fam-status" role="status">{msg ?? ""}</p>
    </>
  );
}

/* ---------------- Curriculum overview with sample problems (4.2.7) ---------------- */
function CurriculumSection({ d, cur, onOpenTopic, patch, uid }: {
  d: FamilyData; cur: Curriculum; onOpenTopic: (topicId: string, topicName: string, advanced: boolean) => void;
  patch: (p: Partial<FamilyData>) => void; uid: string;
}) {
  const grades = Object.keys(cur.curriculum).sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  const firstWorked = d.time.byTopic[0]?.gradeKey;
  const [grade, setGrade] = useState(d.grade ?? (firstWorked && cur.curriculum[firstWorked] ? firstWorked : grades[0] ?? "6"));
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const overviews = d.overviews ?? {};
  const ov = overviews[grade];

  useEffect(() => {
    if (overviews[grade]) return;
    let live = true;
    setLoadErr(null);
    fam.overview(grade)
      .then(o => { if (live) patch({ overviews: { ...(d.overviews ?? {}), [grade]: o } }); })
      .catch(e => { if (live) setLoadErr(describeError(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade]);

  return (
    <>
      <h2>Curriculum overview</h2>
      <p className="lede">What each unit covers, the standards it maps to, and one sample problem per topic, taken from the gentlest tier.</p>
      <div className="field fam-gradepick">
        <label htmlFor={`${uid}-grade`}>Grade</label>
        <select id={`${uid}-grade`} value={grade} onChange={e => setGrade(e.target.value)}>
          {grades.map(g => <option key={g} value={g}>{cur.curriculum[g].label}</option>)}
        </select>
      </div>

      {loadErr && <p className="err" role="alert">{loadErr}</p>}
      {!loadErr && !ov && <div className="loading" role="status">Loading {cur.curriculum[grade]?.label ?? "the grade"}…</div>}

      {ov && ov.units.map(u => (
        <section className="unit fam-unit" key={u.name}>
          <h3>{u.name}{u.track === "adv" && <span className="badge adv">advanced</span>}</h3>
          <ul className="fam-list plain">
            {u.topics.map(t => (
              <li key={t.id} className="drow">
                <div className="dhead">
                  <b>{t.name}</b>
                  <span className="pill">{t.questions} question{t.questions === 1 ? "" : "s"} · mastery at {t.threshold}%</span>
                </div>
                {t.standards && (
                  <div className="pills fam-codes">
                    {t.standards.codes.map(c => <span key={c} className="pill">{t.standards!.framework} {c}</span>)}
                    {t.standards.strand && <span className="pill good">{t.standards.strand.name}</span>}
                  </div>
                )}
                {t.standards?.note && <div className="dsub">{t.standards.note}</div>}
                {t.sample ? (
                  <div className="fam-sample">
                    <div className="sec">Sample problem · {t.sample.secName}</div>
                    <p className={"fam-q" + (t.sample.mono ? " mono" : "")}>{t.sample.q}</p>
                    {t.sample.opts && (
                      <ol className="fam-opts" type="A">
                        {t.sample.opts.map((o, i) => <li key={i} className={t.sample!.mono ? "mono" : ""}>{o}</li>)}
                      </ol>
                    )}
                    {t.sample.items && (
                      <p className="dsub">Put in order: {t.sample.items.join(", ")}</p>
                    )}
                    {t.sample.hint && <p className="hint">Hint offered: {t.sample.hint}</p>}
                  </div>
                ) : <p className="muted">Problems for this topic are on the way.</p>}
                {t.questions > 0 && (
                  <div className="rowbtns">
                    <button className="btn ghost" type="button" aria-label={`Open ${t.name}`}
                      onClick={() => onOpenTopic(t.id, t.name, u.track === "adv")}>Open</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/* ---------------- Weekly summary (4.2.4) ---------------- */
function WeeklySection({ d, learner }: { d: FamilyData; learner: Learner }) {
  const w = d.weekly;
  return (
    <>
      <h2>Weekly summary</h2>
      <p className="lede">Week {w.week}. This is the same summary the weekly email carries, for every learner on the account.</p>
      {w.learners.length === 0 && <p className="muted">No learners yet.</p>}
      {w.learners.length > 0 && (
        <ul className="fam-list plain">
          {w.learners.map(l => (
            <li key={l.learnerId} className={"drow" + (l.learnerId === learner.id ? " fam-me" : "")}>
              <div className="dhead"><b>{l.name}</b>
                <span className="pill">{l.rounds} round{l.rounds === 1 ? "" : "s"} · {l.minutes} min</span></div>
              <div className="dsub">
                {l.streak ? `${l.streak}-day streak. ` : "No current streak. "}
                {l.mastered.length ? `Mastered: ${l.mastered.join(", ")}. ` : "Nothing newly mastered this week. "}
                {l.badges.length ? `Badges: ${l.badges.join(", ")}.` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="fam-h3">As it reads in the email</h3>
      <blockquote className="fam-mail">{w.text}</blockquote>
    </>
  );
}

/* ---------------- Reports (4.2.3, 9.3) ---------------- */
function ReportsSection({ d, cur, learner }: { d: FamilyData; cur: Curriculum; learner: Learner }) {
  const base = `/api/learners/${encodeURIComponent(learner.id)}`;
  const e = d.errors;
  return (
    <>
      <h2>Reports</h2>
      <p className="lede">Exports of {learner.name}'s progress, and the pattern behind recent mistakes.</p>
      <ul className="fam-links">
        <li><a className="btn ghost" href={`${base}/report.csv`} download="progress.csv">Download progress as CSV</a></li>
        <li><a className="btn ghost" href={`${base}/report.html`} target="_blank" rel="noopener noreferrer">Printable report (opens in a new tab)</a></li>
      </ul>
      <p className="dsub">The printable report can be saved as a PDF from the browser's print dialog.</p>

      <h3 className="fam-h3">Error categories</h3>
      {e.total === 0 && <p className="muted">No mistakes recorded yet.</p>}
      {e.total > 0 && (
        <>
          <p className="dsub">{e.total} recent mistake{e.total === 1 ? "" : "s"}, grouped by what went wrong:</p>
          <ul className="fam-list">
            {e.byCategory.map(c => <li key={c.category}>{c.label}: {c.count}</li>)}
          </ul>
          <h3 className="fam-h3">By topic</h3>
          <ul className="fam-list plain">
            {e.byTopic.map(t => (
              <li key={t.topicId} className="drow">
                <div className="dhead"><b>{topicMeta(cur, t.topicId).name}</b><span className="pill">{t.count}</span></div>
                <div className="pills">{t.categories.map(c => <span key={c.category} className="pill">{c.label.split(" — ")[0]} × {c.count}</span>)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
