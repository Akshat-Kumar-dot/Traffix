"""A Session owns two headless SUMO instances stepping in lockstep on the same
routes and seed: one under the default fixed-time program (the paper's
baseline), one under the Q-learning controller. Metrics replicate the paper's
evaluation exactly (approach-lane entry/exit tracking, Eq.4 travel, Eq.5
waiting, halting < 0.1 m/s)."""
from __future__ import annotations
import pickle
import shutil
import tempfile
import threading
import uuid
from collections import defaultdict
from pathlib import Path

import numpy as np
import traci

from . import config, routegen
from .rl_controller import (FixedController, RLController, get_state,
                            get_reward)


class SimSide:
    def __init__(self, label, cfg_file, kind, tls_id, approaches, qtable=None):
        self.label, self.tls_id = label, tls_id
        self.approaches = approaches
        self.all_lanes = [l for ls in approaches.values() for l in ls]
        traci.start([shutil.which("sumo"), "-c", str(cfg_file),
                     "--no-step-log", "--quit-on-end"], label=label)
        self.conn = traci.getConnection(label)
        self.total_ph = len(
            self.conn.trafficlight.getAllProgramLogics(tls_id)[0].phases)
        if kind == "rl":
            self.ctrl = RLController(self.conn, tls_id, qtable, self.total_ph)
        else:
            self.ctrl = FixedController(self.conn, tls_id)

        self.junction_wait, self.junction_entry = {}, {}
        self.completed_wait, self.completed_travel = [], []
        self.prev_vehs = set()
        self.q_hist = {k: [] for k in approaches}
        self.wait_series, self.queue_series = [], []
        self.total_reward = 0.0
        self.step = 0

    # ── paper metric tracker (verbatim logic) ────────────────────────────────
    def _update_trackers(self):
        c = self.conn
        current = set()
        for lane in self.all_lanes:
            for vid in c.lane.getLastStepVehicleIDs(lane):
                current.add(vid)
                if vid not in self.junction_wait:
                    self.junction_wait[vid] = 0.0
                    self.junction_entry[vid] = self.step
                if c.vehicle.getSpeed(vid) < 0.1:
                    self.junction_wait[vid] += 1.0
        for vid in self.prev_vehs - current:
            self.completed_wait.append(self.junction_wait.pop(vid, 0.0))
            t0 = self.junction_entry.pop(vid, self.step)
            self.completed_travel.append(self.step - t0)
        self.prev_vehs = current

    def tick(self):
        state = get_state(self.conn, self.tls_id, self.approaches,
                          self.all_lanes)
        self._update_trackers()
        for k, v in zip(self.approaches, state[:4]):
            self.q_hist[k].append(v)
        self.queue_series.append(int(sum(state[:4])))
        snap = float(np.mean(list(self.junction_wait.values()))) \
            if self.junction_wait else 0.0
        self.wait_series.append(round(snap, 2))
        self.total_reward += get_reward(state)
        self.ctrl.pre_step(state)
        self.conn.simulationStep()
        self.step += 1
        self.ctrl.post_step()

    def metrics(self):
        rem_wait = list(self.junction_wait.values())
        rem_travel = [self.step - self.junction_entry[v]
                      for v in self.junction_wait]
        all_wait = self.completed_wait + rem_wait
        all_travel = self.completed_travel + rem_travel
        keys = list(self.approaches)
        return {
            "avg_wait": round(float(np.mean(all_wait)), 2) if all_wait else 0.0,
            "avg_travel": round(float(np.mean(all_travel)), 2) if all_travel else 0.0,
            "throughput": len(self.completed_travel),
            "total_queue": int(sum(self.queue_series)),
            "max_queue": int(max((max(self.q_hist[k]) for k in keys
                                  if self.q_hist[k]), default=0)),
            "total_reward": round(float(self.total_reward), 1),
            "now_waiting": int(sum(self.conn.lane.getLastStepHaltingNumber(l)
                                   for l in self.all_lanes)),
        }

    def frame(self):
        c = self.conn
        vehicles = []
        for vid in c.vehicle.getIDList():
            x, y = c.vehicle.getPosition(vid)
            vehicles.append({
                "i": vid,
                "x": round(x, 2), "y": round(y, 2),
                "a": round(c.vehicle.getAngle(vid), 1),
                "w": round(c.vehicle.getAccumulatedWaitingTime(vid), 1),
            })
        return {
            "veh": vehicles,
            "lights": c.trafficlight.getRedYellowGreenState(self.tls_id),
            "phase": c.trafficlight.getPhase(self.tls_id),
            "phase_t": float(c.trafficlight.getSpentDuration(self.tls_id)),
            "action": getattr(self.ctrl, "last_action", None),
            "queues": {k: (self.q_hist[k][-1] if self.q_hist[k] else 0)
                       for k in self.approaches},
        }

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass


class Session:
    def __init__(self, demand, seed, episode, qtable_seed,
                 net_file, tls_id, approaches, routes_map, route_file=None):
        self.id = uuid.uuid4().hex[:10]
        self.episode = max(60, min(int(episode), config.MAX_EPISODE))
        self.lock = threading.Lock()
        self.tmp = Path(tempfile.mkdtemp(prefix=f"td_{self.id}_"))
        if route_file is not None:
            cfg_file = routegen.write_cfg(net_file, route_file, int(seed), self.tmp)
        else:
            routes = routegen.write_routes(demand or {}, self.episode, self.tmp, routes_map)
            cfg_file = routegen.write_cfg(net_file, routes, int(seed), self.tmp)

        qtable, self.q_source = self._load_qtable(qtable_seed)
        self.fixed = SimSide(f"fx_{self.id}", cfg_file, "fixed",
                             tls_id, approaches)
        self.rl = SimSide(f"rl_{self.id}", cfg_file, "rl",
                          tls_id, approaches, qtable=qtable)
        self.done = False

    def _load_qtable(self, qtable_seed):
        if qtable_seed in (None, "", "demo"):
            return None, "Fixed-time baseline (no Q-table)"
        path = Path(config.QTABLE_PATTERN.format(seed=qtable_seed))
        if not path.exists():
            return None, f"{path.name} not found — running fixed-time baseline"
        with open(path, "rb") as f:
            raw = pickle.load(f)
        q = defaultdict(lambda: np.zeros(4))
        for k, v in raw.items():
            q[tuple(k)] = np.asarray(v, dtype=float)
        return q, f"{path.name} · {len(raw):,} states"

    def advance(self, n):
        with self.lock:
            for _ in range(n):
                if self.fixed.step >= self.episode:
                    self.done = True
                    break
                self.fixed.tick()
                self.rl.tick()
            return self.snapshot()

    def snapshot(self):
        rlc = self.rl.ctrl
        cov = None
        if isinstance(rlc, RLController) and (rlc.q_hits + rlc.q_misses):
            cov = round(rlc.q_hits / (rlc.q_hits + rlc.q_misses), 3)
        return {
            "t": self.fixed.step,
            "episode": self.episode,
            "done": self.done,
            "fixed": {**self.fixed.frame(), "metrics": self.fixed.metrics()},
            "rl": {**self.rl.frame(), "metrics": self.rl.metrics()},
            "series": {
                "fixed": {"queue": self.fixed.queue_series[-1200:],
                          "wait": self.fixed.wait_series[-1200:]},
                "rl": {"queue": self.rl.queue_series[-1200:],
                       "wait": self.rl.wait_series[-1200:]},
            },
            "q_source": self.q_source,
            "q_coverage": cov,
        }

    def close(self):
        self.fixed.close()
        self.rl.close()
        shutil.rmtree(self.tmp, ignore_errors=True)


class SessionManager:
    def __init__(self):
        self.sessions: dict[str, Session] = {}
        self.lock = threading.Lock()

    def create(self, **kw) -> Session:
        s = Session(**kw)
        with self.lock:
            while len(self.sessions) >= 4:
                old = next(iter(self.sessions))
                self.sessions.pop(old).close()
            self.sessions[s.id] = s
        return s

    def get(self, sid):
        return self.sessions.get(sid)

    def drop(self, sid):
        with self.lock:
            s = self.sessions.pop(sid, None)
        if s:
            s.close()
