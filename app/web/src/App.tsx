import { useEffect, useState, useCallback } from "react";
import { api, ApiError, type User, type Learner, type Grade, type Tier } from "./api";
import { Beast } from "./beasts";
import { useAgeBand } from "./useAgeBand";
import { AuthScreen } from "./screens/Auth";
import { LearnerPicker } from "./screens/Learners";
import { GradeList, GradeMap, TierPicker } from "./screens/Curriculum";
import { Quiz } from "./screens/Quiz";
import { Dashboard } from "./screens/Dashboard";
import { Diagnostic } from "./screens/Diagnostic";
import { MasteryCheck } from "./screens/MasteryCheck";
import { Practice } from "./screens/Practice";

const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8"];

type View =
  | { s: "grades" } | { s: "grade"; g: string }
  | { s: "tiers"; topicId: string; topicName: string; advanced: boolean }
  | { s: "quiz"; topicId: string; topicName: string; tier: string; advanced: boolean }
  | { s: "diagnostic"; topicId: string; topicName: string }
  | { s: "mastery"; topicId: string; topicName: string }
  | { s: "practice"; topicId: string; topicName: string; nonce: number }
  | { s: "dash" };


function Shell({ children, nav }: { children: React.ReactNode; nav?: React.ReactNode }) {
  return (
    <div className="wrap">
      <a className="skip" href="#main">Skip to main content</a>
      {nav}
      <main id="main">{children}</main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booted, setBooted] = useState(false);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [active, setActive] = useState<Learner | null>(null);
  const [cur, setCur] = useState<any | null>(null);
  const [view, setView] = useState<View>({ s: "grades" });

  /* The interface scales with the grade being worked on: bigger targets and
     warmer colour for the youngest, tighter for the oldest. */
  const gradeInView = view.s === "grade" ? view.g
    : (view as any).topicId ? String((view as any).topicId).match(/^k|^g(\d)/)?.[0] : null;
  useAgeBand(gradeInView);

  useEffect(() => {
    /* The first screen needs only the session; the curriculum (the largest
       payload) loads alongside and fills in when it arrives (10.1). */
    (async () => {
      try { setUser((await api.me()).user); } catch { /* offline or API down */ }
      setBooted(true);
    })();
    api.curriculum().then(setCur).catch(() => {});
  }, []);

  const refreshLearners = useCallback(async () => {
    const { learners } = await api.learners();
    setLearners(learners);
    setActive(a => (a ? learners.find(l => l.id === a.id) || null : null));
    return learners;
  }, []);

  useEffect(() => { if (user) refreshLearners().catch(() => {}); }, [user, refreshLearners]);

  if (!booted) return <Shell><div className="loading" role="status">Loading…</div></Shell>;
  const curriculumPending = user && active && !cur;
  if (!user) return <Shell><AuthScreen onDone={u => setUser(u)} /></Shell>;

  if (!active) {
    return (
      <Shell><LearnerPicker
        userName={user.name}
        learners={learners}
        onPick={l => { setActive(l); setView({ s: "grades" }); }}
        onChanged={refreshLearners}
        onSignOut={async () => { await api.logout(); setUser(null); setLearners([]); setActive(null); }}
      /></Shell>
    );
  }

  const back = () => setView({ s: "grades" });

  const nav = (
    <nav className="appbar" aria-label="Learner">
        <span className="who"><Beast kind={active.beast} size={26} /><b>{active.name}</b></span>
        <span className="spread">
          <button className="linkbtn" onClick={() => setView({ s: "dash" })}>Progress</button>
          <button className="linkbtn" onClick={() => setActive(null)}>Switch</button>
      </span>
    </nav>
  );

  return (
    <Shell nav={nav}>
      {curriculumPending && <div className="loading" role="status">Loading the curriculum…</div>}
      {view.s === "dash" && cur && <Dashboard learner={active} cur={cur} onBack={back} onDeleted={async () => {
        await refreshLearners(); setActive(null);
      }} />}

      {view.s === "grades" && cur && (
        <GradeList
          order={GRADE_ORDER} cur={cur}
          onOpen={g => setView({ s: "grade", g })}
        />
      )}

      {view.s === "grade" && cur && (
        <GradeMap
          gradeKey={view.g} cur={cur}
          onBack={back}
          onOpen={(topicId, topicName, advanced) => setView({ s: "tiers", topicId, topicName, advanced })}
        />
      )}

      {view.s === "tiers" && cur && (
        <TierPicker
          topicId={view.topicId} topicName={view.topicName} advanced={view.advanced}
          tiers={cur.tiers} counts={cur.counts} threshold={cur.thresholds?.[view.topicId] ?? 90} learner={active}
          onBack={() => setView({ s: "grades" })}
          onStart={tier => setView({ s: "quiz", topicId: view.topicId, topicName: view.topicName, tier, advanced: view.advanced })}
          onDiagnostic={() => setView({ s: "diagnostic", topicId: view.topicId, topicName: view.topicName })}
          onMastery={() => setView({ s: "mastery", topicId: view.topicId, topicName: view.topicName })}
          onPractice={() => setView({ s: "practice", topicId: view.topicId, topicName: view.topicName, nonce: Date.now() })}
        />
      )}

      {view.s === "diagnostic" && (
        <Diagnostic
          learner={active} topicId={view.topicId} topicName={view.topicName}
          onDone={() => setView({ s: "tiers", topicId: view.topicId, topicName: view.topicName, advanced: false })}
          onExit={back}
        />
      )}

      {view.s === "mastery" && (
        <MasteryCheck
          learner={active} topicId={view.topicId} topicName={view.topicName}
          onExit={() => setView({ s: "tiers", topicId: view.topicId, topicName: view.topicName, advanced: false })}
        />
      )}

      {view.s === "practice" && (
        <Practice
          key={view.nonce}
          learner={active} topicId={view.topicId} topicName={view.topicName}
          onExit={() => setView({ s: "tiers", topicId: view.topicId, topicName: view.topicName, advanced: false })}
          onRestart={() => setView({ s: "practice", topicId: view.topicId, topicName: view.topicName, nonce: Date.now() })}
        />
      )}

      {view.s === "quiz" && (
        <Quiz
          topicId={view.topicId} topicName={view.topicName} tier={view.tier}
          advanced={view.advanced} threshold={cur?.thresholds?.[view.topicId] ?? 90} learner={active}
          onExit={() => setView({ s: "tiers", topicId: view.topicId, topicName: view.topicName, advanced: view.advanced })}
        />
      )}
    </Shell>
  );
}

export { GRADE_ORDER, ApiError };
