/* TrafficDeck frontend — renders real SUMO geometry + live frames. */
"use strict";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let NET = null, INFO = null;
let sessionId = null, ws = null;
let playing = false, speed = 1, pollTimer = null;
let prevSnap = null, curSnap = null, snapTime = 0, snapGap = 1000;

const API_BASE = (() => {
  const host = location.hostname;
  const port = location.port;
  if ((host === "127.0.0.1" || host === "localhost") && port === "5500") {
    return `http://${host}:8000`;
  }
  return "";
})();

/* ── view transform (shared pan/zoom across both canvases) ───────────────── */
const view = { x: 0, y: 0, k: 3 };
function fitView() {
  if (!NET) return;
  const [x0, y0, x1, y1] = NET.bounds;
  const c = $("#vp-fixed canvas");
  const kx = c.clientWidth / (x1 - x0 + 40), ky = c.clientHeight / (y1 - y0 + 40);
  view.k = Math.min(kx, ky);
  view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
}
function w2s(c, x, y) {           // world -> screen (SUMO y up, canvas y down)
  return [c.width / 2 + (x - view.x) * view.k * DPR,
          c.height / 2 - (y - view.y) * view.k * DPR];
}
const DPR = Math.min(window.devicePixelRatio || 1, 2);

/* ── boot ─────────────────────────────────────────────────────────────────── */
async function boot() {
  INFO = await (await fetch(`${API_BASE}/api/info`)).json();
  NET = await (await fetch(`${API_BASE}/api/network`)).json();
  $("#loc-name").textContent = "Live comparison";
  $("#loc-sub").textContent = "fixed-time vs RL · same traffic, same seed";
  const sel = $("#in-qtable");
  for (const s of INFO.qtable_seeds_found) {
    const o = document.createElement("option");
    o.value = s; o.textContent = `seed ${s} pickle`;
    sel.appendChild(o);
  }
  if (INFO.qtable_seeds_found.length) sel.value = INFO.qtable_seeds_found[0];
  buildDemandGrid();
  await loadDemandFiles();
  // default to the UI sliders — they always match the loaded net;
  // demand/route files stay available in the dropdown for users who add them
  $("#demand-file-info").textContent = "Using custom UI demand sliders.";
  buildSigWidgets();
  sizeCanvases(); fitView();
  requestAnimationFrame(renderLoop);
  document.body.classList.add("rail-open");
}

/* ── demand builder ───────────────────────────────────────────────────────── */
const PRESETS = {
  hhhh:    { A:{L:55,S:600,R:50}, B:{L:30,S:260,R:30}, C:{L:60,S:580,R:50}, D:{L:25,S:260,R:25} },
  offpeak: { A:{L:15,S:160,R:15}, B:{L:10,S:90,R:10},  C:{L:15,S:150,R:15}, D:{L:10,S:90,R:10} },
  peak:    { A:{L:70,S:760,R:60}, B:{L:45,S:420,R:45}, C:{L:70,S:740,R:60}, D:{L:40,S:420,R:40} },
  adom:    { A:{L:80,S:900,R:70}, B:{L:10,S:90,R:10},  C:{L:15,S:160,R:15}, D:{L:10,S:90,R:10} },
  bdom:    { A:{L:10,S:100,R:10}, B:{L:60,S:640,R:60}, C:{L:10,S:100,R:10}, D:{L:25,S:240,R:25} },
};
const TURNS = [["L","Left"],["S","Straight"],["R","Right"]];
/* friendly compass names for the approach ids used by the backend */
const AP_NAME = { A: "North", B: "East", C: "South", D: "West" };
const apName = ap => AP_NAME[ap] ?? `Approach ${ap}`;
function buildDemandGrid() {
  const grid = $("#demand-grid");
  grid.innerHTML = "";
  for (const ap of Object.keys(INFO.approaches)) {
    const card = document.createElement("div");
    card.className = "dg-app";
    card.innerHTML = `<header><b>${apName(ap)} approach</b><span>${INFO.approaches[ap]} lanes</span></header>` +
      TURNS.map(([t, name]) =>
        `<div class="dg-row"><label>${name}</label>
         <input type="range" min="0" max="1000" step="5" value="${PRESETS.hhhh[ap]?.[t] ?? 100}" data-ap="${ap}" data-t="${t}">
         <output>${PRESETS.hhhh[ap]?.[t] ?? 100} v/h</output></div>`).join("");
    grid.appendChild(card);
  }
  grid.addEventListener("input", e => {
    if (e.target.matches("input[type=range]"))
      e.target.nextElementSibling.textContent = e.target.value + " v/h";
  });
  $("#presets").addEventListener("click", e => {
    const p = PRESETS[e.target.dataset.p]; if (!p) return;
    $$("#demand-grid input").forEach(inp => {
      const v = p[inp.dataset.ap]?.[inp.dataset.t] ?? 0;
      inp.value = v; inp.nextElementSibling.textContent = v + " v/h";
    });
    $("#in-demand-file").value = "";
    $("#demand-file-info").textContent = "";
  });
  $("#in-demand-file").addEventListener("change", async e => {
    const name = e.target.value;
    if (!name) {
      $("#demand-file-info").textContent = "Using custom UI demand sliders.";
      return;
    }
    await loadDemandFile(name);
  });
}

async function loadDemandFiles() {
  const sel = $("#in-demand-file");
  sel.innerHTML = `<option value="">Custom UI demand</option>`;
  try {
    const files = await (await fetch(`${API_BASE}/api/demands`)).json();
    for (const name of files) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
  } catch (err) {
    console.warn("Could not load demand files", err);
  }
}

async function loadDemandFile(name) {
  try {
    const res = await fetch(`${API_BASE}/api/demands/${encodeURIComponent(name)}`);
    const data = await res.json();
    if (data.route_file) {
      $("#demand-file-info").textContent = `Using route file: ${name} (UI sliders are ignored for route generation)`;
    } else {
      setDemandValues(data);
      $("#demand-file-info").textContent = `Loaded demand file: ${name}`;
    }
  } catch (err) {
    console.error(err);
    $("#demand-file-info").textContent = `Failed to load demand file: ${name}`;
  }
}

function setDemandValues(demand) {
  $$("#demand-grid input").forEach(inp => {
    const v = +(demand[inp.dataset.ap]?.[inp.dataset.t] ?? inp.value);
    inp.value = v;
    inp.nextElementSibling.textContent = v + " v/h";
  });
}
function readDemand() {
  const d = {};
  $$("#demand-grid input").forEach(inp => {
    (d[inp.dataset.ap] ??= {})[inp.dataset.t] = +inp.value;
  });
  return d;
}

/* ── session lifecycle ────────────────────────────────────────────────────── */
async function launch() {
  const btn = $("#btn-launch");
  btn.disabled = true; $("#launch-status").textContent = "starting twin SUMO instances…";
  stopPolling(); if (ws) ws.close();
  if (sessionId) fetch(`${API_BASE}/api/session/${sessionId}`, { method: "DELETE" });
  prevSnap = curSnap = null;
  try {
    const demandFile = $("#in-demand-file").value || null;
    const res = await fetch(`${API_BASE}/api/session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        demand: readDemand(),
        demand_file: demandFile,
        seed: +$("#in-seed").value || 12356,
        episode: +$("#in-episode").value || 1000,
        qtable_seed: $("#in-qtable").value,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.status);
    const j = await res.json();
    sessionId = j.id;
    $("#launch-status").textContent = "session " + j.id + " live ✓";
    openWS();
    document.body.classList.remove("rail-open");
    setPlaying(true);
  } catch (err) {
    $("#launch-status").textContent = "✗ " + err.message;
    $("#conn-dot")?.classList.replace("live", "err");
  }
  btn.disabled = false;
}
function openWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wsHost = API_BASE ? API_BASE.replace(/^http/, "ws") : `${proto}://${location.host}`;
  ws = new WebSocket(`${wsHost}/ws/${sessionId}`);
  ws.onopen = () => { $("#conn-dot")?.classList.add("live"); startPolling(); };
  ws.onclose = () => { $("#conn-dot")?.classList.remove("live"); stopPolling(); };
  ws.onmessage = ev => {
    prevSnap = curSnap;
    curSnap = JSON.parse(ev.data);
    const now = performance.now();
    snapGap = Math.min(Math.max(now - snapTime, 60), 2000);
    snapTime = now;
    onSnapshot(curSnap);
  };
}
function startPolling() {
  stopPolling();
  const tick = () => {
    if (!ws || ws.readyState !== 1) return;
    const n = playing && !(curSnap && curSnap.done) ? Math.max(1, Math.round(speed / 5)) : 0;
    ws.send(JSON.stringify({ n }));
  };
  pollTimer = setInterval(tick, Math.max(60, 1000 * Math.max(1, Math.round(speed / 5)) / speed));
  tick();
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer), pollTimer = null; }
function setPlaying(p) {
  playing = p;
  const btn = $("#btn-play");
  btn.textContent = p ? "❚❚" : "▶";
  btn.classList.toggle("playing", p);
  if (sessionId) startPolling();
}

/* ── snapshot -> HUD ──────────────────────────────────────────────────────── */
const fmt = (v, d = 1) => (+v).toFixed(d);
function onSnapshot(s) {
  $("#chip-time").textContent = `${s.t} / ${s.episode} s`;
  if (s.q_coverage != null) {
    $("#chip-cov").style.display = "";
    $("#chip-cov").textContent = `Q coverage ${(s.q_coverage * 100).toFixed(0)}%`;
  }
  const rows = { fixed: $(".row-fixed"), rl: $(".row-rl") };
  const m = { fixed: s.fixed.metrics, rl: s.rl.metrics };
  for (const side of ["fixed", "rl"]) {
    const t = rows[side].children, mm = m[side];
    t[1].textContent = fmt(mm.avg_wait) + "s";
    t[2].textContent = fmt(mm.avg_travel) + "s";
    t[3].textContent = mm.throughput;
    t[4].textContent = mm.total_queue;
    t[5].textContent = mm.max_queue;
    t[6].textContent = mm.now_waiting;
  }
  const dRow = $(".row-delta").children;
  const deltas = [
    [m.fixed.avg_wait - m.rl.avg_wait, "s", true],
    [m.fixed.avg_travel - m.rl.avg_travel, "s", true],
    [m.rl.throughput - m.fixed.throughput, "", true],
    [m.fixed.total_queue - m.rl.total_queue, "", true],
    [m.fixed.max_queue - m.rl.max_queue, "", true],
    [m.fixed.now_waiting - m.rl.now_waiting, "", true],
  ];
  deltas.forEach(([v, unit], i) => {
    const cell = dRow[i + 1];
    cell.textContent = (v >= 0 ? "+" : "") + fmt(v, unit ? 1 : 0) + unit;
    cell.className = v > 0 ? "good" : v < 0 ? "bad" : "";
  });
  for (const side of ["fixed", "rl"]) {
    $(`.phase-chip[data-side=${side}]`).textContent =
      `phase ${s[side].phase} · ${fmt(s[side].phase_t, 0)} s` +
      (side === "rl" && s.rl.action != null ? ` · a=${s.rl.action}` : "");
    updateSigWidget(side, s[side].lights, s[side].queues);
  }
  drawChart($("#chart-queue"), s.series, "queue");
  drawChart($("#chart-wait"), s.series, "wait");
  if (s.done && playing) setPlaying(false);
}

/* ── per-approach signal widgets ──────────────────────────────────────────── */
const ARROW = { L: "◄", S: "▲", R: "►" };
function buildSigWidgets() {
  for (const side of ["fixed", "rl"]) {
    const stack = $(`.sig-stack[data-side=${side}]`);
    stack.innerHTML = "";
    const byAp = {};
    for (const sig of NET.signals) (byAp[sig.approach ?? "?"] ??= []).push(sig);
    for (const ap of Object.keys(byAp).sort()) {
      const card = document.createElement("div");
      card.className = "sig-card";
      card.innerHTML = `<header><b>${apName(ap).toUpperCase()}</b><span data-q="${ap}">q 0</span></header>
        <div class="leds">` + byAp[ap].map(s =>
          `<div class="led" data-idx="${s.index}" title="link ${s.index} → ${s.out}">${ARROW[s.arrow]}</div>`
        ).join("") + `</div>`;
      stack.appendChild(card);
    }
  }
}
function updateSigWidget(side, lights, queues) {
  const stack = $(`.sig-stack[data-side=${side}]`);
  stack.querySelectorAll(".led").forEach(led => {
    const ch = lights[+led.dataset.idx] || "r";
    led.className = "led " + (ch === "G" || ch === "g" ? "g" : ch === "y" || ch === "Y" ? "y" : "r");
  });
  stack.querySelectorAll("[data-q]").forEach(el => {
    el.textContent = "q " + (queues[el.dataset.q] ?? 0);
  });
}

/* ── canvas rendering ─────────────────────────────────────────────────────── */
function sizeCanvases() {
  for (const c of $$(".viewport canvas")) {
    c.width = c.clientWidth * DPR; c.height = c.clientHeight * DPR;
  }
  for (const c of $$(".dock-chart canvas")) {
    c.width = c.clientWidth * DPR; c.height = 74 * DPR;
  }
}
window.addEventListener("resize", () => { sizeCanvases(); });

function laneColor(l) { return l.approach ? "#1C222C" : "#171C24"; }

function drawWorld(c, g, frame, alpha) {
  g.clearRect(0, 0, c.width, c.height);
  // junction polygons
  g.fillStyle = "#11151C";
  for (const j of NET.junctions) {
    g.beginPath();
    j.shape.forEach((p, i) => { const [x, y] = w2s(c, p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.fill();
  }
  // lanes
  for (const group of [NET.internal, NET.lanes]) {
    for (const l of group) {
      g.strokeStyle = laneColor(l);
      g.lineWidth = Math.max(1, l.width * view.k * DPR);
      g.lineCap = "round"; g.lineJoin = "round";
      g.beginPath();
      l.shape.forEach((p, i) => { const [x, y] = w2s(c, p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
      if (group === NET.lanes && l.width * view.k > 6) {     // lane edge line
        g.strokeStyle = "rgba(120,135,155,.10)";
        g.lineWidth = 1;
        g.stroke();
      }
    }
  }
  if (!frame) return;
  // signal LEDs on stop lines
  const lights = frame.lights || "";
  for (const s of NET.signals) {
    const ch = lights[s.index] || "r";
    const col = (ch === "G" || ch === "g") ? "#2EE56A" : (ch === "y" || ch === "Y") ? "#FFC53D" : "#FF5252";
    const [x, y] = w2s(c, s.x, s.y);
    const rad = (s.angle) * Math.PI / 180;
    const px = Math.cos(rad + Math.PI / 2), py = -Math.sin(rad + Math.PI / 2);
    g.save();
    g.translate(x, y);
    g.rotate(-rad);
    const wpx = 2.6 * view.k * DPR;
    g.fillStyle = col;
    g.shadowColor = col; g.shadowBlur = 6 * DPR;
    g.fillRect(-1.2 * view.k * DPR, -wpx / 2, 2.4 * view.k * DPR * 0.45, wpx);
    g.restore();
  }
  // vehicles (interpolated)
  const prev = prevSnap, prevMap = {};
  if (prev) {
    const pf = frame === curSnap?.fixed ? prev.fixed : frame === curSnap?.rl ? prev.rl : null;
    if (pf) for (const v of pf.veh) prevMap[v.i] = v;
  }
  for (const v of frame.veh) {
    let x = v.x, y = v.y, a = v.a;
    const pv = prevMap[v.i];
    if (pv) {
      x = pv.x + (v.x - pv.x) * alpha;
      y = pv.y + (v.y - pv.y) * alpha;
      let da = ((v.a - pv.a + 540) % 360) - 180;
      a = pv.a + da * alpha;
    }
    const heat = Math.min(v.w / 60, 1);
    const col = `rgb(${Math.round(70 + heat * 185)},${Math.round(205 - heat * 150)},${Math.round(120 - heat * 65)})`;
    const [sx, sy] = w2s(c, x, y);
    const rad = (90 - a) * Math.PI / 180;          // SUMO angle: 0=N, CW
    g.save();
    g.translate(sx, sy);
    g.rotate(-rad);
    const L = 5 * view.k * DPR, W = 1.9 * view.k * DPR;
    g.translate(-L / 2, 0);                        // position is front-center
    g.fillStyle = col;
    g.beginPath(); g.roundRect(-L / 2, -W / 2, L, W, W * 0.28); g.fill();
    if (view.k > 2.4) {                            // windshield hint
      g.fillStyle = "rgba(10,14,20,.55)";
      g.fillRect(L * 0.16, -W * 0.32, L * 0.2, W * 0.64);
    }
    g.restore();
  }
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (!NET) return;
  const alpha = curSnap && prevSnap ? Math.min((performance.now() - snapTime) / snapGap, 1) : 1;
  const cf = $("#vp-fixed canvas"), cr = $("#vp-rl canvas");
  drawWorld(cf, cf.getContext("2d"), curSnap ? curSnap.fixed : null, alpha);
  drawWorld(cr, cr.getContext("2d"), curSnap ? curSnap.rl : null, alpha);
}

/* ── charts ───────────────────────────────────────────────────────────────── */
function drawChart(c, series, key) {
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  const fx = series.fixed[key], rl = series.rl[key];
  const n = Math.max(fx.length, rl.length);
  if (n < 2) return;
  const maxV = Math.max(1, ...fx, ...rl);
  const line = (data, col) => {
    g.strokeStyle = col; g.lineWidth = 1.6 * DPR;
    g.beginPath();
    data.forEach((v, i) => {
      const x = (i / (n - 1)) * (c.width - 6) + 3;
      const y = c.height - 4 - (v / maxV) * (c.height - 10);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  };
  line(fx, "#8b9096"); line(rl, "#d9a13b");
  g.fillStyle = "rgba(124,134,148,.8)";
  g.font = `${9 * DPR}px IBM Plex Mono`;
  g.fillText(fmt(maxV, key === "wait" ? 1 : 0), 4, 10 * DPR);
}

/* ── pan / zoom (mirrored across both viewports) ──────────────────────────── */
for (const c of $$(".viewport canvas")) {
  let drag = null;
  const vp = c.closest(".viewport");
  const queueOverlay = document.createElement("div");
  queueOverlay.className = "queue-overlay";
  queueOverlay.style.display = "none";
  vp.appendChild(queueOverlay);

  c.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY]; c.setPointerCapture(e.pointerId); });
  c.addEventListener("pointermove", e => {
    if (!drag) return;
    view.x -= (e.clientX - drag[0]) / view.k;
    view.y += (e.clientY - drag[1]) / view.k;
    drag = [e.clientX, e.clientY];
  });
  c.addEventListener("pointerup", () => drag = null);
  c.addEventListener("wheel", e => {
    e.preventDefault();
    view.k *= e.deltaY < 0 ? 1.15 : 0.87;
    view.k = Math.min(Math.max(view.k, 0.4), 40);
  }, { passive: false });

  c.addEventListener("mousemove", e => {
    if (!curSnap || !NET) { queueOverlay.style.display = "none"; return; }
    const side = c.closest("#vp-fixed") ? "fixed" : "rl";
    const snap = curSnap[side];
    if (!snap || !snap.queues) { queueOverlay.style.display = "none"; return; }
    const html = Object.entries(snap.queues)
      .map(([ap, q]) => `<div><b>${ap}</b>: ${q} veh</div>`)
      .join("");
    queueOverlay.innerHTML = html;
    queueOverlay.style.display = html ? "block" : "none";
    queueOverlay.style.left = (e.clientX + 10) + "px";
    queueOverlay.style.top = (e.clientY + 10) + "px";
  });
  c.addEventListener("mouseleave", () => { queueOverlay.style.display = "none"; });
}

/* ── wiring ───────────────────────────────────────────────────────────────── */
$("#btn-launch").onclick = launch;
$("#btn-play").onclick = () => { if (sessionId) setPlaying(!playing); else document.body.classList.add("rail-open"); };
$("#btn-step").onclick = () => {
  if (!sessionId || !ws || ws.readyState !== 1) return;
  if (playing) setPlaying(false);
  ws.send(JSON.stringify({ n: 1 }));
};
$("#btn-reset").onclick = () => document.body.classList.add("rail-open");
$("#btn-drawer").onclick = () => document.body.classList.toggle("rail-open");
$("#btn-fit").onclick = fitView;
$("#btn-about").onclick = () => $("#about").hidden = false;
$("#speedset").addEventListener("click", e => {
  if (!e.target.dataset.s) return;
  $$("#speedset button").forEach(b => b.classList.remove("act"));
  e.target.classList.add("act");
  speed = +e.target.dataset.s;
  if (sessionId) startPolling();
});

/* ── panel resizers ───────────────────────────────────────────────────────── */
(function () {
  let active = null;

  function onDown(e, id) {
    active = id;
    document.body.classList.add("resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.getElementById(id).classList.add("dragging");
    e.preventDefault();
  }

  $("#resizer-rail").addEventListener("mousedown", e => {
    if (document.body.classList.contains("rail-open")) onDown(e, "resizer-rail");
  });
  $("#resizer-stage").addEventListener("mousedown", e => onDown(e, "resizer-stage"));

  document.addEventListener("mousemove", e => {
    if (!active) return;
    if (active === "resizer-rail") {
      const w = Math.max(160, Math.min(560, e.clientX - 52));
      document.body.style.setProperty("--drawer-w", w + "px");
    } else {
      const rect = $("#stage").getBoundingClientRect();
      const pct = Math.max(0.15, Math.min(0.85, (e.clientX - rect.left) / rect.width));
      $("#stage").style.gridTemplateColumns = `${pct}fr 6px ${1 - pct}fr`;
    }
    sizeCanvases();
  });

  document.addEventListener("mouseup", () => {
    if (!active) return;
    document.getElementById(active).classList.remove("dragging");
    active = null;
    document.body.classList.remove("resizing");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
})();

/* ── dock resizer + analytics toggle ─────────────────────────────────────── */
(function () {
  let dragging = false;
  let lastDockH = null;

  function initDockH() {
    if (lastDockH !== null) return;
    const h = document.getElementById("dock").getBoundingClientRect().height;
    lastDockH = Math.max(80, h || 140);
    document.body.style.setProperty("--dock-h", lastDockH + "px");
  }

  requestAnimationFrame(() => requestAnimationFrame(initDockH));

  const resizerDock = document.getElementById("resizer-dock");

  resizerDock.addEventListener("mousedown", e => {
    if (e.target.closest("#btn-analytics")) return;
    initDockH();
    dragging = true;
    document.body.classList.add("resizing");
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    resizerDock.classList.add("dragging");
    e.preventDefault();
  });

  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const newH = Math.max(60, Math.min(window.innerHeight * 0.55, window.innerHeight - e.clientY - 18));
    lastDockH = newH;
    document.body.style.setProperty("--dock-h", newH + "px");
    document.body.classList.remove("dock-collapsed");
    $("#btn-analytics").textContent = "▾ Analytics";
    sizeCanvases();
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    resizerDock.classList.remove("dragging");
  });

  $("#btn-analytics").addEventListener("click", () => {
    initDockH();
    const collapsed = document.body.classList.toggle("dock-collapsed");
    if (collapsed) {
      document.body.style.setProperty("--dock-h", "0px");
      $("#btn-analytics").textContent = "▴ Analytics";
    } else {
      document.body.style.setProperty("--dock-h", lastDockH + "px");
      $("#btn-analytics").textContent = "▾ Analytics";
    }
    setTimeout(sizeCanvases, 300);
  });
})();

boot();
