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

/* ---------- progress ---------- */
const PKEY = "mq-progress-v1";
let progress = {};
try { progress = JSON.parse(localStorage.getItem(PKEY) || "{}"); } catch(e){ progress = {}; }
function saveProgress(){ try{ localStorage.setItem(PKEY, JSON.stringify(progress)); }catch(e){} }
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
function show(id){ $$(".screen").forEach(s=>s.classList.remove("on")); $(id).classList.add("on"); window.scrollTo(0,0); }

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
    if(!prev || pct > prev.pct){
      progress[curTopic] = progress[curTopic] || {};
      progress[curTopic][curTier] = {score, total:queue.length, pct};
      saveProgress();
    }
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

renderGrades();
