import { useState } from "react";
import { api, type Learner } from "../api";
import { Beast, BEASTS } from "../beasts";

export function LearnerPicker({ userName, learners, onPick, onChanged, onSignOut }: {
  userName: string; learners: Learner[];
  onPick: (l: Learner) => void; onChanged: () => Promise<Learner[]>; onSignOut: () => void;
}) {
  const [name, setName] = useState(""), [beast, setBeast] = useState("vex");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Type a name first."); return; }
    setErr(""); setBusy(true);
    try { await api.addLearner(name.trim(), beast); setName(""); await onChanged(); }
    catch { setErr("Couldn't add that learner."); }
    finally { setBusy(false); }
  }

  return (
    <div className="wrap">
      <div className="appbar">
        <span className="who">Signed in as <b>{userName}</b></span>
        <button className="linkbtn" onClick={onSignOut}>Sign out</button>
      </div>
      <div className="eyebrow">Math Quest</div>
      <h1>Who's practising?</h1>
      <p className="lede">Each learner keeps their own stars and progress, saved to your account — so it follows them to any device.</p>

      <div className="whoList">
        {learners.map(l => (
          <button className="who" key={l.id} onClick={() => onPick(l)}>
            <span className="wav"><Beast kind={l.beast} size={40} /></span>
            <span className="wmeta">
              <span className="wname">{l.name}</span>
              <span className="wsub">{l.stars ?? 0} {l.stars === 1 ? "star" : "stars"} · {l.topics ?? 0} topics started</span>
            </span>
            <span className="wgo">→</span>
          </button>
        ))}
        {!learners.length && <p className="lede" style={{ margin: "0 0 14px" }}>No learners yet — add the first one below.</p>}
      </div>

      <form className="card newprof" onSubmit={add}>
        <h3 style={{ fontFamily: "var(--slab)", margin: "0 0 10px", fontSize: "1.05rem" }}>Add a learner</h3>
        <div className="field">
          <label htmlFor="ln">Name</label>
          <input id="ln" value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="e.g. Josiah" />
        </div>
        {err && <p className="err">{err}</p>}
        <label className="flabel" style={{ marginTop: 4 }}>Pick a monster</label>
        <div className="beastPick">
          {Object.keys(BEASTS).map(k => (
            <button type="button" key={k} className={"bpick" + (k === beast ? " sel" : "")}
                    onClick={() => setBeast(k)} aria-label={BEASTS[k].name}>
              <Beast kind={k} size={40} />
            </button>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 14 }} disabled={busy}>{busy ? "Adding…" : "Add learner"}</button>
      </form>
    </div>
  );
}
