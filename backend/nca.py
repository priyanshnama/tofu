"""
nca.py — Goal-Guided Neural Cellular Automata (NCA).

Architecture
────────────
Each cell in a (GRID_SIZE × GRID_SIZE) grid maintains a STATE_DIM-channel
state vector.  On every NCA step:

  1. Perception  — Fixed Sobel-x / Sobel-y / identity filters applied
                   channel-wise give each cell a view of its neighbourhood.

  2. Goal embed  — A tiny CNN encodes the target shape image into a per-cell
                   spatial embedding.  This is the "goal-guidance" signal that
                   steers the automaton toward a desired shape.

  3. Update MLP  — A two-layer network maps (perception ‖ goal_embed) → Δstate.
                   The last layer is zero-initialised so the model starts as
                   an identity mapping and learns meaningful updates from there.

  4. Stochastic mask — During training a random fraction (fire_rate) of cells
                   are actually updated each step.  This prevents synchrony
                   artefacts and makes the rule more robust to different seeds.

Untrained mode
──────────────
When no checkpoint is loaded the final-layer weights are zero, so the update
network is the identity.  generate() seeds the grid with goal_grid + small
noise and runs the NCA for NCA_STEPS steps — the result is a slightly diffused
version of the goal, which is fully usable by the OT solver.

Training
────────
Call model.train_on_shape(goal_grid) to fine-tune for a single shape for ~500
gradient steps (≈ 30 s on CPU for a 128×128 grid).  The loss is pixel-wise BCE
between the first channel (sigmoid-squashed) and the goal grid.  Use
train_all_shapes() in train.py for a full multi-shape training run.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional, Union

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .config import (
    GRID_SIZE, NCA_STATE_DIM, NCA_GOAL_DIM, NCA_HIDDEN_DIM,
    NCA_FIRE_RATE, NCA_STEPS, NCA_CHECKPOINT,
)


# ── Perception module ─────────────────────────────────────────────────────────

class NCAPerception(nn.Module):
    """
    Apply fixed Sobel-x, Sobel-y, and identity kernels to every channel of the
    cell state independently, then concatenate along the channel axis.

    Input:  (B, C, H, W)
    Output: (B, 3·C, H, W)
    """

    def __init__(self) -> None:
        super().__init__()
        # Normalised 3×3 Sobel kernels
        kx = torch.tensor(
            [[-1., 0., 1.], [-2., 0., 2.], [-1., 0., 1.]], dtype=torch.float32
        ) / 8.0
        ky = kx.T.clone()
        # Register as buffers so they move with .to(device) automatically
        self.register_buffer("kx", kx.view(1, 1, 3, 3))
        self.register_buffer("ky", ky.view(1, 1, 3, 3))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, C, H, W = x.shape
        flat = x.reshape(B * C, 1, H, W)
        gx   = F.conv2d(flat, self.kx, padding=1).reshape(B, C, H, W)
        gy   = F.conv2d(flat, self.ky, padding=1).reshape(B, C, H, W)
        return torch.cat([x, gx, gy], dim=1)   # (B, 3·C, H, W)


# ── Goal encoder ──────────────────────────────────────────────────────────────

class GoalEncoder(nn.Module):
    """
    Encode a target density image into a spatial feature map that is
    concatenated with the perception output at every cell.

    Input:  (B, 1, H, W)  — normalised density in [0, 1]
    Output: (B, goal_dim, H, W)
    """

    def __init__(self, goal_dim: int = NCA_GOAL_DIM) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, 16, kernel_size=3, padding=1), nn.ReLU(),
            nn.Conv2d(16, goal_dim, kernel_size=3, padding=1),
        )

    def forward(self, goal: torch.Tensor) -> torch.Tensor:
        return self.net(goal)   # (B, goal_dim, H, W)


# ── NCA model ─────────────────────────────────────────────────────────────────

class NCAModel(nn.Module):
    """
    Goal-Guided Neural Cellular Automata.

    See module docstring for the full architecture description.
    """

    def __init__(
        self,
        state_dim:  int   = NCA_STATE_DIM,
        goal_dim:   int   = NCA_GOAL_DIM,
        hidden_dim: int   = NCA_HIDDEN_DIM,
        fire_rate:  float = NCA_FIRE_RATE,
    ) -> None:
        super().__init__()
        self.state_dim = state_dim
        self.fire_rate = fire_rate

        self.perception = NCAPerception()
        self.goal_enc   = GoalEncoder(goal_dim)

        in_dim = 3 * state_dim + goal_dim
        self.update_net = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.ReLU(),
            # Zero-init: network starts as identity; updates learned from scratch
            nn.Linear(hidden_dim, state_dim, bias=False),
        )
        nn.init.zeros_(self.update_net[-1].weight)

    # ── Single NCA step ───────────────────────────────────────────────────────

    def forward(
        self,
        x:    torch.Tensor,   # (B, state_dim, H, W)
        goal: torch.Tensor,   # (B, 1, H, W)  — target density image
    ) -> torch.Tensor:

        B, C, H, W = x.shape

        percept   = self.perception(x)                       # (B, 3·C, H, W)
        goal_feat = self.goal_enc(goal)                      # (B, goal_dim, H, W)
        combined  = torch.cat([percept, goal_feat], dim=1)   # (B, 3·C+goal_dim, H, W)

        # Flatten spatial dims → apply shared MLP → restore spatial dims
        inp   = combined.permute(0, 2, 3, 1).reshape(B * H * W, -1)
        delta = self.update_net(inp).reshape(B, H, W, C).permute(0, 3, 1, 2)

        # Stochastic update mask (training only — deterministic at inference)
        if self.training:
            mask  = (torch.rand(B, 1, H, W, device=x.device) < self.fire_rate).float()
            delta = delta * mask

        return (x + delta).clamp(-2.0, 2.0)

    # ── Inference ─────────────────────────────────────────────────────────────

    @torch.no_grad()
    def generate(
        self,
        goal_grid:  np.ndarray,                      # (H, W) float32 in [0,1]
        steps:      int                 = NCA_STEPS,
        device:     Union[str, torch.device] = "cpu",
        seed_noise: float               = 0.05,
    ) -> np.ndarray:
        """
        Roll out the NCA for *steps* steps and return the resulting density.

        Seeding strategy
        ────────────────
        The grid is initialised to goal_grid + small Gaussian noise.
        An *untrained* model (zero final weights) will produce a gently
        diffused version of the goal — already useful for OT sampling.
        A *trained* model will produce organic, self-organised growth toward
        the goal shape.

        Returns
        ───────
        np.ndarray of shape (H, W) in [0, 1] — the density field to sample
        particle target positions from.
        """
        H, W = goal_grid.shape
        self.eval().to(device)

        # Seed: goal shape + noise so that even untrained models start reasonable
        x    = torch.zeros(1, self.state_dim, H, W, device=device)
        seed = torch.tensor(goal_grid, dtype=torch.float32, device=device)
        x[0, 0] = seed + torch.randn_like(seed) * seed_noise
        x = x.clamp(-1.0, 1.0)

        goal_t = seed.unsqueeze(0).unsqueeze(0)   # (1, 1, H, W)

        for _ in range(steps):
            x = self(x, goal_t)

        # First channel → density via sigmoid
        return torch.sigmoid(x[0, 0]).cpu().numpy().astype(np.float32)

    # ── Training (optional) ───────────────────────────────────────────────────

    def train_on_shape(
        self,
        goal_grid:  np.ndarray,
        n_steps:    int   = 500,
        lr:         float = 2e-3,
        device:     Union[str, torch.device] = "cpu",
        log_every:  int   = 50,
    ) -> list:
        """
        Fine-tune the model on a single shape for *n_steps* gradient steps.

        Uses a randomised rollout length each step (curriculum from 32 to
        NCA_STEPS) so the model learns to maintain the shape at any depth,
        not just at a fixed horizon.

        Returns a list of (step, loss) tuples for progress monitoring.
        """
        self.train().to(device)
        optimizer = torch.optim.Adam(self.parameters(), lr=lr)
        H = W = GRID_SIZE
        goal_t  = torch.tensor(goal_grid, dtype=torch.float32, device=device)
        goal_4d = goal_t.unsqueeze(0).unsqueeze(0)   # (1, 1, H, W)
        target  = goal_t.unsqueeze(0)                # (1, H, W)

        log: list = []
        for step in range(1, n_steps + 1):
            # Fresh seed from centre cell for each training sample
            x = torch.zeros(1, self.state_dim, H, W, device=device)
            x[0, 0, H // 2, W // 2] = 1.0

            rollout = np.random.randint(32, NCA_STEPS + 1)
            for _ in range(rollout):
                x = self(x, goal_4d)

            pred = torch.sigmoid(x[:, 0])   # (1, H, W)
            loss = F.binary_cross_entropy(pred, target)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            if step % log_every == 0:
                log.append((step, loss.item()))
                print(f"  step {step:4d}/{n_steps}  loss={loss.item():.4f}")

        self.eval()
        return log

    def save(self, path: str = NCA_CHECKPOINT) -> None:
        torch.save(self.state_dict(), path)
        print(f"[NCA] Saved weights → {path}")

    def load(self, path: str = NCA_CHECKPOINT) -> None:
        state = torch.load(path, map_location="cpu")
        self.load_state_dict(state)
        print(f"[NCA] Loaded weights ← {path}")


# ── Factory ───────────────────────────────────────────────────────────────────

def load_or_create_nca(
    checkpoint: Optional[str] = NCA_CHECKPOINT,
    device: str = "cpu",
) -> NCAModel:
    """
    Return an NCAModel, loading pretrained weights when available.

    If the checkpoint file is missing the model still works — it just
    produces softened goal shapes (identity behaviour) rather than
    organically grown ones.
    """
    model = NCAModel()
    if checkpoint:
        p = Path(checkpoint)
        if p.exists():
            model.load(checkpoint)
        else:
            print(f"[NCA] No checkpoint at '{checkpoint}' — using untrained model.")
    else:
        print("[NCA] Running in untrained mode.")
    return model.eval().to(device)
