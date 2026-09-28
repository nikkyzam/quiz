(function(){
  const BANKS = window.STUDY.banks;
  const CONFIG = window.STUDY.config;

  const MATH_FORMS = [
    { id:"B", name:"Form B — Fresh Test", bank:"B", recommended:true,
      desc:"The study guide skills with all-new numbers." },
    { id:"A", name:"Form A — Study Guide", bank:"A",
      desc:"The problems exactly as they appear on the sheet." },
    { id:"C", name:"Challenge Round", bank:"C", challengeOnly:true,
      desc:"12 harder problems a step past the guide." }
  ];

  const TESTS = CONFIG.tests.map(t => {
    const out = { id:t.id, label:t.label, name:t.name, desc:t.desc };
    const bank = BANKS[t.id];
    if(Array.isArray(bank)){
      out.questions = bank;
    } else {
      out.forms = MATH_FORMS.map(f => Object.assign({}, f, { questions: bank[f.bank] }));
    }
    return out;
  });

  const TYPE_LABEL = {
    mc:"Multiple choice", multi:"Select all", text:"Write it in",
    tf:"True or false", match:"Matching", order:"Put in order"
  };

  const GRADES = [
    { min:0.90, letter:"A", note:"Excellent — you have this unit down cold." },
    { min:0.80, letter:"B", note:"Strong work. Clean up the misses and you're ready." },
    { min:0.70, letter:"C", note:"Solid start. Focus on the topics listed below." },
    { min:0.60, letter:"D", note:"Getting there — read the notes below, then retake." },
    { min:0,    letter:"—", note:"Work through the answers below, then take it again." }
  ];

  const el = id => document.getElementById(id);

  let test = null, form = null;
  let questions = [], answers = [], views = [];
  let idx = 0;
  let openTest = null;

  function readStore(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function writeStore(k,v){ try { localStorage.setItem(k, String(v)); } catch(e){ /* storage may be blocked */ } }
  function withChallenge(){ return el('addChallenge').checked; }

  function setFor(t, f){
    if(!t.forms) return t.questions.slice();
    const base = f.questions.slice();
    return (withChallenge() && !f.challengeOnly) ? base.concat(BANKS.math.C) : base;
  }
  function keyFor(t, f){
    let k = CONFIG.storagePrefix + t.id;
    if(f) k += '_' + f.id + ((withChallenge() && !f.challengeOnly) ? 'C' : '');
    return k;
  }

  function shuffled(n){
    const a = Array.from({length:n}, (_,i) => i);
    for(let i = a.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- home ---------- */
  function renderHome(){
    const holder = el('testCards');
    holder.innerHTML = '';
    TESTS.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'test-card' + (openTest === t.id ? ' open' : '');
      let meta;
      if(t.forms){
        meta = '3 forms · ' + t.forms[1].questions.length + '–' + t.forms[0].questions.length + ' questions';
      } else {
        const best = readStore(keyFor(t, null));
        meta = t.questions.length + ' questions'
          + (best !== null && best !== '' ? ' · best ' + best + '/' + t.questions.length : '');
      }
      btn.innerHTML = '<span class="tc-label">' + t.label + '</span>'
        + '<span class="tc-name">' + t.name + '</span>'
        + '<span class="tc-desc">' + t.desc + '</span>'
        + '<span class="tc-meta">' + meta + '</span>';
      btn.addEventListener('click', () => {
        if(t.forms){ openTest = (openTest === t.id) ? null : t.id; renderHome(); }
        else { start(t, null); }
      });
      holder.appendChild(btn);
    });

    const t = TESTS.find(x => x.id === openTest);
    const box = el('subforms');
    if(!t){ box.classList.add('hide'); return; }
    box.classList.remove('hide');
    el('subformTitle').textContent = t.name + ' — choose a form';
    const grid = el('subformGrid');
    grid.innerHTML = '';
    t.forms.forEach(f => {
      const count = setFor(t, f).length;
      const best = readStore(keyFor(t, f));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'test-card' + (f.recommended ? ' open' : '');
      b.innerHTML = '<span class="tc-label">' + (f.recommended ? 'Recommended' : '&nbsp;') + '</span>'
        + '<span class="tc-name">' + f.name + '</span>'
        + '<span class="tc-desc">' + f.desc + '</span>'
        + '<span class="tc-meta">' + count + ' questions'
        + (best !== null && best !== '' ? ' · best ' + best + '/' + count : '') + '</span>';
      b.addEventListener('click', () => start(t, f));
      grid.appendChild(b);
    });
  }
  el('addChallenge').addEventListener('change', renderHome);

  /* ---------- starting ---------- */
  function blankAnswer(q){
    if(q.type === 'multi') return [];
    if(q.type === 'match') return q.pairs.map(() => null);
    if(q.type === 'order') return [];
    if(q.type === 'mc' || q.type === 'tf') return null;
    return '';
  }

  function start(t, f){
    test = t; form = f;
    questions = setFor(t, f);
    answers = questions.map(blankAnswer);
    // matching and ordering get one shuffle per attempt, held steady while you work
    views = questions.map(q =>
      q.type === 'match' ? shuffled(q.pairs.length)
      : q.type === 'order' ? shuffled(q.items.length)
      : null);
    idx = 0;

    const home = el('home');            // absent on a single-test page
    if(home) home.classList.add('hide');
    el('testArea').classList.add('show');
    el('results').classList.remove('show');
    el('testCard').style.display = 'block';
    el('paletteWrap').style.display = 'block';

    const best = readStore(keyFor(t, f));
    el('statBest').textContent = (best !== null && best !== '') ? best + '/' + questions.length : '—';

    render();
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function testTitle(){ return test.name + (form ? ' · ' + form.name.replace(/ —.*$/, '') : ''); }

  /* ---------- grading helpers ---------- */
  function normText(s){
    return String(s).toLowerCase()
      .replace(/[−–—]/g, '-')
      .replace(/[.,'’"`!?]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // For number-graded questions, pull the first signed number out of whatever was
  // typed, so "$8", "-37°C" and "120 feet" all grade the same as the bare number.
  function parseNumber(raw){
    const s = String(raw).replace(/[−–—]/g, '-').replace(/,/g, '').trim();
    if(s === '') return null;
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if(!m) return null;
    const v = Number(m[0]);
    return Number.isFinite(v) ? v : null;
  }

  function isAnswered(i){
    const q = questions[i], a = answers[i];
    if(q.type === 'multi') return Array.isArray(a) && a.length > 0;
    if(q.type === 'match') return a.every(v => v !== null);
    if(q.type === 'order') return a.length === q.items.length;
    if(q.type === 'mc' || q.type === 'tf') return a !== null;
    if(q.grade === 'number') return parseNumber(a) !== null;
    return String(a).trim() !== '';
  }
  function answeredCount(){ return questions.reduce((n,_,i) => n + (isAnswered(i) ? 1 : 0), 0); }

  function isCorrect(i){
    const q = questions[i], a = answers[i];
    if(!isAnswered(i)) return false;
    if(q.type === 'mc' || q.type === 'tf') return a === q.answer;
    if(q.type === 'multi'){
      const want = new Set(q.answer), got = new Set(a);
      return want.size === got.size && [...want].every(v => got.has(v));
    }
    if(q.type === 'match') return a.every((v, row) => v === row);
    if(q.type === 'order') return a.every((v, pos) => v === pos);
    if(q.grade === 'number') return parseNumber(a) === q.answer;
    return q.accept.some(ok => normText(ok) === normText(a));
  }

  function givenText(i){
    const q = questions[i], a = answers[i];
    if(!isAnswered(i)) return 'blank';
    if(q.type === 'mc') return q.choices[a];
    if(q.type === 'tf') return a === 0 ? 'True' : 'False';
    if(q.type === 'multi') return a.slice().sort((x,y) => x-y).map(j => q.choices[j]).join('; ');
    if(q.type === 'match') return q.pairs.map((p, row) => p[0] + ' → ' + q.pairs[a[row]][1]).join(' · ');
    if(q.type === 'order') return a.map(j => q.items[j]).join(' → ');
    return String(a).trim();
  }
  function correctText(i){
    const q = questions[i];
    if(q.type === 'mc') return q.choices[q.answer];
    if(q.type === 'tf') return q.answer === 0 ? 'True' : 'False';
    if(q.type === 'multi') return q.answer.map(j => q.choices[j]).join('; ');
    if(q.type === 'match') return q.pairs.map(p => p[0] + ' → ' + p[1]).join(' · ');
    if(q.type === 'order') return q.items.join(' → ');
    if(q.grade === 'number') return String(q.answer);
    return q.display;
  }
  function isExpr(q){ return q.grade === 'number' && !q.word; }

  function updateCounts(){
    const done = answeredCount();
    el('statAnswered').textContent = done;
    el('statLeft').textContent = questions.length - done;
    el('progressPct').textContent = Math.round(done / questions.length * 100) + '%';
    el('progressFill').style.width = (done / questions.length * 100) + '%';
  }

  /* ---------- rendering ---------- */
  function render(){
    const q = questions[idx];
    el('qnum').textContent = 'Question ' + q.n;
    el('catTag').textContent = q.cat;
    const tt = el('typeTag');
    if(q.type === 'mc'){ tt.style.display = 'none'; }
    else { tt.style.display = ''; tt.textContent = TYPE_LABEL[q.type] || q.type; }

    const body = el('qbody');
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = isExpr(q) ? 'expr' : 'qtext';
    p.innerHTML = q.q;
    body.appendChild(p);

    const mh = el('multiHint');
    if(q.type === 'multi'){ mh.textContent = 'Select ALL that apply'; mh.style.display = 'block'; }
    else if(q.type === 'order'){ mh.textContent = 'Click them in order — first click is #1'; mh.style.display = 'block'; }
    else if(q.type === 'match'){ mh.textContent = 'Pick the match for each one'; mh.style.display = 'block'; }
    else { mh.style.display = 'none'; }

    el('confirmBar').classList.remove('show');
    const area = el('inputArea');
    area.innerHTML = '';
    el('answerRow').style.display = 'none';

    if(q.type === 'text'){
      el('answerRow').style.display = 'flex';
      const input = el('answerInput');
      input.value = answers[idx];
      input.className = 'answer' + (q.grade === 'number' ? ' num' : '');
      input.placeholder = q.grade === 'number' ? 'e.g. −24' : '';
    } else if(q.type === 'tf'){
      const row = document.createElement('div');
      row.className = 'tf-row';
      ['True','False'].forEach((label, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tf' + (answers[idx] === i ? ' picked' : '');
        b.textContent = label;
        b.addEventListener('click', () => { answers[idx] = i; render(); });
        row.appendChild(b);
      });
      area.appendChild(row);
    } else if(q.type === 'match'){
      const list = document.createElement('div');
      list.className = 'match-list';
      q.pairs.forEach((pair, row) => {
        const r = document.createElement('div');
        r.className = 'match-row' + (answers[idx][row] !== null ? ' filled' : '');
        const left = document.createElement('span');
        left.className = 'm-left';
        left.innerHTML = pair[0];
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', 'Match for ' + pair[0].replace(/<[^>]*>/g, ''));
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = 'Choose…';
        sel.appendChild(ph);
        views[idx].forEach(optIdx => {
          const o = document.createElement('option');
          o.value = String(optIdx);
          o.textContent = q.pairs[optIdx][1];
          if(answers[idx][row] === optIdx) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => {
          answers[idx][row] = sel.value === '' ? null : Number(sel.value);
          updateCounts(); renderPalette();
          r.className = 'match-row' + (answers[idx][row] !== null ? ' filled' : '');
        });
        r.appendChild(left); r.appendChild(sel);
        list.appendChild(r);
      });
      area.appendChild(list);
    } else if(q.type === 'order'){
      const list = document.createElement('div');
      list.className = 'order-list';
      views[idx].forEach(itemIdx => {
        const pos = answers[idx].indexOf(itemIdx);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'order-item' + (pos !== -1 ? ' placed' : '');
        b.innerHTML = '<span class="seat">' + (pos !== -1 ? (pos + 1) : '·') + '</span>'
          + '<span>' + q.items[itemIdx] + '</span>';
        b.addEventListener('click', () => {
          const at = answers[idx].indexOf(itemIdx);
          if(at === -1) answers[idx].push(itemIdx);
          else answers[idx].splice(at, 1);
          render();
        });
        list.appendChild(b);
      });
      area.appendChild(list);
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'nav order-reset';
      reset.textContent = 'Start over';
      reset.addEventListener('click', () => { answers[idx] = []; render(); });
      area.appendChild(reset);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'choices';
      const letters = ['A','B','C','D','E'];
      q.choices.forEach((choice, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const picked = q.type === 'multi' ? answers[idx].includes(i) : answers[idx] === i;
        btn.className = 'choice' + (picked ? ' picked' : '');
        btn.innerHTML = '<span class="letter' + (q.type === 'multi' ? ' box' : '') + '">'
          + letters[i] + '</span><span>' + choice + '</span>';
        btn.addEventListener('click', () => pick(i));
        wrap.appendChild(btn);
      });
      area.appendChild(wrap);
    }

    const hint = el('hint');
    if(q.hint){ hint.textContent = q.hint; hint.style.display = 'block'; }
    else { hint.style.display = 'none'; }

    el('prevBtn').disabled = idx === 0;
    el('nextBtn').disabled = idx === questions.length - 1;
    el('progressText').textContent = testTitle() + ' · question ' + (idx + 1) + ' of ' + questions.length;

    updateCounts();
    renderPalette();
  }

  function pick(i){
    const q = questions[idx];
    if(q.type === 'multi'){
      const list = answers[idx];
      const at = list.indexOf(i);
      if(at === -1) list.push(i); else list.splice(at, 1);
    } else {
      answers[idx] = i;
    }
    render();
  }

  function renderPalette(){
    const pal = el('palette');
    pal.innerHTML = '';
    questions.forEach((q, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pal' + (isAnswered(i) ? ' done' : '') + (i === idx ? ' current' : '');
      b.textContent = q.n;
      b.setAttribute('aria-label', 'Go to question ' + q.n);
      b.addEventListener('click', () => { saveText(); idx = i; render(); });
      pal.appendChild(b);
    });
  }

  function saveText(){
    if(questions[idx] && questions[idx].type === 'text') answers[idx] = el('answerInput').value;
  }

  function go(delta){
    saveText();
    const next = idx + delta;
    if(next < 0 || next >= questions.length) return;
    idx = next;
    render();
    if(questions[idx].type === 'text') el('answerInput').focus();
  }

  el('prevBtn').addEventListener('click', () => go(-1));
  el('nextBtn').addEventListener('click', () => go(1));

  el('answerInput').addEventListener('input', () => {
    answers[idx] = el('answerInput').value;
    updateCounts();
    renderPalette();
  });
  el('answerInput').addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      e.preventDefault();
      if(idx < questions.length - 1) go(1); else el('submitBtn').click();
    }
  });

  el('submitBtn').addEventListener('click', () => {
    saveText();
    const blank = questions.length - answeredCount();
    if(blank > 0){
      el('confirmText').textContent = blank === 1
        ? '1 question is still blank.'
        : blank + ' questions are still blank.';
      el('confirmBar').classList.add('show');
      return;
    }
    grade();
  });
  el('confirmSubmit').addEventListener('click', grade);
  el('cancelSubmit').addEventListener('click', () => el('confirmBar').classList.remove('show'));

  function grade(){
    saveText();
    const marked = questions.map((q, i) => ({ q, i, correct: isCorrect(i) }));
    const score = marked.filter(m => m.correct).length;
    const pct = score / questions.length;

    el('testCard').style.display = 'none';
    el('paletteWrap').style.display = 'none';
    el('progressFill').style.width = '100%';
    el('progressText').textContent = testTitle() + ' submitted';
    el('progressPct').textContent = '100%';

    const band = GRADES.find(g => pct >= g.min);
    el('resultsTitle').textContent = testTitle();
    el('gradeLetter').textContent = band.letter;
    el('finalScore').textContent = score + ' / ' + questions.length;
    el('finalPct').textContent = Math.round(pct * 100) + '% · ' + band.note;

    const k = keyFor(test, form);
    const prevBest = parseInt(readStore(k) || '-1', 10);
    if(score > prevBest) writeStore(k, score);
    const nowBest = readStore(k);
    if(nowBest !== null && nowBest !== '') el('statBest').textContent = nowBest + '/' + questions.length;

    const missedByCat = {};
    marked.forEach(m => { if(!m.correct) missedByCat[m.q.cat] = (missedByCat[m.q.cat] || 0) + 1; });
    const cats = Object.keys(missedByCat).sort((a,b) => missedByCat[b] - missedByCat[a]);
    if(cats.length){
      el('focusList').innerHTML = cats
        .map(c => '<li>' + c + ' — ' + missedByCat[c] + (missedByCat[c] === 1 ? ' miss' : ' misses') + '</li>')
        .join('');
      el('focusBox').style.display = 'block';
    } else {
      el('focusBox').style.display = 'none';
    }

    const missedCount = marked.length - score;
    el('reviewBox').innerHTML = '<h3>Answers</h3>'
      + '<p class="review-lede">' + (missedCount
          ? 'Every question you missed shows the right answer and why it is right.'
          : 'Nothing missed — the answers are here anyway if you want to look back.') + '</p>'
      + marked.map(m => {
          const i = m.i;
          return '<div class="review-item">'
            + '<div class="review-head"><span class="mark ' + (m.correct ? 'ok' : 'no') + '">'
            + (m.correct ? '✓' : '✗') + '</span><span>Question ' + m.q.n + '</span>'
            + '<span>· ' + m.q.cat + '</span></div>'
            + '<div class="review-q' + (isExpr(m.q) ? ' mono' : '') + '">' + m.q.q + '</div>'
            + '<div class="review-answers">You: <span class="yours ' + (m.correct ? '' : 'no') + '">'
            + givenText(i) + '</span>'
            + (m.correct ? '' : '<br>Correct: <span class="right">' + correctText(i) + '</span>') + '</div>'
            + (m.correct ? '' : '<div class="why"><b>Why</b>' + m.q.why + '</div>')
            + (m.correct || !m.q.remember ? ''
                : '<div class="remember"><b>Easy way to get it</b>' + m.q.remember + '</div>')
            + '</div>';
        }).join('');

    el('results').classList.add('show');
    el('reviewBox').style.display = missedCount ? 'block' : 'none';
    el('reviewToggle').textContent = missedCount ? 'Hide all answers' : 'Show all answers';
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  el('reviewToggle').addEventListener('click', () => {
    const box = el('reviewBox');
    const open = box.style.display !== 'none';
    box.style.display = open ? 'none' : 'block';
    el('reviewToggle').textContent = open ? 'Show all answers' : 'Hide all answers';
  });

  el('retryBtn').addEventListener('click', () => start(test, form));

  el('homeBtn').addEventListener('click', () => {
    const home = el('home');
    if(!home) return;
    el('results').classList.remove('show');
    el('testArea').classList.remove('show');
    home.classList.remove('hide');
    renderHome();
    window.scrollTo({ top:0, behavior:'smooth' });
  });

  // A page holding one test skips the test picker; if that test has forms, go straight to them.
  if(TESTS.length === 1 && !TESTS[0].forms){
    el('home').remove();
    el('homeBtn').classList.add('hide');
    start(TESTS[0], null);
  } else if(TESTS.length === 1){
    openTest = TESTS[0].id;
    el('testCards').style.display = 'none';
    el('homeTitle').textContent = 'Choose a form';
    el('homeLede').textContent = 'Form B has different numbers than the study guide, so it tests the skill rather than your memory of the sheet.';
    el('homeBtn').textContent = 'Choose another form';
    renderHome();
  } else {
    renderHome();
  }
})();
