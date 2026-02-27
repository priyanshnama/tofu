# tofu

> *Less like using a computer, more like conversing with a fluid intelligence.*

A living UI made of 100,000 green particles. Type a shape name — the particles
reorganise themselves into it. No frameworks, no backend, no LLM. Pure WebGPU.

![tofu demo](https://user-images.githubusercontent.com/placeholder/tofu-demo.gif)

---

## How it works

Every shape transition runs a 4-stage GPU pipeline:

```
text input
    │
    ▼
shape name → parametric blueprint (CPU math)
    │
    ▼
NCA growth — 64 steps of a Neural Cellular Automaton (WGSL compute)
    │         grows an organic density field from a clean goal grid
    ▼
OT assignment — sort-by-angle optimal transport
    │            matches 100k source atoms to 100k target positions
    ▼
morph physics — atoms smoothstep toward targets over ~2 s (WGSL compute)
    │
    ▼
density splat render — atomic u32 accumulator → phosphor tone-map (WGSL)
```

The NCA runs in two modes:

| Mode | Trigger | Description |
|---|---|---|
| **MLP** | `public/nca_weights.json` present | 16-channel GoalNCA with trained weights |
| **RDS** | weights missing | Reaction-diffusion fallback, no training needed |

---

## Shape library

27 canonical shapes across three tiers:

**Geometric** — `circle` `ring` `star` `star6` `star8` `diamond` `triangle` `cross` `spiral` `heart` `wave` `hexgrid`

**Mathematical** — `lissajous` `pretzel` `trefoil` `rose` `rose3` `lorenz` `rossler` `interference` `galaxy` `julia` `dragon` `rabbit` `mandelbrot`

**Molecular** — `dna` `nanotube` `crystal` `graphene`

Plus ~30 aliases (`butterfly` → `lorenz`, `fractal` → `julia`, `helix` → `dna`, …).

---

## Getting started

### Prerequisites

- Node.js 18+
- A WebGPU-capable browser: Chrome 113+, Edge 113+, or Safari 18+

### Run

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Type a shape name in the bottom-left panel and
press **RUN** (or `Enter`). Leave the input blank and the system auto-cycles
through all shapes.

---

## Training the NCA (optional but recommended)

Without trained weights the app falls back to a reaction-diffusion rule that
adds organic texture but does not learn shape structure. For the full
MLP-driven behaviour:

```bash
cd training
pip install -r requirements.txt
python train_nca.py
```

Training takes ~5 min on Apple Silicon (M1–M4 MPS), ~10 min on CPU.
The script auto-detects MPS → CUDA → CPU and writes
`public/nca_weights.json` when done. Refresh the browser — the console
will print `[nca] MLP mode active`.

### NCA architecture

```
State      16 channels per cell  (ch 0 = alpha / density)
Perceive   identity + Sobel-X + Sobel-Y on all 16 ch  → 48 floats
Goal       8 hand-engineered features of scalar goal g → 8 floats
MLP        FC(56 → 64, ReLU) → FC(64 → 16) → Δstate
Update     state += Δ × stochastic mask  (PCG hash, no RNG buffer)
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Simulation & rendering | WebGPU / WGSL compute shaders |
| Dev server & bundler | Vite |
| NCA training | PyTorch (CPU / CUDA / MPS) |
| Dependencies | `vite` only (no runtime JS deps) |

---

## Project structure

```
tofu/
├── index.html
├── src/
│   ├── main.js                   orchestrator + frame loop
│   ├── gpu/
│   │   ├── device.js             WebGPU init
│   │   ├── buffers.js            all GPU buffer allocations
│   │   ├── pipelines.js          physics + splat + render pipelines
│   │   ├── nca.js                NCA manager (MLP / RDS dual-mode)
│   │   └── ot.js                 optimal transport assignment
│   ├── shapes/
│   │   ├── registry.js           name → density grid + sampler
│   │   ├── primitives.js         geometric shapes
│   │   ├── mathematical.js       attractors, fractals, curves
│   │   └── molecular.js          DNA, nanotube, crystal, graphene
│   └── ui/
│       └── panel.js              HUD + text input
├── wgsl/
│   ├── physics.wgsl              atom wander + morph
│   ├── splat.wgsl                positions → density accumulator
│   ├── render.wgsl               density → phosphor quad
│   ├── nca_step.wgsl             reaction-diffusion fallback
│   ├── nca_step_mlp.wgsl         MLP NCA step (trained weights)
│   └── nca_extract.wgsl          extract alpha channel from 16-ch state
└── training/
    ├── train_nca.py              GoalNCA PyTorch training
    └── requirements.txt
```

---

## Browser compatibility

| Browser | Status |
|---|---|
| Chrome 113+ | ✅ |
| Edge 113+ | ✅ |
| Safari 18+ | ✅ |
| Firefox | ❌ WebGPU not yet stable |

If WebGPU is unavailable an error overlay explains what to enable.

---

## License

MIT
