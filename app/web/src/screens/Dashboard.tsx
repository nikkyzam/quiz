import { useEffect, useState } from "react";
import { api, type Learner, type ProgressRow, type Grade, type Tier } from "../api";
import { Beast } from "../beasts";

export function Dashboard({ learner, cur, onBack, onDeleted }: {
  learner: Learner;
  cur: { curriculum: Record<string, Grade>; tiers: Tier[]; counts: any };
  onBack: () => void; onDeleted: () => void;
}) {
  const [rows, setRows] = useState<ProgressRow[] | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    api.progress(learner.id).then(r => { setRows(r.progress); setRecent(r.recent); }).catch(() => setRows([]));
  }, [learner.id]);

  if (!rows) return <div className="loading">Loading progress…</div>;

  const topicName = (id: string) => {
    for (const g of Object.values(cur.curriculum))
      for (const u of g.units) {
        const t = u.topics.find(t => t.id === id);
        if (t) return { name: t.name, unit: u.name, grade: g.label, adv: u.track === "adv" };
      }
    return { name: id, unit: "", grade: "", adv: false };
  };

  const byTopic: Record<string, ProgressRow[]> = {};
  rows.forEach(r => { (byTopic[r.topic_id] ||= []).push(r); });
  const stars = rows.filter(r => r.best_pct >= (topicName(r.topic_id).adv ? 80 : 90)).length;
  const runs = rows.reduce((a, r) => a + r.runs, 0);

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="maphead">
        <Beast kind={learner.beast} size={44} />
        <div><div className="eyebrow">Progress</div>
          <h1 style={{ margin: 0, fontSize: "1.8rem" }}>{learner.name}</h1></div>
      </div>

      <div className="statgrid">
        <div className="stat"><b>{stars}</b><span>Stars</span></div>
        <div className="stat"><b>{Object.keys(byTopic).length}</b><span>Topics started</span></div>
        <div className="stat"><b>{runs}</b><span>Rounds played</span></div>
      </div>

      {!rows.length && <p className="lede">Nothing practised yet. Pick a grade and finish a round — it shows up here straight away.</p>}

      {Object.keys(byTopic).map(tid => {
        const meta = topicName(tid);
        const bar = meta.adv ? 80 : 90;
        return (
          <div className="drow" key={tid}>
            <div className="dhead">
              <b>{meta.name}{meta.adv && <span className="badge adv">advanced</span>}</b>
            </div>
            <div className="dsub">{meta.grade} · {meta.unit} · mastery at {bar}%</div>
            <div className="pills">
              {cur.tiers.map(t => {
                const r = byTopic[tid].find(x => x.tier === t.id);
                return <span key={t.id} className={"pill" + (r ? (r.best_pct >= bar ? " good" : "") : " dim")}>
                  {t.name} {r ? `${r.best_pct}%` : "—"}
                </span>;
              })}
            </div>
          </div>
        );
      })}

      {recent.length > 0 && (
        <>
          <h3 style={{ fontFamily: "var(--slab)", marginTop: 24 }}>Recent rounds</h3>
          {recent.slice(0, 8).map((r, i) => (
            <div className="drow" key={i}>
              <div className="dhead"><b>{topicName(r.topic_id).name}</b>
                <span className="muted" style={{ fontFamily: "var(--mono)", fontSize: ".8rem" }}>
                  {r.score}/{r.total} · {r.pct}%</span></div>
              <div className="dsub">{r.tier} · {new Date(r.finished_at).toLocaleString()}</div>
            </div>
          ))}
        </>
      )}

      <div className="endbtns">
        <button className="btn ghost danger" onClick={async () => {
          if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 5000); return; }
          await api.delLearner(learner.id); onDeleted();
        }}>{armed ? `Really delete ${learner.name}? Click again` : "Delete this learner"}</button>
      </div>
    </>
  );
}
