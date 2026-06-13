"""TrafficDeck server.

    uvicorn backend.app:app --host 0.0.0.0 --port 8000

Endpoints
  GET  /api/network          render-ready junction geometry
  GET  /api/info             config summary (tls, approaches, q-tables found)
  POST /api/session          {demand, seed, episode, qtable_seed} -> {id, ...}
  WS   /ws/{session_id}      client sends {"n": K} -> server steps K seconds
                             on both sims and returns one snapshot frame
  DELETE /api/session/{id}
"""
from __future__ import annotations
import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import json

from . import config, netinfo, netparse
from .session import SessionManager

app = FastAPI(title="TrafficDeck", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

NET_FILE = netinfo.ensure_net(config.NET_FILE)
TLS_ID, APPROACHES, ROUTES_MAP, _net = netinfo.resolve(NET_FILE)
GEOMETRY = netparse.parse_net(NET_FILE, TLS_ID, APPROACHES)
MANAGER = SessionManager()

DEMAND_DIR = Path(__file__).resolve().parent.parent / "data" / "demands"
DEMAND_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_DEMAND_FILE = "junction_mixed_train7.rou.xml"

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


class SessionRequest(BaseModel):
    demand: dict | None = Field(None, description='{"A": {"L":55,"S":600,"R":50}, ...}')
    demand_file: str | None = Field(None, description='Optional demand or route filename under data/demands')
    seed: int = config.DEFAULT_SUMO_SEED
    episode: int = config.DEFAULT_EPISODE
    qtable_seed: str | int | None = None


@app.get("/api/info")
def info():
    found = [s for s in config.SEEDS
             if Path(config.QTABLE_PATTERN.format(seed=s)).exists()]
    return {
        "net_file": NET_FILE,
        "tls_id": TLS_ID,
        "approaches": {k: len(v) for k, v in APPROACHES.items()},
        "routes": ROUTES_MAP,
        "qtable_seeds_found": found,
        "qtable_pattern": config.QTABLE_PATTERN,
        "default_seed": config.DEFAULT_SUMO_SEED,
        "default_episode": config.DEFAULT_EPISODE,
        "max_episode": config.MAX_EPISODE,
        "default_demand_file": DEFAULT_DEMAND_FILE if (DEMAND_DIR / DEFAULT_DEMAND_FILE).exists() else None,
        "is_demo_net": "demo.net.xml" in NET_FILE,
        "constants": {"min_green": config.MIN_GREEN,
                      "max_green": config.MAX_GREEN,
                      "yellow": config.MAX_RED},
    }


@app.get("/api/network")
def network():
    return GEOMETRY


@app.get("/api/demands")
def demand_files():
    return sorted([p.name for p in DEMAND_DIR.glob("*.json")] +
                  [p.name for p in DEMAND_DIR.glob("*.rou.xml")])


@app.get("/api/demands/{name}")
def demand_file(name: str):
    file = DEMAND_DIR / name
    if not file.exists() or not file.is_file():
        raise HTTPException(404, "demand file not found")
    if file.suffix.lower() == ".json":
        try:
            return json.loads(file.read_text())
        except Exception as exc:
            raise HTTPException(500, f"failed to load demand file: {exc}")
    if file.name.lower().endswith(".rou.xml"):
        return {"route_file": name}
    raise HTTPException(400, "unsupported demand file type")


@app.post("/api/session")
async def create_session(req: SessionRequest):
    try:
        insert_route = None
        demand = req.demand
        if req.demand_file:
            demand_path = DEMAND_DIR / Path(req.demand_file).name
            if not demand_path.exists() or not demand_path.is_file():
                raise HTTPException(404, f"demand file not found: {req.demand_file}")
            if demand_path.suffix.lower() == ".json":
                demand = json.loads(demand_path.read_text())
            elif demand_path.name.lower().endswith(".rou.xml"):
                insert_route = demand_path
                demand = None
            else:
                raise HTTPException(400, "unsupported demand file type")
        s = await asyncio.to_thread(
            MANAGER.create,
            demand=demand, seed=req.seed, episode=req.episode,
            qtable_seed=req.qtable_seed, net_file=NET_FILE,
            tls_id=TLS_ID, approaches=APPROACHES, routes_map=ROUTES_MAP,
            route_file=insert_route)
    except HTTPException:
        raise
    except Exception as e:                                  # surface SUMO errors
        raise HTTPException(500, f"session failed: {e}")
    return {"id": s.id, "episode": s.episode, "q_source": s.q_source}


@app.delete("/api/session/{sid}")
def drop_session(sid: str):
    MANAGER.drop(sid)
    return {"ok": True}


@app.websocket("/ws/{sid}")
async def ws(websocket: WebSocket, sid: str):
    await websocket.accept()
    s = MANAGER.get(sid)
    if s is None:
        await websocket.close(code=4404)
        return
    try:
        while True:
            msg = await websocket.receive_json()
            n = max(0, min(int(msg.get("n", 1)), 60))
            snap = await asyncio.to_thread(s.advance, n) if n else s.snapshot()
            await websocket.send_json(snap)
            if snap["done"]:
                pass        # keep socket open so the client can read final state
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass


app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
