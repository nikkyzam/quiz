"use strict";
/* ============================================================
   Math Quest — engine
   Screens: grade select → topic map → tier select → quiz → results
   ============================================================ */

const SECNAME = typeof SECS !== "undefined" ? SECS : {};
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = t => String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const lvlOf = q => q.lvl || 1;
const TIER_BY_LVL = {1:"practice", 2:"challenge", 3:"boss"};

/* ---------- original characters (not anyone else's) ---------- */
const BEASTS = {
  pip: {name:"Pip",  hue:"#F2A63B", horns:2, eyes:2},
  nim: {name:"Nim",  hue:"#3FB27F", horns:3, eyes:1},
  vex: {name:"Vex",  hue:"#6C7BE8", horns:2, eyes:3}
};
function beastSVG(key, size){
  const b = BEASTS[key] || BEASTS.pip, s = size || 64;
  let horns = "";
  for(let i=0;i<b.horns;i++){
    const x = 26 + i*(48/Math.max(1,b.horns-1||1)) - (b.horns===1?0:0);
    horns += `<path d="M${x} 26 L${x+5} 8 L${x+11} 26 Z" fill="${b.hue}"/>`;
  }
  let eyes = "";
  const ex = b.eyes===1 ? [50] : b.eyes===2 ? [38,62] : [32,50,68];
  ex.forEach(x=>{
    eyes += `<circle cx="${x}" cy="55" r="8" fill="#fff"/>
             <circle cx="${x}" cy="56" r="4" fill="#17263F"/>`;
  });
  return `<svg viewBox="0 0 100 100" width="${s}" height="${s}" role="img" aria-label="${b.name}">
    ${horns}
    <rect x="18" y="26" width="64" height="58" rx="24" fill="${b.hue}"/>
    ${eyes}
    <path d="M36 72 Q50 82 64 72" stroke="#17263F" stroke-width="4" fill="none" stroke-linecap="round"/>
  </svg>`;
}

/* ---------- profiles ----------
   These are profiles, not accounts: no password, no security. They exist
   so several kids can share a device and keep separate progress. Anything
   stored here lives only in this browser. */
const PROFKEY = "mq-profiles-v1", ACTIVEKEY = "mq-active-v1";
let profiles = [], activeId = null;

function loadProfiles(){
  try { profiles = JSON.parse(localStorage.getItem(PROFKEY) || "[]"); } catch(e){ profiles = []; }
  if(!Array.isArray(profiles)) profiles = [];
  try { activeId = localStorage.getItem(ACTIVEKEY); } catch(e){ activeId = null; }
  if(activeId && !profiles.some(p=>p.id===activeId)) activeId = null;
}
function saveProfiles(){
  try{
    localStorage.setItem(PROFKEY, JSON.stringify(profiles));
    if(activeId) localStorage.setItem(ACTIVEKEY, activeId); else localStorage.removeItem(ACTIVEKEY);
  }catch(e){}
}
function activeProfile(){ return profiles.find(p=>p.id===activeId) || null; }
function newId(){ return "p" + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36); }

function addProfile(name, beast){
  const p = {id:newId(), name:name.slice(0,24), beast, created:new Date().toISOString()};
  profiles.push(p); activeId = p.id; saveProfiles(); loadProgress();
  return p;
}
function selectProfile(id){ activeId = id; saveProfiles(); loadProgress(); }
function deleteProfile(id){
  profiles = profiles.filter(p=>p.id!==id);
  try{ localStorage.removeItem(PKEY_FOR(id)); }catch(e){}
  if(activeId===id) activeId = null;
  saveProfiles();
}

/* ---------- progress (namespaced per profile) ---------- */
const PKEY_FOR = id => "mq-progress-v1::" + id;
let progress = {};
function loadProgress(){
  progress = {};
  if(!activeId) return;
  try { progress = JSON.parse(localStorage.getItem(PKEY_FOR(activeId)) || "{}"); } catch(e){ progress = {}; }
}
function saveProgress(){
  if(!activeId) return;
  try{ localStorage.setItem(PKEY_FOR(activeId), JSON.stringify(progress)); }catch(e){}
}
function tierRec(topicId, tier){
  return (progress[topicId] && progress[topicId][tier]) || null;
}
function starsFor(topicId){
  return TIERS.filter(t => { const r = tierRec(topicId, t.id); return r && r.pct >= 80; }).length;
}
function bankFor(topicId){ return (typeof QUESTIONS !== "undefined" && QUESTIONS[topicId]) || null; }
function tierQuestions(topicId, tier){
  const bank = bankFor(topicId); if(!bank) return [];
  return bank.map((q,i)=>({q,i})).filter(o => TIER_BY_LVL[lvlOf(o.q)] === tier).map(o=>o.i);
}
function topicHasContent(topicId){ const b = bankFor(topicId); return !!(b && b.length); }

/* ---------- navigation ---------- */
let curGrade = null, curTopic = null, curTier = null;
function show(id){
  $$(".screen").forEach(s=>s.classList.remove("on"));
  $(id).classList.add("on");
  const p = activeProfile();
  $("#whoBar").style.display = (p && id !== "#who") ? "flex" : "none";
  if(p){
    $("#whoName").textContent = p.name;
    $("#whoAvatar").innerHTML = beastSVG(p.beast, 26);
  }
  window.scrollTo(0,0);
}

/* ---------- profile screen ---------- */
let pickBeast = "vex";
function renderWho(){
  $("#whoList").innerHTML = profiles.length
    ? profiles.map(p=>{
        const st = totalStarsFor(p.id);
        return `<button class="who" data-id="${p.id}">
          <span class="wav">${beastSVG(p.beast,40)}</span>
          <span class="wmeta"><span class="wname">${esc(p.name)}</span>
            <span class="wsub">${st.stars} ${st.stars===1?"star":"stars"} · ${st.topics} ${st.topics===1?"topic":"topics"} started</span></span>
          <span class="wgo">→</span></button>`;
      }).join("")
    : `<p class="lede" style="margin:0 0 14px">No profiles yet — make the first one below.</p>`;
  $$(".who").forEach(b=>b.addEventListener("click", ()=>{
    selectProfile(b.dataset.id); renderGrades(); show("#home");
  }));
  $("#beastPick").innerHTML = Object.keys(BEASTS).map(k=>
    `<button class="bpick${k===pickBeast?" sel":""}" data-b="${k}" aria-label="${BEASTS[k].name}">${beastSVG(k,40)}</button>`
  ).join("");
  $$(".bpick").forEach(b=>b.addEventListener("click", ()=>{
    pickBeast = b.dataset.b;
    $$(".bpick").forEach(x=>x.classList.toggle("sel", x.dataset.b===pickBeast));
  }));
}
/* stars across all topics for any profile, without disturbing the active one */
function totalStarsFor(id){
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(PKEY_FOR(id)) || "{}"); } catch(e){ raw = {}; }
  let stars = 0, topics = 0;
  Object.keys(raw).forEach(t=>{
    topics++;
    TIERS.forEach(tr=>{ const r = raw[t] && raw[t][tr.id]; if(r && r.pct>=80) stars++; });
  });
  return {stars, topics};
}

/* ---------- progress dashboard ---------- */
function renderDash(){
  const p = activeProfile();
  if(!p) return;
  $("#dashName").textContent = p.name;
  $("#dashAvatar").innerHTML = beastSVG(p.beast, 44);

  const rows = [];
  let stars = 0, mastered = 0, runs = 0, answered = 0;
  GRADE_ORDER.forEach(g=>{
    CURRICULUM[g].units.forEach(u=>u.topics.forEach(t=>{
      const rec = progress[t.id];
      if(!rec) return;
      const s = starsFor(t.id);
      stars += s; if(s === TIERS.length) mastered++;
      runs += rec.runs || 0;
      const tiers = TIERS.map(tr=>{
        const r = rec[tr.id];
        if(r) answered += r.total;
        return r
          ? `<span class="pill${r.pct>=80?" good":""}">${tr.name} ${r.pct}%</span>`
          : `<span class="pill dim">${tr.name} —</span>`;
      }).join("");
      rows.push({last: rec.last || "", html:`
        <div class="drow">
          <div class="dhead">
            <b>${esc(t.name)}</b>
            <span class="stars sm">${"★".repeat(s)}${"☆".repeat(TIERS.length-s)}</span>
          </div>
          <div class="dsub">${esc(CURRICULUM[g].label)} · ${esc(u.name)}${rec.last ? " · last "+timeAgo(rec.last) : ""}</div>
          <div class="pills">${tiers}</div>
        </div>`});
    }));
  });
  rows.sort((a,b)=> (b.last||"").localeCompare(a.last||""));

  $("#dashStats").innerHTML = `
    <div class="stat"><b>${stars}</b><span>Stars</span></div>
    <div class="stat"><b>${mastered}</b><span>Topics mastered</span></div>
    <div class="stat"><b>${runs}</b><span>Rounds played</span></div>`;
  $("#dashRows").innerHTML = rows.length
    ? rows.map(r=>r.html).join("")
    : `<p class="lede" style="margin:0">Nothing practised yet. Pick a grade and start a topic —
       progress shows up here as soon as a round is finished.</p>`;
  show("#dash");
}
function timeAgo(iso){
  const d = (Date.now() - new Date(iso).getTime())/1000;
  if(isNaN(d)) return "";
  if(d < 90) return "just now";
  if(d < 5400) return Math.round(d/60) + " min ago";
  if(d < 172800) return Math.round(d/3600) + " hr ago";
  return Math.round(d/86400) + " days ago";
}

/* Object key order puts "K" after the numbers, so state the order we want. */
const GRADE_ORDER = ["K","1","2","3","4","5","6","7","8"];

function renderGrades(){
  const totals = GRADE_ORDER.map(g=>{
    const grade = CURRICULUM[g];
    const topics = grade.units.flatMap(u=>u.topics);
    const ready  = topics.filter(t=>topicHasContent(t.id)).length;
    const stars  = topics.reduce((a,t)=>a+starsFor(t.id),0);
    const maxSt  = ready * TIERS.length;
    return {g, grade, topics, ready, stars, maxSt};
  });
  $("#gradeGrid").innerHTML = totals.map(({g,grade,topics,ready,stars,maxSt})=>`
    <button class="gcard${ready?"":" empty"}" data-g="${g}">
      <span class="gbeast">${beastSVG(grade.beast, 46)}</span>
      <span class="gmeta">
        <span class="gname">${esc(grade.label)}</span>
        <span class="gsub">${topics.length} topics · ${grade.units.length} units</span>
      </span>
      <span class="gstat">${ready
        ? `<span class="stars">${"★".repeat(Math.min(stars,3))}${"☆".repeat(Math.max(0,3-stars))}</span>
           <span class="gready">${stars}/${maxSt} stars</span>`
        : `<span class="soon">coming soon</span>`}</span>
    </button>`).join("");
  $$(".gcard").forEach(b=>b.addEventListener("click", ()=>openGrade(b.dataset.g)));
}

function openGrade(g){
  curGrade = g;
  const grade = CURRICULUM[g];
  $("#mapTitle").textContent = grade.label;
  $("#mapBeast").innerHTML = beastSVG(grade.beast, 52);
  $("#mapUnits").innerHTML = grade.units.map(u=>`
    <section class="unit">
      <h3>${esc(u.name)}</h3>
      <div class="tlist">
        ${u.topics.map(t=>{
          const has = topicHasContent(t.id), st = starsFor(t.id);
          return `<button class="topic${has?"":" locked"}" data-t="${t.id}" data-n="${esc(t.name)}"${has?"":" disabled"}>
            <span class="tname">${esc(t.name)}</span>
            ${has ? `<span class="stars sm">${"★".repeat(st)}${"☆".repeat(3-st)}</span>`
                  : `<span class="soon sm">not yet written</span>`}
          </button>`;
        }).join("")}
      </div>
    </section>`).join("");
  $$(".topic:not(.locked)").forEach(b=>
    b.addEventListener("click", ()=>openTopic(b.dataset.t, b.dataset.n)));
  show("#map");
}

function openTopic(topicId, name){
  curTopic = topicId;
  $("#tierTitle").textContent = name;
  $("#tierList").innerHTML = TIERS.map(t=>{
    const n = tierQuestions(topicId, t.id).length;
    const rec = tierRec(topicId, t.id);
    if(!n) return "";
    return `<button class="tier" data-tier="${t.id}">
      <span class="tierhead"><b>${t.name}</b><span class="tcount">${n} questions</span></span>
      <span class="tierblurb">${esc(t.blurb)}</span>
      ${rec ? `<span class="tierbest${rec.pct>=80?" good":""}">best ${rec.score}/${rec.total} · ${rec.pct}%</span>` : ""}
    </button>`;
  }).join("");
  $$(".tier").forEach(b=>b.addEventListener("click", ()=>startTier(b.dataset.tier)));
  show("#tiers");
}

/* ---------- quiz ---------- */
let queue=[], pos=0, score=0, streak=0, answered=false, results={}, mode="full", missed=[];

function startTier(tier){
  curTier = tier;
  queue = tierQuestions(curTopic, tier);
  mode = "full"; results = {}; missed = [];
  pos=0; score=0; streak=0;
  $("#qtot").textContent = queue.length;
  show("#quiz"); render();
}
function retryMissed(){
  queue = missed.slice(); mode = "retry"; missed = [];
  pos=0; score=0; streak=0;
  $("#qtot").textContent = queue.length;
  show("#quiz"); render();
}
const bank = () => bankFor(curTopic);

function render(){
  answered = false;
  const q = bank()[queue[pos]];
  $("#qnum").textContent = pos+1;
  $("#scoreVal").textContent = score;
  $("#streakVal").textContent = streak>=3 ? "🔥"+streak : "";
  $("#fill").style.width = (pos/queue.length*100)+"%";

  let html = `<div class="sec">${esc(SECNAME[q.sec] || "Problem")}</div>
              <p class="qtext">${esc(q.q)}</p>`;
  if(q.fig) html += `<div class="fig">${gridSVG(q.fig)}</div>`;

  if(q.type === "mc"){
    const order = q.opts.map((_,i)=>i);
    for(let i=order.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [order[i],order[j]]=[order[j],order[i]]; }
    html += `<div class="opts">` + order.map((oi,slot)=>
      `<button class="opt${q.mono?" mono":""}" data-oi="${oi}"><span class="key">${slot+1}</span>${esc(q.opts[oi])}</button>`
    ).join("") + `</div>`;
  } else {
    const ph = q.type === "pair" ? "(x, y)" : "Your answer";
    html += `<div class="inrow">
      <input class="ansin" id="ansin" autocomplete="off" placeholder="${ph}" aria-label="Your answer">
      <button class="btn" id="checkBtn">Check</button></div>`;
    const hint = q.hint || (q.type==="pair" ? "Type it as an ordered pair, like (3, -4)." : "");
    if(hint) html += `<div class="hint">${esc(hint)}</div>`;
  }
  html += `<div id="fbSlot" aria-live="polite"></div>`;
  $("#qcard").innerHTML = html;

  if(q.type === "mc") $$(".opt").forEach(b=>b.addEventListener("click", ()=>pickMC(b)));
  else {
    $("#checkBtn").addEventListener("click", checkInput);
    $("#ansin").addEventListener("keydown", e=>{ if(e.key==="Enter") checkInput(); });
    $("#ansin").focus();
  }
}

function pickMC(btn){
  if(answered) return;
  const q = bank()[queue[pos]], oi = +btn.dataset.oi, ok = oi === q.a;
  $$(".opt").forEach(b=>{
    b.disabled = true;
    const i = +b.dataset.oi;
    if(i===q.a) b.classList.add("right");
    else if(i===oi) b.classList.add("wrong");
    else b.classList.add("dim");
  });
  finish(ok, q.opts[q.a]);
}

function checkInput(){
  if(answered) return;
  const q = bank()[queue[pos]], raw = $("#ansin").value;
  if(!raw.trim()) return;
  let ok, ansText;
  if(q.type === "pair"){
    const p = raw.replace(/−/g,"-").replace(/[^0-9.,\-]/g,"").split(",").filter(s=>s!=="");
    ok = p.length===2 && Math.abs(parseFloat(p[0])-q.ansP[0])<1e-9 && Math.abs(parseFloat(p[1])-q.ansP[1])<1e-9;
    ansText = "(" + q.ansP[0] + ", " + q.ansP[1] + ")";
  } else {
    const n = parseFloat(raw.replace(/−/g,"-").replace(/[^0-9.\-]/g,""));
    ok = !isNaN(n) && Math.abs(n - q.ans) < 1e-9;
    ansText = String(q.ans);
  }
  $("#ansin").disabled = true; $("#checkBtn").disabled = true;
  $("#ansin").style.borderColor = ok ? "var(--good)" : "var(--bad)";
  finish(ok, ansText);
}

const PRAISE = ["Correct!","Nice work!","You got it!","Exactly right!","Nailed it!"];
function finish(ok, ansText){
  answered = true;
  const qi = queue[pos], q = bank()[qi];
  if(ok){ score++; streak++; } else { streak=0; if(!missed.includes(qi)) missed.push(qi); }
  results[qi] = ok;
  $("#scoreVal").textContent = score;
  $("#streakVal").textContent = streak>=3 ? "🔥"+streak : "";
  $("#fill").style.width = ((pos+1)/queue.length*100)+"%";
  const last = pos === queue.length-1;
  $("#fbSlot").innerHTML = `
    <div class="fb${ok?"":" bad"}">
      <h3>${ok ? PRAISE[Math.floor(Math.random()*PRAISE.length)] : "Not quite — the answer is "+esc(ansText)}</h3>
      <p class="expl">${esc(q.expl)}</p>
      ${q.figA ? `<div class="fig">${gridSVG(q.figA)}</div>` : ""}
    </div>
    <div class="nextrow"><span class="kbd">press Enter ↵</span>
      <button class="btn" id="nextBtn">${last ? "See results →" : "Next →"}</button></div>`;
  $("#nextBtn").addEventListener("click", next);
  $("#nextBtn").focus();
}
function next(){ pos++; if(pos < queue.length) render(); else showResults(); }

function showResults(){
  show("#results");
  const pct = Math.round(score/queue.length*100);
  $("#resScore").textContent = score;
  $("#resTot").textContent = queue.length;
  const tierName = (TIERS.find(t=>t.id===curTier)||{}).name || "";
  $("#resEyebrow").textContent = tierName + (mode==="retry" ? " · retry round" : "");
  $("#resMsg").textContent =
    pct>=90 ? "Mastered. That's a star earned. 🎉" :
    pct>=80 ? "Star earned — solid work." :
    pct>=60 ? "Close. Fix the ones below and run it again for the star." :
              "Worth another run — read each explanation before you retry.";

  if(mode === "full"){
    const prev = tierRec(curTopic, curTier);
    progress[curTopic] = progress[curTopic] || {};
    progress[curTopic].last = new Date().toISOString();
    progress[curTopic].runs = (progress[curTopic].runs || 0) + 1;
    if(!prev || pct > prev.pct){
      progress[curTopic][curTier] = {score, total:queue.length, pct, at:new Date().toISOString()};
    }
    saveProgress();
  }
  const bySec = {};
  Object.keys(results).forEach(i=>{
    const s = bank()[i].sec;
    bySec[s] = bySec[s] || {got:0, tot:0};
    bySec[s].tot++; if(results[i]) bySec[s].got++;
  });
  $("#resCard").innerHTML = Object.keys(bySec).map(s=>{
    const {got,tot} = bySec[s], p = got/tot;
    const col = p>=0.8 ? "var(--good)" : p>=0.5 ? "var(--accent)" : "var(--bad)";
    return `<div class="secrow">
      <div class="lbl"><b>${esc(SECNAME[s]||"Problems")}</b><span>${got}/${tot}</span></div>
      <div class="bar"><i style="width:${p*100}%;background:${col}"></i></div></div>`;
  }).join("");

  $("#retryBtn").style.display = missed.length ? "" : "none";
  $("#retryBtn").textContent = `Practice the ${missed.length} missed →`;
}

/* ---------- wiring ---------- */
$("#createBtn").addEventListener("click", ()=>{
  const name = $("#newName").value.trim();
  if(!name){ $("#newName").focus(); $("#nameErr").textContent = "Type a name first."; return; }
  $("#nameErr").textContent = "";
  addProfile(name, pickBeast);
  $("#newName").value = "";
  renderGrades(); show("#home");
});
$("#newName").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#createBtn").click(); });
$("#switchBtn").addEventListener("click", ()=>{ renderWho(); show("#who"); });
$("#dashBtn").addEventListener("click", renderDash);
$("#dashBack").addEventListener("click", ()=>{ renderGrades(); show("#home"); });
$("#deleteBtn").addEventListener("click", ()=>{
  const p = activeProfile(); if(!p) return;
  if($("#deleteBtn").dataset.armed !== "1"){
    $("#deleteBtn").dataset.armed = "1";
    $("#deleteBtn").textContent = "Really delete " + p.name + "? Tap again";
    setTimeout(()=>{ $("#deleteBtn").dataset.armed=""; $("#deleteBtn").textContent="Delete this profile"; }, 5000);
    return;
  }
  deleteProfile(p.id); renderWho(); show("#who");
});

$("#retryBtn").addEventListener("click", retryMissed);
$("#againBtn").addEventListener("click", ()=>startTier(curTier));
$("#toTopicBtn").addEventListener("click", ()=>openTopic(curTopic, $("#tierTitle").textContent));
$("#mapBack").addEventListener("click", ()=>{ renderGrades(); show("#home"); });
$("#tierBack").addEventListener("click", ()=>openGrade(curGrade));
$("#quizBack").addEventListener("click", ()=>openTopic(curTopic, $("#tierTitle").textContent));

document.addEventListener("keydown", e=>{
  if(!$("#quiz").classList.contains("on")) return;
  const inField = document.activeElement && document.activeElement.id === "ansin";
  if(answered && e.key === "Enter"){ e.preventDefault(); next(); return; }
  if(!answered && !inField && /^[1-4]$/.test(e.key)){
    const b = $$(".opt")[+e.key-1]; if(b) b.click();
  }
});

/* ---------- boot ---------- */
loadProfiles();
loadProgress();
renderWho();
if(activeProfile()){ renderGrades(); show("#home"); }
else { show("#who"); }
