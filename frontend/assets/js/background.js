"use strict";
/* ════════════════════════════════════════════════════════════
   TRAFFIX — background.js · ambient constellation city
   Stipple-art night sky with traffic nuance — dotted junction
   bursts with roads radiating out, stippled roundabout planets,
   dotted route arcs with cars (pulses) travelling them, and
   signal glints in amber / green / red.
   The static art is pre-rendered once to an offscreen layer, so
   a frame costs a few drawImage calls plus a handful of sprites.
   Phones animate too (fewer pulses, lower DPR); only
   prefers-reduced-motion gets a single static frame.
   ════════════════════════════════════════════════════════════ */
(function bgConstellation() {
  const cv = document.getElementById('bg-dots');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // CHEAP = real phone viewport OR a touch device in "desktop site" mode
  const CHEAP = matchMedia('(max-width: 700px)').matches || window.TFX_LOW_POWER === true;
  const DPR = Math.min(devicePixelRatio || 1, CHEAP ? 1.5 : 2);
  const DOTR = CHEAP ? .8 : 1;   // phones have a thinner road — smaller vehicles
  const GOLD = '217,161,59', PALE = '232,205,130', ORANGE = '255,150,46';
  let W = 0, H = 0;
  let layer = null;          // pre-rendered stipple art (parallax-scrolled)
  let layerJ = null;         // the celestial junction (fixed, no parallax)
  let layerB = null;         // blurred city — blended in as the scene defocuses
  let layerJb = null;        // blurred junction — the resting page-2 background
  let slotCache = null;      // the live junction's car queue-slots, per dive
  let arcs = [], stars = [], pulses = [];
  let jrays = [], jpulses = [], jcx = 0, jcy = 0;   // junction traffic

  /* dive boost: 1 = page-1 "city at night" brightness, 0 = the usual
     faint background. main.js (which runs first) seeds the global and
     drives it from the dive scroll; brightening is just restacking the
     pre-rendered layer a few extra times, so it stays drawImage-cheap. */
  let boost = Math.max(0, Math.min(1, +window.__tfxBoost || 0));
  let boostQueued = false;
  window.__tfxBg = {
    setBoost(v) {
      v = Math.max(0, Math.min(1, +v || 0));
      if (Math.abs(v - boost) < .005) return;
      boost = v;
      // animated devices pick the change up next frame; the reduced-motion
      // static frame needs an explicit redraw
      if (REDUCED && ready && !boostQueued) {
        boostQueued = true;
        requestAnimationFrame(() => { boostQueued = false; staticDraw(); });
      }
    },
    // dev: advance + draw one frame synchronously. rAF is throttled to 0 in
    // the occluded preview window, so the capture harness drives this.
    tick(dt) { if (ready) render(dt); }
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);

  function dot(c, x, y, r, rgb, a) {
    c.fillStyle = 'rgba(' + rgb + ',' + a + ')';
    c.fillRect(x - r, y - r, r * 2, r * 2);   // square stipple dots, cheap
  }

  /* stippled disk — a dot-shaded planet, denser and brighter at the rim */
  function stippleDisk(c, cx, cy, R, n) {
    for (let i = 0; i < n; i++) {
      const t = Math.random() * Math.PI * 2;
      const rr = R * Math.sqrt(Math.random());
      const edge = rr / R;
      dot(c, cx + Math.cos(t) * rr, cy + Math.sin(t) * rr,
        rnd(.5, 1.1), GOLD, .03 + .1 * edge * Math.random());
    }
  }

  /* dotted ring — a roundabout */
  function stippleRing(c, cx, cy, R, n) {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + rnd(-.05, .05);
      const rr = R + rnd(-1.5, 1.5);
      dot(c, cx + Math.cos(t) * rr, cy + Math.sin(t) * rr,
        rnd(.5, 1), GOLD, rnd(.05, .14));
    }
  }

  /* junction burst — dotted roads radiating from a small core,
     each ray bending gently like a slip road */
  function burst(c, cx, cy, R, rays) {
    stippleRing(c, cx, cy, rnd(4, 7), 16);
    for (let k = 0; k < rays; k++) {
      const t = (k / rays) * Math.PI * 2 + rnd(-.12, .12);
      const bend = rnd(-.3, .3);
      const len = R * rnd(.55, 1);
      for (let s = 10; s < len; s += rnd(5, 8)) {
        const a = t + bend * (s / len);
        dot(c, cx + Math.cos(a) * s, cy + Math.sin(a) * s,
          rnd(.4, .9), GOLD, Math.max(.02, .12 * (1 - s / len)));
      }
    }
  }

  /* dotted route between two junctions; returns its curve for pulses */
  function route(c, x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2 + rnd(-90, 90);
    const my = (y1 + y2) / 2 + rnd(-90, 90);
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 7);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const x = u * u * x1 + 2 * u * t * mx + t * t * x2;
      const y = u * u * y1 + 2 * u * t * my + t * t * y2;
      dot(c, x, y, .6, PALE, .05);
    }
    return { x1, y1, mx, my, x2, y2 };
  }

  /* a connector road that leaves a junction ALONG a given heading — its
     control point sits straight ahead of the tip, so the curve continues the
     lane's direction (no kink) and only then bends toward the neighbour */
  function connector(c, x1, y1, heading, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const mx = x1 + Math.cos(heading) * dist * .45;
    const my = y1 + Math.sin(heading) * dist * .45;
    const steps = Math.ceil(dist / 7);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      dot(c, u * u * x1 + 2 * u * t * mx + t * t * x2,
        u * u * y1 + 2 * u * t * my + t * t * y2, .6, PALE, .05);
    }
    return { x1, y1, mx, my, x2, y2 };
  }

  /* a point on a junction lane, s px out from centre. The lane bends gently
     with distance (bend), so it's curvy and a little imperfect — never a
     ruler-straight spoke. */
  function lanePoint(cx, cy, ln, s) {
    const a = ln.a0 + ln.bend * (s / ln.len);
    return [cx + Math.cos(a) * s, cy + Math.sin(a) * s];
  }

  /* the celestial junction — at REST it must read as just another dotted
     junction (same soft ring + gold dots as every burst), so a first-time
     visitor never clocks it as special; only its denser traffic hints at it.
     Its hidden structure is a 4-way crossing (two carriageways per
     N / E / S / W approach), but the lanes are gently CURVED and slightly
     irregular — so when the dive zooms in it resolves into an organic, a
     little imperfect intersection, not a hard mechanical cross. build() then
     extends all eight lanes into the network so no approach dead-ends.
     Returns the lane geometry the pulses travel. */
  function celestialJunction(c, cx, cy, R) {
    const ringR = rnd(5, 8);
    stippleRing(c, cx, cy, ringR, 18);             // soft core, like any burst
    const lanes = [];
    for (const ca of [-Math.PI / 2, 0, Math.PI / 2, Math.PI]) {   // N E S W
      for (const side of [-1, 1]) {                // two carriageways each
        const a0 = ca + side * rnd(.08, .17) + rnd(-.05, .05);    // imperfect
        const bend = side * rnd(.05, .22) + rnd(-.06, .06);       // curvy
        const len = R * rnd(.78, 1.05);
        const ln = { a0, bend, len, start: ringR };
        for (let s = ringR + 3; s < len; s += rnd(4.5, 7)) {
          const [x, y] = lanePoint(cx, cy, ln, s);
          dot(c, x, y, rnd(.4, .9), GOLD,
            Math.max(.025, .13 * (1 - (s - ringR) / (len - ringR))));
        }
        lanes.push(ln);
      }
    }
    return lanes;
  }

  /* 4-point glint — a far-away signal light */
  function glint(c, x, y, r, rgb, a) {
    c.strokeStyle = 'rgba(' + rgb + ',' + a + ')';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x - r, y); c.lineTo(x + r, y);
    c.moveTo(x, y - r); c.lineTo(x, y + r);
    c.stroke();
  }

  /* one-time soft copy of a pre-rendered layer (device-pixel gaussian blur) */
  function blurredCopy(src, px) {
    const b = document.createElement('canvas');
    b.width = src.width; b.height = src.height;
    const bc = b.getContext('2d');
    bc.filter = 'blur(' + (px * DPR) + 'px)';
    bc.drawImage(src, 0, 0);
    bc.filter = 'none';
    return b;
  }

  let ready = false;
  function build() {
    W = cv.clientWidth; H = cv.clientHeight;
    // the window can report a 0-size layout during startup — retry
    if (!W || !H) { setTimeout(build, 150); return; }
    cv.width = W * DPR; cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layer = document.createElement('canvas');
    layer.width = W * DPR; layer.height = H * DPR;
    const c = layer.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, 0, 0);

    arcs = []; stars = []; pulses = [];

    // the live junction's screen position — the same fractions hero-sim.js
    // and eraseRoads use. The celestial junction is drawn here, and the
    // page-1 dive zooms into it (scaled inside the canvas, about this
    // point); re-derived on every rebuild — the phone junction sits higher
    const jx = jcx = W * (W < 700 ? .68 : .66);
    const jy = jcy = H * (W < 700 ? .38 : .48);
    layerJ = document.createElement('canvas');
    layerJ.width = W * DPR; layerJ.height = H * DPR;
    const cj = layerJ.getContext('2d');
    cj.setTransform(DPR, 0, 0, DPR, 0, 0);
    // sized in the middle of the neighbours' range (bursts are 70–150) so
    // it doesn't stand out — only its traffic gives it away
    jrays = celestialJunction(cj, jx, jy, Math.min(115, Math.min(W, H) * .18));
    // its traffic: pulses streaming in and out of the junction
    jpulses = [];
    // one orange dot per REAL car slot the sim will spawn — a strict 1:1 map
    // (dot i → slot i → car i), so the dots ARE this junction's vehicles and
    // the count/layout is whatever hero-sim randomised this load. Each dot
    // roams, at rest, on the lane that matches its slot's approach + carriageway.
    const seedSlots = (window.__tfxHero && window.__tfxHero.slots)
      ? window.__tfxHero.slots() : null;
    const NJ = seedSlots ? seedSlots.length : (CHEAP ? 6 : 10);
    for (let i = 0; i < NJ; i++) {
      const sl = seedSlots && seedSlots[i];
      const ray = sl ? jrays[(sl.di * 2 + sl.laneIdx) % jrays.length]
                     : jrays[(Math.random() * jrays.length) | 0];
      jpulses.push({ ray, si: i, t: Math.random(),
                     v: rnd(.18, .38), out: Math.random() < .5 });
    }

    // junction bursts on a loose grid, kept clear of the celestial one
    const cols = Math.max(2, Math.round(W / 480));
    const rows = Math.max(2, Math.round(H / 420));
    const nodes = [];
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const x = (col + rnd(.25, .75)) / cols * W;
      const y = (r + rnd(.25, .75)) / rows * H;
      if (Math.hypot(x - jx, y - jy) < 200) continue;
      nodes.push([x, y]);
      burst(c, x, y, rnd(70, 150), 7 + (Math.random() * 5 | 0));
    }
    // planets / roundabouts scattered between them
    const discs = Math.max(2, Math.round((W * H) / 350000));
    for (let i = 0; i < discs; i++) {
      const x = rnd(0, W), y = rnd(0, H), R = rnd(22, 55);
      if (Math.hypot(x - jx, y - jy) < 200) continue;
      if (Math.random() < .5) stippleDisk(c, x, y, R, R * 7);
      else stippleRing(c, x, y, R, R * 1.6);
    }
    // dotted routes between neighbouring bursts (the celestial junction is
    // linked separately, along its four approaches, just below)
    for (let i = 0; i < nodes.length; i++) {
      const [x1, y1] = nodes[i];
      const [x2, y2] = nodes[(i + 1) % nodes.length];
      arcs.push(route(c, x1, y1, x2, y2));
    }
    // extend ALL EIGHT lanes on into the dotted network: each lane's outer
    // tip continues as a dotted road to the nearest burst roughly ahead of
    // it (falling back to the closest burst overall), so every approach is
    // connected — not just the four cardinal ones — and no lane dead-ends.
    for (const ln of jrays) {
      const [tx0, ty0] = lanePoint(jx, jy, ln, Math.max(ln.start, ln.len - 6));
      const [tipx, tipy] = lanePoint(jx, jy, ln, ln.len);
      const dir = Math.atan2(tipy - ty0, tipx - tx0);   // true tangent at the tip
      let best = -1, bestScore = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        let da = Math.atan2(nodes[i][1] - jy, nodes[i][0] - jx) - dir;
        da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
        if (da > 1.3) continue;                // ~75° cone ahead of the lane
        const score = Math.hypot(nodes[i][0] - tipx, nodes[i][1] - tipy) + da * 140;
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) {                          // nothing ahead — take the closest
        for (let i = 0; i < nodes.length; i++) {
          const d = Math.hypot(nodes[i][0] - tipx, nodes[i][1] - tipy);
          if (d < bestScore) { bestScore = d; best = i; }
        }
      }
      // leave the junction smoothly along the lane's tangent, then curve in
      if (best >= 0)
        arcs.push(connector(c, tipx, tipy, dir, nodes[best][0], nodes[best][1]));
    }
    // traffic dust
    const dust = Math.round((W * H) / 9000);
    for (let i = 0; i < dust; i++)
      dot(c, rnd(0, W), rnd(0, H), rnd(.4, .8),
        Math.random() < .8 ? GOLD : PALE, rnd(.02, .07));
    // signal glints: mostly amber, the odd green, the rare red
    const nStars = Math.round((W * H) / 60000);
    for (let i = 0; i < nStars; i++) {
      const p = Math.random();
      stars.push({
        x: rnd(0, W), y: rnd(0, H), r: rnd(1.6, 3.2),
        rgb: p < .78 ? GOLD : p < .92 ? '95,174,126' : '224,86,74',
        ph: rnd(0, Math.PI * 2), sp: rnd(.5, 1.4),
      });
    }
    // phones animate too (fewer pulses); only reduced-motion gets a
    // single static frame
    const NP = CHEAP ? 5 : 10;
    for (let i = 0; i < NP; i++)
      pulses.push({ arc: arcs[(Math.random() * arcs.length) | 0], si: i,
                    t: Math.random(), v: rnd(.05, .1) });
    slotCache = null;
    // soft, out-of-focus copies of the static art: the resting page-2
    // background blends toward these as it dims, so the junction and city
    // recede like a real defocused backdrop instead of staying pin-sharp.
    // Skipped on phones (the blur pre-render + extra blits aren't worth it).
    layerB = layerJb = null;
    if (!CHEAP) { layerB = blurredCopy(layer, 2.2); layerJb = blurredCopy(layerJ, 3.6); }
    ready = true;
    if (REDUCED) staticDraw();
  }

  /* keep the hero's road channels clear of background art — fades out
     at full boost, where page 1 owns the screen and there is no hero.
     The 1.55 factor makes the erase reach full strength by the resting
     boost (~.3), so the channels stay clean behind the live junction
     even though the city now stays visibly lit on page 2. */
  function eraseRoads(c) {
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = Math.max(0, Math.min(1, (1 - boost) * 1.55));
    c.fillStyle = '#000';
    const cx = W * (W < 700 ? .68 : .66);
    const cy = H * (W < 700 ? .38 : .48);
    const R = W < 700 ? 48 : 72;
    c.fillRect(cx - R, 0, R * 2, H);
    c.fillRect(0, cy - R, W, R * 2);
    c.restore();
  }

  function staticDraw() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(layer, 0, 0, W, H);
    ctx.drawImage(layerJ, 0, 0, W, H);
    if (boost > .02) {
      ctx.globalAlpha = boost;
      for (let i = 0; i < 3; i++) {
        ctx.drawImage(layer, 0, 0, W, H);
        ctx.drawImage(layerJ, 0, 0, W, H);
      }
      ctx.globalAlpha = 1;
    }
    const ga = Math.min(.8, .18 * (1 + 2.2 * boost));
    for (const s of stars) glint(ctx, s.x, s.y, s.r, s.rgb, ga);
    eraseRoads(ctx);
  }

  /* restack a pre-rendered layer a few times to brighten it for page 1.
     `soft` (0→1) crossfades each pass toward the blurred copy, so the art
     defocuses as the scene dims into the resting background. */
  function stack(img, blurImg, dx, dy, extra, soft) {
    const hasBlur = blurImg && soft > .02;
    if (hasBlur) {
      ctx.globalAlpha = 1 - soft; ctx.drawImage(img, dx, dy, W, H);
      ctx.globalAlpha = soft;     ctx.drawImage(blurImg, dx, dy, W, H);
      ctx.globalAlpha = 1;
    } else {
      ctx.drawImage(img, dx, dy, W, H);
    }
    if (extra > .02) {
      for (let i = 0; i < 3; i++) {
        if (hasBlur) {
          ctx.globalAlpha = extra * (1 - soft); ctx.drawImage(img, dx, dy, W, H);
          ctx.globalAlpha = extra * soft;       ctx.drawImage(blurImg, dx, dy, W, H);
        } else {
          ctx.globalAlpha = extra; ctx.drawImage(img, dx, dy, W, H);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  let T = 0, last = performance.now();
  function render(dt) {
    T += dt;

    // the dive, driven by main.js's scrubbed timeline (globals, read live):
    //   zS  — how far the celestial junction is zoomed (1 → ~3.6)
    //   zA  — presence of that cinematic zoom (0 at rest, 1 mid-dive); it
    //         fades as the REAL junction crossfades in, so the dotted
    //         junction RESOLVES into roads instead of vanishing first
    const zS = Math.max(1, +window.__tfxZoomScale || 1);
    const zA = Math.max(0, Math.min(1, +window.__tfxZoomAlpha || 0));
    // monotonic dive progress (0 on page 1, 1 once dived in) — drives the
    // freeze → orange → flow-into-the-junction → become-cars choreography
    const dive = clamp(+window.__tfxDive || 0, 0, 1);
    // how defocused the resting art is: sharp at page-1 boost (1), fully
    // soft by the resting boost (~.3). The dive blurs the backdrop as you go.
    const soft = clamp((1 - boost) / .7, 0, 1);

    ctx.clearRect(0, 0, W, H);
    const off = ((window.scrollY * .15) % H + H) % H;   // slow parallax, wrapped

    // 1) the city (every other burst) — parallax-scrolled. It settles from
    //    page-1 brightness to its resting level AND defocuses (the blurred
    //    copy blends in), so the surroundings recede like a real backdrop.
    stack(layer, layerB, 0, -off, boost, soft);
    stack(layer, layerB, 0, H - off, boost, soft);

    // 2) a faint dotted junction always sits at its spot (scale 1) so the
    //    page-2 background keeps one too — blurred at rest so it blends in,
    //    sharp at page-1 boost where it's just another burst
    stack(layerJ, layerJb, 0, 0, boost, soft);

    // 3) the cinematic dive: the SAME junction, zoomed toward the camera and
    //    held SHARP/bright (the focus), drawn over the now-soft city — the
    //    "diving into the intersection" feel.
    if (zA > .01) {
      ctx.save();
      ctx.translate(jcx, jcy); ctx.scale(zS, zS); ctx.translate(-jcx, -jcy);
      ctx.globalAlpha = zA;
      for (let i = 0; i < (CHEAP ? 2 : 4); i++) ctx.drawImage(layerJ, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    for (const s of stars) {
      const y = ((s.y - off) % H + H) % H;
      const a = Math.min(.8,
        (.08 + .16 * (.5 + .5 * Math.sin(T * s.sp + s.ph))) * (1 + 1.8 * boost));
      glint(ctx, s.x, y, s.r, s.rgb, a);
    }

    // ── the dive choreography ──
    //   FREEZE:  the instant you start scrolling, the cars stop dead and turn
    //            bright orange (the paused traffic of "a city of signals")
    //   conv:    each orange dot flows in along the approaches and parks on a
    //            REAL junction queue-slot (window.__tfxHero.slots())
    //   HANDOFF: hero-sim then spawns the cars on those exact slots and the
    //            dots fade out — dot → car with no overlap, a clean morph
    const FREEZE = .012, HANDOFF = .90;
    const diving = dive > FREEZE;
    if (!diving) slotCache = null;
    const conv = smooth(clamp((dive - .12) / .76, 0, 1));           // road → slot
    const cFade = 1 - clamp((dive - (HANDOFF - .01)) / .08, 0, 1);  // dot → car

    // the live junction's queue-slots (screen coords), fetched once per dive —
    // the dots aim at these so they line up exactly with the cars the sim
    // spawns at HANDOFF (identical geometry: same centre, road width, lanes)
    if (diving && !slotCache && window.__tfxHero && window.__tfxHero.slots) {
      try { slotCache = window.__tfxHero.slots(); } catch (e) { slotCache = null; }
    }
    const slots = slotCache;

    // scale a junction-frame point the way the zoomed junction is scaled, so
    // dots ride the approaches inward as the camera dives (→ identity at rest,
    // and at HANDOFF where the zoom has receded, so slots land pixel-true)
    const pScale = 1 + (zS - 1) * zA;
    const scaledPt = (x, y) => [jcx + (x - jcx) * pScale, jcy + (y - jcy) * pScale];
    const scaledLane = (ln, s) => { const [lx, ly] = lanePoint(jcx, jcy, ln, s); return scaledPt(lx, ly); };
    const slotTarget = i => { const sl = slots[i % slots.length]; return scaledPt(sl.x, sl.y); };

    // cars on the wider city routes — ambient ONLY. They are not this
    // junction's vehicles, so they never turn orange or fly in: they keep
    // roaming and simply fade out with the city as it defocuses, leaving the
    // junction's own dots as the focus of the morph.
    const cityVis = diving ? 1 - clamp((dive - .05) / .35, 0, 1) : 1;
    for (const p of pulses) {
      p.t += p.v * dt;
      if (p.t > 1) { p.t = 0; p.arc = arcs[(Math.random() * arcs.length) | 0]; }
      if (cityVis <= .01) continue;
      const u = 1 - p.t, q = p.t, A = p.arc;
      const x = u * u * A.x1 + 2 * u * q * A.mx + q * q * A.x2;
      const y = (((u * u * A.y1 + 2 * u * q * A.my + q * q * A.y2) - off) % H + H) % H;
      ctx.fillStyle = 'rgba(' + GOLD + ',' + ((.5 + .35 * boost) * cityVis) + ')';
      ctx.beginPath(); ctx.arc(x, y, (1.6 + .9 * boost) * DOTR, 0, 7); ctx.fill();
    }

    // clear the road channels of background art BEFORE drawing the junction's
    // own vehicles — those dots sit IN the channels as they flow into the
    // intersection, so erasing first means they survive (and hand off to the
    // real cars) instead of being wiped the moment they arrive.
    eraseRoads(ctx);

    // the junction's own approach traffic — these dots ARE the vehicles
    for (const p of jpulses) {
      if (!diving) {
        p.t += p.v * dt;
        if (p.t > 1) { p.t = 0; p.out = Math.random() < .5; }   // keep its lane
      }
      const r = p.ray, span = r.len - r.start;
      const s = (p.out ? p.t : 1 - p.t) * span + r.start;
      let x, y, col, vis;
      if (!diving) {
        [x, y] = scaledLane(r, s); col = GOLD;
        const ease = Math.min(1, 3 * (1 - Math.abs(2 * p.t - 1)));   // fade at ends
        vis = ease * Math.max(.32 + .42 * boost, .55 * zA);
      } else {
        col = ORANGE; vis = .9 * cFade;
        const [bxl, byl] = scaledLane(r, s);
        if (slots) { const [tx, ty] = slotTarget(p.si); x = mix(bxl, tx, conv); y = mix(byl, ty, conv); }
        else [x, y] = scaledLane(r, mix(r.len, r.start, conv));
      }
      if (vis <= .01) continue;
      ctx.fillStyle = 'rgba(' + col + ',' + vis + ')';
      ctx.beginPath();
      ctx.arc(x, y, (1.5 + .8 * boost) * (1 + .5 * zA) * (diving ? 1 + conv : 1) * DOTR, 0, 7);
      ctx.fill();
    }
  }
  function frame(t) {
    const dt = Math.min((t - last) / 1000, .05); last = t;
    if (ready) render(dt);
    requestAnimationFrame(frame);
  }

  build();
  // Rebuilding scatters thousands of dots — never do it for the phone
  // URL bar's scroll-resize, only for real size changes (rotation,
  // window resize). Debounced so a drag-resize rebuilds once, not 60×/s.
  let lastW = 0, lastH = 0, rsT;
  function noteSize() { lastW = cv.clientWidth; lastH = cv.clientHeight; }
  noteSize();
  addEventListener('resize', () => {
    clearTimeout(rsT);
    rsT = setTimeout(() => {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (w === lastW && Math.abs(h - lastH) < 140) return;
      noteSize(); build();
    }, 200);
  });
  if (!REDUCED) requestAnimationFrame(frame);
})();
