import { useEffect, useState, useCallback } from "react";
import { api, ApiError, type User, type Learner, type Grade, type Tier } from "./api";
import { Beast } from "./beasts";
import { useAgeBand } from "./useAgeBand";
import { useI18n } from "./i18n";
import { AuthScreen } from "./screens/Auth";
import { LearnerPicker } from "./screens/Learners";
import { GradeList, GradeMap, TierPicker } from "./screens/Curriculum";
import { Quiz } from "./screens/Quiz";
import { Dashboard } from "./screens/Dashboard";
import { Diagnostic } from "./screens/Diagnostic";
import { MasteryCheck } from "./screens/MasteryCheck";
import { Practice } from "./screens/Practice";
import { Home } from "./screens/Home";
import { Lessons } from "./screens/Lessons";
import { Contest } from "./screens/Contest";
import { Proofs } from "./screens/Proofs";
import { Puzzles } from "./screens/Puzzles";
import { Games } from "./screens/Games";
import { Story } from "./screens/Story";
import { Simulations } from "./screens/Simulations";
import { Avatar } from "./screens/Avatar";
import { Authoring } from "./screens/Authoring";
import { Settings } from "./screens/Settings";
import { Onboarding, needsOnboarding } from "./screens/Onboarding";
import { Help } from "./screens/Help";
import { Family } from "./screens/Family";
import { Teacher } from "./screens/Teacher";
import { Admin } from "./screens/Admin";

const GRADE_ORDER = ["K", "1", "2", "3", "4", "5", "6", "7", "8"];

/* Screens that need nothing but the learner (or the account). */
type Simple = "home" | "lessons" | "contest" | "proofs" | "puzzles" | "games" | "story" | "simulations"
  | "avatar" | "settings" | "family" | "teacher" | "admin" | "authoring" | "help" | "dash";

type View =
  | { s: Simple }
  | { s: "grades" } | { s: "grade"; g: string }
  | { s: "tiers"; topicId: string; topicName: string; advanced: boolean }
  | { s: "quiz"; topicId: string; topicName: string; tier: string; advanced: boolean }
  | { s: "diagnostic"; topicId: string; topicName: string }
  | { s: "mastery"; topicId: string; topicName: string }
  | { s: "practice"; topicId: string; topicName: string; nonce: number };

function Shell({ children, nav }: { children: React.ReactNode; nav?: React.ReactNode }) {
  return (
    <div className="wrap">
      <a className="skip" href="#main">Skip to main content</a>
      {nav}
      <main id="main">{children}</main>
    </div>
  );
}

const STAFF = new Set(["teacher", "admin", "author", "editor"]);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booted, setBooted] = useState(false);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [active, setActive] = useState<Learner | null>(null);
  const [cur, setCur] = useState<any | null>(null);
  const [view, setView] = useState<View>({ s: "home" });
  const [tour, setTour] = useState(false);
  const [staffView, setStaffView] = useState<"teacher" | "admin" | "authoring" | null>(null);
  const { t } = useI18n();

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

  useEffect(() => { if (user && needsOnboarding()) setTour(true); }, [user]);

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
  if (tour) return <Shell><Onboarding onDone={() => setTour(false)} /></Shell>;

  const signOut = async () => { await api.logout(); setUser(null); setLearners([]); setActive(null); setStaffView(null); };
  const isStaff = STAFF.has(user.role || "");

  /* Staff consoles do not need a learner selected. */
  if (staffView) {
    const back = () => setStaffView(null);
    return (
      <Shell>
        {staffView === "teacher" && cur && <Teacher user={user} cur={cur} onBack={back} />}
        {staffView === "teacher" && !cur && <div className="loading" role="status">Loading the curriculum…</div>}
        {staffView === "admin" && <Admin user={user} onBack={back} />}
        {staffView === "authoring" && <Authoring user={user} onBack={back} />}
      </Shell>
    );
  }

  if (!active) {
    return (
      <Shell>
        <LearnerPicker
          userName={user.name}
          learners={learners}
          onPick={l => { setActive(l); setView({ s: "home" }); }}
          onChanged={refreshLearners}
          onSignOut={signOut}
        />
        {isStaff && (
          <nav className="rowbtns" aria-label="Staff tools" style={{ marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setStaffView("teacher")}>Teacher console</button>
            {user.role === "admin" && <button className="btn ghost" onClick={() => setStaffView("admin")}>Admin console</button>}
            <button className="btn ghost" onClick={() => setStaffView("authoring")}>Authoring</button>
          </nav>
        )}
      </Shell>
    );
  }

  const home = () => setView({ s: "home" });
  const openTopic = (topicId: string, topicName: string, advanced: boolean) => setView({ s: "tiers", topicId, topicName, advanced });
  const practice = (topicId: string, topicName: string) => setView({ s: "practice", topicId, topicName, nonce: Date.now() });
  const go = (where: string) => {
    if (where === "progress") setView({ s: "dash" });
    else setView({ s: where as Simple });
  };

  const nav = (
    <nav className="appbar" aria-label="Learner">
        <span className="who"><Beast kind={active.beast} size={26} /><b>{active.name}</b></span>
        <span className="spread">
          <button className="linkbtn" onClick={home}>{t("nav.home")}</button>
          <button className="linkbtn" onClick={() => setView({ s: "grades" })}>{t("nav.map")}</button>
          <button className="linkbtn" onClick={() => setView({ s: "dash" })}>{t("nav.progress")}</button>
          <button className="linkbtn" onClick={() => setView({ s: "family" })}>{t("nav.family")}</button>
          {isStaff && <button className="linkbtn" onClick={() => setStaffView("teacher")}>{t("nav.teacher")}</button>}
          <button className="linkbtn" onClick={() => setView({ s: "settings" })}>{t("nav.settings")}</button>
          <button className="linkbtn" onClick={() => setActive(null)}>{t("nav.switch")}</button>
      </span>
    </nav>
  );

  return (
    <Shell nav={nav}>
      {curriculumPending && <div className="loading" role="status">Loading the curriculum…</div>}

      {view.s === "home" && cur && (
        <Home learner={active} cur={cur} onBack={() => setView({ s: "grades" })}
              onOpenTopic={openTopic} onPractice={practice} onGo={go} />
      )}
      {view.s === "lessons" && cur && <Lessons learner={active} cur={cur} onBack={home} onPractice={practice} />}
      {view.s === "contest" && cur && <Contest learner={active} cur={cur} onBack={home} />}
      {view.s === "proofs" && cur && <Proofs learner={active} cur={cur} onBack={home} />}
      {view.s === "puzzles" && <Puzzles learner={active} onBack={home} />}
      {view.s === "games" && <Games learner={active} onBack={home} />}
      {view.s === "story" && <Story learner={active} onBack={home} />}
      {view.s === "simulations" && <Simulations learner={active} onBack={home} />}
      {view.s === "avatar" && <Avatar learner={active} onBack={home} onChanged={() => { refreshLearners().catch(() => {}); }} />}
      {view.s === "settings" && <Settings user={user} learner={active} onBack={home} onSignOut={signOut} />}
      {view.s === "help" && <Help onBack={home} />}
      {view.s === "family" && cur && <Family user={user} learner={active} cur={cur} onBack={home} onOpenTopic={openTopic} />}
      {view.s === "teacher" && cur && <Teacher user={user} cur={cur} onBack={home} />}
      {view.s === "admin" && <Admin user={user} onBack={home} />}
      {view.s === "authoring" && <Authoring user={user} onBack={home} />}

      {view.s === "dash" && cur && <Dashboard learner={active} cur={cur} onBack={home} onDeleted={async () => {
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
          onBack={() => setView({ s: "grades" })}
          onOpen={openTopic}
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
          onPractice={() => practice(view.topicId, view.topicName)}
        />
      )}

      {view.s === "diagnostic" && (
        <Diagnostic
          learner={active} topicId={view.topicId} topicName={view.topicName}
          onDone={() => setView({ s: "tiers", topicId: view.topicId, topicName: view.topicName, advanced: false })}
          onExit={home}
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
          onRestart={() => practice(view.topicId, view.topicName)}
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
export type { Grade, Tier };
