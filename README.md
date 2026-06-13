# Traffix

Reinforcement-learning traffic signal control — landing page
(`frontend/index.html`) plus an interactive before/after demo
(`frontend/app.html`) for the paper's adaptive traffic signal
controller. Two **real SUMO** simulations run server-side on identical routes
and seed — one under the junction's default fixed-time program (the paper's
baseline), one controlled live by a trained tabular Q-learning agent — and a
control-room web UI renders both with the true junction geometry, per-lane
signal LEDs, live metrics and charts.

## Why this architecture
- **Perfect fidelity** — no re-implementation of physics or control. The
  backend drives SUMO through TraCI with the *exact* evaluation loop from the
  paper (6-tuple state, 4 phase-skipping actions, min-green 5 s, must-switch
  30 s, 3 s yellow) and the exact metric definitions (Eq.4 travel / Eq.5 wait,
  approach-lane tracking, halting < 0.1 m/s).
- **Deployable anywhere** — SUMO installs from pip (`eclipse-sumo`), so any
  Linux VPS / Docker host runs it. No GUI, no system SUMO needed.
- **Thin client** — the browser only renders frames streamed over a
  WebSocket (CityFlow-replayer style), so it stays smooth on any device.

## Quick start (local)
```bash
pip install -r requirements.txt
uvicorn backend.app:app --reload          # http://localhost:8000
```
Windows: double-click `run.bat`.

Without your files it boots on an auto-generated demo junction with a
longest-queue demo policy, clearly labelled. To run the real thing, put in
`data/`:
- `junction.net.xml` — your JUN1 net
- `rl_model_seed_SI6{seed}.pkl` — your trained Q-tables (loaded directly,
  no conversion needed)

The UI's Q-table dropdown lists whichever seeds it finds.

## Deploy
```bash
docker build -t trafficdeck .
docker run -p 8000:8000 -v $(pwd)/data:/app/data trafficdeck
```
Works on any Docker host (Railway, Fly.io, EC2, a department server…). For a
public deployment put it behind nginx/Caddy for TLS; the frontend
auto-selects `wss://` on https.

## Configuration
`backend/config.py` holds every experiment constant (TLS id, approach lanes,
route edges, phase indices, timing constants, vType, seeds) — all
overridable via `TD_*` environment variables. If the configured lanes are not
found in the net, approaches/routes are auto-derived from the first TLS
junction so the app still works on any net.

## API
- `GET /api/info` — resolved configuration
- `GET /api/network` — render geometry (lanes, junction polygons, signal LEDs)
- `POST /api/session` — `{demand, seed, episode, qtable_seed}`
- `WS /ws/{id}` — send `{"n": k}` → advances both sims k seconds, returns a
  snapshot (vehicles, lights, metrics, series)

## Honest-demo notes
- Both sides always receive the same routes file and the same SUMO seed.
- Q-table **coverage** is shown live: % of decision states found in the
  table. Low coverage on demand patterns far from training is expected and
  worth narrating, not hiding.
- The demo junction is for development only — results shown on it say
  nothing about the paper.
