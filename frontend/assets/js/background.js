"use strict";
/* ════════════════════════════════════════════════════════════
   TRAFFIX — background.js · ambient constellation city
   Stipple-art night sky with traffic nuance — dotted junction
   bursts with roads radiating out, stippled roundabout planets,
   dotted route arcs with cars (pulses) travelling them, and
   signal glints in amber / green / red.
   The static art is pre-rendered once to an offscreen layer, so
   a frame costs two drawImage calls plus a handful of sprites.
   Low-power devices (phones — even ones showing the desktop
   layout) get a single static frame: no animation loop at all.
   ════════════════════════════════════════════════════════════ */
(function bgConstellation() {
  const cv = document.getElementById('bg-dots');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // CHEAP = real phone viewport OR a touch device in "desktop site" mode
  const CHEAP = matchMedia('(max-width: 700px)').matches || window.TFX_LOW_POWER === true;
  const DPR = Math.min(devicePixelRatio || 1, CHEAP ? 1.5 : 2);
  const GOLD = '217,161,59', PALE = '232,205,130';
  let W = 0, H = 0;
  let layer = null;          // pre-rendered stipple art
  let arcs = [], stars = [], pulses = [];

  const rnd = (a, b) => a + Math.random() * (b - a);

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

  /* 4-point glint — a far-away signal light */
  function glint(c, x, y, r, rgb, a) {
    c.strokeStyle = 'rgba(' + rgb + ',' + a + ')';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x - r, y); c.lineTo(x + r, y);
    c.moveTo(x, y - r); c.lineTo(x, y + r);
    c.stroke();
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

    // junction bursts on a loose grid
    const cols = Math.max(2, Math.round(W / 480));
    const rows = Math.max(2, Math.round(H / 420));
    const nodes = [];
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const x = (col + rnd(.25, .75)) / cols * W;
      const y = (r + rnd(.25, .75)) / rows * H;
      nodes.push([x, y]);
      burst(c, x, y, rnd(70, 150), 7 + (Math.random() * 5 | 0));
    }
    // planets / roundabouts scattered between them
    const discs = Math.max(2, Math.round((W * H) / 350000));
    for (let i = 0; i < discs; i++) {
      const x = rnd(0, W), y = rnd(0, H), R = rnd(22, 55);
      if (Math.random() < .5) stippleDisk(c, x, y, R, R * 7);
      else stippleRing(c, x, y, R, R * 1.6);
    }
    // dotted routes between neighbouring junctions
    for (let i = 0; i < nodes.length; i++) {
      const [x1, y1] = nodes[i];
      const [x2, y2] = nodes[(i + 1) % nodes.length];
      arcs.push(route(c, x1, y1, x2, y2));
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
    if (!CHEAP) for (let i = 0; i < 7; i++)
      pulses.push({ arc: arcs[(Math.random() * arcs.length) | 0],
                    t: Math.random(), v: rnd(.05, .1) });
    ready = true;
    if (CHEAP || REDUCED) staticDraw();   // single frame, no loop
  }

  /* keep the hero's road channels clear of background art */
  function eraseRoads(c) {
    c.save();
    c.globalCompositeOperation = 'destination-out';
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
    for (const s of stars) glint(ctx, s.x, s.y, s.r, s.rgb, .18);
    eraseRoads(ctx);
  }

  let T = 0, last = performance.now();
  function frame(t) {
    const dt = Math.min((t - last) / 1000, .05); last = t; T += dt;
    if (!ready) { requestAnimationFrame(frame); return; }
    ctx.clearRect(0, 0, W, H);
    const off = ((window.scrollY * .15) % H + H) % H;   // slow parallax, wrapped
    ctx.drawImage(layer, 0, -off, W, H);
    ctx.drawImage(layer, 0, H - off, W, H);
    for (const s of stars) {
      const y = ((s.y - off) % H + H) % H;
      const a = .08 + .16 * (.5 + .5 * Math.sin(T * s.sp + s.ph));
      glint(ctx, s.x, y, s.r, s.rgb, a);
    }
    for (const p of pulses) {                            // cars on the routes
      p.t += p.v * dt;
      if (p.t > 1) { p.t = 0; p.arc = arcs[(Math.random() * arcs.length) | 0]; }
      const u = 1 - p.t, q = p.t, A = p.arc;
      const x = u * u * A.x1 + 2 * u * q * A.mx + q * q * A.x2;
      const y = (((u * u * A.y1 + 2 * u * q * A.my + q * q * A.y2) - off) % H + H) % H;
      ctx.fillStyle = 'rgba(217,161,59,.5)';
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill();
    }
    eraseRoads(ctx);
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
  if (!(CHEAP || REDUCED)) requestAnimationFrame(frame);
})();
