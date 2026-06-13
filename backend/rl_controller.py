"""Controllers.

RLController is a step-wise state machine that reproduces *exactly* the TraCI
call sequence of the blocking evaluation loop used for the paper:

    state    = (maxHalt(A), maxHalt(B), maxHalt(C), maxHalt(D), phase, demand_level)
    action   = argmax(Q[state]) if state in Q else 0
    mustSwitch (green, duration >= 30):
        if action == 0: action = argmax(Q[state][1:]) + 1
        setPhase(phase+1); setPhaseDuration(3)
        ... 3 simulation steps under yellow ...
        setPhase(NextPhase(action, phase)); setPhaseDuration(31)
    canRLAct (green, 5 <= duration < 30):
        action == 0 -> setPhase(phase); setPhaseDuration(31)   (re-extend)
        else        -> same 3-step yellow sequence, then NextPhase

The blocking loop steps the simulation inside the yellow window; here the
session owner calls pre_step() before every simulationStep() and post_step()
after it, which yields an identical ordering of setPhase/setPhaseDuration
relative to simulationStep calls.

FixedController does nothing: the default program in the net file (greens
18/20/20/20 s with 3 s yellows, strict cycling) runs untouched — the paper's
fixed-time baseline.
"""
from __future__ import annotations
import numpy as np
from . import config


def max_queue(conn, lanes):
    return max(conn.lane.getLastStepHaltingNumber(l) for l in lanes)


def demand_level(conn, all_lanes):
    total = sum(conn.lane.getLastStepVehicleNumber(l) for l in all_lanes)
    if total <= 4:
        return 0
    elif total <= 9:
        return 1
    return 2


def get_state(conn, tls_id, approaches, all_lanes):
    A = max_queue(conn, approaches["A"])
    B = max_queue(conn, approaches["B"])
    C = max_queue(conn, approaches["C"])
    D = max_queue(conn, approaches["D"])
    L = conn.trafficlight.getPhase(tls_id)
    return (A, B, C, D, L, demand_level(conn, all_lanes))


def get_reward(state):
    A, B, C, D = state[0], state[1], state[2], state[3]
    return -(A * A + B * B + C * C + D * D)


def next_phase(action, phase, total_ph):
    if action == 1:
        return (phase + 2) % total_ph
    if action == 2:
        return (phase + 4) % total_ph
    if action == 3:
        return (phase + 6) % total_ph
    return phase


class FixedController:
    name = "fixed"

    def __init__(self, conn, tls_id):
        self.conn, self.tls_id = conn, tls_id
        self.last_action = None

    def pre_step(self, state):
        pass

    def post_step(self):
        pass


class RLController:
    name = "rl"

    def __init__(self, conn, tls_id, qtable, total_ph):
        self.conn, self.tls_id = conn, tls_id
        self.Q = qtable                       # dict[tuple] -> np.array(4) | None
        self.total_ph = total_ph
        self.yellow_remaining = 0
        self.pending_phase = None
        self.last_action = None
        self.q_hits = 0
        self.q_misses = 0

        program = self.conn.trafficlight.getAllProgramLogics(self.tls_id)[0].phases
        self.green_phases = [i for i, p in enumerate(program)
                             if "G" in p.state and "y" not in p.state]
        self.yellow_phases = [i for i, p in enumerate(program) if "y" in p.state]
        if not self.green_phases:
            self.green_phases = [0, 2, 4, 6]
        if not self.yellow_phases:
            self.yellow_phases = [1, 3, 5, 7]

    def _action(self, state):
        if self.Q is not None and state in self.Q:
            self.q_hits += 1
            return int(np.argmax(self.Q[state]))
        self.q_misses += 1
        if self.Q is not None:
            return 0                          # exact eval-loop behaviour
        # no table loaded -> demo policy: serve the longest max-queue approach
        q = state[:4]
        target_ap = int(np.argmax(q))         # 0..3 -> A..D phases 4,6,2,0
        ap_phase = {0: 4, 1: 6, 2: 2, 3: 0}[target_ap]
        cur = state[4]
        if cur not in self.green_phases:
            return 0
        diff = (ap_phase - cur) % self.total_ph
        return {0: 0, 2: 1, 4: 2, 6: 3}.get(diff, 0)

    def _argmax_nonzero(self, state):
        if self.Q is not None and state in self.Q:
            return int(np.argmax(self.Q[state][1:]) + 1)
        a = self._action(state)
        return a if a != 0 else 1

    def _start_yellow(self, phase, action):
        c = self.conn
        c.trafficlight.setPhase(self.tls_id, (phase + 1) % self.total_ph)
        c.trafficlight.setPhaseDuration(self.tls_id, 3)
        self.yellow_remaining = 3
        self.pending_phase = next_phase(action, phase, self.total_ph)

    def pre_step(self, state):
        """Called once per second, immediately before simulationStep()."""
        if self.yellow_remaining > 0:
            return
        c = self.conn
        phase = c.trafficlight.getPhase(self.tls_id)
        duration = c.trafficlight.getSpentDuration(self.tls_id)
        action = self._action(state)
        self.last_action = action

        must = (phase in self.green_phases and duration >= config.MAX_GREEN) or \
               (phase in self.yellow_phases and duration >= config.MAX_RED)
        can = phase in self.green_phases and config.MIN_GREEN <= duration < config.MAX_GREEN

        if must:
            if phase in config.GREEN_PH:
                if action == 0:
                    action = self._argmax_nonzero(state)
                    self.last_action = action
                self._start_yellow(phase, action)
            else:
                c.trafficlight.setPhase(self.tls_id, (phase + 1) % self.total_ph)
        elif can:
            if action == 0:
                c.trafficlight.setPhase(self.tls_id, phase)
                c.trafficlight.setPhaseDuration(self.tls_id, 31)
            else:
                self._start_yellow(phase, action)

    def post_step(self):
        """Called once per second, immediately after simulationStep()."""
        if self.yellow_remaining > 0:
            self.yellow_remaining -= 1
            if self.yellow_remaining == 0:
                self.conn.trafficlight.setPhase(self.tls_id, self.pending_phase)
                self.conn.trafficlight.setPhaseDuration(self.tls_id, 31)
                self.pending_phase = None
