"""
shapes.py — Shape blueprint library for tofu.

Every shape is a function that returns a float32 NumPy array of shape
(GRID_SIZE, GRID_SIZE) with values in [0, 1], representing a spatial
density field.  The OT solver samples particle target positions from
this density — denser regions attract more atoms.

Adding a new shape:
    1. Write a function that returns an ndarray of the right shape.
    2. Register it in SHAPE_REGISTRY with a string key.
    3. Add the key to config.SHAPE_CYCLE.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

from .config import GRID_SIZE

# ── Helpers ───────────────────────────────────────────────────────────────────

def _grid() -> tuple[np.ndarray, np.ndarray]:
    """Return (X, Y) coordinate grids in [0, 1]², matching GRID_SIZE."""
    lin = np.linspace(0.0, 1.0, GRID_SIZE, dtype=np.float32)
    return np.meshgrid(lin, lin)   # X: col coords, Y: row coords


def _normalise(arr: np.ndarray, blur_sigma: float = 1.5) -> np.ndarray:
    """
    Soft-edge the density by applying a mild Gaussian blur, then rescale
    to [0, 1].  The blur prevents all atoms from piling exactly on a hard
    boundary — they spread into a natural cloud instead.
    """
    from scipy.ndimage import gaussian_filter
    blurred = gaussian_filter(arr.astype(np.float32), sigma=blur_sigma)
    lo, hi = blurred.min(), blurred.max()
    if hi - lo < 1e-6:
        return blurred
    return (blurred - lo) / (hi - lo)


# ── Mathematical shapes ───────────────────────────────────────────────────────

def circle(cx: float = 0.5, cy: float = 0.5, r: float = 0.36) -> np.ndarray:
    """Filled disc."""
    X, Y = _grid()
    return _normalise(((X - cx) ** 2 + (Y - cy) ** 2 < r ** 2).astype(np.float32))


def ring(
    cx: float = 0.5, cy: float = 0.5,
    r: float = 0.34, width: float = 0.08,
) -> np.ndarray:
    """Hollow ring (annulus)."""
    X, Y = _grid()
    dist = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    mask = (dist > r - width / 2) & (dist < r + width / 2)
    return _normalise(mask.astype(np.float32))


def star(
    cx: float = 0.5, cy: float = 0.5,
    n_points: int = 5,
    r_outer: float = 0.38,
    r_inner: float = 0.16,
) -> np.ndarray:
    """
    N-pointed star using polar interpolation between outer and inner radius.
    Works for any n_points ≥ 3.
    """
    X, Y = _grid()
    dx = X - cx
    dy = Y - cy
    theta = np.arctan2(dy, dx)
    r     = np.sqrt(dx ** 2 + dy ** 2)

    # Normalised angle within each "wedge" of the star: 0 → tip, 0.5 → valley
    wedge = (theta % (2 * np.pi / n_points)) / (2 * np.pi / n_points)
    # Star boundary oscillates between r_outer and r_inner
    star_r = r_inner + (r_outer - r_inner) * np.abs(1.0 - 2.0 * wedge)

    return _normalise((r < star_r).astype(np.float32))


def diamond(
    cx: float = 0.5, cy: float = 0.5, half: float = 0.36,
) -> np.ndarray:
    """Filled diamond (L1 ball)."""
    X, Y = _grid()
    mask = (np.abs(X - cx) + np.abs(Y - cy)) < half
    return _normalise(mask.astype(np.float32))


def heart(cx: float = 0.5, cy: float = 0.52) -> np.ndarray:
    """
    Heart shape using the algebraic implicit equation:
        (x² + y² - 1)³ - x²y³ < 0
    Coordinates are remapped to [-1.4, 1.4] to fit the grid.
    """
    X, Y = _grid()
    # Map [0,1] → [-1.4, 1.4]
    x = (X - cx) * 2.8
    y = (cy - Y) * 2.8    # flip Y so heart points up
    mask = (x ** 2 + y ** 2 - 1) ** 3 - x ** 2 * y ** 3 < 0
    return _normalise(mask.astype(np.float32))


# ── Letter / glyph shapes ─────────────────────────────────────────────────────

# Candidate system font paths (tried in order, first found wins)
_FONT_CANDIDATES: list = [
    "/System/Library/Fonts/Helvetica.ttc",                       # macOS
    "/System/Library/Fonts/HelveticaNeue.ttc",                   # macOS alt
    "/System/Library/Fonts/Supplemental/Arial.ttf",              # macOS 13+
    "/Library/Fonts/Arial.ttf",                                  # macOS user
    "/System/Library/Fonts/Arial.ttf",                           # macOS older
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",      # Linux
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
]


def _find_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    # Last resort: PIL built-in bitmap font (very small but always available)
    return ImageFont.load_default()


def letter(char: str, font_size: int = 96) -> np.ndarray:
    """
    Render a single character centred in the grid using Pillow.
    Works with any Unicode character the system font supports.
    """
    img  = Image.new("L", (GRID_SIZE, GRID_SIZE), 0)
    draw = ImageDraw.Draw(img)
    font = _find_font(font_size)

    # Get bounding box to centre the glyph
    bbox = draw.textbbox((0, 0), char, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x    = (GRID_SIZE - w) // 2 - bbox[0]
    y    = (GRID_SIZE - h) // 2 - bbox[1]

    draw.text((x, y), char, fill=255, font=font)

    arr = np.array(img, dtype=np.float32) / 255.0
    return _normalise(arr, blur_sigma=1.0)


# ── Shape registry ────────────────────────────────────────────────────────────

SHAPE_REGISTRY: dict = {
    "circle":  circle,
    "ring":    ring,
    "star5":   lambda: star(n_points=5),
    "star6":   lambda: star(n_points=6),
    "diamond": diamond,
    "heart":   heart,
    # Letters — add any Unicode character you like
    "A": lambda: letter("A"),
    "E": lambda: letter("E"),
    "I": lambda: letter("I"),
    "O": lambda: letter("O"),
    "0": lambda: letter("0"),
}


class ShapeLibrary:
    """
    Thin wrapper around SHAPE_REGISTRY that caches generated grids so the
    same shape is only computed once per process lifetime.
    """

    def __init__(self) -> None:
        self._cache: dict = {}

    def get(self, name: str) -> np.ndarray:
        """Return the density grid for *name*, generating it on first call."""
        if name not in self._cache:
            if name not in SHAPE_REGISTRY:
                raise KeyError(
                    f"Unknown shape '{name}'. "
                    f"Available: {list(SHAPE_REGISTRY.keys())}"
                )
            print(f"[shapes] Generating '{name}' …", end=" ", flush=True)
            self._cache[name] = SHAPE_REGISTRY[name]()
            print("done")
        return self._cache[name]

    @property
    def names(self) -> list:
        return list(SHAPE_REGISTRY.keys())
