// Jarvis AR "dvigateli": kamera, qo'l ishoralari, chizish, obyektga bog'lash.
// React faqat interfeys (menyu, HUD) uchun; og'ir ish shu yerda, canvas ustida bajariladi.
// Kutubxonalar (Hands, cocoSsd, tf) index.html'dagi CDN skriptlardan global holda olinadi.

const SHAPES = ['line', 'arrow', 'rect', 'circle', 'triangle', 'star'];
const NAMES = { pencil: 'Qalam', line: 'Chiziq', arrow: 'Strelka', rect: "To'rtburchak", circle: 'Doira', triangle: 'Uchburchak', star: 'Yulduz', eraser: "O'chirg'ich" };
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createEngine({ canvas: cv, video, cursor, onUI }) {
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = innerWidth, H = innerHeight;
  let alive = true, rafId = 0, stream = null, started = false, modelsStarted = false;

  const state = {
    tool: 'pencil', color: '#00e5ff', size: 8, sticker: null, menu: null,
    items: [], drawing: null, hands: [], ptr: null, anchorPerson: false, gProg: 0,
    status: 'Tayyor emas', toast: '', nh: 0, no: 0, fps: 0,
  };
  const mouse = { x: 0, y: 0, down: false, active: false };
  const tracks = [];
  let nextId = 1;

  /* ---------- React'ga holat yuborish ---------- */
  function emit() {
    onUI({
      menu: state.menu, tool: state.tool, color: state.color, size: state.size, sticker: state.sticker,
      toolLabel: state.tool === 'sticker' ? 'Stiker ' + (state.sticker || '') : NAMES[state.tool],
      anchorPerson: state.anchorPerson, status: state.status, toast: state.toast,
      nh: state.nh, no: state.no, fps: state.fps, gProg: state.gProg,
    });
  }
  const setSt = (t) => { state.status = t; emit(); };
  let toastT;
  function toast(t) {
    state.toast = t; emit();
    clearTimeout(toastT);
    toastT = setTimeout(() => { state.toast = ''; emit(); }, 1800);
  }

  /* ---------- ekran va koordinatalar ---------- */
  function resize() {
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  let vw = 1280, vh = 720, sc = 1, ox = 0, oy = 0;
  function layout() {
    vw = video.videoWidth || 1280; vh = video.videoHeight || 720;
    sc = Math.max(W / vw, H / vh); ox = (W - vw * sc) / 2; oy = (H - vh * sc) / 2;
  }
  const toScreen = (nx, ny) => ({ x: W - (ox + nx * vw * sc), y: oy + ny * vh * sc }); // ko'zgu
  const mapBox = ([x, y, w, h]) => ({ x: W - (ox + (x + w) * sc), y: oy + y * sc, w: w * sc, h: h * sc });

  /* ---------- menyu va amallar ---------- */
  function openMenu(n) { state.menu = n; state.drawing = null; emit(); }
  function closeMenu() { openMenu(null); }
  function removeItem(it) {
    const i = state.items.indexOf(it);
    if (i >= 0) state.items.splice(i, 1);
    if (it.anchor) it.anchor.track.items = Math.max(0, it.anchor.track.items - 1);
  }
  const actions = {
    pickTool(t) { state.tool = t; state.sticker = null; closeMenu(); },
    pickColor(c) { state.color = c; if (state.tool === 'eraser' || state.tool === 'sticker') state.tool = 'pencil'; emit(); },
    pickSize(s) { state.size = s; emit(); },
    pickSticker(e) { state.tool = 'sticker'; state.sticker = e; closeMenu(); },
    openMenu, closeMenu,
    undo() { const it = state.items[state.items.length - 1]; if (it) removeItem(it); emit(); },
    clear() { state.items.length = 0; tracks.forEach((t) => (t.items = 0)); closeMenu(); },
    togglePerson() { state.anchorPerson = !state.anchorPerson; emit(); },
  };

  /* ---------- kirish hodisalari ---------- */
  const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; };
  const onDown = (e) => {
    if (state.menu) { closeMenu(); return; }
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = true; mouse.active = true;
  };
  const onUp = () => { mouse.down = false; };
  const onKey = (e) => {
    if (e.key === 'Escape') closeMenu();
    if (e.key === 'd') openMenu('draw');
    if (e.key === 's') openMenu('sticker');
    if (e.key === 'z') actions.undo();
    if (e.key === 'c') { state.items.length = 0; tracks.forEach((t) => (t.items = 0)); emit(); }
  };
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerdown', onDown);
  addEventListener('pointerup', onUp);
  addEventListener('keydown', onKey);
  addEventListener('resize', resize);

  /* ---------- qo'l tahlili ---------- */
  let rawHands = [], handsT = 0;
  const slots = [];
  function analyze(lms) {
    const out = [];
    lms.forEach((lm, i) => {
      const P = lm.map((l) => toScreen(l.x, l.y));
      const size = dist(P[0], P[9]) || 1;
      const ext = (t, p) => dist(P[t], P[0]) > dist(P[p], P[0]) * 1.1;
      const f = [ext(8, 6), ext(12, 10), ext(16, 14), ext(20, 18)];
      const cnt = f.filter(Boolean).length;
      const pd = dist(P[4], P[8]) / size;
      const s = slots[i] || (slots[i] = { px: P[8].x, py: P[8].y, pinch: false });
      s.pinch = s.pinch ? pd < 0.5 : pd < 0.32;
      s.px += (P[8].x - s.px) * 0.55; s.py += (P[8].y - s.py) * 0.55;
      out.push({
        P, size, cnt, pinch: s.pinch, open: cnt === 4 && pd > 0.55, fist: cnt === 0 && pd > 0.45,
        point: f[0] && !f[1] && !f[2], px: s.px, py: s.py, cx: P[9].x, cy: P[9].y,
      });
    });
    slots.length = lms.length;
    return out;
  }

  /* ---------- ishoralar: menyu ochish/yopish ---------- */
  let hold1 = 0, hold2 = 0, idleT = 0, armed = true, fistT = 0;
  function updateGestures(dt) {
    const Hs = state.hands;
    const raised = Hs.filter((h) => h.open && h.cy < H * 0.62);
    if (raised.length === 0) { idleT += dt; if (idleT > 0.4) armed = true; hold1 = hold2 = 0; } else idleT = 0;
    if (armed && !state.menu && !state.drawing) {
      if (raised.length >= 2) { hold2 += dt; hold1 = 0; if (hold2 > 0.6) { openMenu('sticker'); armed = false; hold2 = 0; } }
      else if (raised.length === 1) { hold1 += dt; hold2 = 0; if (hold1 > 0.8) { openMenu('draw'); armed = false; hold1 = 0; } }
      else hold1 = hold2 = 0;
    } else if (state.menu) { hold1 = hold2 = 0; }
    state.gProg = Math.max(hold1 / 0.8, hold2 / 0.6, state.menu ? fistT / 0.6 : 0);
    if (state.menu) {
      fistT = Hs.some((h) => h.fist) ? fistT + dt : 0;
      if (fistT > 0.6) { closeMenu(); fistT = 0; armed = false; }
    } else fistT = 0;
  }

  /* ---------- ko'rsatkich (qo'l yoki sichqoncha) ---------- */
  function pickPointer() {
    const Hs = state.hands;
    if (Hs.length) {
      const h = Hs.find((x) => x.pinch) || Hs.find((x) => x.point) || Hs[0];
      return { x: h.px, y: h.py, down: h.pinch, src: 'hand' };
    }
    if (mouse.active) return { x: mouse.x, y: mouse.y, down: mouse.down, src: 'mouse' };
    return null;
  }
  let lastDown = false, dwellEl = null, dwellT = 0, clickedEl = null;
  function handlePointer(dt) {
    const p = pickPointer(); state.ptr = p;
    const down = !!(p && p.down), edgeDown = down && !lastDown, edgeUp = !down && lastDown;
    lastDown = down;
    document.querySelectorAll('.btn.hot').forEach((b) => b.classList.remove('hot'));
    if (p && p.src === 'hand') {
      cursor.style.display = 'block';
      cursor.style.transform = `translate(${p.x}px,${p.y}px)`;
      cursor.classList.toggle('down', down);
    } else cursor.style.display = 'none';

    if (state.menu) {
      let prog = 0;
      if (p && p.src === 'hand') {
        const el = document.elementFromPoint(p.x, p.y);
        const b = el && el.closest('.menu .btn');
        if (b) {
          b.classList.add('hot');
          if (b === dwellEl) dwellT += dt; else { dwellEl = b; dwellT = 0; }
          prog = Math.min(1, dwellT / 0.8);
          if (b !== clickedEl && (dwellT > 0.8 || edgeDown)) { clickedEl = b; dwellT = 0; b.click(); prog = 0; }
        } else { dwellEl = null; dwellT = 0; clickedEl = null; }
      }
      cursor.style.setProperty('--p', prog);
      return;
    }
    dwellEl = null; clickedEl = null; cursor.style.setProperty('--p', 0);
    const d = state.drawing;
    if (p && edgeDown && !d) startDraw(p);
    else if (down && d) updateDraw(p);
    else if (edgeUp && d) endDraw();
    else if (!down && d) endDraw();
  }

  /* ---------- chizish ---------- */
  function startDraw(p) {
    const t = state.tool, pt = { x: p.x, y: p.y };
    if (t === 'pencil') state.drawing = { type: 'stroke', color: state.color, size: state.size, pts: [pt] };
    else if (t === 'eraser') state.drawing = { type: 'erase' };
    else if (t === 'sticker' && state.sticker) state.drawing = { type: 'sticker', emoji: state.sticker, size: 76, p: pt, rot: (Math.random() - 0.5) * 0.35 };
    else if (SHAPES.includes(t)) state.drawing = { type: 'shape', kind: t, color: state.color, size: state.size, a: pt, b: { ...pt } };
    if (t === 'eraser') updateDraw(p);
  }
  function updateDraw(p) {
    const d = state.drawing; if (!d || !p) return;
    if (d.type === 'stroke') { const l = d.pts[d.pts.length - 1]; if (dist(l, p) > 3) d.pts.push({ x: p.x, y: p.y }); }
    else if (d.type === 'shape') d.b = { x: p.x, y: p.y };
    else if (d.type === 'sticker') d.p = { x: p.x, y: p.y };
    else if (d.type === 'erase') { for (let i = state.items.length - 1; i >= 0; i--) if (hit(state.items[i], p)) removeItem(state.items[i]); }
  }
  function endDraw() {
    const d = state.drawing; state.drawing = null;
    if (!d || d.type === 'erase') return;
    if (d.type === 'stroke' && d.pts.length < 2) return;
    if (d.type === 'shape' && dist(d.a, d.b) < 12) return;
    anchorFor(d); state.items.push(d);
  }
  function hit(it, p) {
    const { m } = mapper(it);
    if (it.type === 'stroke') return it.pts.some((q) => dist(m(q), p) < it.size + 26);
    if (it.type === 'sticker') return dist(m(it.p), p) < it.size * 0.7 + 10;
    const a = m(it.a), b = m(it.b);
    if (it.kind === 'circle' || it.kind === 'star') return dist(a, p) < dist(a, b) + 24;
    return p.x > Math.min(a.x, b.x) - 24 && p.x < Math.max(a.x, b.x) + 24 && p.y > Math.min(a.y, b.y) - 24 && p.y < Math.max(a.y, b.y) + 24;
  }

  /* ---------- obyektga bog'lash ---------- */
  function anchorFor(it) {
    const ref = it.type === 'stroke' ? it.pts[Math.floor(it.pts.length / 2)]
      : it.type === 'sticker' ? it.p : { x: (it.a.x + it.b.x) / 2, y: (it.a.y + it.b.y) / 2 };
    let best = null, ba = 1e12;
    for (const t of tracks) {
      if (t.lost) continue;
      if (t.cls === 'person' && !state.anchorPerson) continue;
      const c = t.cur;
      if (ref.x >= c.x && ref.x <= c.x + c.w && ref.y >= c.y && ref.y <= c.y + c.h) {
        const a = c.w * c.h; if (a < ba) { ba = a; best = t; }
      }
    }
    if (best) { it.anchor = { track: best, box0: { ...best.cur } }; best.items++; toast('🔗 "' + best.cls + "\" obyektiga bog'landi"); }
  }
  function mapper(it) {
    const a = it.anchor; if (!a) return { m: (p) => p, s: 1 };
    const c = a.track.cur, b = a.box0;
    const fx = c.w / b.w, fy = c.h / b.h;
    const s = Math.min(3, Math.max(0.3, (fx + fy) / 2));
    return { m: (p) => ({ x: c.x + (p.x - b.x) * fx, y: c.y + (p.y - b.y) * fy }), s };
  }
  function updateTracks(preds) {
    const now = performance.now();
    const dets = preds.filter((p) => p.score > 0.45).map((p) => ({ cls: p.class, ...mapBox(p.bbox) }));
    const used = new Set();
    const cx = (b) => b.x + b.w / 2, cy = (b) => b.y + b.h / 2;
    for (const t of tracks.slice().sort((a, b) => b.items - a.items)) {
      let best = -1, bd = 1e9;
      const size = Math.max(t.target.w, t.target.h);
      const lim = t.lost ? size * 3 : size * 0.9;
      dets.forEach((d, i) => {
        if (used.has(i) || d.cls !== t.cls) return;
        const dd = Math.hypot(cx(d) - cx(t.target), cy(d) - cy(t.target));
        if (dd < bd && dd < lim) { bd = dd; best = i; }
      });
      if (best >= 0) { used.add(best); const d = dets[best]; t.target = { x: d.x, y: d.y, w: d.w, h: d.h }; t.lost = false; t.seen = now; }
      else if (now - t.seen > 500) t.lost = true;
    }
    dets.forEach((d, i) => {
      if (!used.has(i)) {
        const b = { x: d.x, y: d.y, w: d.w, h: d.h };
        tracks.push({ id: nextId++, cls: d.cls, target: { ...b }, cur: { ...b }, seen: now, lost: false, items: 0 });
      }
    });
    for (let i = tracks.length - 1; i >= 0; i--) { const t = tracks[i]; if (t.items === 0 && now - t.seen > 1500) tracks.splice(i, 1); }
  }

  /* ---------- chizish funksiyalari ---------- */
  function pathShape(kind, a, b) {
    ctx.beginPath();
    if (kind === 'line') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    else if (kind === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x), hl = Math.max(14, Math.min(40, dist(a, b) * 0.25));
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - hl * Math.cos(ang - 0.45), b.y - hl * Math.sin(ang - 0.45));
      ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - hl * Math.cos(ang + 0.45), b.y - hl * Math.sin(ang + 0.45));
    }
    else if (kind === 'rect') ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    else if (kind === 'circle') ctx.arc(a.x, a.y, dist(a, b), 0, Math.PI * 2);
    else if (kind === 'triangle') {
      const mx = (a.x + b.x) / 2;
      ctx.moveTo(mx, Math.min(a.y, b.y)); ctx.lineTo(Math.max(a.x, b.x), Math.max(a.y, b.y)); ctx.lineTo(Math.min(a.x, b.x), Math.max(a.y, b.y)); ctx.closePath();
    }
    else if (kind === 'star') {
      const r = dist(a, b);
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? r * 0.45 : r, an = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = a.x + rr * Math.cos(an), y = a.y + rr * Math.sin(an);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
  }
  function strokePath(P) {
    ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y);
    if (P.length < 3) { P.forEach((p) => ctx.lineTo(p.x + 0.01, p.y)); }
    else {
      for (let i = 1; i < P.length - 1; i++) {
        const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2;
        ctx.quadraticCurveTo(P[i].x, P[i].y, mx, my);
      }
      ctx.lineTo(P[P.length - 1].x, P[P.length - 1].y);
    }
    ctx.stroke();
  }
  function drawItem(it) {
    const { m, s } = mapper(it);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (it.type === 'sticker') {
      const p = m(it.p); ctx.translate(p.x, p.y); ctx.rotate(it.rot || 0);
      ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
      ctx.font = `${it.size * s}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.emoji, 0, 0);
    } else {
      ctx.strokeStyle = it.color; ctx.lineWidth = it.size * s; ctx.shadowColor = it.color; ctx.shadowBlur = 12;
      if (it.type === 'stroke') strokePath(it.pts.map(m));
      else { pathShape(it.kind, m(it.a), m(it.b)); ctx.stroke(); }
    }
    ctx.restore();
  }
  function corners(x, y, w, h, l) {
    ctx.beginPath();
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([px, py, sx, sy]) => {
      ctx.moveTo(px + sx * l, py); ctx.lineTo(px, py); ctx.lineTo(px, py + sy * l);
    });
    ctx.stroke();
  }
  function drawTracks() {
    ctx.save(); ctx.font = '12px ui-monospace,Consolas,monospace';
    for (const t of tracks) {
      if (t.cls === 'person' && !state.anchorPerson) continue;
      if (t.lost && t.items === 0) continue;
      const c = t.cur, on = t.items > 0;
      ctx.strokeStyle = t.lost ? 'rgba(255,170,60,.9)' : on ? '#00ff9d' : 'rgba(0,229,255,.55)';
      ctx.lineWidth = on ? 2.5 : 1.5; ctx.setLineDash(t.lost ? [6, 6] : []);
      corners(c.x, c.y, c.w, c.h, Math.max(6, Math.min(26, c.w / 4, c.h / 4)));
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(t.cls.toUpperCase() + (on ? '  ⛓ ' + t.items : '') + (t.lost ? "  (yo'qoldi)" : ''), c.x + 2, Math.max(14, c.y - 6));
    }
    ctx.restore();
  }
  function drawHands() {
    ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,229,255,.55)'; ctx.fillStyle = 'rgba(0,229,255,.9)';
    for (const h of state.hands) {
      ctx.beginPath(); CONN.forEach(([a, b]) => { ctx.moveTo(h.P[a].x, h.P[a].y); ctx.lineTo(h.P[b].x, h.P[b].y); }); ctx.stroke();
      h.P.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); });
    }
    ctx.restore();
  }
  function drawPreview() {
    const d = state.drawing, p = state.ptr;
    if (d && d.type !== 'erase') drawItem(d);
    if (!p || state.menu) return;
    ctx.save();
    if ((d && d.type === 'erase') || (!d && state.tool === 'eraser')) {
      ctx.strokeStyle = '#fff'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, 7); ctx.stroke();
    } else if (!d && state.tool === 'sticker' && state.sticker) {
      ctx.globalAlpha = 0.45; ctx.font = `76px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(state.sticker, p.x, p.y);
    } else if (!d) {
      ctx.fillStyle = state.color; ctx.shadowColor = state.color; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, state.size / 2), 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- asosiy sikl ---------- */
  let last = performance.now(), fps = 0, lastEmit = 0;
  function render(now) {
    if (!alive) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    fps += (1 / Math.max(dt, 0.001) - fps) * 0.1;
    layout();
    state.hands = analyze(now - handsT < 300 ? rawHands : []);
    updateGestures(dt); handlePointer(dt);

    ctx.clearRect(0, 0, W, H);
    if (video.readyState >= 2) {
      ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
      ctx.drawImage(video, ox, oy, vw * sc, vh * sc); ctx.restore();
    } else { ctx.fillStyle = '#02070b'; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = 'rgba(0,25,35,.16)'; ctx.fillRect(0, 0, W, H);

    for (const t of tracks) {
      const k = 0.3;
      t.cur.x += (t.target.x - t.cur.x) * k; t.cur.y += (t.target.y - t.cur.y) * k;
      t.cur.w += (t.target.w - t.cur.w) * k; t.cur.h += (t.target.h - t.cur.h) * k;
    }
    drawTracks();
    for (const it of state.items) drawItem(it);
    drawPreview();
    drawHands();

    if (now - lastEmit > 100) {
      lastEmit = now;
      state.nh = state.hands.length;
      state.no = tracks.filter((t) => !t.lost && (t.cls !== 'person' || state.anchorPerson)).length;
      state.fps = Math.round(fps);
      emit();
    }
    rafId = requestAnimationFrame(render);
  }

  /* ---------- modellar ---------- */
  let hands = null, busy = false, detReady = false, handReady = false;
  function statusNow() {
    setSt((handReady ? "✋ qo'l: tayyor" : "✋ qo'l: yuklanmoqda…") + ' · ' + (detReady ? '🎯 obyekt: tayyor' : '🎯 obyekt: yuklanmoqda…'));
  }
  async function initHands() {
    if (!window.Hands) { setSt('Hands kutubxonasi yuklanmadi (internetni tekshiring)'); return; }
    hands = new window.Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${f}` });
    hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    hands.onResults((r) => { rawHands = r.multiHandLandmarks || []; handsT = performance.now(); });
    try { await hands.initialize(); } catch (e) { console.error(e); setSt("Qo'l modeli yuklanmadi"); return; }
    handReady = true; statusNow();
    (async function loop() {
      if (!alive) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        try { await hands.send({ image: video }); } catch (e) { console.error(e); }
        busy = false;
      }
      requestAnimationFrame(loop);
    })();
  }
  async function initDetector() {
    if (!window.cocoSsd) { toast("Obyekt modeli yuklanmadi (internet?). Bog'lash ishlamaydi."); return; }
    let model;
    try { model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' }); }
    catch (e) { console.error(e); toast('Obyekt modeli yuklanmadi'); return; }
    detReady = true; statusNow();
    (async function loop() {
      if (!alive) return;
      try { if (video.readyState >= 2) { const p = await model.detect(video, 12, 0.45); updateTracks(p); } }
      catch (e) { console.error(e); }
      setTimeout(loop, 100);
    })();
  }

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setSt('Kamera ochilmadi: Kamera uchun sahifani http://localhost:5173 yoki https orqali oching (hozir: ' + location.origin + ')');
      return false;
    }
    setSt('Kamera ulanmoqda…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream;
      await video.play();
    } catch (e) { setSt('Kamera ochilmadi: ' + e.message); return false; }
    if (!started) { started = true; rafId = requestAnimationFrame(render); }
    statusNow();
    if (!modelsStarted) { modelsStarted = true; initHands(); initDetector(); }
    return true;
  }

  function destroy() {
    alive = false;
    cancelAnimationFrame(rafId);
    clearTimeout(toastT);
    cv.removeEventListener('pointermove', onMove);
    cv.removeEventListener('pointerdown', onDown);
    removeEventListener('pointerup', onUp);
    removeEventListener('keydown', onKey);
    removeEventListener('resize', resize);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    try { hands && hands.close && hands.close(); } catch (e) { /* e'tiborsiz */ }
  }

  emit();
  return { start, destroy, ...actions };
}
