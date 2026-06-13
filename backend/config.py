"""Central configuration. Override anything via environment variables or by
editing the DEFAULTS below. All values default to the JUN1 (BeST Berlin)
experiment from the paper."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("TD_DATA_DIR", BASE_DIR / "data"))

# ── SUMO files ────────────────────────────────────────────────────────────────
# Put your junction net file at data/junction.net.xml (or set TD_NET_FILE).
NET_FILE = os.environ.get("TD_NET_FILE", str(DATA_DIR / "junction.net.xml"))

# ── Traffic light / junction (paper defaults) ────────────────────────────────
TLS_ID = os.environ.get(
    "TD_TLS_ID",
    "cluster_26785788_26785789_26785790_26785791_"
    "4286289674_4286289675_4286289676_4286289679",
)

APPROACHES = {
    "A": ["429488376#0_0", "429488376#0_1", "429488376#0_2", "429488376#0_3"],
    "B": ["429488375#0_0", "429488375#0_1", "429488375#0_2"],
    "C": ["328440060#1_0", "328440060#1_1", "328440060#1_2", "328440060#1_3"],
    "D": ["338690994#0_0", "338690994#0_1", "338690994#0_2", "338690994#0_3"],
}

# Route edges:  approach edge -> {turn: outgoing edge}
ROUTES = {
    "A": {"edge": "429488376#0", "L": "4453041",   "S": "34412631", "R": "429488374"},
    "B": {"edge": "429488375#0", "L": "34412633",  "S": "4453041",  "R": "34412631"},
    "C": {"edge": "328440060#1", "L": "429488374", "S": "34412633", "R": "4453041"},
    "D": {"edge": "338690994#0", "L": "34412631",  "S": "429488374","R": "34412633"},
}

# ── Signal program / control constants (must match training) ─────────────────
GREEN_PH  = [0, 2, 4, 6]
RED_PH    = [1, 3, 5, 7]
TOTAL_PH  = 8
MAX_GREEN = 30
MIN_GREEN = 5
MAX_RED   = 3            # yellow length

# ── Q-tables ──────────────────────────────────────────────────────────────────
# Drop your trained pickles into data/ . {seed} is substituted.
QTABLE_PATTERN = os.environ.get("TD_QTABLE_PATTERN",
                                str(DATA_DIR / "rl_model_seed_SI6{seed}.pkl"))
SEEDS = [int(s) for s in os.environ.get("TD_SEEDS", "42,123,256,512,1024").split(",")]

# ── Vehicle type (from the route files used in the paper) ─────────────────────
VTYPE = dict(id="DefaultVehicle", length=5.00, minGap=2.00, maxSpeed=50.00,
             accel=1.50, decel=4.50, sigma=0.50, tau=1.00)

# ── Simulation defaults ───────────────────────────────────────────────────────
DEFAULT_SUMO_SEED = 12356
DEFAULT_EPISODE   = 1000          # steps (1 step = 1 s)
MAX_EPISODE       = 8000

# processing block carried over from the experiment .sumocfg
PROCESSING_XML = """    <processing>
        <route-steps value="200"/>
        <no-internal-links value="false"/>
        <ignore-junction-blocker value="20"/>
        <time-to-teleport value="120.0"/>
        <time-to-teleport.highways value="0"/>
        <eager-insert value="false"/>
    </processing>"""

# ── Demo mode ─────────────────────────────────────────────────────────────────
# If the configured NET_FILE does not exist, the server can generate a plain
# 4-way demo junction so the product is testable before you drop in JUN1.
ALLOW_DEMO_NET = os.environ.get("TD_ALLOW_DEMO_NET", "1") == "1"
