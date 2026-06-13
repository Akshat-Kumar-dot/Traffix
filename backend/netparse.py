"""Parse the SUMO net into render-ready geometry JSON.

The frontend draws:
  * every lane as a thick polyline (its real shape),
  * junction polygons,
  * one signal LED per controlled connection, placed at the end of its
    incoming lane, coloured live from the RYG state string by link index.
"""
from __future__ import annotations
import math
import sumolib


def _angle(p1, p2):
    return math.degrees(math.atan2(p2[1] - p1[1], p2[0] - p1[0]))


def parse_net(net_file: str, tls_id: str, approaches: dict) -> dict:
    net = sumolib.net.readNet(net_file, withInternal=True, withPrograms=True)

    lane_to_approach = {}
    for name, lanes in approaches.items():
        for l in lanes:
            lane_to_approach[l] = name

    lanes_out, internal_out = [], []
    for edge in net.getEdges(withInternal=True):
        for lane in edge.getLanes():
            shape = [[round(x, 2), round(y, 2)] for x, y in lane.getShape()]
            item = {
                "id": lane.getID(),
                "shape": shape,
                "width": round(lane.getWidth(), 2),
                "speed": round(lane.getSpeed(), 2),
                "approach": lane_to_approach.get(lane.getID()),
            }
            (internal_out if edge.isSpecial() else lanes_out).append(item)

    junctions_out = []
    for node in net.getNodes():
        shp = node.getShape()
        if shp and len(shp) >= 3:
            junctions_out.append({
                "id": node.getID(),
                "shape": [[round(x, 2), round(y, 2)] for x, y in shp],
            })

    # TLS controlled links, ordered by link index -> LED positions
    signals = []
    tls = net.getTLS(tls_id) if tls_id in [t.getID() for t in net.getTrafficLights()] else None
    if tls is not None:
        for conn in tls.getConnections():
            in_lane, out_lane, link_idx = conn
            shape = in_lane.getShape()
            p_end, p_prev = shape[-1], shape[-2] if len(shape) > 1 else shape[-1]
            ang = _angle(p_prev, p_end)
            # outgoing direction for the turn arrow
            oshape = out_lane.getShape()
            oang = _angle(oshape[0], oshape[1] if len(oshape) > 1 else oshape[0])
            turn = ((oang - ang + 540) % 360) - 180   # + left, - right, ~0 straight
            arrow = "S" if abs(turn) < 30 else ("L" if turn > 0 else "R")
            signals.append({
                "index": link_idx,
                "lane": in_lane.getID(),
                "approach": lane_to_approach.get(in_lane.getID()),
                "x": round(p_end[0], 2), "y": round(p_end[1], 2),
                "angle": round(ang, 1),
                "arrow": arrow,
                "out": out_lane.getID(),
            })
        signals.sort(key=lambda s: s["index"])

    xmin, ymin, xmax, ymax = net.getBoundary()
    return {
        "bounds": [round(xmin, 1), round(ymin, 1), round(xmax, 1), round(ymax, 1)],
        "lanes": lanes_out,
        "internal": internal_out,
        "junctions": junctions_out,
        "signals": signals,
        "tls": tls_id,
    }
