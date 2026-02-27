"""
ot_solver.py — Sinkhorn Optimal Transport solver for 100 k particles.

The Challenge
─────────────
Running Sinkhorn OT directly on 100 000 source × 100 000 target pairs
requires a (100k)² cost matrix — 40 GB at float32.  That's infeasible.

Our Solution: Random-Cluster Sinkhorn
──────────────────────────────────────
1. Sub-sample N_OT_CLUSTERS (default 512) random source positions from
   the current particle cloud.  These act as *representatives* of where
   the swarm currently lives.

2. Sample the same number of target positions from the NCA-generated
   density field via importance sampling.

3. Run Sinkhorn OT on the small (512 × 512) cost matrix.  This is fast
   (< 0.1 s on CPU) and gives us a discrete transport plan T[i,j].

4. MAP assignment: argmax of each row gives each source representative
   its assigned target representative.

5. Nearest-neighbour lookup: for every one of the 100 k particles, find
   its closest source representative (via a cKDTree), then inherit that
   representative's target assignment.

6. Per-particle jitter: add small Gaussian noise so that thousands of
   particles assigned to the same representative don't all pile onto one
   pixel — they spread into a natural cloud around it.

The result: 100 k particles each get a distinct target position that
collectively fill the goal shape, with smooth transitions between shapes.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import ot                              # Python Optimal Transport (POT)
from scipy.spatial import cKDTree

from .config import (
    PARTICLE_COUNT, GRID_SIZE, N_OT_CLUSTERS,
)


# ── Density sampling ──────────────────────────────────────────────────────────

def sample_from_density(
    density:   np.ndarray,    # (H, W) float32 in [0, 1]
    n_samples: int,
    jitter:    float = 0.5,   # sub-pixel jitter in grid-cell units
) -> np.ndarray:
    """
    Draw *n_samples* positions (NDC) from *density* via importance sampling.

    A small uniform floor (1 % of the peak) is added before sampling so that
    zero-density regions are never completely unreachable — this prevents
    edge-case degenerate configurations in the OT plan.
    """
    H, W = density.shape

    # Add a tiny floor so every cell has non-zero probability
    flat = density.flatten().astype(np.float64)
    flat = flat + 0.001 * flat.max()
    flat /= flat.sum()

    # Draw flat indices via multinomial sampling
    indices = np.random.choice(len(flat), size=n_samples, p=flat)
    rows, cols = np.unravel_index(indices, (H, W))

    # Sub-pixel jitter so sampled points don't all sit on grid centres
    rows = rows + np.random.uniform(-jitter, jitter, n_samples)
    cols = cols + np.random.uniform(-jitter, jitter, n_samples)

    # Map grid coordinates → NDC  [-1, +1]
    # Rows increase downward in image space, but NDC y increases upward,
    # so we must flip: row 0 (top of image) → y_ndc = +1 (top of screen).
    x_ndc =       (cols / W) * 2.0 - 1.0
    y_ndc = 1.0 - (rows / H) * 2.0

    return np.stack([x_ndc, y_ndc], axis=1).astype(np.float32)  # (n_samples, 2)


# ── OT Solver ─────────────────────────────────────────────────────────────────

class OTSolver:
    """
    Scalable Sinkhorn OT solver using random-cluster sub-sampling.

    Usage
    ─────
        solver = OTSolver()
        targets = solver.solve(
            source_positions,   # (100 000, 2) float32  or  None for first call
            target_density,     # (128, 128)   float32
        )
        # targets: (100 000, 2) float32  — one NDC target per particle
    """

    def __init__(
        self,
        n_clusters: int   = N_OT_CLUSTERS,
        particle_jitter: float = 0.02,    # NDC units of per-particle spread
    ) -> None:
        self.n_clusters      = n_clusters
        self.particle_jitter = particle_jitter

    # ── Public API ────────────────────────────────────────────────────────────

    def solve(
        self,
        source_positions: Optional[np.ndarray],  # (N, 2) or None
        target_density:   np.ndarray,             # (H, W) float32
    ) -> np.ndarray:
        """
        Compute per-particle target positions via cluster-Sinkhorn OT.

        If *source_positions* is None (first call), a uniform random
        distribution is used as the source — this represents the initial
        chaotic scatter of the swarm before any backend frame.

        Returns
        ───────
        np.ndarray  (PARTICLE_COUNT, 2)  float32  —  NDC target per particle
        """
        N = PARTICLE_COUNT

        # ── Source representative sample ──────────────────────────────────
        if source_positions is None or len(source_positions) == 0:
            # First frame: assume uniform scatter
            source_positions = np.random.uniform(-1.0, 1.0, (N, 2)).astype(np.float32)

        src = source_positions.astype(np.float32)

        # Random sub-sample of source positions (no clustering needed — fast)
        src_idx  = np.random.choice(len(src), self.n_clusters, replace=False)
        src_pts  = src[src_idx]   # (K, 2)

        # ── Target representative sample ──────────────────────────────────
        tgt_pts = sample_from_density(target_density, self.n_clusters)  # (K, 2)

        # ── Exact OT on K×K cost matrix ──────────────────────────────────
        # Use exact Earth Mover's Distance (no regularisation) so the transport
        # plan is a proper bijection: every source maps to a UNIQUE target.
        # Sinkhorn with reg>0 produces a diffuse plan where argmax collapses
        # many sources to the same target, badly distorting the shape.
        a = np.ones(self.n_clusters, dtype=np.float64) / self.n_clusters
        b = np.ones(self.n_clusters, dtype=np.float64) / self.n_clusters

        M = ot.dist(src_pts.astype(np.float64), tgt_pts.astype(np.float64),
                    metric="sqeuclidean")
        M_norm = M / (M.max() + 1e-9)

        # Exact OT plan — T is essentially a permutation matrix (bijection)
        T = ot.emd(a, b, M_norm)

        # Each source representative maps to its unique assigned target
        assign = np.argmax(T, axis=1)    # (K,)
        tgt_for_src = tgt_pts[assign]    # (K, 2)

        # ── Nearest-neighbour assignment for all 100 k particles ──────────
        # Build a KD-tree on the K source representatives and query all N
        # particles — O(N log K), takes ~20 ms for N=100 000, K=512.
        tree     = cKDTree(src_pts)
        _, nn_id = tree.query(src, k=1, workers=-1)   # (N,)

        # Each particle inherits its nearest representative's target
        particle_targets = tgt_for_src[nn_id].copy()  # (N, 2)

        # ── Per-particle jitter ───────────────────────────────────────────
        # Without jitter, every particle assigned to the same representative
        # would rush to the same exact point, creating unpleasant "black holes".
        jitter = np.random.randn(N, 2).astype(np.float32) * self.particle_jitter
        particle_targets += jitter

        # Clamp to NDC range so targets don't escape the canvas
        particle_targets = np.clip(particle_targets, -1.0, 1.0)

        return particle_targets.astype(np.float32)   # (N, 2)

    # ── Diagnostics ───────────────────────────────────────────────────────────

    def earth_mover_distance(
        self,
        source_positions: np.ndarray,
        target_density:   np.ndarray,
        n_sample:         int = 2048,
    ) -> float:
        """
        Approximate EMD between the source cloud and the target density.
        Useful for monitoring convergence in the training / debug loop.
        """
        src_idx = np.random.choice(len(source_positions), n_sample, replace=False)
        src_s   = source_positions[src_idx].astype(np.float64)
        tgt_s   = sample_from_density(target_density, n_sample).astype(np.float64)

        a = np.ones(n_sample) / n_sample
        b = np.ones(n_sample) / n_sample
        M = ot.dist(src_s, tgt_s, metric="sqeuclidean")

        return float(ot.emd2(a, b, M))
