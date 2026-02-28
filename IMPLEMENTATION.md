# Project Tofu — Implementation Reference

Current state of the codebase as of v2. Everything runs in the browser with no backend.

---

## What it does

100,000 green atoms fill a 2D canvas. The user types a shape name; the system reorganises
the atoms into that shape using NCA-grown density fields, GPU optimal transport, and a
smoothstep morph. Between transitions the atoms wander under a sinusoidal force field.
It auto-cycles through all shapes when idle.

---

## Full per-frame pipeline

```
[JS]  write simParams (dt, time, has_targets, morph_t)
[JS]  writeBuffer → clear densityBuf + velBuf to zero

[GPU] physics   compute  — wander / smoothstep morph
[GPU] splat     compute  — atom positions → density u32 + velocity u32 buffers
[GPU] decay     compute  — density → persistent trail f32 buffer (phosphor glow)
[GPU] render    pass     — trail + vel + density → fullscreen phosphor quad
```

## Shape transition pipeline (on user input or auto-cycle)

```
[JS]  text → resolveShape → getShape  → goalGrid (128×128 Float32)
[GPU] NCA (64 steps): goalGrid → organicDensity (128×128 Float32, GPU→CPU readback)
[JS]  sampleFromDensity(organicDensity) → rawTargets (N×2 NDC positions)
[GPU] K-means on srcPos (6 iters) → src centroids + labels
[GPU] K-means on rawTargets (6 iters) → tgt centroids + labels
[CPU] sort-by-angle OT on K=512 centroids → centroidMap
[CPU] round-robin intra-cluster pairing → assignedTargets (N×2)
[JS]  write sourceBuf + targetBuf to GPU, reset morph_t to 0
```

---

## GPU Buffers

| Name | Size | Type | Purpose |
|---|---|---|---|
| `atomBufs[2]` | 1.6 MB × 2 | f32 `{pos, vel}` | ping-pong atom state |
| `sourceBuf` | 800 KB | f32 vec2 × N | OT source positions at transition start |
| `targetBuf` | 800 KB | f32 vec2 × N | OT assigned target positions |
| `simBuf` | 16 B | uniform f32[4] | `{dt, time, has_targets, morph_t}` |
| `densityBuf` | 256 KB | atomic u32 | per-texel atom count (cleared each frame) |
| `velBuf` | 256 KB | atomic u32 | per-texel speed accumulator (cleared each frame) |
| `trailBuf` | 256 KB | f32 | persistent decayed density (never cleared) |

Density grid is 256×256 texels. All density/velocity/trail buffers share the same layout.

---

## WGSL Shaders

### `physics.wgsl`
Per-atom compute, workgroup size 256, dispatches 391 groups (= ⌈100 000 / 256⌉).

**Morph mode** (`has_targets > 0.5`):
- Reads `source_buf[i]` and `target_buf[i]`
- Applies smoothstep `te = t²(3-2t)` over `morph_t ∈ [0,1]`
- Velocity dims to zero on arrival: `vel = (tgt - src) * (1 - te)`

**Wander mode** (`has_targets == 0`):
- Two-frequency sinusoidal force field, per-atom phase offset from `idx`
- Soft quadratic wall repulsion at `BOUND = 0.92`
- Velocity damping `× 0.992`, speed clamp at `MAX_VEL = 0.55`
- Hard position clamp at `±1.0`

### `splat.wgsl`
Accumulates atom positions into the density and velocity buffers.
- NDC `[-1,+1]` → texel `[0, 256)`, both axes
- `atomicAdd(&density_buf[texel], 1u)`
- Speed accumulated as fixed-point u32: `speed / 0.55 * 65535`, then `atomicAdd(&vel_buf[texel], speed_u)`

### `decay.wgsl`
256 workgroups × 256 threads = 65 536 threads (one per texel).
```
trail_buf[i] = trail_buf[i] * 0.88 + f32(density_buf[i])
```
Runs after splat, before render. `trailBuf` is never cleared — it decays exponentially
and gives the phosphor afterglow. Half-life at 60 FPS ≈ 11 frames / ~180 ms.

### `render.wgsl`
Fullscreen quad (6 vertices, 2 triangles).

**Bindings:** `trail_buf` (f32), `vel_buf` (u32), `density_buf` (u32)

Per fragment:
1. 3×3 box filter over all three buffers → `avg_t`, `avg_v`, `avg_d`
2. Brightness: `norm = clamp(log(1+avg_t) / log(1+12), 0, 1)` — log tone curve on trail
3. Speed: `speed = avg_v / (avg_d * 65535)` using current-frame density as denominator
4. Green-phosphor base: `r = norm² * 0.18`, `g = 0.35·norm + 0.65·norm²`, `b = norm² * 0.10`
5. White-hot blend: `mix(base, norm * white_factors, speed * 0.85)`

### `nca_step_mlp.wgsl` (MLP mode)
16-channel GoalNCA. Architecture: `56 → 64 → 16` MLP per cell.
- Input features: 16 channels × 3×3 neighbourhood = 144 features, downsampled to 56
- Per-step stochastic fire mask (50% cell fire rate) driven by hash of `(x, y, step)`
- Goal channel is channel 0, injected from `goal_buf`
- Ping-pong on 16-channel state buffers (1 MB each)

### `nca_step.wgsl` (RDS fallback)
Single-channel reaction-diffusion. Used when `nca_weights.json` is absent.
Seeds from `goalGrid + tiny noise`, then diffuses with a Laplacian kernel.

### `nca_extract.wgsl`
Extracts the alpha channel (channel 0) from the 16-channel NCA state → compact 64 KB
`alphaBuf`. Used as the organic density grid fed to `sampleFromDensity`.

### `kmeans_assign.wgsl`
N=100 000, K=512. One thread per point, inner loop over all K centroids.
Writes nearest centroid index to `labels`.

### `kmeans_update.wgsl`
Accumulates fixed-point centroid sums. Scale = 16384.
`atomicAdd` on `sum_x`, `sum_y`, `counts` (all i32/u32).

### `kmeans_divide.wgsl`
`centroids[k] = {sum_x[k] / (SCALE * counts[k]), sum_y[k] / (SCALE * counts[k])}`
Reads accumulators as plain `array<i32>` (non-atomic) after the previous submission has
completed.

---

## Shape Library

27 canonical shapes across three tiers, plus ~30 aliases.

**Tier 1 — geometric primitives**
`circle`, `ring`, `star` (5pt), `star6`, `star8`, `diamond`, `triangle`, `cross`,
`spiral`, `heart`, `wave`, `hexgrid`

**Tier 2 — mathematical**
`lissajous` (3:2 pretzel), `pretzel` (5:4), `trefoil` (3:1),
`rose` (4-freq 8-petal), `rose3` (3-freq 6-petal),
`lorenz` (butterfly attractor), `rossler` (single-scroll),
`interference` (wave fringes), `galaxy` (log spiral),
`julia` (dendrite at c=−0.7+0.27i), `dragon` (dragon curve),
`rabbit` (Douady's rabbit), `mandelbrot`

**Tier 3 — molecular / structural**
`dna`, `nanotube`, `crystal`, `graphene`

All generators output `Float32Array(128 × 128)` density grids in `[0, 1]`.
Results are cached in a JS `Map` after first computation.

**Resolution logic** (`resolveShape`):
1. Exact match in registry
2. Exact match in aliases
3. Prefix match in registry
4. Fallback to `circle`

---

## NCA Pipeline (`src/gpu/nca.js`)

`buildNCA(device)` tries to load `/nca_weights.json` (served from `public/`):
- **MLP mode** — weights present: compiles `nca_step_mlp.wgsl`, loads w1/b1/w2/b2 into
  GPU buffers, runs 64 step inference on each transition.
- **RDS fallback** — no weights: compiles `nca_step.wgsl`, seeds from `goalGrid + noise`,
  runs 64 diffusion steps in one command encoder.

Both modes return `Promise<Float32Array(128×128)>` via GPU→CPU `mapAsync` readback.

Trained weight file: `public/nca_weights.json` (95 KB).
Architecture: `channels=16, hidden=64`, w1 shape `64×56`, w2 shape `16×64`.
Trained for ~20 000 steps against all 27 canonical shapes.

---

## GPU Optimal Transport (`src/gpu/ot_gpu.js`)

Called once per transition via `assignTargetsGpu(device, ot, srcPos, tgtPos)`.

**K-means** (runs twice — once for src, once for tgt):
- K = 512 centroids, 6 iterations
- Each iteration is a separate `device.queue.submit()` call
- Accumulator buffers (`sum_x`, `sum_y`, `counts`) cleared via `writeBuffer` between
  submissions (not via `atomicStore` inside the encoder — avoids ordering hazards)
- Fixed-point arithmetic: SCALE = 16384

**Centroid OT** (CPU, K=512 items):
- Sort source and target centroids by angle around their respective centroids
- Match by rank → `centroidMap[src_k] = tgt_k`

**Intra-cluster assignment** (CPU):
- Build per-target-centroid member list
- Round-robin: source atom `i` in cluster `k` gets the next target from cluster `centroidMap[k]`
- Empty cluster fallback: use centroid position directly

---

## Morph Timing (`src/main.js`)

| Constant | Value | Description |
|---|---|---|
| `MORPH_DURATION` | 2.0 s | source → target travel |
| `HOLD_DURATION` | 3.5 s | pause at target before auto-advance |

Auto-cycle: iterates through `SHAPE_NAMES` in order, wrapping around.
User input disables auto-advance (`userControlled = true`) until the HUD clear button is pressed.
`transitioning` flag prevents overlapping NCA/OT calls.

---

## UI (`src/ui/panel.js`)

Thin HTML/CSS sidebar. Two callbacks wired from `main.js`:
- `onSubmit(text)` — runs `goToShape(text)`, shows resolved name in the response area
- `onClear()` — resets `userControlled = false`, resumes auto-cycle

FPS counter updates via `tickFPS(nowMs)` every frame.
Phase/status labels updated during NCA (`nca · growing`), OT (`ot · k-means`),
morph progress, and hold.

---

## File Structure

```
src/
  main.js                   — orchestrator, frame loop, morph state
  gpu/
    device.js               — WebGPU adapter/device/context init
    buffers.js              — all buffer allocations + atom seeding
    pipelines.js            — buildPipelines(), encodeFrame()
    nca.js                  — NCA pipeline (MLP + RDS), weight loading
    ot_gpu.js               — GPU k-means, centroid OT, atom assignment
  shapes/
    registry.js             — resolveShape, getShape, sampleFromDensity
    primitives.js           — circle, ring, star, diamond, spiral, heart, wave, hexGrid, triangle, cross
    mathematical.js         — lissajous, lorenz, interference, julia, dragon, rabbit, rossler, rose, logSpiral, mandelbrot
    molecular.js            — dna, nanotube, crystal, graphene2D
  ui/
    panel.js                — HUD sidebar, FPS, status display

wgsl/
  physics.wgsl              — per-atom wander + morph interpolation
  splat.wgsl                — atom positions → density + velocity buffers
  decay.wgsl                — density → persistent trail (phosphor glow)
  render.wgsl               — trail + vel + density → screen colour
  nca_step_mlp.wgsl         — 16-channel GoalNCA MLP step (trained mode)
  nca_step.wgsl             — single-channel RDS fallback
  nca_extract.wgsl          — extract alpha channel from 16-ch NCA state
  kmeans_assign.wgsl        — assign N points to K centroids
  kmeans_update.wgsl        — accumulate fixed-point centroid sums
  kmeans_divide.wgsl        — divide sums → new centroid positions

public/
  nca_weights.json          — 95 KB, trained GoalNCA weights (w1, b1, w2, b2)

training/
  train_nca.py              — PyTorch training script (run once, offline)
```

---

## Key Constants

| Constant | Value | Location |
|---|---|---|
| N (atom count) | 100 000 | `buffers.js` |
| DENSITY_W / H | 256 × 256 | `buffers.js` |
| NCA_W / H | 128 × 128 | `nca.js` |
| NCA_STEPS | 64 | `nca.js` |
| NCA_CHANNELS | 16 | `nca.js` |
| K (OT centroids) | 512 | `ot_gpu.js` |
| K_ITERS | 6 | `ot_gpu.js` |
| TRAIL_DECAY | 0.88 | `decay.wgsl` |
| MAX_VEL | 0.55 | `physics.wgsl` |
| MORPH_DURATION | 2.0 s | `main.js` |
| HOLD_DURATION | 3.5 s | `main.js` |

---

## Running

```bash
npm install
npm run dev     # Vite dev server → http://localhost:5173
```

Requires a browser with WebGPU support (Chrome 113+, Edge 113+).
`nca_weights.json` is loaded automatically from `public/` — no server needed.
If missing, the system falls back to RDS mode silently.
