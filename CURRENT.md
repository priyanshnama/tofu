# Project Tofu — Current State (v1)

Snapshot of everything built before the architectural pivot to full GPU / no-backend.

---

## What It Is

A 1D particle simulation rendered with WebGPU. 5,000 atoms each have one coordinate:
their x-position on a number line. Rendered as vertical tick marks — denser regions
appear as bright solid bands.

---

## File Map

```
tofu/
├── index.html          UI shell: left panel (HUD + prompt input) + right canvas
├── main.js             WebGPU init, simulation loop, input wiring
├── morse.js            text → morse token stream (pure, no side effects)
├── layout.js           morse tokens → NDC segments with auto-scaling T
├── sampler.js          NDC segments → Float32Array(N) with mitosis dormant atoms
├── ot_assignment.py    one-off script: generates public/shapes.bin + shapes.json
├── public/
│   ├── shapes.bin      precomputed 1D distributions (6 morse letters A–F)
│   └── shapes.json     ordered name list for shapes.bin
├── backend/
│   ├── config.py       all tunables (PARTICLE_COUNT=100k, GRID_SIZE=128, etc.)
│   ├── shapes.py       2D density-field generators (circle, star, heart, letters…)
│   ├── nca.py          Goal-Guided NCA model (PyTorch, CPU/CUDA/MPS)
│   ├── ot_solver.py    Cluster-Sinkhorn OT (Python OT library + scipy KDTree)
│   ├── server.py       FastAPI WebSocket server — generates & broadcasts shapes
│   └── train.py        NCA training script (multi-shape curriculum)
└── package.json        Vite dev server only
```

---

## Simulation Loop (main.js)

### GPU buffers

| Buffer       | Size       | Contents                            |
|--------------|------------|-------------------------------------|
| particleBufs | 2 × 40 KB  | ping-pong: {pos_x f32, vel_x f32}×N |
| sourceBuf    | 20 KB      | OT source positions (f32×N)         |
| targetBuf    | 20 KB      | OT target positions (f32×N)         |
| simBuf       | 16 B       | uniform: dt, time, has_targets, morph_t |

### Compute shader (WGSL)

Two modes per atom:

**Morph mode** (`has_targets > 0`):
```
t_smooth = smoothstep(morph_t)
pos = (1 - t_smooth) * source + t_smooth * target
vel = (target - source) * (1 - t_smooth)   // dims to zero on arrival
```

**Wander mode** (`has_targets == 0`):
```
force = sin(time * 1.30 + idx * 0.00731) + sin(time * 2.10 + idx * 0.00517) * 0.4
soft walls at ±0.93
vel = (vel + force * dt) * 0.994
pos = clamp(pos + vel * dt, -1, 1)
```

### Render shader (WGSL)

Each atom → one `line-list` segment (top/bottom vertices at y = ±0.06).
Colour: `rgb(0, 0.45 + speed*0.55, speed*0.10)` — slow=dark green, fast=bright green.

### Shape cycling (JS)

1. Load `public/shapes.bin` + `public/shapes.json` at startup
2. `goToPositions(targetPositions, label)` — the single morph entry point:
   - `cpuSource ← cpuTarget` (freeze current end state)
   - Run `ot1D(source, target)` — O(N log N) sort-based rank pairing
   - Write source + target to GPU; reset morph_t = 0
3. Auto-cycle every `HOLD_DURATION = 2.5s` after `MORPH_DURATION = 1.5s` travel
4. `userControlled = true` suspends auto-cycle while morse input is displayed

---

## Morse Input Pipeline

```
text input
   ↓ morse.js: encode()
token stream  [{type:'dot'}, {type:'sym_gap'}, {type:'dash'}, ...]
   ↓ layout.js: computeLayout()
NDC segments  [{left, right, type}, ...]   T = min(autoT, maxUnitWidth=0.08)
   ↓ sampler.js: samplePositions()
Float32Array(N)
  N_active  = round(N × segmentsWidth / totalRange)   uniform density
  N_dormant = N - N_active  ← stacked on active positions (mitosis seeds)
   ↓ main.js: goToPositions()
GPU morph
```

---

## Backend (Python — not used in browser)

**NCA** (`backend/nca.py`):
- Goal-Guided Neural Cellular Automata, PyTorch
- Architecture: Sobel perception → GoalEncoder (small CNN) → Update MLP
- State: (B, 16, 128, 128) grid evolving over 64 steps
- Untrained: produces softened goal. Trained: organic growth.

**OT Solver** (`backend/ot_solver.py`):
- Random-cluster Sinkhorn: sub-sample 1024 representatives from 100k particles
- Exact EMD on 1024×1024 cost matrix (Python OT library)
- KDTree nearest-neighbour lookup maps all 100k particles to cluster assignments
- Per-particle Gaussian jitter prevents pile-up

**Server** (`backend/server.py`):
- FastAPI WebSocket, broadcasts `(shape_info JSON, binary Float32[100k×2])` per shape
- Background async loop: NCA → OT → broadcast every `SHAPE_INTERVAL_S = 10s`

---

## Known Limitations of v1

- **1D only** — atoms have only x-position; universe is a single line
- **5,000 atoms** — too few for the intended 100,000
- **Precomputed shapes** — no live shape generation in the browser
- **Backend not connected to frontend** — WebSocket server built but main.js ignores it
- **OT runs on CPU** — sort-based 1D trick works, but doesn't scale to 2D or 100k
- **NCA not in browser** — runs in Python, not WGSL compute shaders
- **Morse only** — text input limited to morse encoding; no arbitrary shape commands
