"""
server.py — WebSocket server for the tofu backend.

What this server does
─────────────────────
  1. On startup it generates the first target shape immediately so newly
     connecting clients always get data right away.

  2. A background asyncio task cycles through SHAPE_CYCLE every
     SHAPE_INTERVAL_S seconds:
       a. Run the NCA to grow the next shape from its density blueprint.
       b. Run Sinkhorn OT to compute a smooth, non-chaotic mapping from the
          previous targets to the new shape's target positions.
       c. Broadcast the 100 k × 2 float32 positions (800 KB binary frame)
          to every connected WebSocket client.

  3. The WebSocket endpoint at /ws:
       • Accepts any number of simultaneous clients.
       • Sends current targets immediately on connect.
       • Sends a JSON metadata frame before each binary data frame so the
         JS frontend knows which shape is forming.
       • Handles disconnects gracefully.

Wire protocol (server → client)
────────────────────────────────
  Frame A (text / JSON):
    { "type": "shape_info",
      "name": "<shape_name>",
      "attract_k": 2.0 }

  Frame B (binary):
    Raw Float32Array, length = PARTICLE_COUNT × 2 floats = 800 000 bytes.
    Layout: [x0, y0, x1, y1, … x_{N-1}, y_{N-1}]  (NDC, -1 … +1)

Running
───────
  cd tofu
  source venv/bin/activate
  pip install -r backend/requirements.txt
  uvicorn backend.server:app --host 127.0.0.1 --port 8765 --reload
"""
from __future__ import annotations

import asyncio
import json
import itertools
import time
from typing import Optional, Set

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import (
    SHAPE_CYCLE, SHAPE_INTERVAL_S, ATTRACT_K,
    HOST, PORT, PARTICLE_COUNT, NCA_CHECKPOINT,
    print_config,
)
from .shapes import ShapeLibrary
from .nca import load_or_create_nca, NCAModel
from .ot_solver import OTSolver


# ═══════════════════════════════════════════════════════════════════════════════
# Shape Engine — manages state and drives the shape-morphing loop
# ═══════════════════════════════════════════════════════════════════════════════

class ShapeEngine:
    """
    Singleton that owns the NCA model, OT solver, and shape library.

    All mutable state is read/written from the same asyncio event loop so
    no locks are needed.
    """

    def __init__(self) -> None:
        self.lib:    ShapeLibrary = ShapeLibrary()
        self.nca:    NCAModel     = load_or_create_nca(NCA_CHECKPOINT)
        self.solver: OTSolver     = OTSolver()

        # Shared state (read by WebSocket handlers, written by the bg task)
        self.current_targets:      Optional[np.ndarray] = None   # (N, 2) float32
        self.current_shape_name:   str                  = ""
        self.current_info_frame:   Optional[bytes]      = None   # serialised JSON

        # Active WebSocket connections
        self.clients: Set[WebSocket] = set()

    # ── Background loop ───────────────────────────────────────────────────────

    async def run(self) -> None:
        """
        Infinite loop that generates and broadcasts a new shape every
        SHAPE_INTERVAL_S seconds.  Runs as a background asyncio task.
        """
        print_config()
        shape_gen = itertools.cycle(SHAPE_CYCLE)

        for shape_name in shape_gen:
            t0 = time.perf_counter()

            await self._transition_to(shape_name)

            elapsed = time.perf_counter() - t0
            wait    = max(0.0, SHAPE_INTERVAL_S - elapsed)
            print(
                f"[engine] '{shape_name}' ready in {elapsed:.2f}s  "
                f"— holding for {wait:.1f}s"
            )
            await asyncio.sleep(wait)

    async def _transition_to(self, shape_name: str) -> None:
        """
        Generate target positions for *shape_name* and broadcast.

        This runs in the asyncio event loop.  The heavy CPU work (NCA + OT)
        is offloaded to a thread pool via run_in_executor so it doesn't
        block the event loop and drop WebSocket heartbeats.
        """
        loop = asyncio.get_running_loop()

        # ── Heavy CPU work in thread pool ──────────────────────────────────
        new_targets, info_frame = await loop.run_in_executor(
            None,   # default ThreadPoolExecutor
            self._compute_targets,
            shape_name,
        )

        # ── Update shared state (safe: single event-loop thread) ──────────
        self.current_targets    = new_targets
        self.current_shape_name = shape_name
        self.current_info_frame = info_frame

        # ── Broadcast to all connected clients ────────────────────────────
        await self._broadcast(info_frame, new_targets.tobytes())

    def _compute_targets(
        self,
        shape_name: str,
    ) -> tuple:
        """
        Blocking CPU computation — runs in a thread pool.

        Returns (new_targets: ndarray, info_frame: bytes).
        """
        # 1. Get goal density grid (cached after first call)
        goal_grid = self.lib.get(shape_name)

        # 2. Run NCA to produce an organically grown density
        print(f"[NCA]  generating '{shape_name}' …", end=" ", flush=True)
        t0      = time.perf_counter()
        density = self.nca.generate(goal_grid)
        print(f"done ({time.perf_counter() - t0:.2f}s)")

        # 3. Sinkhorn OT: map previous targets → new density
        print(f"[OT]   computing transport ({PARTICLE_COUNT:,} particles) …",
              end=" ", flush=True)
        t0          = time.perf_counter()
        new_targets = self.solver.solve(self.current_targets, density)
        print(f"done ({time.perf_counter() - t0:.2f}s)")

        # 4. Build metadata JSON frame
        info = json.dumps({
            "type":      "shape_info",
            "name":      shape_name,
            "attract_k": ATTRACT_K,
        }).encode()

        return new_targets, info

    # ── Broadcasting ──────────────────────────────────────────────────────────

    async def _broadcast(
        self,
        info_bytes: bytes,
        data_bytes: bytes,
    ) -> None:
        """Send the info frame then the binary data frame to every client."""
        if not self.clients:
            return

        dead: Set[WebSocket] = set()

        for ws in list(self.clients):
            try:
                await ws.send_bytes(info_bytes)   # JSON as bytes
                await ws.send_bytes(data_bytes)   # Float32 binary
            except Exception as exc:
                print(f"[ws] Send error ({exc}) — dropping client.")
                dead.add(ws)

        self.clients -= dead

    async def send_current_to(self, ws: WebSocket) -> None:
        """
        Push the current shape data to a newly connected client.
        Called once immediately after a client's WebSocket handshake.
        """
        if self.current_info_frame is None or self.current_targets is None:
            return   # engine hasn't produced its first shape yet
        try:
            await ws.send_bytes(self.current_info_frame)
            await ws.send_bytes(self.current_targets.tobytes())
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════════
# FastAPI application
# ═══════════════════════════════════════════════════════════════════════════════

app    = FastAPI(title="tofu — Backend")
engine = ShapeEngine()

# Allow the Vite dev server (localhost:5173) to connect without CORS issues
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    """Launch the shape-generation loop as a background task."""
    asyncio.create_task(engine.run())


@app.get("/")
async def health() -> dict:
    return {
        "status":        "ok",
        "shape":         engine.current_shape_name,
        "clients":       len(engine.clients),
        "particle_count": PARTICLE_COUNT,
    }


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    """
    WebSocket endpoint — one per connected browser tab.

    Lifecycle:
      1. Accept connection, register in engine.clients.
      2. Send current shape data immediately (if available).
      3. Wait indefinitely — the engine's broadcast loop pushes updates.
      4. On disconnect, remove from engine.clients.
    """
    await ws.accept()
    engine.clients.add(ws)
    print(f"[ws] Client connected  — total: {len(engine.clients)}")

    # Give the new client the latest shape right away
    await engine.send_current_to(ws)

    try:
        # Keep the connection alive; receive() raises on disconnect.
        # We don't process client messages in this version, but the loop
        # means we'll detect disconnects promptly.
        async for _msg in ws.iter_bytes():
            pass   # reserved for future client→server commands
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[ws] Unexpected error: {exc}")
    finally:
        engine.clients.discard(ws)
        print(f"[ws] Client disconnected — total: {len(engine.clients)}")
