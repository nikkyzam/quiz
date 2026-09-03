import { useEffect, useState } from "react";
import { useEffect as useEffect2, useState as useState2 } from "react";
import { api, type Grade, type Tier, type Learner, type ProgressRow } from "../api";
import { Beast } from "../beasts";

type Cur = { curriculum: Record<string, Grade>; tiers: Tier[]; counts: Record<string, Record<string, number>> };
const hasContent = (cur: Cur, id: string) =>
  !!cur.counts[id] && Object.values(cur.counts[id]).some(n => n > 0);

export function GradeList({ order, cur, onOpen }: { order: string[]; cur: Cur; onOpen: (g: string) => void }) {
  return (
    <>
      <div className="eyebrow">Kindergarten → Grade 8</div>
      <h1 style={{ marginTop: 0 }}>Choose a grade</h1>
      <div className="gradeGrid">
        {order.map(g => {
          const grade = cur.curriculum[g];
          const topics = grade.units.flatMap(u => u.topics);
          const ready = topics.filter(t => hasContent(cur, t.id)).length;
          return (
            <button key={g} className={"gcard" + (ready ? "" : " empty")} onClick={() => ready && onOpen(g)} disabled={!ready}>
              <span className="gbeast"><Beast kind={grade.beast} size={46} /></span>
              <span className="gmeta">
                <span className="gname">{grade.label}</span>
                <span className="gsub">{topics.length} topics · {grade.units.length} units</span>
              </span>
              <span className="gstat">{ready
                ? <span className="gready">{ready} ready</span>
                : <span className="soon">no questions yet</span>}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function GradeMap({ gradeKey, cur, onBack, onOpen }: {
  gradeKey: string; cur: Cur; onBack: () => void;
  onOpen: (topicId: string, topicName: string, advanced: boolean) => void;
}) {
  const grade = cur.curriculum[gradeKey];
  return (
    <>
      <button className="back" onClick={onBack}>← All grades</button>
      <div className="maphead">
        <Beast kind={grade.beast} size={52} />
        <h1 style={{ margin: 0, fontSize: "1.9rem" }}>{grade.label}</h1>
      </div>
      {grade.units.map(u => (
        <section className="unit" key={u.name}>
          <h3>{u.name}{u.track === "adv" && <span className="badge adv">advanced</span>}</h3>
          <div className="tlist">
            {u.topics.map(t => {
              const ready = hasContent(cur, t.id);
              return (
                <button key={t.id} className={"topic" + (ready ? "" : " locked")} disabled={!ready}
                        onClick={() => onOpen(t.id, t.name, u.track === "adv")}>
                  <span className="tname">{t.name}</span>
                  {ready ? <span className="muted" style={{ fontSize: ".8rem" }}>
                             {Object.values(cur.counts[t.id]).reduce((a, b) => a + b, 0)} questions</span>
                         : <span className="soon sm">not yet written</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

export function TierPicker({ topicId, topicName, advanced, tiers, counts, threshold, learner, onBack, onStart, onDiagnostic, onMastery, onPractice, onLesson }: {
  topicId: string; topicName: string; advanced: boolean;
  tiers: Tier[]; counts: any; threshold: number; learner: Learner;
  onBack: () => void; onStart: (tier: string) => void;
  onDiagnostic: () => void; onMastery: () => void; onPractice: () => void;
  onLesson: (lessonId: string) => void;
}) {
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [lessonId, setLessonId] = useState2<string | null | undefined>(undefined);
  useEffect(() => { api.progress(learner.id).then(r => setRows(r.progress)).catch(() => {}); }, [learner.id]);
  useEffect2(() => {
    api.lessons().then(r => {
      const match = r.lessons.find(l => l.topicId === topicId);
      setLessonId(match ? match.id : null);
    }).catch(() => setLessonId(null));
  }, [topicId]);

  return (
    <>
      <button className="back" onClick={onBack}>← Back to topics</button>
      <h1 style={{ fontSize: "1.8rem" }}>{topicName}{advanced && <span className="badge adv">advanced</span>}</h1>
      <p className="lede">Three tiers, same topic. Mastery here is {threshold}% — {advanced
        ? "advanced topics use a lower bar so exploring stays worthwhile."
        : "core topics need a high bar before they count as mastered."}</p>
      {lessonId && (
        <div className="rowbtns" style={{ marginBottom: 16 }}>
          <button className="btn" onClick={() => onLesson(lessonId)}>📖 Start with the lesson</button>
        </div>
      )}
      <div className="rowbtns" style={{ marginBottom: 16 }}>
        <button className="btn" onClick={onPractice}>Adaptive practice →</button>
        <button className="btn ghost" onClick={onDiagnostic}>Placement check</button>
      </div>
      <p className="muted" style={{ fontSize: ".85rem", marginTop: -6 }}>
        Adaptive practice picks each question from how you are doing, and shows you
        what to look at again afterwards. Or choose a fixed tier below.
      </p>
      <div className="tierList">
        {tiers.map(t => {
          const n = counts[topicId]?.[t.id] || 0;
          if (!n) return null;
          const rec = rows.find(r => r.topic_id === topicId && r.tier === t.id);
          return (
            <button className="tier" key={t.id} onClick={() => onStart(t.id)}>
              <span className="tierhead"><b>{t.name}</b><span className="tcount">{n} questions</span></span>
              <span className="tierblurb">{t.blurb}</span>
              {rec && <span className={"tierbest" + (rec.best_pct >= threshold ? " good" : "")}>
                best {rec.best_score}/{rec.best_total} · {rec.best_pct}%
                {rec.best_pct >= threshold ? " ★ mastered" : ""}
              </span>}
            </button>
          );
        })}
      </div>
      <div className="rowbtns">
        <button className="btn" onClick={onMastery}>Take the mastery check →</button>
      </div>
      <p className="muted" style={{ fontSize: ".85rem" }}>
        The mastery check draws from every tier, gives no hints, and needs {threshold}% to pass.
      </p>
    </>
  );
}
