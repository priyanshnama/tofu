"""
config.py — Central configuration for the tofu backend.

Every tunable lives here so JS constants and Python constants stay in sync.
The server prints the active config at startup for easy diagnostics.
"""
from __future__ import annotations

# ── Particles ─────────────────────────────────────────────────────────────────
PARTICLE_COUNT: int = 100_000       # Must match JS PARTICLE_COUNT in main.js

# ── NCA / shape grid ──────────────────────────────────────────────────────────
GRID_SIZE: int = 128                # H and W of the density grid  (128 × 128)

# ── NCA model ─────────────────────────────────────────────────────────────────
NCA_STATE_DIM:  int   = 16          # Number of channels in the NCA cell state
NCA_GOAL_DIM:   int   = 8           # Spatial goal-embedding channels
NCA_HIDDEN_DIM: int   = 128         # Hidden units in the update MLP
NCA_FIRE_RATE:  float = 0.5         # Fraction of cells updated per step
NCA_STEPS:      int   = 64          # Inference rollout steps

# Path for pre-trained weights.  Missing → untrained model (still functional).
NCA_CHECKPOINT: str = "backend/nca_weights.pt"

# ── Sinkhorn Optimal Transport ────────────────────────────────────────────────
N_OT_CLUSTERS: int   = 1024         # Representative points for scalable OT

# ── Shape sequencer ───────────────────────────────────────────────────────────
SHAPE_CYCLE: list = [
    "circle", "star5", "ring", "A", "E", "heart", "diamond", "O", "star6",
]
SHAPE_INTERVAL_S: float = 10.0      # Seconds each shape is held before morphing

# ── Physics (mirrored to main.js SimParams) ───────────────────────────────────
ATTRACT_K: float = 1.5              # Attraction spring constant sent to JS

# ── WebSocket server ──────────────────────────────────────────────────────────
HOST: str = "127.0.0.1"
PORT: int = 8765


def print_config() -> None:
    """Pretty-print the active configuration at server startup."""
    print("=" * 60)
    print("  tofu — Python Backend")
    print("=" * 60)
    print(f"  Particles      : {PARTICLE_COUNT:,}")
    print(f"  Grid size      : {GRID_SIZE}×{GRID_SIZE}")
    print(f"  NCA steps      : {NCA_STEPS}")
    print(f"  OT clusters    : {N_OT_CLUSTERS}")
    print(f"  Attract-K      : {ATTRACT_K}")
    print(f"  Shape interval : {SHAPE_INTERVAL_S}s")
    print(f"  Server         : ws://{HOST}:{PORT}/ws")
    print(f"  Shapes         : {', '.join(SHAPE_CYCLE)}")
    print("=" * 60)
