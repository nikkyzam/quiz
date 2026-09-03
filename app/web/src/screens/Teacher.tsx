/* Teacher console (spec 4.3.1-4.3.5, 4.1.8, 5.8): classes and rostering,
   assignments with due dates and group tracks, accommodations, reports,
   competition teams, leaderboard and tournament controls. */
import "../styles/teacher.css";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { api, type User } from "../api";
import {
  explain, useLoad, fmtDate, fmtWhen, teacherApi as T, TRACKS, CONTEST_FORMATS,
  type ClassRow, type RosterEntry, type ProgressData, type Group, type Team, type Tournament,
  type Leaderboard, type ContestBoard, type ClassSettings, type Thresholds, type Accommodations
} from "./teacher.api";

export type Curriculum = Awaited<ReturnType<typeof api.curriculum>>;

export type TeacherTab = "roster" | "progress" | "assignments" | "groups" | "accommodations" | "settings" | "teams" | "reports" | "leaderboards";

export type TeacherData = {
  classes: ClassRow[];
  selected?: string;
  tab?: TeacherTab;
  roster?: RosterEntry[];
  progress?: ProgressData;
  groups?: Group[];
  teams?: Team[];
  tournament?: Tournament;
  leaderboard?: Leaderboard;
  contest?: ContestBoard;
  settings?: ClassSettings;
  thresholds?: Thresholds;
};

const TABS: { id: TeacherTab; label: string }[] = [
  { id: "roster", label: "Roster" }, { id: "progress", label: "Progress" }, { id: "assignments", label: "Assignments" },
  { id: "groups", label: "Groups" }, { id: "accommodations", label: "Accommodations" }, { id: "settings", label: "Settings" },
  { id: "teams", label: "Teams & Tournament" }, { id: "reports", label: "Reports" }, { id: "leaderboards", label: "Leaderboards" }
];

type TopicMeta = { id: string; name: string; grade: string; unit: string; adv: boolean; authored: boolean };

function useTopics(cur: Curriculum) {
  return useMemo(() => {
    const list: TopicMeta[] = [];
    for (const g of Object.values(cur.curriculum))
      for (const u of g.units)
        for (const t of u.topics)
          list.push({ id: t.id, name: t.name, grade: g.label, unit: u.name, adv: u.track === "adv", authored: !!cur.counts?.[t.id] });
    const byId = new Map(list.map(t => [t.id, t]));
    return { list, name: (id: string) => byId.get(id)?.name ?? id, byGrade: groupBy(list.filter(t => t.authored), t => t.grade) };
  }, [cur]);
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const out: [string, T[]][] = [];
  for (const x of xs) {
    const k = key(x);
    const hit = out.find(o => o[0] === k);
    if (hit) hit[1].push(x); else out.push([k, [x]]);
  }
  return out;
}

function Status({ msg, err }: { msg: string; err: string }) {
  return (
    <>
      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="notice" role="status">{msg}</p>}
    </>
  );
}

/* ================= class list ================= */
export function Teacher({ user, cur, onBack, initial }: { user: User; cur: Curriculum; onBack: () => void; initial?: TeacherData }) {
  const list = useLoad(async () => (await T.classes()).classes, initial?.classes);
  const [selected, setSelected] = useState<string | null>(initial?.selected ?? null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; joinCode: string } | null>(null);
  const [formErr, setFormErr] = useState("");
  const nameId = useId();

  const cls = list.data?.find(c => c.id === selected);
  if (cls) {
    return <ClassDetail cls={cls} cur={cur} initial={initial?.selected === cls.id ? initial : undefined}
                        onBack={() => { setSelected(null); list.reload(); }} />;
  }

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setFormErr("");
    try {
      const r = await T.createClass(name.trim());
      setCreated({ name: r.class.name, joinCode: r.class.joinCode });
      setName("");
      await list.reload();
    } catch (err) { setFormErr(explain(err)); }
    setBusy(false);
  };

  return (
    <div className="tc">
      <button className="back" onClick={onBack}>← Back</button>
      <div className="eyebrow">Teacher console</div>
      <h1>Your classes</h1>
      <p className="lede">Signed in as {user.name}. Parents add a learner to a class with its join code, or claim a roster entry with its claim code; a teacher never adds a child directly.</p>

      {list.err && <p className="err" role="alert">{list.err}</p>}
      {list.data === null && !list.err && <div className="loading" role="status">Loading classes…</div>}
      {list.data && list.data.length === 0 && <p className="muted">No classes yet. Create one below.</p>}
      {list.data && list.data.length > 0 && (
        <ul className="tc-list">
          {list.data.map(c => (
            <li key={c.id}>
              <button type="button" className="tc-classbtn" onClick={() => setSelected(c.id)}>
                <span className="tc-classname">{c.name}</span>
                <span className="tc-classmeta">Join code <code className="tc-code">{c.joinCode}</code> · {c.members} {c.members === 1 ? "learner" : "learners"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="card tc-form" onSubmit={create}>
        <h2>Create a class</h2>
        <div className="field">
          <label htmlFor={nameId}>Class name</label>
          <input id={nameId} value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. 6B Maths" required />
        </div>
        <button className="btn" type="submit" disabled={busy || !name.trim()}>Create class</button>
        <Status err={formErr} msg={created ? `Created ${created.name}. Join code: ${created.joinCode}. Share it with parents so they can add their learner.` : ""} />
      </form>
    </div>
  );
}

/* ================= class detail ================= */
function ClassDetail({ cls, cur, initial, onBack }: { cls: ClassRow; cur: Curriculum; initial?: TeacherData; onBack: () => void }) {
  const [tab, setTab] = useState<TeacherTab>(initial?.tab ?? "roster");
  const topics = useTopics(cur);
  const progress = useLoad(() => T.progress(cls.id), initial?.progress, cls.id);
  const learners = progress.data?.learners ?? [];
  const label = TABS.find(t => t.id === tab)?.label ?? "";

  return (
    <div className="tc">
      <button className="back" onClick={onBack}>← Back</button>
      <div className="eyebrow">Class</div>
      <h1>{cls.name}</h1>
      <p className="lede">Join code <code className="tc-code">{cls.joinCode}</code> · {cls.members} enrolled</p>

      <div className="tabs tc-tabs" role="tablist" aria-label="Class sections">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={"tab" + (tab === t.id ? " on" : "")}
                  onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <section role="tabpanel" aria-label={label}>
        {tab === "roster" && <RosterTab cls={cls} seed={initial?.roster} />}
        {tab === "progress" && <ProgressTab cls={cls} topics={topics} progress={progress.data} err={progress.err} reload={progress.reload} />}
        {tab === "assignments" && <AssignmentsTab cls={cls} cur={cur} topics={topics} progress={progress.data} reload={progress.reload} seedGroups={initial?.groups} />}
        {tab === "groups" && <GroupsTab cls={cls} learners={learners} seed={initial?.groups} />}
        {tab === "accommodations" && <AccommodationsTab cls={cls} learners={learners} />}
        {tab === "settings" && <SettingsTab cls={cls} cur={cur} seedSettings={initial?.settings} seedThresholds={initial?.thresholds} />}
        {tab === "teams" && <TeamsTab cls={cls} learners={learners} seedTeams={initial?.teams} seedTournament={initial?.tournament} />}
        {tab === "reports" && <ReportsTab cls={cls} />}
        {tab === "leaderboards" && <LeaderboardsTab cls={cls} seedBoard={initial?.leaderboard} seedContest={initial?.contest} />}
      </section>
    </div>
  );
}

/* ---------------- Roster ---------------- */
function RosterTab({ cls, seed }: { cls: ClassRow; seed?: RosterEntry[] }) {
  const roster = useLoad(async () => (await T.roster(cls.id)).roster, seed, cls.id);
  const [csv, setCsv] = useState("");
  const [or, setOr] = useState({ classes: "", users: "", enrollments: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const readFile = (f: File | undefined, into: (s: string) => void) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => into(String(r.result || ""));
    r.readAsText(f);
  };

  const importCsv = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await T.importCsv(cls.id, csv);
      const updated = r.entries.filter(x => x.updated).length;
      setMsg(`Imported ${r.imported} roster ${r.imported === 1 ? "entry" : "entries"}${updated ? ` (${updated} updated)` : ""}. Each has a claim code for the parent.`);
      setCsv("");
      await roster.reload();
    } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  const importOneRoster = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await T.importOneRoster(or.classes, or.users, or.enrollments);
      setMsg(`OneRoster import provisioned ${r.classes.length} ${r.classes.length === 1 ? "class" : "classes"}: ` +
        r.classes.map(c => `${c.name} (${c.students} students)`).join(", ") + ". Go back to the class list to open them.");
      setOr({ classes: "", users: "", enrollments: "" });
    } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  return (
    <>
      <h2>Roster</h2>
      <p className="muted">Roster entries wait for a parent to claim them with the claim code. Claimed entries show the linked learner.</p>
      {roster.err && <p className="err" role="alert">{roster.err}</p>}
      {roster.data === null && !roster.err && <div className="loading" role="status">Loading roster…</div>}
      {roster.data && roster.data.length === 0 && <p className="muted">No roster entries yet. Import a CSV below.</p>}
      {roster.data && roster.data.length > 0 && (
        <div className="scroll">
          <table className="tc-table">
            <caption className="visually-hidden">Roster for {cls.name}</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Student ID</th><th scope="col">Guardian email</th><th scope="col">Claim code</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {roster.data.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.externalId || "none"}</td>
                  <td>{r.guardianEmail || "none"}</td>
                  <td>{r.claimCode ? <code className="tc-code">{r.claimCode}</code> : "used"}</td>
                  <td>{r.claimed ? <span className="pill good">claimed{r.learnerName ? `: ${r.learnerName}` : ""}</span> : <span className="pill">waiting</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Status msg={msg} err={err} />

      <form className="card tc-form" onSubmit={importCsv}>
        <h3>Import a CSV</h3>
        <p className="muted">Needs a header row with a <code>name</code> column (or <code>givenName</code> and <code>familyName</code>); optional <code>studentId</code> and <code>guardianEmail</code>. Up to 200 rows.</p>
        <div className="field">
          <label htmlFor={id + "-file"}>Choose a CSV file</label>
          <input id={id + "-file"} type="file" accept=".csv,text/csv" onChange={e => readFile(e.target.files?.[0], setCsv)} />
        </div>
        <div className="field">
          <label htmlFor={id + "-csv"}>Or paste CSV text</label>
          <textarea id={id + "-csv"} rows={5} value={csv} onChange={e => setCsv(e.target.value)}
                    placeholder={"name,studentId,guardianEmail\nAva Brown,1001,ava.parent@example.org"} />
        </div>
        <button className="btn" type="submit" disabled={busy || !csv.trim()}>Import roster</button>
      </form>

      <form className="card tc-form" onSubmit={importOneRoster}>
        <h3>Import a OneRoster bundle</h3>
        <p className="muted">Paste the three OneRoster CSV files (Clever and ClassLink exports). Classes are created under your account.</p>
        {(["classes", "users", "enrollments"] as const).map(k => (
          <div className="field" key={k}>
            <label htmlFor={`${id}-or-${k}`}>{k}.csv</label>
            <input id={`${id}-or-${k}-file`} type="file" accept=".csv,text/csv" aria-label={`Choose ${k}.csv file`}
                   onChange={e => readFile(e.target.files?.[0], s => setOr(o => ({ ...o, [k]: s })))} />
            <textarea id={`${id}-or-${k}`} rows={3} value={or[k]} onChange={e => setOr(o => ({ ...o, [k]: e.target.value }))} />
          </div>
        ))}
        <button className="btn ghost" type="submit" disabled={busy || !(or.classes && or.users && or.enrollments)}>Import OneRoster</button>
      </form>
    </>
  );
}

/* ---------------- Progress ---------------- */
function ProgressTab({ cls, topics, progress, err, reload }: {
  cls: ClassRow; topics: ReturnType<typeof useTopics>; progress: ProgressData | null; err: string; reload: () => Promise<void>;
}) {
  const [msg, setMsg] = useState("");
  const [trackErr, setTrackErr] = useState("");
  const id = useId();

  const setTrack = async (learnerId: string, name: string, track: string) => {
    if (!track) return;
    setTrackErr(""); setMsg("");
    try { await T.setTrack(cls.id, learnerId, track); setMsg(`${name} is now on the ${track} track.`); await reload(); }
    catch (e) { setTrackErr(explain(e)); }
  };

  if (err) return <><h2>Progress</h2><p className="err" role="alert">{err}</p></>;
  if (!progress) return <><h2>Progress</h2><div className="loading" role="status">Loading progress…</div></>;
  const assignments = progress.assignments;

  return (
    <>
      <h2>Progress</h2>
      <Status msg={msg} err={trackErr} />
      {progress.learners.length === 0 && <p className="muted">No learners have joined yet. Share the join code or import a roster.</p>}
      {progress.learners.length > 0 && (
        <div className="scroll">
          <table className="tc-table">
            <caption className="visually-hidden">Mastery per learner in {cls.name}</caption>
            <thead>
              <tr>
                <th scope="col">Learner</th>
                <th scope="col" className="tc-num">Topics mastered</th>
                {assignments.map(a => <th scope="col" key={a.id}>{topics.name(a.topic_id)}{a.tier ? ` (${a.tier})` : ""}</th>)}
                <th scope="col">Track</th>
              </tr>
            </thead>
            <tbody>
              {progress.learners.map(l => (
                <tr key={l.learnerId}>
                  <th scope="row">{l.name}</th>
                  <td className="tc-num">{l.topicsMastered}</td>
                  {assignments.map(a => {
                    const x = l.assignments.find(y => y.assignmentId === a.id);
                    return <td key={a.id}>{!x ? <span className="muted">n/a</span> : !x.attempted ? <span className="muted">not started</span>
                      : <span className={"pill" + (x.mastered ? " good" : "")}>{x.bestPct}%{x.mastered ? " mastered" : ""}</span>}</td>;
                  })}
                  <td>
                    <label className="visually-hidden" htmlFor={`${id}-tr-${l.learnerId}`}>Track for {l.name}</label>
                    <select id={`${id}-tr-${l.learnerId}`} className="tc-select" defaultValue="" onChange={e => setTrack(l.learnerId, l.name, e.target.value)}>
                      <option value="">Set track…</option>
                      {TRACKS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Class heatmap</h3>
      {progress.heatmap.length === 0 ? <p className="muted">Assign a topic to see how the class is doing on it.</p> : (
        <div className="scroll">
          <table className="tc-table">
            <caption className="visually-hidden">Class results per assigned topic</caption>
            <thead><tr><th scope="col">Topic</th><th scope="col">Scope</th><th scope="col" className="tc-num">Assigned</th><th scope="col" className="tc-num">Attempted</th><th scope="col" className="tc-num">Average</th><th scope="col" className="tc-num">Mastered</th></tr></thead>
            <tbody>
              {progress.heatmap.map((h, i) => (
                <tr key={i}>
                  <td>{topics.name(h.topicId)}</td><td>{h.groupId ? "group" : "whole class"}</td>
                  <td className="tc-num">{h.assigned}</td><td className="tc-num">{h.attempted}</td>
                  <td className="tc-num">{h.averagePct}%</td><td className="tc-num">{h.mastered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------- Assignments ---------------- */
function AssignmentsTab({ cls, cur, topics, progress, reload, seedGroups }: {
  cls: ClassRow; cur: Curriculum; topics: ReturnType<typeof useTopics>; progress: ProgressData | null;
  reload: () => Promise<void>; seedGroups?: Group[];
}) {
  const groups = useLoad(async () => (await T.groups(cls.id)).groups, seedGroups, cls.id);
  const [topicId, setTopicId] = useState("");
  const [tier, setTier] = useState("");
  const [due, setDue] = useState("");
  const [groupId, setGroupId] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      await T.assign(cls.id, { topicId, tier: tier || null, dueAt: due ? new Date(due + "T23:59:00").toISOString() : null, groupId: groupId || null });
      setMsg(`Assigned ${topics.name(topicId)}${tier ? ` (${tier})` : ""}${due ? `, due ${fmtDate(due)}` : ""}.`);
      setTopicId(""); setTier(""); setDue(""); setGroupId("");
      await reload();
    } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  const groupName = (gid: string | null) => (gid ? groups.data?.find(g => g.id === gid)?.name ?? "group" : "whole class");
  const list = progress?.assignments ?? [];

  return (
    <>
      <h2>Assignments</h2>
      <form className="card tc-form" onSubmit={create}>
        <h3>New assignment</h3>
        <div className="tc-row">
          <div className="field">
            <label htmlFor={id + "-topic"}>Topic</label>
            <select id={id + "-topic"} value={topicId} onChange={e => setTopicId(e.target.value)} required>
              <option value="">Choose a topic…</option>
              {topics.byGrade.map(([grade, ts]) => (
                <optgroup key={grade} label={grade}>
                  {ts.map(t => <option key={t.id} value={t.id}>{t.name}{t.adv ? " (advanced)" : ""}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={id + "-tier"}>Tier</label>
            <select id={id + "-tier"} value={tier} onChange={e => setTier(e.target.value)}>
              <option value="">Any tier</option>
              {cur.tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="tc-row">
          <div className="field">
            <label htmlFor={id + "-due"}>Due date</label>
            <input id={id + "-due"} type="date" value={due} onChange={e => setDue(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={id + "-group"}>Group (optional)</label>
            <select id={id + "-group"} value={groupId} onChange={e => setGroupId(e.target.value)}>
              <option value="">Whole class</option>
              {(groups.data ?? []).map(g => <option key={g.id} value={g.id}>{g.name}{g.track ? ` (${g.track})` : ""}</option>)}
            </select>
          </div>
        </div>
        <button className="btn" type="submit" disabled={busy || !topicId}>Assign</button>
        <Status msg={msg} err={err || groups.err} />
      </form>

      <h3>Current assignments</h3>
      {!progress && <div className="loading" role="status">Loading assignments…</div>}
      {progress && list.length === 0 && <p className="muted">Nothing assigned yet.</p>}
      {list.length > 0 && (
        <div className="scroll">
          <table className="tc-table">
            <caption className="visually-hidden">Assignments for {cls.name}</caption>
            <thead><tr><th scope="col">Topic</th><th scope="col">Tier</th><th scope="col">Due</th><th scope="col">Scope</th><th scope="col">Created</th></tr></thead>
            <tbody>
              {list.map(a => (
                <tr key={a.id}>
                  <td>{topics.name(a.topic_id)}</td><td>{a.tier || "any"}</td><td>{fmtDate(a.due_at)}</td>
                  <td>{groupName(a.group_id)}</td><td>{fmtDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------- Groups ---------------- */
function GroupsTab({ cls, learners, seed }: { cls: ClassRow; learners: { learnerId: string; name: string }[]; seed?: Group[] }) {
  const groups = useLoad(async () => (await T.groups(cls.id)).groups, seed, cls.id);
  const [name, setName] = useState("");
  const [track, setTrack] = useState("");
  const [gid, setGid] = useState("");
  const [lid, setLid] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try { const r = await T.createGroup(cls.id, name.trim(), track || null); setMsg(`Created group ${r.group.name}.`); setName(""); setTrack(""); await groups.reload(); }
    catch (x) { setErr(explain(x)); }
    setBusy(false);
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await T.addGroupMember(cls.id, gid, lid);
      const ln = learners.find(l => l.learnerId === lid)?.name ?? "Learner";
      setMsg(`${ln} added to the group${r.track ? ` and moved to the ${r.track} track` : ""}.`);
      setLid(""); await groups.reload();
    } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  return (
    <>
      <h2>Groups</h2>
      <p className="muted">A group with a track moves each learner placed in it onto that track. Assignments can target a group.</p>
      {groups.err && <p className="err" role="alert">{groups.err}</p>}
      {groups.data === null && !groups.err && <div className="loading" role="status">Loading groups…</div>}
      {groups.data && groups.data.length === 0 && <p className="muted">No groups yet.</p>}
      {groups.data && groups.data.length > 0 && (
        <ul className="tc-cards">
          {groups.data.map(g => (
            <li className="drow" key={g.id}>
              <div className="dhead"><b>{g.name}</b>{g.track && <span className="badge">{g.track}</span>}</div>
              <div className="dsub">{g.members.length} {g.members.length === 1 ? "member" : "members"}</div>
              {g.members.length > 0 && <ul className="tc-inline">{g.members.map(m => <li key={m.id} className="pill">{m.name}</li>)}</ul>}
            </li>
          ))}
        </ul>
      )}
      <Status msg={msg} err={err} />

      <form className="card tc-form" onSubmit={create}>
        <h3>Create a group</h3>
        <div className="tc-row">
          <div className="field">
            <label htmlFor={id + "-gname"}>Group name</label>
            <input id={id + "-gname"} value={name} onChange={e => setName(e.target.value)} maxLength={40} required />
          </div>
          <div className="field">
            <label htmlFor={id + "-gtrack"}>Track</label>
            <select id={id + "-gtrack"} value={track} onChange={e => setTrack(e.target.value)}>
              <option value="">No track change</option>
              {TRACKS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <button className="btn" type="submit" disabled={busy || !name.trim()}>Create group</button>
      </form>

      <form className="card tc-form" onSubmit={add}>
        <h3>Add a learner to a group</h3>
        <div className="tc-row">
          <div className="field">
            <label htmlFor={id + "-pickg"}>Group</label>
            <select id={id + "-pickg"} value={gid} onChange={e => setGid(e.target.value)} required>
              <option value="">Choose a group…</option>
              {(groups.data ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={id + "-pickl"}>Learner</label>
            <select id={id + "-pickl"} value={lid} onChange={e => setLid(e.target.value)} required>
              <option value="">Choose a learner…</option>
              {learners.map(l => <option key={l.learnerId} value={l.learnerId}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn ghost" type="submit" disabled={busy || !gid || !lid}>Add to group</button>
      </form>
    </>
  );
}

/* ---------------- Accommodations ---------------- */
const ACC_DEFAULT: Accommodations = { extraTimePct: 0, hintsInChecks: false, shorterChecks: false, readAloud: false, notes: "" };

function AccommodationsTab({ cls, learners }: { cls: ClassRow; learners: { learnerId: string; name: string }[] }) {
  const [lid, setLid] = useState("");
  const [acc, setAcc] = useState<Accommodations>(ACC_DEFAULT);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await T.setAccommodations(cls.id, lid, acc);
      const ln = learners.find(l => l.learnerId === lid)?.name ?? "the learner";
      const on = [r.accommodations.extraTimePct ? `${r.accommodations.extraTimePct}% extra time` : "", r.accommodations.readAloud ? "read aloud" : "",
                  r.accommodations.hintsInChecks ? "hints in checks" : "", r.accommodations.shorterChecks ? "shorter checks" : ""].filter(Boolean);
      setMsg(`Saved for ${ln}: ${on.length ? on.join(", ") : "no accommodations"}.`);
    } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  const check = (k: "hintsInChecks" | "shorterChecks" | "readAloud", label: string) => (
    <label className="checkline" key={k}>
      <input type="checkbox" checked={acc[k]} onChange={e => setAcc(a => ({ ...a, [k]: e.target.checked }))} />
      <span>{label}</span>
    </label>
  );

  return (
    <>
      <h2>Accommodations</h2>
      <p className="muted">Applied to that learner's timed checks and contests in this class. Saving replaces the previous setting.</p>
      <form className="card tc-form" onSubmit={save}>
        <div className="field">
          <label htmlFor={id + "-l"}>Learner</label>
          <select id={id + "-l"} value={lid} onChange={e => { setLid(e.target.value); setAcc(ACC_DEFAULT); setMsg(""); }} required>
            <option value="">Choose a learner…</option>
            {learners.map(l => <option key={l.learnerId} value={l.learnerId}>{l.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id + "-extra"}>Extra time (percent, 0 to 100)</label>
          <input id={id + "-extra"} type="number" min={0} max={100} step={5} value={acc.extraTimePct}
                 onChange={e => setAcc(a => ({ ...a, extraTimePct: Number(e.target.value) || 0 }))} />
        </div>
        <fieldset className="tc-fieldset">
          <legend className="flabel">Supports</legend>
          {check("readAloud", "Read questions aloud")}
          {check("hintsInChecks", "Allow hints during mastery checks")}
          {check("shorterChecks", "Reduced load: shorter checks")}
        </fieldset>
        <div className="field">
          <label htmlFor={id + "-notes"}>Notes (visible to teachers only)</label>
          <textarea id={id + "-notes"} rows={3} maxLength={500} value={acc.notes} onChange={e => setAcc(a => ({ ...a, notes: e.target.value }))} />
        </div>
        <button className="btn" type="submit" disabled={busy || !lid}>Save accommodations</button>
        <Status msg={msg} err={err} />
      </form>
    </>
  );
}

/* ---------------- Settings ---------------- */
function SettingsTab({ cls, cur, seedSettings, seedThresholds }: { cls: ClassRow; cur: Curriculum; seedSettings?: ClassSettings; seedThresholds?: Thresholds }) {
  const [s, setS] = useState<ClassSettings>(seedSettings ?? { leaderboardOn: false, displayNames: false, tournamentOn: false });
  const [th, setTh] = useState({ core: String(seedThresholds?.core ?? cur.mastery?.core ?? 90), adv: String(seedThresholds?.adv ?? cur.mastery?.adv ?? 80) });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await T.setSettings(cls.id, s);
      setMsg(`Saved. Leaderboard ${r.settings.leaderboardOn ? "on" : "off"}${r.settings.leaderboardOn ? (r.settings.displayNames ? " with names" : ", anonymised") : ""}; tournament ${r.settings.tournamentOn ? "on" : "off"}.`);
    } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };
  const saveThresholds = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await T.setThresholds(cls.id, { core: Number(th.core), adv: Number(th.adv) });
      setMsg(`Mastery thresholds saved: core ${r.thresholds.core}%, advanced ${r.thresholds.adv}%.`);
    } catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  return (
    <>
      <h2>Settings</h2>
      <Status msg={msg} err={err} />
      <form className="card tc-form" onSubmit={saveSettings}>
        <h3>Leaderboard and tournament</h3>
        <p className="muted">Both are off by default. Learners are only ever ranked against classmates in this class; a parent can withdraw a child by leaving the class.</p>
        <fieldset className="tc-fieldset">
          <legend className="flabel">Class leaderboard</legend>
          <label className="checkline"><input type="checkbox" checked={s.leaderboardOn} onChange={e => setS(x => ({ ...x, leaderboardOn: e.target.checked }))} /><span>Turn the leaderboard on</span></label>
          <label className="checkline"><input type="checkbox" checked={s.displayNames} disabled={!s.leaderboardOn} onChange={e => setS(x => ({ ...x, displayNames: e.target.checked }))} /><span>Show learner names (off = anonymised as "Learner 1, 2, ...")</span></label>
        </fieldset>
        <fieldset className="tc-fieldset">
          <legend className="flabel">Team tournament</legend>
          <label className="checkline"><input type="checkbox" checked={s.tournamentOn} onChange={e => setS(x => ({ ...x, tournamentOn: e.target.checked }))} /><span>Run a weekly team tournament (points reset each Monday)</span></label>
        </fieldset>
        <button className="btn" type="submit" disabled={busy}>Save settings</button>
      </form>

      <form className="card tc-form" onSubmit={saveThresholds}>
        <h3>Mastery thresholds</h3>
        <p className="muted">Platform defaults are core {cur.mastery?.core ?? 90}% and advanced {cur.mastery?.adv ?? 80}%. Allowed range 50 to 100.</p>
        <div className="tc-row">
          <div className="field">
            <label htmlFor={id + "-core"}>Core topics (%)</label>
            <input id={id + "-core"} type="number" min={50} max={100} value={th.core} onChange={e => setTh(t => ({ ...t, core: e.target.value }))} required />
          </div>
          <div className="field">
            <label htmlFor={id + "-adv"}>Advanced topics (%)</label>
            <input id={id + "-adv"} type="number" min={50} max={100} value={th.adv} onChange={e => setTh(t => ({ ...t, adv: e.target.value }))} required />
          </div>
        </div>
        <button className="btn ghost" type="submit" disabled={busy}>Save thresholds</button>
      </form>
    </>
  );
}

/* ---------------- Teams & Tournament ---------------- */
function TeamsTab({ cls, learners, seedTeams, seedTournament }: {
  cls: ClassRow; learners: { learnerId: string; name: string }[]; seedTeams?: Team[]; seedTournament?: Tournament;
}) {
  const teams = useLoad(async () => (await T.teams(cls.id)).teams, seedTeams, cls.id);
  const tour = useLoad(() => T.tournament(cls.id), seedTournament, cls.id);
  const [name, setName] = useState("");
  const [tid, setTid] = useState("");
  const [lid, setLid] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr(""); setMsg("");
    try { setMsg(await fn()); await Promise.all([teams.reload(), tour.reload()]); }
    catch (x) { setErr(explain(x)); }
    setBusy(false);
  };

  return (
    <>
      <h2>Teams and tournament</h2>
      <p className="muted">A learner belongs to one team per class. Team points add up each learner's points; the tournament ranks teams on this week's points only.</p>
      {(teams.err || err) && <p className="err" role="alert">{teams.err || err}</p>}
      {msg && <p className="notice" role="status">{msg}</p>}
      {teams.data === null && !teams.err && <div className="loading" role="status">Loading teams…</div>}
      {teams.data && teams.data.length === 0 && <p className="muted">No teams yet.</p>}
      {teams.data && teams.data.length > 0 && (
        <ul className="tc-cards">
          {teams.data.map(t => (
            <li className="drow" key={t.id}>
              <div className="dhead"><b>{t.name}</b><span className="tc-points">{t.points} pts</span></div>
              <div className="dsub">{t.members.length} {t.members.length === 1 ? "member" : "members"}</div>
              {t.members.length > 0 && <ul className="tc-inline">{t.members.map((m, i) => <li key={m.learnerId ?? i} className="pill">{m.name} · {m.points}</li>)}</ul>}
              <div className="rowbtns">
                <button type="button" className="btn ghost danger" disabled={busy} aria-label={`Delete team ${t.name}`}
                        onClick={() => run(async () => { await T.deleteTeam(cls.id, t.id); return `Deleted team ${t.name}.`; })}>Delete team</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="card tc-form" onSubmit={e => { e.preventDefault(); run(async () => { const r = await T.createTeam(cls.id, name.trim()); setName(""); return `Created team ${r.team.name}.`; }); }}>
        <h3>Create a team</h3>
        <div className="field">
          <label htmlFor={id + "-tname"}>Team name</label>
          <input id={id + "-tname"} value={name} onChange={e => setName(e.target.value)} maxLength={40} required />
        </div>
        <button className="btn" type="submit" disabled={busy || !name.trim()}>Create team</button>
      </form>

      <form className="card tc-form" onSubmit={e => { e.preventDefault(); run(async () => {
        await T.addTeamMember(cls.id, tid, lid);
        const ln = learners.find(l => l.learnerId === lid)?.name ?? "Learner";
        const tn = teams.data?.find(t => t.id === tid)?.name ?? "the team";
        setLid(""); return `${ln} joined ${tn}.`;
      }); }}>
        <h3>Add a learner to a team</h3>
        <div className="tc-row">
          <div className="field">
            <label htmlFor={id + "-pickt"}>Team</label>
            <select id={id + "-pickt"} value={tid} onChange={e => setTid(e.target.value)} required>
              <option value="">Choose a team…</option>
              {(teams.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={id + "-pickl"}>Learner</label>
            <select id={id + "-pickl"} value={lid} onChange={e => setLid(e.target.value)} required>
              <option value="">Choose a learner…</option>
              {learners.map(l => <option key={l.learnerId} value={l.learnerId}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn ghost" type="submit" disabled={busy || !tid || !lid}>Add to team</button>
      </form>

      <h3>Tournament standings</h3>
      {tour.err && <p className="err" role="alert">{tour.err}</p>}
      {tour.data === null && !tour.err && <div className="loading" role="status">Loading tournament…</div>}
      {tour.data && !tour.data.enabled && <p className="muted">{tour.data.reason} Turn it on under Settings.</p>}
      {tour.data?.enabled && (
        <>
          <p className="muted">Week of {fmtDate(tour.data.week?.start)} to {fmtDate(tour.data.week?.end)}.</p>
          {(tour.data.teams ?? []).length === 0 ? <p className="muted">No teams to rank yet.</p> : (
            <div className="scroll">
              <table className="tc-table">
                <caption className="visually-hidden">Tournament standings this week</caption>
                <thead><tr><th scope="col" className="tc-num">Rank</th><th scope="col">Team</th><th scope="col" className="tc-num">Points this week</th><th scope="col" className="tc-num">Members</th></tr></thead>
                <tbody>{(tour.data.teams ?? []).map(t => (
                  <tr key={t.id}><td className="tc-num">{t.rank}</td><td>{t.name}</td><td className="tc-num">{t.points}</td><td className="tc-num">{t.members.length}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ---------------- Reports ---------------- */
function ReportsTab({ cls }: { cls: ClassRow }) {
  const base = `/api/classes/${encodeURIComponent(cls.id)}`;
  return (
    <>
      <h2>Reports</h2>
      <ul className="tc-cards">
        <li className="drow">
          <div className="dhead"><b>Class progress</b></div>
          <div className="dsub">One row per learner per topic and tier: best score, mastered, attempts. Opens in a spreadsheet.</div>
          <div className="rowbtns"><a className="btn ghost" href={`${base}/report.csv`} download="class-progress.csv">Download CSV</a></div>
        </li>
        <li className="drow">
          <div className="dhead"><b>Gifted and talented report</b></div>
          <div className="dsub">Advanced topics mastered, known skills, best timed paper and percentile per learner, with an indicator and a recommendation. Indicators are a prompt for a conversation, not a verdict.</div>
          <div className="rowbtns">
            <a className="btn" href={`${base}/gifted.html`} target="_blank" rel="noopener noreferrer">Open printable report</a>
            <a className="btn ghost" href={`${base}/gifted.csv`} download="gifted-report.csv">Download CSV</a>
          </div>
        </li>
      </ul>
      <p className="muted">Every report download is recorded in the audit log.</p>
    </>
  );
}

/* ---------------- Leaderboards ---------------- */
function LeaderboardsTab({ cls, seedBoard, seedContest }: { cls: ClassRow; seedBoard?: Leaderboard; seedContest?: ContestBoard }) {
  const board = useLoad(() => T.leaderboard(cls.id), seedBoard, cls.id);
  const [format, setFormat] = useState(seedContest?.format && seedContest.format !== "all" ? seedContest.format : "");
  const contest = useLoad(() => T.contest(cls.id, format), seedContest, cls.id + ":" + format);
  const [first, setFirst] = useState(true);
  useEffect(() => { if (first) { setFirst(false); return; } contest.reload(); }, [format]); // eslint-disable-line react-hooks/exhaustive-deps
  const id = useId();

  return (
    <>
      <h2>Leaderboards</h2>
      <p className="muted">Shown to families only when turned on under Settings. As the teacher you always see names.</p>

      <h3>Class points</h3>
      {board.err && <p className="err" role="alert">{board.err}</p>}
      {board.data === null && !board.err && <div className="loading" role="status">Loading leaderboard…</div>}
      {board.data && !board.data.enabled && <p className="muted">{board.data.reason}</p>}
      {board.data?.enabled && (
        <>
          <p className="muted">Families see {board.data.displayNames ? "names" : "anonymised labels"}.</p>
          {(board.data.board ?? []).length === 0 ? <p className="muted">No points earned yet.</p> : (
            <div className="scroll">
              <table className="tc-table">
                <caption className="visually-hidden">Class leaderboard by points</caption>
                <thead><tr><th scope="col" className="tc-num">Rank</th><th scope="col">Learner</th><th scope="col" className="tc-num">Points</th></tr></thead>
                <tbody>{(board.data.board ?? []).map(r => <tr key={r.rank}><td className="tc-num">{r.rank}</td><td>{r.name}</td><td className="tc-num">{r.points}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h3>Contest papers</h3>
      <div className="field tc-narrow">
        <label htmlFor={id + "-fmt"}>Paper format</label>
        <select id={id + "-fmt"} value={format} onChange={e => setFormat(e.target.value)}>
          <option value="">All formats</option>
          {CONTEST_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      {contest.err && <p className="err" role="alert">{contest.err}</p>}
      {contest.data === null && !contest.err && <div className="loading" role="status">Loading contest leaderboard…</div>}
      {contest.data && !contest.data.enabled && <p className="muted">{contest.data.reason}</p>}
      {contest.data?.enabled && ((contest.data.board ?? []).length === 0 ? <p className="muted">No papers sat yet.</p> : (
        <div className="scroll">
          <table className="tc-table">
            <caption className="visually-hidden">Contest leaderboard, {contest.data.format === "all" ? "all formats" : contest.data.format}</caption>
            <thead><tr><th scope="col" className="tc-num">Rank</th><th scope="col">Learner</th><th scope="col" className="tc-num">Best</th><th scope="col" className="tc-num">Papers</th></tr></thead>
            <tbody>{(contest.data.board ?? []).map(r => <tr key={r.rank}><td className="tc-num">{r.rank}</td><td>{r.name}</td><td className="tc-num">{r.best}%</td><td className="tc-num">{r.papers}</td></tr>)}</tbody>
          </table>
        </div>
      ))}
      <p className="muted tc-foot">Last refreshed {fmtWhen(new Date().toISOString())}.</p>
    </>
  );
}
