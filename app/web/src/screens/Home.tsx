import "../styles/home.css";
import { useEffect, useState } from "react";
import { api, call, post, put, ApiError, type Learner, type ProgressRow, type Question } from "../api";
import { Beast } from "../beasts";

/* ---------------- types (mirroring the server responses) ---------------- */
export type Curriculum = Awaited<ReturnType<typeof api.curriculum>>;

type Strand = { topics: number; available: number; started: number; mastered: number };
export type HomeSummary = {
  learner: { id: string; name: string; beast: string; track?: string };
  streak: { days: number; freezesAvailable?: number; freezesUsed?: number; freezesEarned?: number; nextFreezeAt?: number };
  dailyGoal: { target: number; done: number; met: boolean; weeklyTarget: number | null };
  challenge: Question & { topic: string; done: boolean; bonus: number };
  map: { grade: string; label: string; core: Strand; advanced: Strand }[];
  rewards: { points: number; level: number; nextLevelAt: number | null; badges: { code: string; name?: string }[] };
};
export type StreakStatus = {
  days: number; freezesAvailable: number; freezesUsed: number; freezesEarned: number; nextFreezeAt: number;
};
export type Levels = {
  overall: { level: number; points: number; nextLevelAt: number | null };
  subjects: any[]; prestigeLevel: number; prestigeSubjects: string[];
};
export type Avatar = {
  slots: string[];
  unlocked: { id: string; slot: string; name: string }[];
  equipped: Record<string, string>;
  locked: { id: string; slot: string; name: string; hint: string }[];
};
export type ReviewEntry = {
  topicId: string; tier?: string; bestPct?: number; threshold: number; track: string;
  gap: number; lastAt: string; dueAt?: string; intervalDays?: number;
  reason: "not_yet_mastered" | "due_for_review" | "mastery_decayed";
};
export type NextUp = {
  track: string;
  ready: { topicId: string; name: string; track?: string; gradeKey?: string; bestPct: number; optional: boolean }[];
  blocked: { topicId: string; name: string; missing: { topicId: string; name: string }[] }[];
};
export type TrackInfo = {
  track: string;
  tracks: Record<string, { name: string; blurb: string }>;
  recommended: { track: string; reason: string };
};
export type Goal = {
  goal: { roundsPerWeek: number; minutesPerWeek: number; setAt?: string } | null;
  roundsThisWeek: number; percentOfGoal?: number | null; met?: boolean | null; atRisk?: boolean | null;
};
export type HomeData = {
  home: HomeSummary; streak: StreakStatus; levels: Levels; avatar: Avatar;
  review: ReviewEntry[]; next: NextUp; track: TrackInfo; goal: Goal; progress: ProgressRow[];
};

export type Destination = "lessons" | "contest" | "proofs" | "puzzles" | "games" | "story"
  | "simulations" | "avatar" | "settings" | "family" | "progress" | "help";

/* ---------------- api helpers ---------------- */
const homeApi = {
  summary: (id: string) => call<HomeSummary>(`/learners/${id}/home`),
  streak:  (id: string) => call<StreakStatus>(`/learners/${id}/streak`),
  levels:  (id: string) => call<Levels>(`/learners/${id}/levels`),
  avatar:  (id: string) => call<Avatar>(`/learners/${id}/avatar`),
  review:  (id: string) => call<{ review: ReviewEntry[] }>(`/learners/${id}/review`),
  next:    (id: string) => call<NextUp>(`/learners/${id}/next`),
  track:   (id: string) => call<TrackInfo>(`/learners/${id}/track`),
  setTrack:(id: string, track: string) => put<{ track: string }>(`/learners/${id}/track`, { track }),
  goal:    (id: string) => call<Goal>(`/learners/${id}/goal`),
  progress:(id: string) => call<{ progress: ProgressRow[] }>(`/learners/${id}/progress`),
  challenge:(id: string, questionId: string, answer: unknown) =>
    post<{ correct: boolean; correctAnswer: string; explanation: string; bonus: number }>(
      `/learners/${id}/challenge`, { questionId, answer })
};

async function loadAll(id: string): Promise<HomeData> {
  const [home, streak, levels, avatar, review, next, track, goal, progress] = await Promise.all([
    homeApi.summary(id), homeApi.streak(id), homeApi.levels(id), homeApi.avatar(id),
    homeApi.review(id), homeApi.next(id), homeApi.track(id), homeApi.goal(id), homeApi.progress(id)
  ]);
  return { home, streak, levels, avatar, review: review.review, next, track, goal, progress: progress.progress };
}

/* ---------------- small helpers ---------------- */
const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8"];
const gradeOfTopic = (id: string) => {
  const m = id.match(/^(k|g(\d))-/i);
  return m ? (m[2] ? m[2] : "K") : null;
};
const errText = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Please sign in again.";
    if (e.status === 403) return "This learner belongs to another account.";
    return `Something went wrong (${e.message}).`;
  }
  return "Could not reach the server.";
};
const REASON: Record<ReviewEntry["reason"], { label: string; cls: string; why: (r: ReviewEntry) => string }> = {
  not_yet_mastered: { label: "not yet mastered", cls: "",
    why: r => `best ${r.bestPct ?? 0}%, needs ${r.threshold}%` },
  due_for_review:   { label: "due for a refresher", cls: "due",
    why: r => r.intervalDays ? `last seen ${r.intervalDays} days ago` : "spaced review is due" },
  mastery_decayed:  { label: "mastery slipped", cls: "decayed",
    why: () => "it has been a long while, so a fresh round is needed" }
};

/* ---------------- screen ---------------- */
export function Home({ learner, cur, onBack, onOpenTopic, onPractice, onGo, initial }: {
  learner: Learner; cur: Curriculum; onBack: () => void;
  onOpenTopic: (topicId: string, topicName: string, advanced: boolean) => void;
  onPractice: (topicId: string, topicName: string) => void;
  onGo: (where: Destination) => void;
  initial?: HomeData;
}) {
  const [data, setData] = useState<HomeData | null>(initial ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [grade, setGrade] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let live = true;
    loadAll(learner.id).then(d => { if (live) setData(d); }).catch(e => { if (live) setErr(errText(e)); });
    return () => { live = false; };
  }, [learner.id, initial]);

  if (err) return (<>
    <button className="back" onClick={onBack}>← Back</button>
    <h1>Home</h1>
    <p className="err" role="alert">{err}</p>
  </>);
  if (!data) return (<>
    <button className="back" onClick={onBack}>← Back</button>
    <h1>Home</h1>
    <div className="loading" role="status">Getting your map ready…</div>
  </>);

  /* the topic list the map draws from */
  const lookup = (id: string) => {
    for (const g of Object.values(cur.curriculum))
      for (const u of g.units) {
        const t = u.topics.find(t => t.id === id);
        if (t) return { name: t.name, adv: u.track === "adv" };
      }
    return { name: id, adv: false };
  };
  const hasContent = (id: string) => !!cur.counts[id] && Object.values(cur.counts[id]).some(n => n > 0);
  const bestOf = new Map<string, number>();
  for (const r of data.progress) bestOf.set(r.topic_id, Math.max(bestOf.get(r.topic_id) || 0, r.best_pct));
  const threshold = (id: string, adv: boolean) => cur.thresholds?.[id] ?? (adv ? cur.mastery?.adv ?? 80 : cur.mastery?.core ?? 90);

  const grades = GRADE_ORDER.filter(g => cur.curriculum[g]);
  const upNext = data.next.ready[0] || null;
  const currentGrade = grade
    || (upNext && (upNext.gradeKey || gradeOfTopic(upNext.topicId)))
    || grades.find(g => cur.curriculum[g].beast === learner.beast)
    || grades[0];
  const gradeData = cur.curriculum[currentGrade];
  const strand = (adv: boolean) => gradeData.units.filter(u => (u.track === "adv") === adv);
  const mapRow = data.home.map.find(m => m.grade === currentGrade);

  const level = data.levels.overall;
  const streak = data.streak;
  const daily = data.home.dailyGoal;
  const dailyPct = Math.min(100, Math.round((daily.done / Math.max(1, daily.target)) * 100));
  const equipped = Object.values(data.avatar.equipped)
    .map(id => data.avatar.unlocked.find(a => a.id === id)?.name).filter(Boolean) as string[];

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>

      <div className="hm-head">
        <Beast kind={learner.beast} size={56} mood={daily.met ? "happy" : "idle"} />
        <div>
          <div className="eyebrow">Home</div>
          <h1>{learner.name}</h1>
          <span className="hm-level">Level {level.level} · {level.points} points
            {level.nextLevelAt != null && ` · next level at ${level.nextLevelAt}`}</span>
          {equipped.length > 0 && (
            <ul className="hm-gear pills" aria-label="Equipped gear">
              {equipped.map(n => <li key={n} className="pill">{n}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="hm-two">
        <section className="hm-box" aria-labelledby="hm-goal-h">
          <h2 id="hm-goal-h">Today's goal</h2>
          <div className="hm-big">{daily.done}<small> / {daily.target} {daily.target === 1 ? "round" : "rounds"}</small></div>
          <div className={"hm-meter" + (daily.met ? " met" : "")} role="progressbar"
               aria-label="Rounds done today" aria-valuemin={0} aria-valuemax={daily.target} aria-valuenow={Math.min(daily.done, daily.target)}>
            <i style={{ width: `${dailyPct}%` }} />
          </div>
          <p className="hm-note">{daily.met
            ? <span className="hm-ok">Goal met. Nice work!</span>
            : `${daily.target - daily.done} more to go.`}
            {data.goal.goal?.roundsPerWeek
              ? ` This week: ${data.goal.roundsThisWeek} of ${data.goal.goal.roundsPerWeek}.`
              : ""}
          </p>
        </section>

        <section className="hm-box" aria-labelledby="hm-streak-h">
          <h2 id="hm-streak-h">Streak</h2>
          <div className="hm-big"><span aria-hidden="true">🔥 </span>{streak.days}<small> {streak.days === 1 ? "day" : "days"}</small></div>
          <p className="hm-note">
            <span aria-hidden="true">❄️ </span>{streak.freezesAvailable} {streak.freezesAvailable === 1 ? "freeze" : "freezes"} ready
            {streak.freezesUsed > 0 && `, ${streak.freezesUsed} used`}.
            {" "}Next freeze at day {streak.nextFreezeAt}.
          </p>
        </section>
      </div>

      <Challenge learnerId={learner.id} ch={data.home.challenge}
                 onPractice={onPractice} onDone={r => setData(d => d && ({
                   ...d, home: { ...d.home, challenge: { ...d.home.challenge, done: true } },
                   levels: { ...d.levels, overall: { ...d.levels.overall, points: d.levels.overall.points + r.bonus } }
                 }))} />

      <section className="card" aria-labelledby="hm-next-h" style={{ marginBottom: 14 }}>
        <h2 id="hm-next-h" style={{ margin: "0 0 6px" }}>Up next</h2>
        {upNext ? (
          <div className="hm-next">
            <div>
              <b>{upNext.name}</b>
              {upNext.track === "adv" && <span className="badge adv">advanced</span>}
              <div className="dsub">
                {upNext.bestPct ? `best so far ${upNext.bestPct}%` : "new topic"}
                {upNext.optional && " · optional on your track"}
                {data.next.blocked.length > 0 && ` · ${data.next.blocked.length} waiting on other topics`}
              </div>
            </div>
            <button className="btn" onClick={() => onOpenTopic(upNext.topicId, upNext.name, upNext.track === "adv")}>
              Start {upNext.name} →
            </button>
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>Everything with questions is mastered. Try a contest paper or a proof.</p>}
      </section>

      <section aria-labelledby="hm-map-h">
        <h2 id="hm-map-h">Your map</h2>
        <div className="hm-mapbar">
          <label htmlFor="hm-grade">Grade</label>
          <select id="hm-grade" className="hm-select" value={currentGrade} onChange={e => setGrade(e.target.value)}>
            {grades.map(g => <option key={g} value={g}>{cur.curriculum[g].label}</option>)}
          </select>
          {mapRow && <span className="muted" style={{ fontSize: ".85rem" }}>
            core {mapRow.core.mastered}/{mapRow.core.available} mastered · advanced {mapRow.advanced.mastered}/{mapRow.advanced.available}
          </span>}
        </div>
        <div className="hm-tracks">
          {[false, true].map(adv => {
            const units = strand(adv);
            const s = adv ? mapRow?.advanced : mapRow?.core;
            return (
              <div key={String(adv)} className={"hm-strand" + (adv ? " adv" : "")}>
                <h3>{adv ? "Enrichment & competition" : "Core"}
                  {s && <span className="hm-count">{s.mastered} of {s.available} mastered</span>}</h3>
                {units.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing here for this grade yet.</p>}
                {units.map(u => (
                  <div className="hm-unit" key={u.name}>
                    <h4>{u.name}</h4>
                    <ul className="hm-tlist">
                      {u.topics.map(t => {
                        const ready = hasContent(t.id);
                        const best = bestOf.get(t.id);
                        const bar = threshold(t.id, adv);
                        const mastered = best != null && best >= bar;
                        return (
                          <li key={t.id}>
                            <button className="hm-topic" disabled={!ready}
                                    onClick={() => onOpenTopic(t.id, t.name, adv)}>
                              <span className="tname">{t.name}</span>
                              {!ready ? <span className="soon sm">coming soon</span>
                                : mastered ? <span className="pill good">★ mastered</span>
                                : best != null ? <span className="pill">{best}% of {bar}%</span>
                                : <span className="pill dim">new</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="hm-review-h">
        <h2 id="hm-review-h">Review</h2>
        {data.review.length === 0
          ? <p className="muted">Nothing to review right now. Keep going on the map.</p>
          : <ul className="hm-review">
              {data.review.map(r => {
                const meta = lookup(r.topicId);
                const info = REASON[r.reason] || REASON.not_yet_mastered;
                return (
                  <li key={r.topicId + (r.tier || "")} className="drow">
                    <div>
                      <div className="dhead"><b>{meta.name}
                        {meta.adv && <span className="badge adv">advanced</span>}
                        <span className={"hm-reason " + info.cls}>{info.label}</span></b></div>
                      <div className="dsub">{info.why(r)}{r.tier ? ` · ${r.tier}` : ""}</div>
                    </div>
                    <button className="btn ghost" onClick={() => onPractice(r.topicId, meta.name)}>
                      Review now
                    </button>
                  </li>
                );
              })}
            </ul>}
      </section>

      <TrackPicker learnerId={learner.id} info={data.track}
                   onChanged={track => setData(d => d && ({ ...d, track: { ...d.track, track } }))} />

      <section aria-labelledby="hm-go-h">
        <h2 id="hm-go-h">Where to?</h2>
        <ul className="hm-grid">
          {DESTINATIONS.map(d => (
            <li key={d.id}>
              <button className="hm-go" onClick={() => onGo(d.id)}>
                <span className="ico" aria-hidden="true">{d.icon}</span>
                {d.label}
                <small>{d.sub}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const DESTINATIONS: { id: Destination; icon: string; label: string; sub: string }[] = [
  { id: "lessons",     icon: "📖", label: "Lessons",        sub: "learn an idea" },
  { id: "contest",     icon: "🏁", label: "Contest corner", sub: "timed papers" },
  { id: "proofs",      icon: "🧩", label: "Proofs",         sub: "show why" },
  { id: "puzzles",     icon: "🔍", label: "Puzzles",        sub: "brain teasers" },
  { id: "games",       icon: "🎲", label: "Games",          sub: "play with numbers" },
  { id: "story",       icon: "📜", label: "Story",          sub: "your adventure" },
  { id: "simulations", icon: "🔬", label: "Simulations",    sub: "try it out" },
  { id: "avatar",      icon: "🎨", label: "Avatar",         sub: "dress your beast" },
  { id: "progress",    icon: "📈", label: "Progress",       sub: "see how far" },
  { id: "family",      icon: "👪", label: "Family",         sub: "parent view" },
  { id: "help",        icon: "💡", label: "Help",           sub: "how it works" },
  { id: "settings",    icon: "⚙️", label: "Settings",       sub: "sound, theme" }
];

/* ---------------- challenge of the day ---------------- */
function Challenge({ learnerId, ch, onPractice, onDone }: {
  learnerId: string; ch: HomeSummary["challenge"];
  onPractice: (topicId: string, topicName: string) => void;
  onDone: (r: { bonus: number }) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; correctAnswer: string; explanation: string; bonus: number } | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const topicId = ch.id.split(":")[0];
  const inline = ch.type === "mc" || ch.type === "in";

  const submit = async (answer: unknown) => {
    setBusy(true); setFail(null);
    try {
      const r = await homeApi.challenge(learnerId, ch.id, answer);
      setResult(r); onDone(r);
    } catch (e) {
      setFail(e instanceof ApiError && e.status === 409 ? "Today's challenge is already done." : errText(e));
    } finally { setBusy(false); }
  };

  return (
    <section className="card hm-chal" aria-labelledby="hm-chal-h">
      <div className="eyebrow">Challenge of the day</div>
      <h2 id="hm-chal-h" style={{ margin: "2px 0 0" }}>{ch.topic}</h2>
      <div className="dsub">{ch.secName} · +{ch.bonus} points for a first-try win</div>

      {ch.done && !result && (
        <p className="notice" role="status">Done for today. Come back tomorrow for a new one.</p>
      )}

      {!ch.done && !result && (
        <>
          <p className={"hm-q" + (ch.mono ? " mono" : "")}>{ch.q}</p>
          {ch.type === "mc" && ch.opts && (
            <div className="opts" role="group" aria-label="Answer choices">
              {ch.opts.map((o, i) => (
                <button key={i} className={"opt" + (ch.mono ? " mono" : "") + (picked === o ? " sel" : "")}
                        aria-pressed={picked === o} disabled={busy}
                        onClick={() => { setPicked(o); submit(o); }}>
                  <span className="key" aria-hidden="true">{String.fromCharCode(65 + i)}</span>{o}
                </button>
              ))}
            </div>
          )}
          {ch.type === "in" && (
            <form className="inrow" onSubmit={e => { e.preventDefault(); if (typed.trim()) submit(typed.trim()); }}>
              <label htmlFor="hm-chal-in" className="visually-hidden">Your answer</label>
              <input id="hm-chal-in" className="ansin" value={typed} onChange={e => setTyped(e.target.value)}
                     autoComplete="off" inputMode="text" disabled={busy} />
              <button className="btn" type="submit" disabled={busy || !typed.trim()}>Check</button>
            </form>
          )}
          {!inline && (
            <div className="rowbtns">
              <button className="btn" onClick={() => onPractice(topicId, ch.topic)}>Take it on →</button>
            </div>
          )}
          {ch.hint && <p className="hint">Hint: {ch.hint}</p>}
        </>
      )}

      {result && (
        <div className={"fb" + (result.correct ? "" : " bad")} role="status">
          <h3>{result.correct ? `Yes! +${result.bonus} points` : "Not this time"}</h3>
          {!result.correct && <p className="expl"><b>Answer:</b> {result.correctAnswer}</p>}
          <p className="expl">{result.explanation}</p>
          <div className="rowbtns">
            <button className="btn ghost" onClick={() => onPractice(topicId, ch.topic)}>Practise {ch.topic}</button>
          </div>
        </div>
      )}
      {fail && <p className="err" role="alert">{fail}</p>}
    </section>
  );
}

/* ---------------- track picker (4.2.2) ---------------- */
function TrackPicker({ learnerId, info, onChanged }: {
  learnerId: string; info: TrackInfo; onChanged: (track: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const choose = async (t: string) => {
    if (t === info.track || busy) return;
    setBusy(true); setFail(null); setMsg(null);
    try {
      const r = await homeApi.setTrack(learnerId, t);
      onChanged(r.track);
      setMsg(`Track set to ${info.tracks[r.track]?.name || r.track}. Recommendations now follow it.`);
    } catch (e) { setFail(errText(e)); }
    finally { setBusy(false); }
  };
  const rec = info.recommended;
  return (
    <section aria-labelledby="hm-track-h">
      <h2 id="hm-track-h">Track</h2>
      <p className="lede" style={{ marginBottom: 8 }}>
        The track shapes what is suggested, never what is allowed.
        {rec && rec.track !== info.track && ` Suggested: ${info.tracks[rec.track]?.name || rec.track} (${rec.reason}).`}
      </p>
      <div className="hm-trackpick" role="group" aria-label="Choose a track">
        {Object.entries(info.tracks).map(([id, t]) => (
          <button key={id} className="hm-trackopt" aria-pressed={info.track === id} disabled={busy}
                  onClick={() => choose(id)}>
            <b>{t.name}{info.track === id ? " (current)" : ""}{rec?.track === id && rec.track !== info.track ? " · suggested" : ""}</b>
            <span>{t.blurb}</span>
          </button>
        ))}
      </div>
      <p className="hm-status" role="status">{msg}</p>
      {fail && <p className="err" role="alert">{fail}</p>}
    </section>
  );
}
