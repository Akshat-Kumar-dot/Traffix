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

    // Hero Section Timeline (scroll out only)
    gsap.timeline({
      scrollTrigger: {
        trigger: "header",
        start: "top top",
        end: "bottom top",
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
