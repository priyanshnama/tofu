"""
train.py — Optional NCA training script.

Trains the Goal-Guided NCA on all shapes in SHAPE_CYCLE for a configurable
number of gradient steps per shape.  After training the model generates
organic, self-organised growth toward each shape rather than a diffused
copy of the goal image.

Usage (from project root, venv active):
    python -m backend.train
    python -m backend.train --steps 1000 --lr 3e-3 --device mps
    python -m backend.train --shapes circle star5 A --steps 500
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

import torch

from .config import SHAPE_CYCLE, NCA_CHECKPOINT
from .shapes import ShapeLibrary
from .nca import NCAModel


def train(
    shapes:  list,
    steps:   int   = 500,
    lr:      float = 2e-3,
    device:  str   = "cpu",
    out:     str   = NCA_CHECKPOINT,
) -> None:
    """
    Train a single NCAModel on all *shapes* sequentially.

    One training pass per shape runs for *steps* gradient steps with a
    randomised curriculum rollout length (32 … NCA_STEPS).

    The trained weights are saved to *out* after each shape so progress is
    preserved even if training is interrupted.
    """
    lib   = ShapeLibrary()
    model = NCAModel().to(device)

    # Load existing checkpoint so re-running extends prior training
    p = Path(out)
    if p.exists():
        model.load(out)
        print(f"Resuming from checkpoint: {out}")

    total_start = time.perf_counter()

    for shape_name in shapes:
        print(f"\n{'─'*50}")
        print(f"  Training on '{shape_name}'  ({steps} steps, lr={lr})")
        print(f"{'─'*50}")

        goal_grid = lib.get(shape_name)
        t0 = time.perf_counter()
        model.train_on_shape(goal_grid, n_steps=steps, lr=lr, device=device)
        elapsed = time.perf_counter() - t0

        print(f"  Finished '{shape_name}' in {elapsed:.1f}s")
        model.save(out)

    total = time.perf_counter() - total_start
    print(f"\n{'='*50}")
    print(f"  Training complete in {total:.1f}s")
    print(f"  Weights saved → {out}")
    print(f"{'='*50}")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Train the Goal-Guided NCA on shape blueprints."
    )
    p.add_argument(
        "--shapes", nargs="+", default=SHAPE_CYCLE,
        help="Space-separated list of shape names to train on.",
    )
    p.add_argument(
        "--steps", type=int, default=500,
        help="Gradient steps per shape (default: 500).",
    )
    p.add_argument(
        "--lr", type=float, default=2e-3,
        help="Learning rate (default: 2e-3).",
    )
    p.add_argument(
        "--device", default="cpu",
        choices=["cpu", "cuda", "mps"],
        help="Torch device (default: cpu).",
    )
    p.add_argument(
        "--out", default=NCA_CHECKPOINT,
        help=f"Output checkpoint path (default: {NCA_CHECKPOINT}).",
    )
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    train(
        shapes=args.shapes,
        steps=args.steps,
        lr=args.lr,
        device=args.device,
        out=args.out,
    )
