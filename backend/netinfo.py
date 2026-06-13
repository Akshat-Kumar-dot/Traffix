"""Resolve which junction/lanes/routes to use against the actual net file.

If the configured JUN1 lane ids exist in the net, the paper configuration is
used verbatim. Otherwise (e.g. demo net before you drop JUN1 in), approaches
and turn routes are auto-derived from the first TLS junction: incoming edges
are labelled A..D clockwise from north, and per-approach L/S/R target edges
are classified by turning angle.
"""
from __future__ import annotations
import math
import subprocess
import shutil
from pathlib import Path
import sumolib
from . import config


def ensure_net(net_file: str) -> str:
    p = Path(net_file)
    if p.exists():
        return str(p)
    if not config.ALLOW_DEMO_NET:
        raise FileNotFoundError(
            f"Net file not found: {net_file}. Put your junction net there or "
            f"set TD_NET_FILE.")
    p.parent.mkdir(parents=True, exist_ok=True)
    demo = p.parent / "demo.net.xml"
    if not demo.exists():
        subprocess.run([
            shutil.which("netgenerate"), "--grid", "--grid.number", "1",
            "--grid.attach-length", "220", "--grid.length", "200",
            "--default.lanenumber", "4",
            "--no-turnarounds", "true",
            "--default-junction-type", "traffic_light",
            "--tls.guess", "true",
            "--default.speed", "13.89",
            "-o", str(demo),
        ], check=True, capture_output=True)
    return str(demo)


def _edge_angle_in(edge):
    sh = edge.getShape()
    a, b = sh[-2] if len(sh) > 1 else sh[0], sh[-1]
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


def _heading_label(edge):
    """Compass heading the traffic is coming FROM, for A..D labelling."""
    ang = _edge_angle_in(edge)            # direction of travel
    # travelling south (ang ~ -90) means coming from north
    return (ang + 360) % 360


def resolve(net_file: str):
    net = sumolib.net.readNet(net_file, withPrograms=True)
    tls_ids = [t.getID() for t in net.getTrafficLights()]
    if not tls_ids:
        raise RuntimeError("No traffic light in net file.")
    tls_id = config.TLS_ID if config.TLS_ID in tls_ids else tls_ids[0]

    # Does the paper configuration apply to this net?
    have = {l.getID() for e in net.getEdges() for l in e.getLanes()}
    cfg_lanes = [l for ls in config.APPROACHES.values() for l in ls]
    if all(l in have for l in cfg_lanes):
        # Apply two anticlockwise rotations to the configured JUN1 approach
        # labels so A/B/C/D are shifted twice around the junction.
        keys = list(config.APPROACHES.keys())
        rotated = keys[2:] + keys[:2]
        reordered_approaches = {new: config.APPROACHES[old] for old, new in zip(keys, rotated)}
        reordered_routes = {new: config.ROUTES[old] for old, new in zip(keys, rotated)}
        return tls_id, reordered_approaches, reordered_routes, net

    # ── auto-derive from the TLS junction ────────────────────────────────────
    tls = net.getTLS(tls_id)
    in_edges = []
    for conn in tls.getConnections():
        e = conn[0].getEdge()
        if not e.isSpecial() and e not in in_edges:
            in_edges.append(e)
    # label clockwise starting nearest "coming from north"
    def from_north(e):
        return (( _heading_label(e) - 270) % 360)
    in_edges.sort(key=from_north)
    labels = "ABCD"[:len(in_edges)]

    approaches, routes = {}, {}
    for lab, e in zip(labels, in_edges):
        approaches[lab] = [l.getID() for l in e.getLanes()]
        ang_in = _edge_angle_in(e)
        turns = {}
        for conn in tls.getConnections():
            if conn[0].getEdge() is not e:
                continue
            out_edge = conn[1].getEdge()
            sh = out_edge.getShape()
            ang_out = math.degrees(math.atan2(sh[1][1] - sh[0][1],
                                              sh[1][0] - sh[0][0])) \
                if len(sh) > 1 else ang_in
            d = ((ang_out - ang_in + 540) % 360) - 180
            key = "S" if abs(d) < 30 else ("L" if d > 0 else "R")
            turns.setdefault(key, out_edge.getID())
        routes[lab] = {"edge": e.getID(),
                       "L": turns.get("L", turns.get("S")),
                       "S": turns.get("S", next(iter(turns.values()))),
                       "R": turns.get("R", turns.get("S"))}
    return tls_id, approaches, routes, net
