/* Coordinate-grid renderer, shared by any topic that plots points. */

function gridSVG(o){
  const pts = o.pts || [];
  let m = 5;
  const feed = pts.map(p=>[p[0],p[1]]).concat(o.path||[], o.poly||[]);
  feed.forEach(p=>{ m = Math.max(m, Math.abs(p[0]), Math.abs(p[1])); });
  m = Math.ceil(m)+1;
  const step = m>9 ? 5 : (m>6 ? 2 : 1);
  const W = 280, c = W/(2*m), X = x=>W/2 + x*c, Y = y=>W/2 - y*c;
  let s = "";
  for(let i=-m;i<=m;i++){
    s += `<line class="gl" x1="${X(i)}" y1="0" x2="${X(i)}" y2="${W}"/>`;
    s += `<line class="gl" x1="0" y1="${Y(i)}" x2="${W}" y2="${Y(i)}"/>`;
  }
  s += `<line class="ax" x1="0" y1="${W/2}" x2="${W}" y2="${W/2}"/>`;
  s += `<line class="ax" x1="${W/2}" y1="0" x2="${W/2}" y2="${W}"/>`;
  let ticks = ""; // built here, appended last so the label halo masks any line beneath it
  for(let i=step;i<=m;i+=step){
    [i,-i].forEach(v=>{
      const lb = String(v).replace("-","−"); // proper minus sign, matching the question text
      ticks += `<text class="tick" x="${X(v)}" y="${W/2+13}" text-anchor="middle">${lb}</text>`;
      ticks += `<text class="tick" x="${W/2-5}" y="${Y(v)+3.5}" text-anchor="end">${lb}</text>`;
    });
  }
  if(o.poly){ s += `<polygon class="poly" points="${o.poly.map(p=>X(p[0])+","+Y(p[1])).join(" ")}"/>`; }
  if(o.path){ s += `<polyline class="seg" points="${o.path.map(p=>X(p[0])+","+Y(p[1])).join(" ")}"/>`; }
  s += ticks; // after the segments, before the points
  pts.forEach(p=>{
    const [x,y,lb,cls] = p;
    s += `<circle class="${cls||"pt"}" cx="${X(x)}" cy="${Y(y)}" r="4.6"/>`;
    if(lb){
      const left = X(x) > W-64;
      s += `<text class="plb" x="${X(x)+(left?-9:9)}" y="${Y(y)-7}" text-anchor="${left?"end":"start"}">${lb}</text>`;
    }
  });
  const p = 18; // padding so edge tick labels and point labels are never clipped
  return `<svg viewBox="${-p} ${-p} ${W+2*p} ${W+2*p}" role="img" aria-label="coordinate grid">${s}</svg>`;
}
