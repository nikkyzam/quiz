import "../styles/play.css";
import { useEffect, useState } from "react";
import { call, post, put, ApiError, type Learner } from "../api";
import { Beast } from "../beasts";

/* Avatar gear (5.3), per-subject levels with prestige (5.4), streak freezes
   (5.5) and unlockable areas (5.7), all on one page so nothing is hidden
   behind a tab. */

export type GearItem = { id: string; slot: string; name: string; unlock?: { badge?: string; level?: number } };
export type LockedItem = { id: string; slot: string; name: string; hint: string };
export type GearData = { slots: string[]; unlocked: GearItem[]; equipped: Record<string, string>; locked: LockedItem[] };
export type SubjectLevel = {
  subject: string; name: string; points: number; level: number; nextLevelAt: number; prestige: number; canPrestige: boolean;
};
export type LevelsData = {
  overall: { level: number; points: number; nextLevelAt: number };
  subjects: SubjectLevel[]; prestigeLevel: number; prestigeSubjects: string[];
};
export type AreaInfo = {
  id: string; name: string; blurb: string; unlocked: boolean; unlockHint: string;
  puzzles: { id: string; title: string; difficulty?: number }[] | number;
};
export type UnlocksData = { areas: AreaInfo[]; hiddenPuzzles: { id: string; title: string; area: string | null }[]; gear: string[] };
export type StreakData = { days: number; freezesAvailable: number; freezesUsed: number; freezesEarned: number; nextFreezeAt: number };
export type AvatarData = { gear: GearData; levels: LevelsData; unlocks: UnlocksData; streak: StreakData };

const avatarApi = {
  gear: (id: string) => call<GearData>(`/learners/${id}/avatar`),
  equip: (id: string, slot: string, item: string | null) => put<GearData>(`/learners/${id}/avatar`, { slot, item }),
  levels: (id: string) => call<LevelsData>(`/learners/${id}/levels`),
  prestige: (id: string, subject: string) => post<{ subject: string; stars: number }>(`/learners/${id}/prestige`, { subject }),
  unlocks: (id: string) => call<UnlocksData>(`/learners/${id}/unlocks`),
  streak: (id: string) => call<StreakData>(`/learners/${id}/streak`)
};

const SLOT_LABEL: Record<string, string> = { hat: "Hats", eyes: "Eyes", held: "Held", trail: "Trails" };

function friendly(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Please sign in again.";
    if (e.status === 403) return e.message === "not_unlocked" ? "That item is still locked." : "This learner is not on your account.";
    if (e.status === 409) return "Not high enough to prestige yet.";
  }
  return fallback;
}

export function Avatar({ learner, onBack, onChanged, initial }: {
  learner: Learner; onBack: () => void; onChanged: () => void; initial?: AvatarData;
}) {
  const [data, setData] = useState<AvatarData | null>(initial ?? null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    Promise.all([avatarApi.gear(learner.id), avatarApi.levels(learner.id), avatarApi.unlocks(learner.id), avatarApi.streak(learner.id)])
      .then(([gear, levels, unlocks, streak]) => setData({ gear, levels, unlocks, streak }))
      .catch(e => setError(friendly(e, "Couldn't load your monster's things. Check the server is running.")));
  }, [learner.id, initial]);

  async function equip(slot: string, item: string | null, name: string) {
    if (!data) return;
    setBusy(slot); setError(""); setStatus("");
    try {
      const gear = await avatarApi.equip(learner.id, slot, item);
      setData({ ...data, gear });
      setStatus(item ? `${name} is on.` : `${name} is off.`);
      onChanged();
    } catch (e) { setError(friendly(e, "Couldn't change that gear.")); }
    finally { setBusy(""); }
  }

  async function prestige(s: SubjectLevel) {
    if (!data) return;
    setBusy("prestige"); setError(""); setStatus("");
    try {
      const r = await avatarApi.prestige(learner.id, s.subject);
      const levels = await avatarApi.levels(learner.id);
      setData({ ...data, levels });
      setStatus(`${s.name} prestiged! You now have ${r.stars} ${r.stars === 1 ? "star" : "stars"} there and the level starts again.`);
      setConfirm(null);
      onChanged();
    } catch (e) { setError(friendly(e, "Couldn't prestige that subject.")); }
    finally { setBusy(""); }
  }

  const equippedIds = data ? Object.values(data.gear.equipped) : [];

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="play-head">
        <div><div className="eyebrow">Your monster</div><h1>{learner.name}'s gear</h1></div>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <p className="play-status" role="status">{status}</p>
      {!data && !error && <div className="loading" role="status">Fetching the wardrobe…</div>}
      {data && (
        <>
          <div className="avatar-hero">
            <Beast kind={learner.beast} size={128} gear={equippedIds} />
            <div>
              <p style={{ margin: 0 }}><b>Level {data.levels.overall.level}</b> · {data.levels.overall.points} points</p>
              <p className="play-note">{data.levels.overall.nextLevelAt - data.levels.overall.points} more to level {data.levels.overall.level + 1}</p>
              <p className="play-note">Wearing: {equippedIds.length
                ? equippedIds.map(id => data.gear.unlocked.find(g => g.id === id)?.name || id).join(", ")
                : "nothing yet"}</p>
            </div>
          </div>

          <div className="statgrid">
            <div className="stat"><b>{data.gear.unlocked.length}</b><span>Gear unlocked</span></div>
            <div className="stat"><b>{data.streak.days}</b><span>Day streak</span></div>
            <div className="stat"><b>{data.unlocks.areas.filter(a => a.unlocked).length}</b><span>Areas found</span></div>
          </div>

          <h2 className="play-h2">Wardrobe</h2>
          <p className="muted">One item per slot. Locked items tell you how to earn them.</p>
          {data.gear.slots.map(slot => {
            const open = data.gear.unlocked.filter(g => g.slot === slot);
            const locked = data.gear.locked.filter(g => g.slot === slot);
            const worn = data.gear.equipped[slot];
            return (
              <section key={slot} aria-labelledby={`slot-${slot}`}>
                <h3 id={`slot-${slot}`} style={{ marginTop: 16 }}>{SLOT_LABEL[slot] || slot}</h3>
                <ul className="wardrobe" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {open.map(g => {
                    const on = worn === g.id;
                    return (
                      <li key={g.id} className={"gear" + (on ? " on" : "")}>
                        <Beast kind={learner.beast} size={44} still gear={[g.id]} />
                        <span><span className="gear-name">{g.name}</span>
                          <span className="gear-hint">{on ? "Wearing it now" : "Unlocked"}</span></span>
                        <button className={"btn" + (on ? " ghost" : "")} disabled={busy === slot}
                                aria-pressed={on} onClick={() => equip(slot, on ? null : g.id, g.name)}>
                          {on ? "Take off" : "Wear"}
                        </button>
                      </li>
                    );
                  })}
                  {locked.map(g => (
                    <li key={g.id} className="gear locked">
                      <Beast kind={learner.beast} size={44} still gear={[g.id]} />
                      <span><span className="gear-name">{g.name}</span>
                        <span className="gear-hint lock">Locked: {g.hint}</span></span>
                    </li>
                  ))}
                  {!open.length && !locked.length && <li className="muted">Nothing here yet.</li>}
                </ul>
              </section>
            );
          })}

          <h2 className="play-h2">Levels by subject</h2>
          <p className="muted">
            Reach level {data.levels.prestigeLevel} in an advanced subject and you can prestige it: the level starts again
            from 1, you keep every point, and you earn a permanent star.
          </p>
          <ul className="levels">
            {data.levels.subjects.map(s => {
              const prevAt = Math.round(50 * Math.pow(s.level - 1, 2));
              const span = Math.max(1, s.nextLevelAt - prevAt);
              const pct = Math.round(clamp01((s.points - prevAt) / span) * 100);
              const asking = confirm === s.subject;
              return (
                <li key={s.subject} className="level">
                  <div className="level-head">
                    <b>{s.name}{s.prestige > 0 && <span className="prestige-stars" aria-label={`${s.prestige} prestige ${s.prestige === 1 ? "star" : "stars"}`}>{"★".repeat(s.prestige)}</span>}</b>
                    <span className="level-num">Level {s.level} · {s.points} pts</span>
                  </div>
                  <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
                       aria-label={`${s.name}: progress to level ${s.level + 1}`}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  {data.levels.prestigeSubjects.includes(s.subject) && (
                    <div className="play-actions">
                      {s.canPrestige
                        ? <button className="btn" disabled={busy === "prestige"} onClick={() => setConfirm(asking ? null : s.subject)}
                                  aria-expanded={asking} aria-controls={`confirm-${s.subject}`}>Prestige {s.name}</button>
                        : <span className="muted" style={{ fontSize: ".85rem" }}>Prestige unlocks at level {data.levels.prestigeLevel}</span>}
                    </div>
                  )}
                  <div id={`confirm-${s.subject}`} className="confirm" hidden={!asking}>
                    <p><b>Prestige {s.name}?</b> Your level here goes back to 1 and you earn a star. You keep all your points and badges.</p>
                    <div className="play-actions">
                      <button className="btn" disabled={busy === "prestige"} onClick={() => prestige(s)}>Yes, prestige it</button>
                      <button className="btn ghost" onClick={() => setConfirm(null)}>Not now</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <h2 className="play-h2">Hidden areas</h2>
          <p className="muted">Places on the map that only appear once you have earned them.</p>
          <ul className="areas">
            {data.unlocks.areas.map(a => (
              <li key={a.id} className={"area" + (a.unlocked ? "" : " locked")}>
                <div className="dhead"><b>{a.unlocked ? a.name : `${a.name} (locked)`}</b>
                  <span className={"pill" + (a.unlocked ? " good" : " dim")}>{a.unlocked ? "open" : "locked"}</span></div>
                <div className="dsub">{a.blurb}</div>
                {a.unlocked
                  ? (Array.isArray(a.puzzles) && a.puzzles.length > 0
                      ? <ul>{a.puzzles.map(p => <li key={p.id}>{p.title}{p.difficulty ? ` · difficulty ${p.difficulty}` : ""}</li>)}</ul>
                      : <p className="play-note">No puzzles inside yet.</p>)
                  : <p className="play-note">Unlock it: {a.unlockHint}. {typeof a.puzzles === "number" ? `${a.puzzles} hidden ${a.puzzles === 1 ? "puzzle" : "puzzles"} inside.` : ""}</p>}
              </li>
            ))}
          </ul>
          {data.unlocks.hiddenPuzzles.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Secret puzzles you can reach</h3>
              <ul>{data.unlocks.hiddenPuzzles.map(p => <li key={p.id}>{p.title}</li>)}</ul>
            </>
          )}

          <h2 className="play-h2">Streak</h2>
          <div className="drow">
            <div className="streak-big">{data.streak.days} {data.streak.days === 1 ? "day" : "days"}</div>
            <p className="play-note">Practise on any day and the streak grows. Miss a single day and a freeze saves it.</p>
            <p style={{ margin: "10px 0 0" }}><b>Streak freezes</b></p>
            <div className="freezes" aria-hidden="true">
              {[0, 1].map(i => <span key={i} className={"freeze" + (i < data.streak.freezesAvailable ? " have" : "")}>❄</span>)}
            </div>
            <p className="play-note">
              {data.streak.freezesAvailable} of 2 ready to use · {data.streak.freezesUsed} used so far · {data.streak.freezesEarned} earned in total.
              Every full week of streak earns one more. Next at {data.streak.nextFreezeAt} days.
            </p>
          </div>
        </>
      )}
    </>
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
