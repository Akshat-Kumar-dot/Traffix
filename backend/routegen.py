"""Generate a .rou.xml and .sumocfg from the demand built in the UI.

Demand shape (vehicles/hour):
    {"A": {"L": 55, "S": 600, "R": 50}, ...}

Flows replicate the paper's route files: departLane="best",
departSpeed="max", single DefaultVehicle vType.
"""
from __future__ import annotations
from pathlib import Path
from . import config


def write_routes(demand: dict, episode: int, out_dir: Path, routes_map: dict) -> Path:
    v = config.VTYPE
    lines = [
        '<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/routes_file.xsd">',
        f'  <vType id="{v["id"]}" length="{v["length"]:.2f}" minGap="{v["minGap"]:.2f}" '
        f'maxSpeed="{v["maxSpeed"]:.2f}" accel="{v["accel"]:.2f}" '
        f'decel="{v["decel"]:.2f}" sigma="{v["sigma"]:.2f}" tau="{v["tau"]:.2f}"/>',
    ]
    for ap, r in routes_map.items():
        for turn in ("L", "S", "R"):
            if r.get(turn):
                lines.append(f'  <route id="{ap}_{turn}" edges="{r["edge"]} {r[turn]}"/>')
    for ap in routes_map:
        rates = demand.get(ap, {})
        for turn in ("L", "S", "R"):
            vph = float(rates.get(turn, 0) or 0)
            if vph <= 0 or not routes_map[ap].get(turn):
                continue
            lines.append(
                f'  <flow id="{ap}_{turn}_flow" begin="0" end="{episode}" '
                f'route="{ap}_{turn}" vehsPerHour="{vph:g}" type="{v["id"]}" '
                f'departLane="best" departSpeed="max"/>'
            )
    lines.append("</routes>")
    path = out_dir / "demand.rou.xml"
    path.write_text("\n".join(lines))
    return path


def write_cfg(net_file: str, route_file: Path, seed: int, out_dir: Path) -> Path:
    cfg = f"""<configuration>
    <input>
        <net-file value="{net_file}"/>
        <route-files value="{route_file}"/>
    </input>
    <time>
        <step-length value="1.0"/>
    </time>
{config.PROCESSING_XML}
    <random_number>
        <random value="false"/>
        <seed value="{seed}"/>
    </random_number>
    <report>
        <no-step-log value="true"/>
    </report>
</configuration>"""
    path = out_dir / "session.sumocfg"
    path.write_text(cfg)
    return path
