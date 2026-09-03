import "../styles/play.css";
import { useEffect, useState } from "react";
import { call, post, ApiError, type Learner } from "../api";
import { Beast } from "../beasts";
import { ReadAloud } from "../components/ReadAloud";

/* Branching story (spec 5.6). Chapters unlock from real progress; each ends
   with a choice that shapes how the next chapter opens. */

export type StoryPanel = { art: string; text: string };
export type StoryChapter = {
  id: string; title: string; unlocked: boolean; unlockHint: string;
  read: boolean; chosen: string | null; intro: string | null;
  panels: StoryPanel[] | null;
  choice: { prompt: string; options: { id: string; label: string }[] } | null;
};
export type StoryData = { chapters: StoryChapter[]; choices: Record<string, string>; epilogue: string | null };
type ChooseResult = { chosen: string; badges: any[]; next: StoryChapter | null; epilogue: string | null };

const storyApi = {
  get: (learnerId: string) => call<StoryData>(`/learners/${learnerId}/story`),
  choose: (learnerId: string, chapter: string, choice: string) =>
    post<ChooseResult>(`/learners/${learnerId}/story/${chapter}`, { choice })
};

function friendly(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Please sign in again to read on.";
    if (e.status === 403) return e.message === "chapter_locked" ? "That chapter is still locked." : "This learner is not on your account.";
    if (e.status === 409) return e.message === "already_chosen" ? "You already chose for this chapter." : "Finish the chapter before this one first.";
  }
  return fallback;
}

const firstOpen = (chs: StoryChapter[]) => {
  const next = chs.find(c => c.unlocked && !c.chosen);
  if (next) return next.id;
  const read = chs.filter(c => c.chosen);
  return read.length ? read[read.length - 1].id : chs[0]?.id ?? null;
};

export function Story({ learner, onBack, initial }: { learner: Learner; onBack: () => void; initial?: StoryData }) {
  const [data, setData] = useState<StoryData | null>(initial ?? null);
  const [open, setOpen] = useState<string | null>(initial ? firstOpen(initial.chapters) : null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) return;
    storyApi.get(learner.id)
      .then(d => { setData(d); setOpen(firstOpen(d.chapters)); })
      .catch(e => setError(friendly(e, "Couldn't load the story. Check the server is running.")));
  }, [learner.id, initial]);

  async function choose(ch: StoryChapter, optionId: string) {
    if (!data || busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const r = await storyApi.choose(learner.id, ch.id, optionId);
      const chapters = data.chapters.map(c =>
        c.id === ch.id ? { ...c, read: true, chosen: r.chosen }
        : r.next && c.id === r.next.id ? r.next : c);
      setData({ chapters, choices: { ...data.choices, [ch.id]: r.chosen }, epilogue: r.epilogue });
      const label = ch.choice?.options.find(o => o.id === optionId)?.label || optionId;
      setStatus(`Written into the story: ${label}.` + (r.badges?.length ? ` New badge: ${r.badges.map((b: any) => b?.name || b?.code || b).join(", ")}.` : ""));
      if (r.next?.unlocked) setOpen(r.next.id);
    } catch (e) { setError(friendly(e, "Couldn't save that choice.")); }
    finally { setBusy(false); }
  }

  return (
    <>
      <button className="back" onClick={onBack}>← Back</button>
      <div className="play-head">
        <Beast kind={learner.beast} size={48} />
        <div><div className="eyebrow">Story</div><h1>The BeastForge</h1></div>
      </div>
      <p className="lede">Every round you finish moves the story on. Your choices decide how it goes.</p>
      {error && <p className="err" role="alert">{error}</p>}
      <p className="play-status" role="status">{status}</p>
      {!data && !error && <div className="loading" role="status">Opening the book…</div>}
      {data && (
        <ol className="chapters">
          {data.chapters.map((ch, i) => {
            const isOpen = open === ch.id;
            const prev = i > 0 ? data.chapters[i - 1] : null;
            const waiting = !!prev && !prev.chosen;
            const chosenLabel = ch.chosen ? (ch.choice?.options.find(o => o.id === ch.chosen)?.label || ch.chosen) : null;
            return (
              <li key={ch.id} className={"chapter" + (isOpen ? " open" : "") + (ch.unlocked ? "" : " locked")}>
                <button type="button" className="chapter-btn" aria-expanded={isOpen}
                        aria-controls={`chapter-${ch.id}`} onClick={() => setOpen(isOpen ? null : ch.id)}>
                  <span className="chapter-num" aria-hidden="true">{i + 1}</span>
                  <span>
                    <span className="chapter-title">Chapter {i + 1}: {ch.title}</span>
                    {!ch.unlocked && <span className="chapter-state">Locked. Unlock it: {ch.unlockHint}</span>}
                    {ch.unlocked && chosenLabel && <span className="chapter-state done">You chose: {chosenLabel}</span>}
                    {ch.unlocked && !chosenLabel && <span className="chapter-state">{waiting ? "Read the chapter before this one first" : "Ready to read"}</span>}
                  </span>
                  <span className="chapter-arrow" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                </button>
                <div id={`chapter-${ch.id}`} hidden={!isOpen} className="chapter-body">
                  {!ch.unlocked && (
                    <p className="muted">This chapter opens when you <b>{ch.unlockHint.toLowerCase()}</b>. Your monster is waiting.</p>
                  )}
                  {ch.unlocked && ch.panels && (
                    <>
                      {ch.intro && <p className="story-intro">{ch.intro} <ReadAloud text={ch.intro} label="Read aloud" /></p>}
                      <ol className="panels">
                        {ch.panels.map((p, j) => (
                          <li key={j} className="panel">
                            <PanelArt art={p.art} beast={learner.beast} />
                            <div><p>{p.text}</p><ReadAloud text={p.text} /></div>
                          </li>
                        ))}
                      </ol>
                      {ch.choice && (
                        <div className="choice">
                          <p className="choice-prompt">{ch.choice.prompt}</p>
                          <div className="opts" role="group" aria-label={ch.choice.prompt}>
                            {ch.choice.options.map((o, k) => {
                              const picked = ch.chosen === o.id;
                              const cls = "opt" + (ch.chosen ? (picked ? " right" : " dim") : "");
                              return (
                                <button key={o.id} type="button" className={cls}
                                        disabled={!!ch.chosen || waiting || busy}
                                        aria-pressed={ch.chosen ? picked : undefined}
                                        onClick={() => choose(ch, o.id)}>
                                  <span className="key" aria-hidden="true">{k + 1}</span>{o.label}
                                  {picked && <span className="mark">✓<span className="visually-hidden"> your choice</span></span>}
                                </button>
                              );
                            })}
                          </div>
                          {waiting && <p className="muted">Finish chapter {i} first, then you can choose here.</p>}
                          {chosenLabel && <p className="chosen-note">Your choice is part of the story now.</p>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {data?.epilogue && (
        <div className="epilogue">
          <h2>Epilogue</h2>
          <p>{data.epilogue}</p>
          <ReadAloud text={data.epilogue} />
        </div>
      )}
    </>
  );
}

/* Decorative art for a panel: the monster where the panel is about it,
   otherwise a small original glyph for the scene. Hidden from AT — the
   narration carries the meaning. */
function PanelArt({ art, beast }: { art: string; beast: string }) {
  if (art.startsWith("monster-")) {
    const mood = /proud|wave|blow/.test(art) ? "happy" : /think|brace/.test(art) ? "thinking" : "idle";
    return <div className="panelart" aria-hidden="true"><Beast kind={beast} size={56} still mood={mood} /></div>;
  }
  return <div className="panelart" aria-hidden="true"><svg viewBox="0 0 60 60" focusable="false">{glyph(art)}</svg></div>;
}

function glyph(art: string) {
  switch (art) {
    case "forge-dark": return <><rect x="8" y="22" width="44" height="30" rx="6" className="a-ink" /><rect x="22" y="36" width="16" height="16" className="a-muted" /><circle cx="30" cy="46" r="3" className="a-bad" /></>;
    case "door-open": return <><rect x="14" y="8" width="32" height="46" rx="4" className="a-ink" /><rect x="20" y="12" width="14" height="42" className="a-star" /><circle cx="31" cy="34" r="2" className="a-ink" /></>;
    case "ember": return <><ellipse cx="30" cy="46" rx="20" ry="6" className="a-muted" /><circle cx="30" cy="40" r="6" className="a-bad" /><circle cx="30" cy="38" r="3" className="a-star" /></>;
    case "flame": return <><path d="M30 8 Q42 24 40 38 Q44 46 30 54 Q16 46 20 38 Q18 24 30 8Z" className="a-bad" /><path d="M30 26 Q36 36 30 48 Q24 36 30 26Z" className="a-star" /></>;
    case "bellows": case "bellows-open": return <><path d="M10 30 L34 14 L34 46 Z" className="a-band" /><rect x="34" y="26" width="18" height="8" rx="2" className="a-ink" /></>;
    case "chains": return <>{[12, 24, 36, 48].map(x => <ellipse key={x} cx={x} cy="30" rx="6" ry="9" className="a-line" />)}</>;
    case "mirrors": case "exit": return <><rect x="8" y="10" width="20" height="40" rx="3" className="a-band" /><rect x="32" y="10" width="20" height="40" rx="3" className="a-good" /><path d="M14 14 L22 46" className="a-line" style={{ strokeWidth: 2 }} /></>;
    case "storm": return <><ellipse cx="30" cy="22" rx="20" ry="11" className="a-muted" /><path d="M32 30 L26 42 L32 42 L26 54" className="a-line" /></>;
    case "calm": return <><circle cx="30" cy="30" r="14" className="a-star" /><path d="M8 48 Q30 40 52 48" className="a-line" /></>;
    case "master": return <><rect x="20" y="8" width="20" height="18" rx="5" className="a-ink" /><rect x="12" y="28" width="36" height="26" rx="6" className="a-muted" /><rect x="24" y="14" width="12" height="4" className="a-star" /></>;
    case "hammer": return <><rect x="27" y="22" width="6" height="32" rx="2" className="a-muted" /><rect x="14" y="8" width="32" height="14" rx="3" className="a-ink" /></>;
    default: return <><polygon points="30,6 37,22 55,24 41,36 45,54 30,44 15,54 19,36 5,24 23,22" className="a-star" /></>;
  }
}
