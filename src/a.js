// Concept A — single-row timeline with minimap/heatmap + brush selection
// Interaction policy:
// - Single valve row
// - Minimap with brush selection (resize handles + slide window + create new)
// - Vertical scroll untouched
// - Zoom: pinch (mobile), Zoom ± buttons / modifier+wheel (desktop)

(function(){
  // ---- Tokens ----
  function readTokens(){
    const s = getComputedStyle(document.documentElement);
    return {
      grid: s.getPropertyValue('--grid-line').trim() || '#e5e7eb',
      muted: s.getPropertyValue('--tone-muted').trim() || '#a1a1aa',
      verified: s.getPropertyValue('--color-verified').trim() || '#16a34a',
      unexpected: s.getPropertyValue('--color-unexpected').trim() || '#dc2626',
      manual: s.getPropertyValue('--color-manual').trim() || '#2563eb',
      bgAlt: s.getPropertyValue('--row-alt').trim() || '#fafafa',
      text: s.getPropertyValue('--text').trim() || '#0f172a',
      brush: 'rgba(59,130,246,0.15)',
      brushStroke: '#2563eb',
    };
  }
  let TOK = readTokens();

  // ---- Geometry ----
  const DAY = 24*60*60*1000;
  const GUTTER = 140;
  const ROW_H = 28;
  const TOP_PAD = 28;

  const clamp=(v,a,b)=>Math.min(Math.max(v,a),b);
  const scaleT=(t,t0,t1,x0,x1)=> x0 + ((t-t0)/(t1-t0))*(x1-x0);
  const invScaleX=(x,t0,t1,x0,x1)=> t0 + ((x-x0)/(x1-x0))*(t1-t0);

  function setCanvasSize(c, cssH){
    const dpr = window.devicePixelRatio || 1;
    if (typeof cssH === 'number') c.style.height = cssH + 'px';
    const rect = c.getBoundingClientRect();
    c.width  = Math.max(1, Math.round(rect.width*dpr));
    c.height = Math.max(1, Math.round(((cssH ?? rect.height))*dpr));
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return ctx;
  }

  // ---- Mock data ----
  const now = Date.now();
  const dataStart = now - 60*DAY;
  const dataEnd = now;
  const VALVE = { name:'Valve A' };
  const KINDS = ['verified','unexpected','manual'];

  function genEvents(){
    const evts=[], R=(a,b)=>a+Math.random()*(b-a);
    const spanDays=Math.round((dataEnd-dataStart)/DAY);
    for(let d=0; d<spanDays; d++){
      const base = dataStart + d*DAY;
      const count = Math.random()<0.7 ? 1 : 2;
      for(let i=0;i<count;i++){
        const s = base + R(2*60*60*1000, 22*60*60*1000);
        const dur = R(10,90)*60*1000;
        const kind = KINDS[Math.floor(R(0,KINDS.length))];
        evts.push({start:s, end:s+dur, kind});
      }
    }
    return evts.sort((a,b)=>a.start-b.start);
  }
  const EVENTS = genEvents();

  // ---- DOM & State ----
  const timeline = document.getElementById('timeline');
  const minimap  = document.getElementById('minimap');
  const rangeLabel = document.getElementById('rangeLabel');
  const presetBtns = Array.from(document.querySelectorAll('.controls .btn'));
  const toolBtns = Array.from(document.querySelectorAll('.controls .tool'));

  const presets = { '24h':1*DAY, '7d':7*DAY, '14d':14*DAY, '30d':30*DAY, '1y':365*DAY };
  let viewEnd = dataEnd;
  let viewStart = Math.max(dataStart, viewEnd - presets['14d']);

  // ---- Renderers ----
  function formatRange(a,b){
    const fmt = new Intl.DateTimeFormat(undefined,{month:'short',day:'2-digit'});
    const fmtTime = new Intl.DateTimeFormat(undefined,{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    return (b-a)<=DAY ? `${fmtTime.format(a)} – ${fmtTime.format(b)}` : `${fmt.format(a)} – ${fmt.format(b)}`;
  }

  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);
    ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);
    ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
  }

  function renderTimeline(){
    const totalH = TOP_PAD + ROW_H + 8;
    const ctx = setCanvasSize(timeline, totalH);
    const rect = timeline.getBoundingClientRect();
    ctx.clearRect(0,0,rect.width,rect.height);

    // grid (daily)
    ctx.strokeStyle = TOK.grid; ctx.lineWidth = 1;
    const startDay = new Date(viewStart); startDay.setHours(0,0,0,0);
    for(let t=+startDay; t<viewEnd+DAY; t+=DAY){
      const x = scaleT(t, viewStart, viewEnd, GUTTER, rect.width);
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,rect.height); ctx.stroke();
    }
    // day labels
    ctx.fillStyle = '#71717a'; ctx.font = '12px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    for(let t=+startDay; t<viewEnd+DAY; t+=DAY){
      const x = scaleT(t+DAY*0.02, viewStart, viewEnd, GUTTER, rect.width);
      const d = new Date(t); ctx.fillText(`${d.getMonth()+1}/${d.getDate()}`, x, 14);
    }

    // row background
    const y = TOP_PAD;
    ctx.fillStyle = TOK.bgAlt; ctx.fillRect(GUTTER, y-2, rect.width-GUTTER, ROW_H+4);

    // row label
    ctx.fillStyle = TOK.text; ctx.textBaseline='middle'; ctx.textAlign='left';
    ctx.fillText(VALVE.name, 8, y + ROW_H/2);

    // events
    const vis = EVENTS.filter(e=> e.end>=viewStart && e.start<=viewEnd);
    for(const e of vis){
      const x0 = scaleT(e.start, viewStart, viewEnd, GUTTER, rect.width);
      const x1 = scaleT(e.end,   viewStart, viewEnd, GUTTER, rect.width);
      const w = Math.max(2, x1-x0);
      ctx.fillStyle = TOK[e.kind] || TOK.manual;
      roundRect(ctx, x0, y, w, ROW_H, Math.min(4, ROW_H/2));
      ctx.fill();
    }

    if(rangeLabel) rangeLabel.textContent = formatRange(new Date(viewStart), new Date(viewEnd));
  }

  function renderMinimap(){
    const ctx = setCanvasSize(minimap);            // uses CSS height from #minimap
    const rect = minimap.getBoundingClientRect();
    ctx.clearRect(0,0,rect.width,rect.height);

    // density bars (cheap heatmap)
    const y=10, h=rect.height-20;
    for(const e of EVENTS){
      const x0 = scaleT(e.start, dataStart, dataEnd, 0, rect.width);
      const x1 = scaleT(e.end,   dataStart, dataEnd, 0, rect.width);
      ctx.fillStyle = '#a1a1aa'; ctx.globalAlpha = 0.7;
      ctx.fillRect(x0, y, Math.max(1, x1-x0), h);
    }
    ctx.globalAlpha=1;

    // current view brush
    const bx0 = scaleT(viewStart, dataStart, dataEnd, 0, rect.width);
    const bx1 = scaleT(viewEnd,   dataStart, dataEnd, 0, rect.width);
    ctx.fillStyle = TOK.brush; ctx.fillRect(bx0, 0, Math.max(2,bx1-bx0), rect.height);
    ctx.strokeStyle = TOK.brushStroke; ctx.lineWidth = 2;
    ctx.strokeRect(bx0+1, 1, Math.max(2,bx1-bx0)-2, rect.height-2);

    // resize handles with chevrons
    const handleW = 10;
    const drawHandle = (x, dir) => {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x - handleW/2, 4, handleW, rect.height-8);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = TOK.brushStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - handleW/2 + 0.5, 4.5, handleW-1, rect.height-9);

      ctx.translate(x, rect.height/2);
      ctx.beginPath();
      if (dir === 'left') { ctx.moveTo(-2, 0); ctx.lineTo(2, -5); ctx.lineTo(2, 5); }
      else { ctx.moveTo(2, 0); ctx.lineTo(-2, -5); ctx.lineTo(-2, 5); }
      ctx.closePath();
      ctx.fillStyle = TOK.brushStroke;
      ctx.fill();
      ctx.restore();
    };
    drawHandle(bx0, 'left'); drawHandle(bx1, 'right');
  }

  function render(){ renderTimeline(); renderMinimap(); }

  // ---- Presets ----
  presetBtns.forEach(b=>b.addEventListener('click',()=>{
    const span = presets[b.dataset.preset];
    presetBtns.forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
    viewEnd = dataEnd;
    viewStart = Math.max(dataStart, viewEnd - span);
    render();
  }));

  function clampView(ns, ne){
    const minSpan = 15*60*1000; // 15 minutes
    const maxSpan = dataEnd - dataStart;
    const span = clamp(ne - ns, minSpan, maxSpan);
    if (ns < dataStart) { ns = dataStart; ne = ns + span; }
    if (ne > dataEnd)   { ne = dataEnd;   ns = ne - span; }
    return [ns, ne];
  }

  function zoomFactor(f){
    const center=(viewStart+viewEnd)/2;
    const span=(viewEnd-viewStart)*f;
    let ns=center-span/2, ne=center+span/2;
    [viewStart, viewEnd] = clampView(ns, ne);
    render();
  }
  function shiftFrac(frac){
    const span=viewEnd-viewStart; const dt=span*frac;
    let ns=viewStart+dt, ne=viewEnd+dt;
    [viewStart, viewEnd] = clampView(ns, ne);
    render();
  }
  toolBtns.forEach(btn=>{
    if(btn.dataset.zoom){btn.addEventListener('click',()=>zoomFactor(btn.dataset.zoom==='in'?0.8:1.25));}
    else if(btn.dataset.shift){btn.addEventListener('click',()=>shiftFrac(parseFloat(btn.dataset.shift))); }
  });

  // ---- Wheel zoom (modifier or strong horizontal only) ----
  timeline.addEventListener('wheel', (ev)=>{
    const horizontalIntent = Math.abs(ev.deltaX) > Math.abs(ev.deltaY);
    const modifier = ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey;
    if(!(horizontalIntent || modifier)) return; // let vertical scroll pass
    ev.preventDefault();
    const rect = timeline.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const delta = Math.abs(ev.deltaY)>0 ? ev.deltaY : ev.deltaX;
    const zoom = Math.exp(-delta*0.0015);
    const centerT = invScaleX(mx, viewStart, viewEnd, GUTTER, rect.width);
    const span = clamp((viewEnd-viewStart)*zoom, 15*60*1000, dataEnd-dataStart);
    let ns = centerT - (mx/rect.width)*span;
    let ne = ns + span;
    [viewStart, viewEnd] = clampView(ns, ne);
    render();
  }, {passive:false});

  // ---- Drag to pan (mouse) ----
  let panning=false, panX=0, panRange=[viewStart,viewEnd];
  timeline.addEventListener('mousedown', (e)=>{ panning=true; panX=e.clientX; panRange=[viewStart,viewEnd]; });
  window.addEventListener('mousemove', (e)=>{
    if(!panning) return;
    const rect = timeline.getBoundingClientRect();
    const dx = e.clientX - panX;
    const dt = (panRange[1]-panRange[0])*(dx/rect.width);
    let ns = panRange[0]-dt, ne = panRange[1]-dt;
    [viewStart, viewEnd] = clampView(ns, ne);
    render();
  });
  window.addEventListener('mouseup', ()=>{ panning=false; });

  // ---- Minimap brush (handles + move + create) ----
  const EDGE = 8;        // px threshold near edges
  const MIN_W_PX = 10;   // minimum selection width in px
  let brushing=false, brushMode=null; // 'left'|'right'|'move'|'create'
  let brushStartX=0, brushEndX=0;     // for 'create'
  let downX=0, baseBx0=0, baseBx1=0;  // for move/resize baselines

  function getBrushPixels(rect){
    const bx0=scaleT(viewStart,dataStart,dataEnd,0,rect.width);
    const bx1=scaleT(viewEnd,dataStart,dataEnd,0,rect.width);
    return [bx0,bx1];
  }
  function commitFromPixels(rect,px0,px1){
    const bx0=clamp(px0,0,rect.width-MIN_W_PX);
    const bx1=clamp(px1,bx0+MIN_W_PX,rect.width);
    viewStart=invScaleX(bx0,dataStart,dataEnd,0,rect.width);
    viewEnd=invScaleX(bx1,dataStart,dataEnd,0,rect.width);
    render();
  }

  minimap.addEventListener('pointerdown', (e)=>{
    const rect = minimap.getBoundingClientRect();
    const [bx0,bx1] = getBrushPixels(rect);
    downX = e.clientX;
    brushMode = null;

    if (Math.abs(e.clientX - (rect.left + bx0)) <= EDGE) {
      brushMode = 'left';
    } else if (Math.abs(e.clientX - (rect.left + bx1)) <= EDGE) {
      brushMode = 'right';
    } else if (e.clientX >= rect.left + bx0 && e.clientX <= rect.left + bx1) {
      brushMode = 'move';
    } else {
      brushMode = 'create';
      brushStartX = e.clientX;
      brushEndX = e.clientX;
    }

    baseBx0 = bx0; baseBx1 = bx1;
    brushing = true; minimap.setPointerCapture(e.pointerId);
    if (brushMode === 'create') {
      commitFromPixels(rect, brushStartX - rect.left, brushEndX - rect.left);
    }
  });

  minimap.addEventListener('pointermove', (e)=>{
    const rect = minimap.getBoundingClientRect();
    if (!brushing) {
      // hover cursor feedback
      const [bx0, bx1] = getBrushPixels(rect);
      const x = e.clientX - rect.left;
      if (Math.abs(x - bx0) <= EDGE || Math.abs(x - bx1) <= EDGE) minimap.style.cursor = 'ew-resize';
      else if (x > bx0 && x < bx1) minimap.style.cursor = 'grab';
      else minimap.style.cursor = 'crosshair';
      return;
    }

    if (brushMode === 'left') {
      const nx0 = clamp(e.clientX - rect.left, 0, baseBx1 - MIN_W_PX);
      commitFromPixels(rect, nx0, baseBx1);
    } else if (brushMode === 'right') {
      const nx1 = clamp(e.clientX - rect.left, baseBx0 + MIN_W_PX, rect.width);
      commitFromPixels(rect, baseBx0, nx1);
    } else if (brushMode === 'move') {
      const dx = e.clientX - downX;
      let nx0 = baseBx0 + dx;
      let nx1 = baseBx1 + dx;
      if (nx0 < 0) { nx1 -= nx0; nx0 = 0; }
      if (nx1 > rect.width) { const over = nx1 - rect.width; nx0 -= over; nx1 = rect.width; }
      commitFromPixels(rect, nx0, nx1);
    } else if (brushMode === 'create') {
      brushEndX = e.clientX;
      commitFromPixels(rect,
        Math.min(brushStartX, brushEndX) - rect.left,
        Math.max(brushStartX, brushEndX) - rect.left
      );
    }
  });

  const endBrush = (e)=>{
    brushing=false; brushMode=null;
    minimap.releasePointerCapture?.(e.pointerId);
    minimap.style.cursor = '';
  };
  minimap.addEventListener('pointerup', endBrush);
  minimap.addEventListener('pointercancel', endBrush);
  minimap.addEventListener('pointerleave', (e)=>{ if(!brushing) minimap.style.cursor=''; else endBrush(e); });

  // ---- Pinch zoom (two-finger) ----
  let touches=new Map(), pinchBase=null;
  timeline.addEventListener('pointerdown', (e)=>{
    if(e.pointerType==='mouse') return;
    timeline.setPointerCapture(e.pointerId);
    touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touches.size===2){
      const pts=Array.from(touches.values());
      const rect=timeline.getBoundingClientRect();
      const midX=(pts[1].x+pts[0].x)/2-rect.left;
      const dx=pts[1].x-pts[0].x;
      pinchBase={ span:viewEnd-viewStart, dist:Math.abs(dx), midX };
    }
  });
  timeline.addEventListener('pointermove', (e)=>{
    if(!touches.has(e.pointerId)) return;
    touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(e.pointerType==='mouse') return;
    if(touches.size===2 && pinchBase){
      e.preventDefault();
      const rect=timeline.getBoundingClientRect();
      const pts=Array.from(touches.values());
      const dist=Math.abs(pts[1].x-pts[0].x);
      const zoom=clamp(dist/(pinchBase.dist||1),0.2,5);
      const span=clamp(pinchBase.span/zoom, 15*60*1000, dataEnd-dataStart);
      const centerT = invScaleX(pinchBase.midX, viewStart, viewEnd, GUTTER, rect.width);
      let ns=centerT-0.5*span, ne=ns+span;
      [viewStart, viewEnd] = clampView(ns, ne);
      render();
    }
  }, {passive:false});
  const endTouch=(e)=>{
    if(touches.has(e.pointerId)) touches.delete(e.pointerId);
    if(touches.size<2) pinchBase=null;
  };
  timeline.addEventListener('pointerup', endTouch);
  timeline.addEventListener('pointercancel', endTouch);
  timeline.addEventListener('pointerleave', endTouch);

  // ---- Resize/theme awareness ----
  window.addEventListener('resize', ()=>{ TOK = readTokens(); render(); });

  // ---- First paint ----
  render();
})();
