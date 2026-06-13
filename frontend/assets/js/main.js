"use strict";
/* ════════════════════════════════════════════════════════════
   TRAFFIX — main.js
   Page behaviour shared by every device: nav state, mobile menu,
   scroll reveals, stat counters, chart bars, scrollspy, the demo
   walkthrough and the GSAP section transitions.
   The hero junction lives in hero-sim.js; the constellation
   background lives in background.js.
   ════════════════════════════════════════════════════════════ */
(() => {

  /* ── nav state ── */
  const nav = document.getElementById('nav');
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 24), { passive: true });

  /* ── mobile menu ── */
  const burger = document.getElementById('nav-burger');
  if (burger) {
    const navLinks = document.getElementById('nav-links');
    const setMenu = open => {
      nav.classList.toggle('menu-open', open);
      navLinks.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open);
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    burger.addEventListener('click', () => setMenu(!nav.classList.contains('menu-open')));
    document.querySelectorAll('.nav-links a').forEach(a =>
      a.addEventListener('click', () => setMenu(false)));
  }

  /* ── scroll reveal ── */
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const useGsap = !!window.gsap && !REDUCED;
  if (useGsap) {
    document.body.classList.add('gsap-active');
  } else {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: .18, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.rv').forEach(el => io.observe(el));
  }

  /* ── stat counters ── */
  const cio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    cio.unobserve(e.target);
    const el = e.target, to = +el.dataset.to, t0 = performance.now();
    if (to === 0) return;
    (function tick(t) {
      const p = Math.min((t - t0) / 1400, 1);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }), { threshold: .6 });
  document.querySelectorAll('.count').forEach(el => cio.observe(el));

  /* ── chart bars grow on reveal ── */
  const bio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    bio.unobserve(e.target);
    e.target.querySelectorAll('.cfill').forEach(f => { f.style.width = f.dataset.w + '%'; });
  }), { threshold: .4 });
  document.querySelectorAll('.rchart').forEach(el => bio.observe(el));

  /* ── cursor-tracking highlight on cards — mouse only; touch devices
     never hover, so don't even bind the listeners there ── */
  if (!matchMedia('(pointer: coarse)').matches) {
    document.querySelectorAll('.stat, .feat').forEach(card => {
      card.addEventListener('mousemove', e => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* ── hero parallax: content drifts and fades as you scroll past ── */
  if (!useGsap && !REDUCED) {
    const hc = document.querySelector('.hero-content');
    const hh = document.querySelector('.sim-hud');
    addEventListener('scroll', () => {
      const y = scrollY;
      if (y > innerHeight) return;
      hc.style.transform = 'translateY(' + (y * .22) + 'px)';
      hc.style.opacity = Math.max(0, 1 - y / (innerHeight * .8));
      if (hh && y > 0) {
        hh.style.animation = 'none';  // entrance animation's fill would override inline opacity
        hh.style.opacity = Math.max(0, 1 - y / (innerHeight * .5));
      }
    }, { passive: true });
  }

  /* ── scrollspy: amber on the section you're in ──
     coalesced to one update per frame: scroll events can fire faster
     than rAF on phones, and each update reads four layout rects */
  (function spy() {
    const links = [...document.querySelectorAll('.nav-links a')];
    const secs = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    let queued = false;
    function update() {
      queued = false;
      let cur = null;
      for (const s of secs) if (s.getBoundingClientRect().top <= innerHeight * .4) cur = s;
      links.forEach(a => a.classList.toggle('active', cur && a.getAttribute('href') === '#' + cur.id));
    }
    addEventListener('scroll', () => {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  })();

  /* ── demo walkthrough: 1 set demand → 2 run → 3 compare ── */
  (function tour() {
    const root = document.getElementById('tour');
    if (!root) return;
    const cur = document.getElementById('t-cursor');
    const steps = [...root.querySelectorAll('.ts')];
    const sliders = [...root.querySelectorAll('.t-slider i')];
    const outs = [...root.querySelectorAll('.t-row output')];
    const preset = document.getElementById('tp-target');
    const play = document.getElementById('t-play');
    const time = document.getElementById('t-time');
    // per-movement targets: North L/S/R then East L/S/R (matches the app's cards)
    const WID = [10, 78, 9, 7, 36, 7], VAL = [55, 600, 50, 30, 260, 30];
    let timers = [], clock = null, sec = 0;
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    function place(el) {
      const r = el.getBoundingClientRect(), b = root.getBoundingClientRect();
      // rects are post-transform; the cursor lives in pre-transform
      // coordinates, so divide the scale back out (1 when not scaled)
      const s = (b.width / root.offsetWidth) || 1;
      cur.style.left = ((r.left - b.left + r.width / 2) / s) + 'px';
      cur.style.top = ((r.top - b.top + r.height / 2) / s) + 'px';
    }
    function click() { cur.classList.add('click'); setTimeout(() => cur.classList.remove('click'), 500); }
    function count(el, to, dur, suffix = '', dec = 0) {
      if (typeof el === 'string') el = document.getElementById(el);
      const t0 = performance.now();
      (function f(t) {
        const p = Math.min(1, (t - t0) / dur);
        el.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(dec) + suffix;
        if (p < 1) requestAnimationFrame(f);
      })(t0);
    }
    function setStep(n) {
      steps.forEach((s, i) => s.classList.toggle('act', i === n));
      root.dataset.step = n + 1;
    }
    function cycle() {
      timers.forEach(clearTimeout); timers = [];
      clearInterval(clock); sec = 0; time.textContent = '0 / 1000 s';
      root.classList.remove('playing', 'analytics');
      preset.classList.remove('on'); play.classList.remove('on');
      sliders.forEach(s => s.style.width = '14%');
      outs.forEach(o => o.textContent = '100 v/h');
      document.getElementById('t-cov').textContent = '0%';
      for (const id of ['tm-fw', 'tm-fv', 'tm-ft', 'tm-fq', 'tm-fm', 'tm-fn',
        'tm-rw', 'tm-rv', 'tm-rt', 'tm-rq', 'tm-rm', 'tm-rn'])
        document.getElementById(id).textContent = '—';
      setStep(0);
      at(300, () => place(preset));
      at(1300, () => {
        click(); preset.classList.add('on');
        sliders.forEach((s, i) => s.style.width = WID[i] + '%');
        outs.forEach((o, i) => count(o, VAL[i], 900, ' v/h'));
      });
      at(3600, () => { setStep(1); place(play); });
      at(4600, () => {
        click(); play.classList.add('on'); root.classList.add('playing');
        count('t-cov', 96, 3600, '%');
        clock = setInterval(() => { sec += 25; time.textContent = sec + ' / 1000 s'; }, 320);
      });
      at(8200, () => { setStep(2); place(root.querySelector('.t-delta td:last-child')); });
      at(8700, () => {
        root.classList.add('analytics');
        count('tm-fw', 2.3, 900, 's', 1); count('tm-fv', 16.4, 900, 's', 1);
        count('tm-ft', 8, 900); count('tm-fq', 35, 900);
        count('tm-fm', 2, 900); count('tm-fn', 6, 900);
        count('tm-rw', 1.3, 900, 's', 1); count('tm-rv', 16.1, 900, 's', 1);
        count('tm-rt', 11, 900); count('tm-rq', 21, 900);
        count('tm-rm', 2, 900); count('tm-rn', 3, 900);
      });
      at(13800, cycle);
    }
    const tio = new IntersectionObserver(es => {
      if (es[0].isIntersecting) { cycle(); tio.unobserve(root); }
    }, { threshold: .35 });
    tio.observe(root);
  })();

  /* ── phone: the tour is the desktop UI scaled down to fit, like a
     video — same layout as the real app instead of a restacked one.
     transform: scale doesn't change layout height, so the leftover
     space is reclaimed with a negative bottom margin. ── */
  (function fitTour() {
    const tour = document.getElementById('tour');
    if (!tour) return;
    const DESIGN = 780;                  // px width the tour is laid out at
    function fit() {
      if (innerWidth > 860) {
        tour.style.width = tour.style.transform = '';
        tour.style.transformOrigin = tour.style.marginBottom = '';
        return;
      }
      const host = tour.parentElement;
      const cs = getComputedStyle(host);
      const avail = host.clientWidth -
        parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const s = avail / DESIGN;
      tour.style.width = DESIGN + 'px';
      tour.style.transformOrigin = 'top left';
      tour.style.transform = 'scale(' + s + ')';
      tour.style.marginBottom = '';
      tour.style.marginBottom = (-tour.offsetHeight * (1 - s)) + 'px';
    }
    fit();
    // debounced: phone URL bars fire resize on every scroll, and fit()
    // forces a layout each time it runs
    let t;
    addEventListener('resize', () => { clearTimeout(t); t = setTimeout(fit, 120); });
  })();

  /* ── cinematic GSAP ScrollTrigger transitions ── */
  if (useGsap) {
    gsap.registerPlugin(ScrollTrigger);

    /* ── the dive: page 1 is the whole city at night, pinned over the
       hidden hero. Scrolling zooms the celestial junction toward the
       camera while the rest of the city settles into the background;
       the dotted junction then RESOLVES into the real one in the same
       spot (its dots crossfade into roads) — a morph, not a cut.

       The zoom is rendered INSIDE the canvas (background.js reads the
       globals below), not via a CSS transform on the canvas element —
       so the constellation never blanks out and there's no scale-pop
       when it returns as the faint page-2 background. ── */
    ScrollTrigger.config({ ignoreMobileResize: true });
    const hdr = document.getElementById('hero');
    const overlay = document.getElementById('dive-overlay');
    if (hdr && overlay) {
      document.body.classList.add('has-dive');
      const LOWPOW = window.TFX_LOW_POWER === true;
      // the city never fully goes out: page 2 keeps it visibly lit behind
      // the live junction (background.js's erase still clears the roads)
      const REST = .3;

      // page 1 opens at full brightness, no zoom — background.js loads
      // after this script and reads these globals as its start values
      window.__tfxBoost = 1;
      window.__tfxZoomScale = 1;
      window.__tfxZoomAlpha = 0;
      window.__tfxDive = 0;     // monotonic dive progress, read live by background.js
      const d = { boost: 1, zScale: 1, zAlpha: 0 };
      const push = () => {
        window.__tfxBoost = d.boost;
        window.__tfxZoomScale = d.zScale;
        window.__tfxZoomAlpha = d.zAlpha;
        if (window.__tfxBg) window.__tfxBg.setBoost(d.boost);
      };

      gsap.set('.hero-stage', { opacity: 0 });   // hero hidden until the reveal
      const tl = gsap.timeline({
        defaults: { onUpdate: push },
        scrollTrigger: {
          // a generous pin (≈1.5 screens) + heavy scrub smoothing makes the
          // dive read slowly and glide, instead of tracking the wheel 1:1
          trigger: hdr, start: 'top top', end: LOWPOW ? '+=130%' : '+=150%',
          scrub: 1.2, pin: true, anticipatePin: 1,
          // release the hero's CSS entrance animations at the reveal point —
          // onUpdate (not a timeline call) so a mid-page reload still fires
          // it. Hysteresis keeps the boundary from thrashing on reverse.
          onUpdate(self) {
            window.__tfxDive = self.progress;   // background.js reads this live
            if (self.progress > .55) hdr.classList.add('hero-in');
            else if (self.progress < .35) hdr.classList.remove('hero-in');
          }
        }
      });
      tl
        // title lingers, then lifts away
        .fromTo(overlay, { opacity: 1 }, { opacity: 0, duration: .32, ease: 'power1.in' }, .04)
        // the city recedes to its resting brightness across the whole dive
        .to(d, { boost: REST, duration: 1, ease: 'power1.inOut' }, 0)
        // the junction zooms steadily toward the camera (keeps growing —
        // never shrinks on screen; on reverse it eases back out into the city)
        .to(d, { zScale: LOWPOW ? 3 : 3.6, duration: .92, ease: 'power2.inOut' }, 0)
        // its cinematic presence rises fast, holds, then fades as the real
        // junction takes over — the dots dissolve into roads
        .to(d, { zAlpha: 1, duration: .18, ease: 'power1.out' }, 0)
        .to(d, { zAlpha: 0, duration: .34, ease: 'power1.inOut' }, .56)
        // the real junction crossfades in over the fading dots (the morph)
        .to('.hero-stage', { opacity: 1, duration: .34, ease: 'sine.inOut' }, .5);
    }

    /* ── dev capture harness — the preview window throttles rAF to 0, so
       canvas frames never advance on their own. step() advances both
       sims synchronously; capture() composites #bg-dots + #sim and POSTs
       a JPEG to .claude/capture-server.py (:8123) so frames are viewable. ── */
    window.__tfx = {
      step(sec) {
        const dt = 1 / 60; let n = Math.max(1, Math.round((sec || 1 / 60) / dt));
        while (n--) {
          if (window.__tfxBg) window.__tfxBg.tick(dt);
          if (window.__tfxHero) window.__tfxHero.tick(dt);
        }
      },
      capture(width, gain) {
        width = width || 900; gain = gain || 1;
        const bg = document.getElementById('bg-dots');
        const sim = document.getElementById('sim');
        const w = width, h = Math.round(w * innerHeight / innerWidth);
        const o = document.createElement('canvas'); o.width = w; o.height = h;
        const g = o.getContext('2d');
        g.fillStyle = '#0b0d0e'; g.fillRect(0, 0, w, h);
        if (bg) {
          g.drawImage(bg, 0, 0, w, h);
          // inspection gain: re-add the (dim) art additively so faint dots
          // are legible in the JPEG — does not reflect on-screen brightness
          if (gain > 1) { g.globalCompositeOperation = 'lighter';
            for (let i = 1; i < gain; i++) g.drawImage(bg, 0, 0, w, h);
            g.globalCompositeOperation = 'source-over'; }
        }
        const stage = document.querySelector('.hero-stage');
        const sop = stage ? (parseFloat(getComputedStyle(stage).opacity) || 0) : 0;
        if (sop > 0 && sim) { g.globalAlpha = sop; g.drawImage(sim, 0, 0, w, h); g.globalAlpha = 1; }
        const data = o.toDataURL('image/jpeg', .72).split(',')[1];
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'http://127.0.0.1:8123/save', false);
        try { xhr.send(data); } catch (e) { return 'POST failed: ' + e; }
        const ov = document.getElementById('dive-overlay');
        const ovop = ov ? (parseFloat(getComputedStyle(ov).opacity) || 0) : 0;
        return 'saved ' + w + 'x' + h + ' · stage=' + sop.toFixed(2) + ' overlay=' + ovop.toFixed(2)
          + ' zS=' + (+window.__tfxZoomScale).toFixed(2) + ' zA=' + (+window.__tfxZoomAlpha).toFixed(2)
          + ' boost=' + (+window.__tfxBoost).toFixed(2);
      }
    };

    // Hero scroll-out — keyed to #results' approach, not the header's own
    // position: the header is pinned, so its box no longer describes the exit
    gsap.timeline({
      scrollTrigger: {
        trigger: "#results",
        start: "top bottom",
        end: "top top",
        scrub: 0.5,
      }
    })
      .to(".hero-content", { y: -80, opacity: 0, ease: "power1.in", duration: 1 })
      .to("#sim", { y: -50, opacity: 0.15, ease: "power1.in", duration: 1 }, 0)
      .to(".sim-hud", { y: -60, opacity: 0, ease: "power1.in", duration: 1 }, 0);

    // Sections: entrance-only reveals — once in, content stays fully
    // opaque for as long as the reader is on it
    const secIO = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      secIO.unobserve(en.target);
      const reveals = en.target.querySelectorAll('.rv');
      gsap.fromTo(reveals.length ? reveals : (en.target.querySelector('.wrap') || en.target),
        { y: 48, opacity: 0 },
        { y: 0, opacity: 1, ease: "power2.out", stagger: 0.12, duration: 1, overwrite: true });
    }), { threshold: .12, rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll("#results, #how, #demo, #built, #cta")
      .forEach(el => secIO.observe(el));
  }

})();
