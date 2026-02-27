"""
ot_assignment.py — Generate 1D shape distributions for 5000 atoms.

Produces two files consumed by main.js:
  public/shapes.bin   — all distributions concatenated  (M × N × 4 bytes)
  public/shapes.json  — ordered list of display names

The OT assignment itself happens in JavaScript at transition time
(sort-based monotone rearrangement, O(N log N), essentially instant).

Shapes
──────
  Statistical  :  uniform, gaussian, bimodal, trimodal, edges, centre
  Morse code   :  A · −   B − · · ·   C − · − ·   D − · ·   E ·   F · · − ·

Morse encoding
──────────────
Each symbol becomes a Gaussian cluster of atoms spread across [-0.82, 0.82]:
  dot  (·)  →  narrow cluster,  1 unit wide,  proportional atom count
  dash (−)  →  wider  cluster,  3 units wide, 3× more atoms than a dot
  gap between elements = 1 unit (empty space in the layout)

Usage:
  source venv/bin/activate
  python ot_assignment.py
"""

import json
import numpy as np
from pathlib import Path

N = 5_000   # must match main.js constant


# ── Statistical shapes ────────────────────────────────────────────────────────

def s_uniform(n, rng):
    return rng.uniform(-0.85, 0.85, n).astype(np.float32)

def s_gaussian(n, rng):
    return np.clip(rng.normal(0.0, 0.28, n), -0.90, 0.90).astype(np.float32)

def s_bimodal(n, rng):
    h = n // 2
    return np.clip(
        np.concatenate([rng.normal(-0.55, 0.10, h), rng.normal(+0.55, 0.10, n - h)]),
        -0.90, 0.90).astype(np.float32)

def s_trimodal(n, rng):
    t = n // 3
    return np.clip(
        np.concatenate([rng.normal(-0.65, 0.08, t),
                        rng.normal( 0.00, 0.08, t),
                        rng.normal(+0.65, 0.08, n - 2*t)]),
        -0.90, 0.90).astype(np.float32)

def s_edges(n, rng):
    h = n // 2
    return np.clip(
        np.concatenate([rng.normal(-0.80, 0.05, h), rng.normal(+0.80, 0.05, n - h)]),
        -0.90, 0.90).astype(np.float32)

def s_centre(n, rng):
    return np.clip(rng.normal(0.0, 0.05, n), -0.90, 0.90).astype(np.float32)


# ── Morse code shapes ─────────────────────────────────────────────────────────

MORSE = {
    'A': '.-',
    'B': '-...',
    'C': '-.-.',
    'D': '-..',
    'E': '.',
    'F': '..-.',
}

def s_morse(letter, n, rng):
    """
    Each symbol is a flat rectangular block of atoms, uniformly distributed.

    DOT_W  = 0.05 NDC   narrow spike
    DASH_W = 0.22 NDC   visibly wider bar
    GAP    = 0.07 NDC   empty space between symbols

    KEY RULE: every symbol — dot or dash — always gets exactly N_PER_SYM
    atoms, regardless of which letter it belongs to. This makes every dot
    look identical across all letters (same width, same brightness).

    MITOSIS RULE: letters with fewer than MAX_SYMS symbols have dormant atoms
    that are stacked exactly on top of active atoms (same x position). Since
    two tick marks at the same x render as one, they are visually invisible.
    When the next shape needs more atoms, the OT assignment pairs dormant atoms
    with new targets and they split apart — visually budding off like mitosis.
    Going the other way (more symbols → fewer), atoms converge and merge back.
    """
    DOT_W      = 0.05
    DASH_W     = 0.22
    GAP        = 0.07
    MAX_SYMS   = max(len(v) for v in MORSE.values())   # = 4  (B, C, F)
    N_PER_SYM  = n // MAX_SYMS                         # = 1250 for n=5000

    code = MORSE[letter]

    # Build (left, right) segments, then centre around x=0
    x, segs = 0.0, []
    for i, sym in enumerate(code):
        w = DOT_W if sym == '.' else DASH_W
        segs.append((x, x + w))
        x += w + (GAP if i < len(code) - 1 else 0.0)
    offset = x / 2.0
    segs   = [(l - offset, r - offset) for l, r in segs]

    # Fixed atom count per symbol
    pts = [rng.uniform(l, r, N_PER_SYM) for l, r in segs]

    # Dormant atoms: stack on top of existing active atoms (mitosis seeds).
    # They are invisible at rest (same x = same tick mark) but split to new
    # targets during OT transitions — no atoms ever leave the screen.
    leftover = n - N_PER_SYM * len(segs)
    if leftover > 0:
        active = np.concatenate(pts)
        dormant_idx = rng.integers(0, len(active), size=leftover)
        pts.append(active[dormant_idx])

    return np.concatenate(pts).astype(np.float32)


# ── Build all shapes ──────────────────────────────────────────────────────────

def build_all(n=N, seed=42):
    rng = np.random.default_rng(seed)

    shapes = {}

    # Morse code A–F only
    for letter in 'ABCDEF':
        sym = MORSE[letter].replace('.', '·').replace('-', '−')
        shapes[f'{letter}  {sym}'] = s_morse(letter, n, rng)

    return shapes


# ── Export ────────────────────────────────────────────────────────────────────

def main():
    shapes = build_all()
    names  = list(shapes.keys())
    M      = len(names)

    print(f'Generating {M} shapes × {N:,} atoms …')
    for name in names:
        arr = shapes[name]
        print(f'  {name:<18}  mean={arr.mean():+.3f}  std={arr.std():.3f}')

    Path('public').mkdir(exist_ok=True)

    # shapes.bin: M × N floats, each shape packed sequentially
    packed = np.concatenate([shapes[k] for k in names])
    packed.tofile('public/shapes.bin')
    kb = packed.nbytes / 1024
    print(f'\n→ public/shapes.bin   ({kb:.0f} KB  =  {M} × {N} × 4 B)')

    # shapes.json: ordered name list so JS knows the count and labels
    with open('public/shapes.json', 'w') as f:
        json.dump(names, f, ensure_ascii=False)
    print(f'→ public/shapes.json  {names}')

    print('\nDone.  Run: npx vite')


if __name__ == '__main__':
    main()
