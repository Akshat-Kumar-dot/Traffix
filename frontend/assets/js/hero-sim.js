"use strict";
/* ════════════════════════════════════════════════════════════
   TRAFFIX — hero-sim.js · the living intersection
   The same traffic is controlled alternately by a dumb fixed-time
   program and by the RL policy. Queues pile up under fixed control
   and drain when RL takes over; each RL decision is flashed next
   to the junction.

   Performance: expensive effects (canvas shadows, headlight
   gradients, 2× pixel ratio) are keyed on TFX_LOW_POWER — the
   actual device — not the viewport width, so a phone showing the
   desktop layout still gets the cheap paths.
   ════════════════════════════════════════════════════════════ */
(function hero() {
  const cv = document.getElementById('sim');
  const hud = document.getElementById('sim-hud');
  if (!cv) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cv.remove(); if (hud) hud.remove(); return;
  }
  const LOWPOW = window.TFX_LOW_POWER === true;
  const ctx = cv.getContext('2d');
  let DPR = Math.min(devicePixelRatio || 1, 2);
  let W = 0, H = 0, CX = 0, CY = 0;
  let GLOWS = true;         // canvas shadows are too slow on phone GPUs
  let ROAD = 72;            // half road width (both lanes) — the junction is the hero
  let LANE = ROAD / 2;      // lane centre offset from road axis
  let STOP = ROAD + 16;     // stop-line distance from centre

  const DIRS = [
    { axis: 'ew', dx: 1, dy: 0, off: LANE, rate: 4.4 },  // eastbound
    { axis: 'ew', dx: -1, dy: 0, off: -LANE, rate: 4.9 },  // westbound
    { axis: 'ns', dx: 0, dy: 1, off: -LANE, rate: 8.4 },  // southbound
    { axis: 'ns', dx: 0, dy: -1, off: LANE, rate: 9.2 },  // northbound
  ];

  function resize() {
    W = cv.clientWidth; H = cv.clientHeight;
    // low-power devices: fewer device pixels and no canvas shadow
    // effects — both are the difference between 60fps and a slideshow.
    // Keyed on the device, not the width, so "desktop site" on a phone
    // still takes the cheap path.
    GLOWS = W >= 700 && !LOWPOW;
    DPR = Math.min(devicePixelRatio || 1, GLOWS ? 2 : 1.5);
    cv.width = W * DPR; cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    ROAD = W < 700 ? 48 : 72; // less thick on mobile
    LANE = ROAD / 2;
    STOP = ROAD + 16;

    // Update the offsets in DIRS dynamically
    DIRS[0].off = LANE;
    DIRS[1].off = -LANE;
    DIRS[2].off = -LANE;
    DIRS[3].off = LANE;

    // desktop: junction owns the right-centre; mobile: the road hugs the
    // right edge so cars flow BESIDE the text, junction in the lower half
    CX = W * (W < 700 ? .68 : .66);
    CY = H * (W < 700 ? .38 : .48);   // lower junction on desktop view, higher on mobile
    const cssCY = H * (W < 700 ? .32 : .38); // keep headline layout unchanged
    document.documentElement.style.setProperty('--cy', cssCY + 'px');
    document.documentElement.style.setProperty('--road-half', ROAD + 'px');
    measureHeadline();
  }
  /* cars fade out behind the headline — measured from the real text,
     not hard-coded pixels, so it tracks any viewport / font size */
  let h1Rect = null;
  function measureHeadline() {
    const el = document.querySelector('.hero-content h1');
    if (!el) { h1Rect = null; return; }
    const r = el.getBoundingClientRect();
    // the text block reaches down to the CTA row on phones
    let bottom = r.bottom;
    const cta = document.querySelector('.hero-cta');
    if (cta) bottom = Math.max(bottom, cta.getBoundingClientRect().bottom);
    h1Rect = { right: r.right, bottom: bottom + scrollY };
  }
  resize();
  // debounced resize that ignores the phone URL bar: scrolling fires
  // resize events with only a small height change, and a real resize()
  // clears the canvas + re-measures everything
  let lastW = W, lastH = H, rsT;
  addEventListener('resize', () => {
    clearTimeout(rsT);
    rsT = setTimeout(() => {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (w === lastW && Math.abs(h - lastH) < 140) return;
      lastW = w; lastH = h; resize();
    }, 150);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureHeadline);
  addEventListener('load', measureHeadline);
  function spawnDist(d) { return -(d.dx !== 0 ? (d.dx > 0 ? CX : W - CX) : (d.dy > 0 ? CY : H - CY)) - 40; }
  function endDist(d) { return (d.dx !== 0 ? (d.dx > 0 ? W - CX : CX) : (d.dy > 0 ? H - CY : CY)) + 40; }
  function pos(d, s) { return [CX + d.dx * s + (d.dy !== 0 ? d.off : 0), CY + d.dy * s + (d.dx !== 0 ? d.off : 0)]; }
  function carPos(c, d) {
    const sign = d.off > 0 ? 1 : -1;
    const off = sign * (ROAD * 0.25 + ROAD * 0.5 * (c.laneIdx !== undefined ? c.laneIdx : 0));
    return [
      CX + d.dx * c.s + (d.dy !== 0 ? off : 0),
      CY + d.dy * c.s + (d.dx !== 0 ? off : 0)
    ];
  }

  const lanes = DIRS.map(d => ({ d, cars: [], cool: Math.random() * 2 }));
  const VMAX = 52, ACC = 34, BRK = 90, GAP = 17, CAR_L = 13;
  /* four silhouettes a reviewer can tell apart from above */
  const TYPES = [
    { type: 'car', len: 16, wid: 7.5, p: .49 },
    { type: 'suv', len: 19, wid: 8.5, p: .72 },
    { type: 'truck', len: 27, wid: 9, p: .85 },
    { type: 'van', len: 23, wid: 8.5, p: .94 },
    { type: 'police', len: 17, wid: 7.5, p: .97 },     // rare: flashing red/blue
    { type: 'ambulance', len: 24, wid: 9, p: 1.1 },    // rare: white box, red cross
  ];
  function makeCar(s, v, dropped, laneIdx) {
    const r = Math.random();
    const t = TYPES.find(t => r < t.p) || TYPES[0];
    const emergency = t.type === 'police' || t.type === 'ambulance';
    const canTurn = !emergency && t.type !== 'truck';
    const r2 = Math.random();
    if (laneIdx === undefined) {
      laneIdx = Math.floor(Math.random() * 2);
    }
    return {
      s, v, wait: 0,
      type: t.type, len: t.len, wid: t.wid,
      shade: 195 + (Math.random() * 35 | 0),     // light grey body variations
      turn: canTurn && r2 < .22 ? (r2 < .11 ? 'L' : 'R') : null,
      beam: emergency || Math.random() < .25,    // emergencies always run beams
      hazardT: dropped ? 3 : 0,                  // dropped cars blink hazards
      brake: false,
      laneIdx,
      outLaneIdx: laneIdx,
    };
  }

  /* ── signal controller ── */
  const YEL = 1.6, ALLRED = .9;       // shared safety timing
  const FIX_G = 8;                    // fixed program: equal green, blind to queues
  const MIN_G = 3, MAX_G = 12;        // RL: min-green + must-switch caps
  const MODE_SPAN = 14;               // seconds per controller before handover
  let mode = 'FIXED', modeT = 0;
  let axis = 'ew', sig = 'g', sigT = 0, evalT = 0, lastExtend = -9;
  let gFade = 1;                      // green gates bloom in instead of snapping

  const flashes = [];                 // {text, t} — RL decisions shown by the junction
  function flash(text) { flashes.push({ text, t: 0 }); if (flashes.length > 4) flashes.shift(); }

  function queued(ax) {
    let n = 0;
    for (const ln of lanes) if (ln.d.axis === ax)
      for (const c of ln.cars) if (c.v < 4 && c.s < -STOP + 2) n++;
    return n;
  }
  const AXN = { ns: 'N–S', ew: 'E–W' };

  function stepSignal(dt) {
    modeT += dt;
    if (modeT >= MODE_SPAN) {
      modeT = 0;
      setMode(mode === 'FIXED' ? 'TRAFFIX' : 'FIXED');
    }
    sigT += dt;
    if (sig === 'g') {
      if (mode === 'FIXED') {
        if (sigT >= FIX_G) { sig = 'y'; sigT = 0; }
      } else {
        evalT += dt;
        if (sigT >= MIN_G && evalT >= .5) {
          evalT = 0;
          const other = axis === 'ns' ? 'ew' : 'ns';
          const qCur = queued(axis), qOth = queued(other);
          if (qOth > qCur + 2 || sigT >= MAX_G) {
            sig = 'y'; sigT = 0;
            flash('AI · green → ' + AXN[other]);
            tlog('giving green to ' + AXN[other]);
          } else if (qCur > 0 && sigT - lastExtend >= 4.5) {
            lastExtend = sigT;
            tlog('keeping ' + AXN[axis] + ' green');
          }
        }
      }
    } else if (sig === 'y') {
      if (sigT >= YEL) { sig = 'r'; sigT = 0; }
    } else { // all-red clearance
      if (sigT >= ALLRED) {
        const other = axis === 'ns' ? 'ew' : 'ns';
        axis = (mode === 'FIXED') ? other
          : (queued(other) >= queued(axis) ? other : axis);
        sig = 'g'; sigT = 0; lastExtend = -9; gFade = 0;
      }
    }
  }
  function lightFor(ax) { return ax === axis && sig !== 'r' ? sig : 'r'; }

  /* ── navbar car interaction logic ── */
  const activeNavCars = [];
  let navSpawnCool = 5 + Math.random() * 5;

  function spawnNavbarCar(x, speed, canTurn = true) {
    const navEl = document.getElementById('nav');
    if (!navEl) return;

    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('class', 'nav-car');
    el.setAttribute('viewBox', '0 0 24 10');
    el.setAttribute('fill', 'none');
    el.style.position = 'absolute';
    el.style.bottom = '-3.5px';
    // moved with transform, not `left` — transform doesn't invalidate layout
    el.style.left = '0';
    el.style.transform = 'translateX(' + x + 'px)';
    el.style.width = '14px';
    el.style.height = '6px';
    el.style.zIndex = '60';
    el.style.pointerEvents = 'none';

    el.innerHTML = `
      <path d="M18 5.5L24 4.5V6.5L18 5.5Z" fill="rgba(217, 161, 59, 0.4)" />
      <path d="M2 6.5C2 6.5 3 6.5 3.5 4.5C4 2.5 5.5 2 8 2H12C14.5 2 15 3.5 15.5 4.5C16 5.5 18 6.5 18 6.5" stroke="var(--amber)" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="1" y="5.5" width="18" height="1.5" rx="0.75" fill="var(--amber)"/>
      <circle cx="5.5" cy="7" r="1.2" fill="#0b0d0e" stroke="var(--amber)" stroke-width="1"/>
      <circle cx="14.5" cy="7" r="1.2" fill="#0b0d0e" stroke="var(--amber)" stroke-width="1"/>
    `;
    navEl.appendChild(el);
    activeNavCars.push({ el, x, speed, waiting: false, canTurn });
  }

  /* ── traffic ── */
  let T = 0;                                 // wall-clock for pulse effects
  function step(dt) {
    T += dt;
    gFade = Math.min(1, gFade + dt * 2.2);
    stepSignal(dt);
    for (const f of flashes) f.t += dt;
    while (flashes.length && flashes[0].t > 2.2) flashes.shift();
    for (const rp of ripples) rp.t += dt;
    while (ripples.length && ripples[0].t > .8) ripples.shift();

    // ── Spawn navbar cars (rarer on phones — the strip is short) ──
    navSpawnCool -= dt;
    if (navSpawnCool <= 0) {
      const speed = 80 + Math.random() * 40;
      const canTurn = Math.random() < 0.85; // 85% chance to turn down, 15% stay
      spawnNavbarCar(-20, speed, canTurn);
      navSpawnCool = (W < 700 || LOWPOW) ? 32 + Math.random() * 22 : 15 + Math.random() * 15;
    }

    // ── Update active navbar cars ──
    const turnX = CX - ROAD * 0.25;
    const sEntry = 68 - CY;
    for (let i = activeNavCars.length - 1; i >= 0; i--) {
      const nc = activeNavCars[i];
      if (!nc.waiting) {
        nc.x += nc.speed * dt;
        nc.el.style.transform = 'translateX(' + nc.x + 'px)';
        if (nc.canTurn && nc.x >= turnX) {
          nc.x = turnX;
          nc.el.style.transform = 'translateX(' + nc.x + 'px)';
          nc.waiting = true;
        }
      }
      if (nc.waiting) {
        let blocked = false;
        for (const c of lanes[2].cars) {
          if (c.laneIdx === 0 && Math.abs(c.s - sEntry) < GAP + 15) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          nc.el.remove();
          activeNavCars.splice(i, 1);
          const car = makeCar(sEntry, VMAX * 0.75, false, 0);
          const idx = lanes[2].cars.findIndex(c => c.s < sEntry);
          if (idx === -1) lanes[2].cars.push(car);
          else lanes[2].cars.splice(idx, 0, car);

          const [px, py] = carPos(car, lanes[2].d);
          ripples.push({ x: px, y: py, t: 0 });
        }
      }
      if (nc.x > W + 40) {
        nc.el.remove();
        activeNavCars.splice(i, 1);
      }
    }

    // ── Check Northbound lane exit to navbar ──
    if (lanes[3].cars.length > 0) {
      const lead = lanes[3].cars[0];
      const sExit = CY - 68;
      if (lead.s >= sExit && !lead.toNavChecked) {
        lead.toNavChecked = true;
        if (Math.random() < 0.45) { // 45% chance to turn onto navbar
          lanes[3].cars.shift();
          const speed = Math.max(50, lead.v * 1.5);
          const sign = lanes[3].d.off > 0 ? 1 : -1;
          const lead_out_offset = sign * (ROAD * 0.25 + ROAD * 0.5 * lead.outLaneIdx);
          spawnNavbarCar(CX + lead_out_offset, speed, false);
        }
      }
    }


    for (const ln of lanes) {
      const light = lightFor(ln.d.axis);
      ln.cool -= dt;
      if (ln.cool <= 0) {
        const laneIdx = Math.floor(Math.random() * 2);
        const isBlocked = ln.cars.some(c => c.laneIdx === laneIdx && c.s < spawnDist(ln.d) + GAP + 22);
        if (!isBlocked) {
          const car = makeCar(spawnDist(ln.d), VMAX * (.7 + Math.random() * .3), false, laneIdx);
          ln.cars.push(car);
          ln.cool = ln.d.rate * (.7 + Math.random() * .6);
        } else {
          ln.cool = .4;   // retry soon, but not every frame
        }
      }
      for (let i = 0; i < ln.cars.length; i++) {
        const c = ln.cars[i];
        if (c.hazardT > 0) c.hazardT -= dt;
        let limit = Infinity;
        let lead = null;
        for (let j = i - 1; j >= 0; j--) {
          const prospective = ln.cars[j];
          if (prospective.laneIdx === c.laneIdx) {
            lead = prospective;
            break;
          }
        }
        if (lead) {
          limit = lead.s - ((lead.len + c.len) / 2 + 8);
        }
        // hold the car's FRONT bumper a few px short of the light
        if ((light !== 'g') && c.s < -STOP) limit = Math.min(limit, -STOP - 4 - c.len / 2);
        const room = limit - c.s;
        // smooth car-following: open road → full throttle (punchier from
        // a standstill); near an obstacle the safe speed ramps down with
        // the remaining gap, so braking eases in instead of slamming on
        const vSafe = room === Infinity ? VMAX
          : Math.max(0, Math.min(VMAX, (room - 1) * 2));
        if (c.v < vSafe) {
          c.v = Math.min(vSafe, c.v + ACC * (1.3 - .55 * c.v / VMAX) * dt);
          c.brake = false;
        } else {
          c.v = Math.max(vSafe, c.v - BRK * dt);
          c.brake = c.v > vSafe + 1;
        }
        if (c.v < 4) { c.wait += dt; c.brake = true; }
        c.s += c.v * dt;
      }
      while (ln.cars.length && ln.cars[0].s > endDist(ln.d)) ln.cars.shift();
    }
  }

  /* ── agent terminal: the policy thinks out loud ── */
  const optFixed = document.getElementById('opt-fixed');
  const optRl = document.getElementById('opt-rl');
  const term = document.getElementById('term');
  const tq = []; let typing = false;
  function tlog(s) {
    if (!term) return;
    tq.push(s); if (tq.length > 6) tq.shift();
    typeNext();
  }
  function typeNext() {
    if (typing || !tq.length) return;
    typing = true;
    const line = document.createElement('div');
    term.appendChild(line);
    while (term.children.length > 5) term.firstChild.remove();
    const s = tq.shift(); let i = 0;
    (function tick() {
      line.textContent = '▸ ' + s.slice(0, ++i);
      if (i < s.length) setTimeout(tick, 14);
      else { typing = false; typeNext(); }
    })();
  }
  function setMode(m) {
    mode = m;
    const rl = m === 'TRAFFIX';
    if (optFixed && optRl) {
      optFixed.classList.toggle('active', !rl);
      optRl.classList.toggle('active', rl);
    }
    flash(rl ? 'Traffix AI on' : 'fixed timer on');
    tlog(rl ? 'Traffix AI took over' : 'old-school timer running');
    if (rl) tlog('checking each road…');
  }
  if (hud) hud.addEventListener('click', () => {
    modeT = 0;
    setMode(mode === 'FIXED' ? 'TRAFFIX' : 'FIXED');
  });

  /* telemetry lines + a simple reward signal (queue drained per interval) */
  let telT = 0, rewT = 0, qPrev = 0;
  function telemetry(dt) {
    telT += dt; rewT += dt;
    const q = queued('ns') + queued('ew');
    if (mode === 'TRAFFIX' && telT >= 4.2) {
      telT = 0;
      tlog('cars waiting · N–S ' + queued('ns') + ' · E–W ' + queued('ew'));
    }
    if (mode === 'TRAFFIX' && rewT >= 5.5) {
      rewT = 0;
      if (q < qPrev - 1) tlog('queues shrinking ✓');
      else if (q > qPrev + 1) tlog('queues building…');
      qPrev = q;
    }
    if (mode === 'FIXED') qPrev = q;
  }

  /* ── the wow button: flood the junction, let RL clean it up ── */
  const inj = document.getElementById('btn-inject');
  let injecting = false;
  if (inj) inj.addEventListener('click', e => {
    e.stopPropagation();                  // don't toggle the controller
    if (injecting) return;
    injecting = true;
    modeT = -3;                           // hold fixed-time long enough to hurt
    setMode('FIXED');
    tlog('flooding the junction…');
    let n = 0;
    const iv = setInterval(() => {
      if (++n > 16) {
        clearInterval(iv);
        setTimeout(() => {
          tlog('jam building up');
          modeT = 0;
          setMode('TRAFFIX');
          injecting = false;
        }, 3200);
        return;
      }
      const ln = lanes[Math.random() < .72 ? (Math.random() < .5 ? 0 : 1)
        : (Math.random() < .5 ? 2 : 3)];
      const s0 = spawnDist(ln.d) + 10;
      const laneIdx = Math.floor(Math.random() * 2);
      const isBlocked = ln.cars.some(c => c.laneIdx === laneIdx && Math.abs(c.s - s0) < 36);
      if (!isBlocked) {
        const car = makeCar(s0, VMAX * .6, false, laneIdx);
        const idx = ln.cars.findIndex(c => c.s < s0);
        if (idx === -1) ln.cars.push(car);
        else ln.cars.splice(idx, 0, car);
      }
    }, 150);
  });

  /* ── pick & place: tap a road to drop a vehicle there ── */
  const ripples = [];
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = ROAD + 10;        // must hit a lane, not just the road
    for (const ln of lanes) {
      const d = ln.d;
      const dist = d.dx !== 0 ? Math.abs(y - (CY + d.off)) : Math.abs(x - (CX + d.off));
      if (dist < bd) { bd = dist; best = ln; }
    }
    if (!best) return;
    const d = best.d;
    const s = d.dx !== 0 ? (x - CX) * d.dx : (y - CY) * d.dy;
    if (s > endDist(d) - 30 || s < spawnDist(d) + 10) return;
    for (const c of best.cars) if (Math.abs(c.s - s) < GAP + 8) return;  // keep spacing
    // Find which lane the click was closer to (2 lanes, centers at 18, 54)
    const absOff = Math.abs(d.axis === 'ew' ? y - CY : x - CX);
    const laneIdx = absOff < ROAD * 0.5 ? 0 : 1;
    const car = makeCar(s, 0, true, laneIdx);

    const i = best.cars.findIndex(c => c.s < s);   // array runs front → back
    if (i === -1) best.cars.push(car); else best.cars.splice(i, 0, car);
    const [px, py] = carPos(car, d);
    ripples.push({ x: px, y: py, t: 0 });
  });
  /* crosshair only where it means something: over the roads */
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    cv.style.cursor =
      (Math.abs(y - CY) < ROAD + 10 || Math.abs(x - CX) < ROAD + 10)
        ? 'crosshair' : 'default';
  });

  /* ── render: a digital twin at night, not asphalt ── */
  let lastTint = '';
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // road body — a clear channel
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = ROAD * 2;
    ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(W, CY);
    ctx.moveTo(CX, 0); ctx.lineTo(CX, H); ctx.stroke();

    for (const ln of lanes) {
      const { d } = ln;
      let n = 0;
      for (const c of ln.cars) if (c.s < -STOP + 2) n++;
      const col = n < 4 ? '96,150,210' : n < 10 ? '217,161,59' : '224,118,58';
      const a = Math.min(.13, .035 + n * .006);
      const [x1, y1] = pos(d, spawnDist(d) + 20);
      const [x2, y2] = pos(d, -STOP - 2);
      ctx.strokeStyle = 'rgba(' + col + ',' + a + ')';
      ctx.lineWidth = ROAD; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    // Update text tint based on queue size in eastbound (lanes[0]).
    // Only touch the custom property when the tint actually changes —
    // setting it every frame forces a full style recalc per frame.
    const getTint = (n) => {
      if (n === 0) return '#a5abb6'; // original neutral gray
      if (n < 4) return '#9fb2c0';  // subtle blue-gray
      if (n < 10) return '#bdae9c';  // subtle gold-gray
      return '#c2a59c';             // subtle rose-gray
    };
    let nEast = 0;
    for (const c of lanes[0].cars) if (c.s < -STOP + 2) nEast++;
    const tint = getTint(nEast);
    if (tint !== lastTint) {
      lastTint = tint;
      document.documentElement.style.setProperty('--text-tint-2', tint);
    }

    // channel edges
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const o of [-ROAD, ROAD]) {
      ctx.moveTo(0, CY + o); ctx.lineTo(CX - ROAD, CY + o);
      ctx.moveTo(CX + ROAD, CY + o); ctx.lineTo(W, CY + o);
      ctx.moveTo(CX + o, 0); ctx.lineTo(CX + o, CY - ROAD);
      ctx.moveTo(CX + o, CY + ROAD); ctx.lineTo(CX + o, H);
    }
    ctx.stroke();
    // centre dashes
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.setLineDash([6, 14]);
    ctx.beginPath();
    ctx.moveTo(0, CY); ctx.lineTo(CX - ROAD, CY); ctx.moveTo(CX + ROAD, CY); ctx.lineTo(W, CY);
    ctx.moveTo(CX, 0); ctx.lineTo(CX, CY - ROAD); ctx.moveTo(CX, CY + ROAD); ctx.lineTo(CX, H);
    ctx.stroke(); ctx.setLineDash([]);

    // lane dividers (dashed lines for 2 lanes on each side)
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.setLineDash([3, 10]);
    ctx.beginPath();

    const halfRoad = ROAD * 0.5;
    // Horizontal road lane dividers (left and right arms)
    ctx.moveTo(0, CY + halfRoad); ctx.lineTo(CX - ROAD, CY + halfRoad);
    ctx.moveTo(0, CY - halfRoad); ctx.lineTo(CX - ROAD, CY - halfRoad);
    ctx.moveTo(CX + ROAD, CY + halfRoad); ctx.lineTo(W, CY + halfRoad);
    ctx.moveTo(CX + ROAD, CY - halfRoad); ctx.lineTo(W, CY - halfRoad);

    // Vertical road lane dividers (top and bottom arms)
    ctx.moveTo(CX + halfRoad, 0); ctx.lineTo(CX + halfRoad, CY - ROAD);
    ctx.moveTo(CX - halfRoad, 0); ctx.lineTo(CX - halfRoad, CY - ROAD);
    ctx.moveTo(CX + halfRoad, CY + ROAD); ctx.lineTo(CX + halfRoad, H);
    ctx.moveTo(CX - halfRoad, CY + ROAD); ctx.lineTo(CX - halfRoad, H);

    ctx.stroke(); ctx.setLineDash([]);
    // junction cell
    ctx.strokeStyle = 'rgba(255,255,255,.17)'; ctx.lineWidth = 1;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(CX - ROAD, CY - ROAD, ROAD * 2, ROAD * 2, 9);
      ctx.stroke();
    } else ctx.strokeRect(CX - ROAD, CY - ROAD, ROAD * 2, ROAD * 2);

    // signals: glowing gates — green blooms in, yellow pulses, red burns steady
    const cols = { g: '#5fae7e', y: '#d9a13b', r: '#b8584f' };
    for (const ln of lanes) {
      const { d } = ln, l = lightFor(d.axis);
      const [sx, sy] = pos(d, -STOP);
      const a = l === 'g' ? .95 * gFade
        : l === 'y' ? .55 + .35 * Math.sin(T * 7)
          : .85;
      if (a <= 0) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (d.dx !== 0) { ctx.moveTo(sx, sy - LANE + 4); ctx.lineTo(sx, sy + LANE - 4); }
      else { ctx.moveTo(sx - LANE + 4, sy); ctx.lineTo(sx + LANE - 4, sy); }
      // bloom pass, then core (shadow blur only where the GPU can afford it)
      ctx.strokeStyle = cols[l];
      if (GLOWS) ctx.shadowColor = cols[l];
      ctx.globalAlpha = a * .3; ctx.lineWidth = 7; if (GLOWS) ctx.shadowBlur = 18; ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = 2.5; if (GLOWS) ctx.shadowBlur = 8; ctx.stroke();
      ctx.restore();
    }

    // vehicles: top-down bodies with windshields, lights and indicators.
    // Drawn in a local frame: +x is the direction of travel.
    const HEAD = d => d.dx === 1 ? 0 : d.dx === -1 ? Math.PI : d.dy === 1 ? Math.PI / 2 : -Math.PI / 2;
    function rr(x, y, w, h, r) {
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
      else ctx.fillRect(x, y, w, h);
    }
    function dot(x, y, r, color, glow) {
      if (glow && GLOWS) {
        ctx.save();
        ctx.shadowColor = color; ctx.shadowBlur = 5;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
    }
    for (const ln of lanes) {
      const { d } = ln, ang = HEAD(d);
      for (const c of ln.cars) {
        const [x, y] = carPos(c, d);

        // Fade out cars while behind the headline text / in the left and middle segment
        let alpha = 1;
        if (W >= 700) {
          if (d.axis === 'ew' && d.dx === 1 && h1Rect) {
            const fadeStart = h1Rect.right + 10;
            const fadeEnd = fadeStart + 38;
            if (x < fadeStart) {
              alpha = 0;
            } else if (x < fadeEnd) {
              alpha = (x - fadeStart) / (fadeEnd - fadeStart);
            }
          }
        }

        const moving = c.v > 4;
        const L = c.len, Wd = c.wid, g = c.shade;
        const hw = Wd / 2 - 1.4;
        ctx.save();
        if (alpha < 1) ctx.globalAlpha = alpha;
        ctx.translate(x, y); ctx.rotate(ang);
        // headlight beams falling on the road — only some vehicles, like a
        // real night (skipped on low-power GPUs: a gradient per car per frame)
        if (moving && c.beam && GLOWS) {
          const reach = 24 + c.v * .22;
          const bg = ctx.createLinearGradient(L / 2, 0, L / 2 + reach, 0);
          bg.addColorStop(0, 'rgba(255,249,224,.09)');
          bg.addColorStop(1, 'rgba(255,249,224,0)');
          ctx.fillStyle = bg;
          ctx.beginPath();
          ctx.moveTo(L / 2 - 1, -hw - 1); ctx.lineTo(L / 2 + reach, -hw - 6);
          ctx.lineTo(L / 2 + reach, hw + 6); ctx.lineTo(L / 2 - 1, hw + 1);
          ctx.closePath(); ctx.fill();
        }
        // body
        const dim = moving ? .85 : .62 + .08 * Math.sin(T * 2.6 + c.s * .35);
        const rcol = `rgba(${g},${g - 3},${g - 10},${dim})`;
        const GLASS = `rgba(14,17,19,${dim * 0.85})`;
        const LINE = `rgba(20,24,28,${dim * 0.9})`;

        ctx.fillStyle = rcol;
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 0.8;

        if (c.type === 'truck') {
          // Cab (front section)
          ctx.fillStyle = `rgba(${g - 15},${g - 18},${g - 25},${dim})`;
          rr(L * 0.12, -Wd / 2, L * 0.38, Wd, 1.8);

          // Seam between cab and cargo bed
          ctx.strokeStyle = '#050708';
          ctx.beginPath();
          ctx.moveTo(L * 0.12, -Wd / 2);
          ctx.lineTo(L * 0.12, Wd / 2);
          ctx.stroke();

          // Cargo Bed (back section - container box)
          ctx.fillStyle = `rgba(${g + 18},${g + 14},${g + 4},${dim})`;
          rr(-L / 2, -Wd / 2, L * 0.62, Wd, 1.2);

          // Container panels/ribs
          ctx.strokeStyle = 'rgba(10,12,14,0.4)';
          ctx.lineWidth = 0.8;
          for (let i = -L / 2 + 3; i < L * 0.1; i += 4) {
            ctx.beginPath(); ctx.moveTo(i, -Wd / 2 + 1); ctx.lineTo(i, Wd / 2 - 1); ctx.stroke();
          }

          // Windshield & side windows
          ctx.fillStyle = GLASS;
          rr(L * 0.28, -Wd / 2 + 1.2, 3.2, Wd - 2.4, 0.8);
          // Side mirrors
          ctx.fillStyle = `rgba(${g - 30},${g - 33},${g - 40},${dim})`;
          ctx.fillRect(L * 0.32, -Wd / 2 - 1.6, 1.6, 1.6);
          ctx.fillRect(L * 0.32, Wd / 2, 1.6, 1.6);

        } else if (c.type === 'van') {
          // Boxy van body
          ctx.fillStyle = `rgba(${g - 5},${g - 8},${g - 15},${dim})`;
          rr(-L / 2, -Wd / 2, L, Wd, 2.2);

          // Hood seam
          ctx.strokeStyle = LINE;
          ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(L * 0.24, -Wd / 2 + 0.8); ctx.lineTo(L * 0.24, Wd / 2 - 0.8); ctx.stroke();

          // Roof ridges
          ctx.strokeStyle = 'rgba(255,255,255,0.08)';
          ctx.lineWidth = 0.8;
          for (let dy = -2; dy <= 2; dy += 2) {
            ctx.beginPath(); ctx.moveTo(-L / 2 + 3, dy); ctx.lineTo(L * 0.2, dy); ctx.stroke();
          }

          // Windshield & Rear glass
          ctx.fillStyle = GLASS;
          rr(L * 0.12, -Wd / 2 + 1.2, 2.8, Wd - 2.4, 0.8);
          rr(-L / 2 + 1.2, -Wd / 2 + 1.6, 1.8, Wd - 3.2, 0.6);

          // Side mirrors
          ctx.fillStyle = `rgba(${g - 15},${g - 18},${g - 25},${dim})`;
          ctx.fillRect(L * 0.16, -Wd / 2 - 1.2, 1.2, 1.2);
          ctx.fillRect(L * 0.16, Wd / 2, 1.2, 1.2);

        } else if (c.type === 'suv') {
          // SUV body
          ctx.fillStyle = `rgba(${g + 8},${g + 6},${g - 2},${dim})`;
          rr(-L / 2, -Wd / 2, L, Wd, 2.4);

          // Hood seam
          ctx.strokeStyle = LINE;
          ctx.beginPath(); ctx.moveTo(L * 0.18, -Wd / 2 + 0.8); ctx.lineTo(L * 0.18, Wd / 2 - 0.8); ctx.stroke();

          // Roof rack rails
          ctx.fillStyle = `rgba(30,34,38,${dim})`;
          ctx.fillRect(-L * 0.26, -Wd / 2 + 1.2, L * 0.44, 0.9);
          ctx.fillRect(-L * 0.26, Wd / 2 - 2.1, L * 0.44, 0.9);

          // Windshield, side glass, rear glass
          ctx.fillStyle = GLASS;
          rr(L * 0.05, -Wd / 2 + 1.2, 2.8, Wd - 2.4, 0.8);
          rr(-L * 0.34, -Wd / 2 + 1.4, L * 0.32, Wd - 2.8, 1);

          // Side mirrors
          ctx.fillStyle = `rgba(${g - 10},${g - 13},${g - 20},${dim})`;
          ctx.fillRect(L * 0.09, -Wd / 2 - 1.2, 1.2, 1.2);
          ctx.fillRect(L * 0.09, Wd / 2, 1.2, 1.2);

        } else if (c.type === 'police') {
          // American black-and-white cruiser
          ctx.fillStyle = `rgba(38,44,54,${dim})`;
          rr(-L / 2, -Wd / 2, L, Wd, 2.4);
          // white door panels
          ctx.fillStyle = `rgba(224,227,231,${dim})`;
          rr(-L * 0.18, -Wd / 2 + 0.8, L * 0.34, Wd - 1.6, 1);
          // glass
          ctx.fillStyle = GLASS;
          rr(L * 0.08, -Wd / 2 + 1.2, 2.6, Wd - 2.4, 0.8);
          rr(-L * 0.3, -Wd / 2 + 1.4, 2, Wd - 2.8, 0.8);
          // roof lightbar — red / blue strobing
          {
            const ph = (T * 4.5 % 1) < .5;
            dot(-1, -1.7, 1.2, ph ? 'rgba(255,60,60,.95)' : 'rgba(255,60,60,.2)', ph);
            dot(-1, 1.7, 1.2, ph ? 'rgba(80,140,255,.2)' : 'rgba(80,140,255,.95)', !ph);
          }
        } else if (c.type === 'ambulance') {
          // white box ambulance with red striping
          ctx.fillStyle = `rgba(230,232,234,${dim})`;
          rr(-L / 2, -Wd / 2, L, Wd, 2);
          // side stripes
          ctx.fillStyle = `rgba(212,58,48,${dim})`;
          ctx.fillRect(-L / 2 + 2, -Wd / 2 + 0.7, L - 5, 1.1);
          ctx.fillRect(-L / 2 + 2, Wd / 2 - 1.8, L - 5, 1.1);
          // red cross on the roof
          ctx.fillRect(-L * 0.18, -0.6, 4.6, 1.2);
          ctx.fillRect(-L * 0.18 + 1.7, -2.3, 1.2, 4.6);
          // cab seam + glass
          ctx.strokeStyle = LINE;
          ctx.beginPath(); ctx.moveTo(L * 0.16, -Wd / 2 + 0.8); ctx.lineTo(L * 0.16, Wd / 2 - 0.8); ctx.stroke();
          ctx.fillStyle = GLASS;
          rr(L * 0.22, -Wd / 2 + 1.2, 2.8, Wd - 2.4, 0.8);
          // lightbar — red / white strobing over the cab
          {
            const ph = (T * 4.5 % 1) < .5;
            dot(L * 0.36, -Wd / 2 + 1.2, 1.1, ph ? 'rgba(255,60,60,.95)' : 'rgba(255,255,255,.25)', ph);
            dot(L * 0.36, Wd / 2 - 1.2, 1.1, ph ? 'rgba(255,255,255,.25)' : 'rgba(255,60,60,.95)', !ph);
          }
        } else {
          // Sedan body (standard car)
          ctx.fillStyle = `rgba(${g + 18},${g + 18},${g + 18},${dim})`;
          rr(-L / 2, -Wd / 2, L, Wd, 2.5);

          // Hood & trunk seams
          ctx.strokeStyle = LINE;
          ctx.beginPath(); ctx.moveTo(L * 0.18, -Wd / 2 + 0.8); ctx.lineTo(L * 0.18, Wd / 2 - 0.8); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-L * 0.26, -Wd / 2 + 0.8); ctx.lineTo(-L * 0.26, Wd / 2 - 0.8); ctx.stroke();

          // Windshield & Rear glass
          ctx.fillStyle = GLASS;
          rr(L * 0.04, -Wd / 2 + 1.2, 2.8, Wd - 2.4, 0.8);
          rr(-L * 0.22, -Wd / 2 + 1.4, 2.2, Wd - 2.8, 0.8);

          // Side mirrors
          ctx.fillStyle = `rgba(${g - 5},${g - 8},${g - 15},${dim})`;
          ctx.fillRect(L * 0.08, -Wd / 2 - 1.2, 1.2, 1.2);
          ctx.fillRect(L * 0.08, Wd / 2, 1.2, 1.2);
        }
        // headlights — white, brighter when rolling
        dot(L / 2 - .9, hw, 1, `rgba(255,253,240,${moving ? .95 : .45})`, moving);
        dot(L / 2 - .9, -hw, 1, `rgba(255,253,240,${moving ? .95 : .45})`, moving);
        // brake lights — red when braking or held
        const br = c.brake;
        dot(-L / 2 + .9, hw, 1.1, `rgba(255,72,58,${br ? .95 : .2})`, br);
        dot(-L / 2 + .9, -hw, 1.1, `rgba(255,72,58,${br ? .95 : .2})`, br);
        // indicators — hazards on dropped cars, turn signal near the junction
        const blink = (T * 1.4 % 1) < .5;
        if (blink) {
          const sides = c.hazardT > 0 ? [1, -1]
            : (c.turn && Math.abs(c.s) < 170) ? [c.turn === 'L' ? -1 : 1] : [];
          for (const sd of sides) {
            dot(L / 2 - 2.6, sd * hw, .9, 'rgba(255,176,46,.95)', true);
            dot(-L / 2 + 2.6, sd * hw, .9, 'rgba(255,176,46,.95)', true);
          }
        }
        ctx.restore();
      }
    }

    // tap ripples — confirmation that a vehicle was placed
    for (const rp of ripples) {
      const a = Math.max(0, 1 - rp.t / .8);
      ctx.strokeStyle = 'rgba(217,161,59,' + (a * .6) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, 6 + rp.t * 52, 0, 7); ctx.stroke();
    }

    // RL decision flashes float up beside the junction — desktop only;
    // on phones they clip at the screen edge and there is no HUD to
    // narrate the controller anyway
    if (W >= 700) {
      ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      flashes.forEach((f, i) => {
        const a = Math.min(1, f.t * 4) * Math.max(0, 1 - f.t / 2.2);
        ctx.fillStyle = 'rgba(217,161,59,' + (a * .95) + ')';
        ctx.fillText(f.text, CX + ROAD + 24, CY - ROAD - 18 - (flashes.length - 1 - i) * 19 - f.t * 6);
      });
    }
  }

  let last = performance.now(), running = true;
  const vio = new IntersectionObserver(es => { running = es[0].isIntersecting; }, {});
  vio.observe(cv);
  tlog('watching the junction');
  tlog('old-school timer running');
  (function loop(t) {
    const dt = Math.min((t - last) / 1000, .05); last = t;
    if (running) { step(dt); telemetry(dt); draw(); }
    requestAnimationFrame(loop);
  })(last);
})();
