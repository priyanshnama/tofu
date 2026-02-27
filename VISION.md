# Project Tofu — Vision (v2)

The complete architectural blueprint for the no-backend, full-GPU rebuild.

---

## Core Philosophy

No Python. No server. No LLM.
The browser IS the engine. The GPU IS the brain.

Everything that moves on screen is computed directly in WebGPU compute shaders —
the NCA growth, the OT transport, the physics, the rendering. The CPU/JS layer
only manages state transitions and interprets text input.

---

## The Universe

| Property     | v1 (current) | v2 (target)     |
|--------------|--------------|-----------------|
| Dimensions   | 1D (x only)  | 2D (x, y)       |
| Atoms        | 5,000        | 100,000         |
| Rendering    | line-list     | point sprite / fullscreen density |
| NCA          | Python        | WGSL compute shader |
| OT           | JS sort (1D)  | GPU k-means + Sinkhorn (2D) |
| Backend      | FastAPI WS    | None            |
| Input        | Morse only   | Named shape library |

---

## Pipeline (every shape transition)

```
1. USER INPUT
   text box → keyword → shape name
   e.g. "helix", "dna", "galaxy", "nanotube", "wave", "grid"

2. PARAMETRIC BLUEPRINT  (JS, CPU — instant)
   shape name → goal_grid: Float32Array(128×128)
   Pure mathematics — no AI. A carbon nanotube is a cylindrical hex lattice.
   A galaxy is a logarithmic spiral density. A sine wave is sin(x).

3. NCA GROWTH  (WGSL compute shader — ~64 passes)
   goal_grid → density_grid: Float32Array(128×128)
   The NCA doesn't just copy the goal — it grows into it organically.
   Each cell updates from its neighbours + the goal signal simultaneously.
   This is where the "living" quality comes from.

4. DENSITY SAMPLING  (WGSL compute shader)
   density_grid → target_positions: Float32Array(100k × 2)
   Importance-sample 100k (x,y) positions from the density field.
   Denser regions attract more atoms.

5. OPTIMAL TRANSPORT  (WGSL compute shader)
   source_positions, target_positions → assignment: u32Array(100k)
   Approximated on GPU:
     a. k-means cluster both source and target into K=1024 centroids
     b. Compute K×K cost matrix on GPU
     c. Auction / Sinkhorn iterations on GPU
     d. KNN: each of 100k atoms inherits its nearest centroid's assignment

6. MORPH PHYSICS  (WGSL compute shader — every frame)
   pos(t) = smoothstep(t) * source + (1 - smoothstep(t)) * target
   + small velocity field for organic feel

7. RENDER  (WGSL render pipeline — every frame)
   100k atoms → fullscreen density texture → postprocess (bloom, trails)
   No DOM rendering of particle data. GPU writes pixels directly.
```

---

## NCA Architecture in WGSL

The NCA runs as a series of compute dispatch passes. Each pass = one NCA step.

### Buffers

```
goalGrid    : texture_storage_2d<r32float>  (128×128) — static per shape
stateGrid   : array of storage buffers      (128×128×16 channels) — ping-pong
densityOut  : texture_storage_2d<r32float>  (128×128) — NCA output
```

### Per-step shader (`nca_step.wgsl`)

```wgsl
// Each workgroup handles one 8×8 tile of the 128×128 grid
@compute @workgroup_size(8, 8)
fn nca_step(@builtin(global_invocation_id) gid: vec3<u32>) {
    // 1. Read state channels for this cell + 8 neighbours
    // 2. Apply Sobel-x and Sobel-y kernels per channel → perception vector (48 floats)
    // 3. Read goal embedding for this cell (8 floats, from pre-encoded goal texture)
    // 4. Concatenate → 56-float input to update MLP
    // 5. MLP: linear(56→128) + ReLU + linear(128→16) → delta
    // 6. Stochastic mask (inference: deterministic, training: random)
    // 7. new_state = clamp(state + delta, -2, 2)
    // 8. Write new_state to output buffer
}
```

MLP weights are stored in uniform/storage buffers (small: 56×128 + 128×16 = ~9k floats).
The goal encoder weights (~1k floats) are also stored in a uniform buffer.
Total NCA weight budget: ~40 KB — trivial for GPU.

### Inference loop (JS)

```js
for (let step = 0; step < NCA_STEPS; step++) {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(ncaPipeline);
    pass.setBindGroup(0, ncaBindGroups[step & 1]);
    pass.dispatchWorkgroups(16, 16);   // 128/8 = 16 per axis
    pass.end();
    device.queue.submit([enc.finish()]);
}
// Result: densityOut texture contains the grown shape
```

---

## OT on GPU

Full 100k×100k OT is infeasible (40 GB cost matrix). Strategy: cluster-then-assign.

### Phase 1 — k-means on GPU (K=1024 centroids)

```
source_centroids[K] = k_means(source_positions[100k])   // ~5 iterations
target_centroids[K] = weighted_k_means(density_grid)    // importance-weighted
```

### Phase 2 — Cost matrix + EMD on GPU

```
cost[K×K]  computed in parallel (each thread = one pair)
EMD solved via auction algorithm in WGSL (K=1024 is tractable on GPU)
```

### Phase 3 — KNN assignment on GPU

```
// Each atom finds its nearest source centroid, inherits that centroid's target
for each atom i in parallel:
    nearest_src_centroid = knn(source_positions[i], source_centroids)
    atom_target[i]       = target_centroids[assignment[nearest_src_centroid]]
    atom_target[i]      += small_jitter
```

---

## Shape Library (parametric, no AI)

Every shape is a pure function: `name → Float32Array(128×128)` density grid.

### Tier 1 — Geometric primitives (immediate)
- `circle`, `ring`, `disc`, `square`, `triangle`, `diamond`
- `star(n)`, `polygon(n)`, `spiral(turns)`

### Tier 2 — Scientific / mathematical (medium effort)
- `sine_wave`, `standing_wave`, `interference_pattern`
- `lorenz_attractor` (projected to 2D), `julia_set`, `mandelbrot`
- `lissajous(a, b, delta)`

### Tier 3 — Molecular / structural (rich)
- `carbon_nanotube` — cylindrical hexagonal lattice, projected
- `dna_helix` — two interleaved helices, projected
- `graphene` — 2D hexagonal lattice, direct
- `crystal_cubic`, `crystal_fcc`, `crystal_hcp`

### Input matching (JS, CPU)
```js
const ALIASES = {
    "nanotube":  "carbon_nanotube",
    "dna":       "dna_helix",
    "galaxy":    "spiral",
    "wave":      "sine_wave",
    ...
}
function resolveShape(text) {
    const key = text.toLowerCase().trim();
    return ALIASES[key] ?? SHAPE_REGISTRY[key] ?? "circle";
}
```

---

## Rendering

### Atom density texture

Instead of drawing 100k points (overdraw, aliasing), accumulate to a density texture:

```wgsl
// Splat shader: each atom atomically increments a density texel
@compute @workgroup_size(256)
fn splat(@builtin(global_invocation_id) gid: vec3<u32>) {
    let pos   = atoms[gid.x].pos;
    let texel = pos_to_texel(pos);       // NDC → [0, W) × [0, H)
    atomicAdd(&density_tex[texel], 1u);
}
```

```wgsl
// Fullscreen quad: density → colour with bloom
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    let d    = density_tex[in.uv];
    let norm = log(1.0 + f32(d)) / log(1.0 + f32(MAX_DENSITY));
    let col  = vec3(0.0, norm * 0.9, norm * 0.15);   // green phosphor
    return vec4(col + bloom(in.uv), 1.0);
}
```

### Trail / persistence

Keep a history texture: `history = mix(history, current_density, 0.15)`.
Atoms leave glowing trails as they morph. The trail fades exponentially.

---

## File Structure (v2)

```
tofu/
├── index.html              minimal shell: left panel (HUD + input) + canvas
├── src/
│   ├── main.js             orchestrator: init, shape transitions, frame loop
│   ├── gpu/
│   │   ├── device.js       WebGPU adapter/device setup
│   │   ├── buffers.js      all buffer + texture allocations
│   │   ├── nca.js          NCA pipeline builder + inference runner
│   │   ├── ot.js           GPU OT pipeline (k-means + auction + KNN)
│   │   ├── physics.js      per-frame morph + wander compute pipeline
│   │   └── render.js       splat + fullscreen quad + bloom pipeline
│   ├── shapes/
│   │   ├── registry.js     name → generator function
│   │   ├── primitives.js   geometric shapes
│   │   ├── mathematical.js attractors, fractals, waves
│   │   └── molecular.js    nanotubes, DNA, lattices
│   └── ui/
│       ├── panel.js        HUD updates + input handling
│       └── morse.js        existing morse pipeline (kept as an input mode)
├── wgsl/
│   ├── nca_step.wgsl       NCA single step
│   ├── density_sample.wgsl importance sampling from density grid
│   ├── kmeans.wgsl         k-means clustering
│   ├── ot_cost.wgsl        cost matrix construction
│   ├── ot_auction.wgsl     auction algorithm for EMD
│   ├── knn_assign.wgsl     KNN atom assignment
│   ├── physics.wgsl        morph interpolation + wander
│   ├── splat.wgsl          atom → density texture splatting
│   └── render.wgsl         fullscreen density → colour + bloom
└── CURRENT.md              (this archive)
```

---

## Build Phases

### Phase 1 — 2D foundation (no NCA, no GPU OT)
- Upgrade from 1D to 2D: atoms have (x, y)
- Scale to 100k atoms
- Density splat rendering (GPU)
- Hardcode first shape: uniform scatter → circle
- JS-side importance sampling from density grid (temporary)

### Phase 2 — Shape library + direct sampling
- Implement parametric shape generators (Tier 1 + Tier 2)
- Connect text input → shape resolver → density grid → positions
- Still using CPU OT approximation (sort in 2D is not trivial; use random pairing with jitter as placeholder)

### Phase 3 — NCA on GPU
- Port NCA architecture to WGSL (perception + goal encoder + update MLP)
- Load pre-trained weights from a JSON file (trained once in Python, baked in)
- Replace direct density sampling with NCA-grown density
- Observe the organic growth quality in the browser

### Phase 4 — GPU OT
- Implement k-means on GPU
- Implement cost matrix computation on GPU
- Implement auction algorithm (or approximation) on GPU
- Full assignment pipeline in WGSL

### Phase 5 — Rendering quality
- Bloom pass
- Trail persistence texture
- Colour mapping (velocity, age, shape identity)
- Smooth NCA step animation (show the growth, not just the result)

---

## Key Constraints

- No Python, no server, no WebSocket at runtime
- All simulation data lives in GPU buffers — never read back to CPU except for debug
- HTML/CSS only for the control panel shell (HUD + text input)
- WebGPU required (Chrome 113+, Edge 113+, Safari 18+)
- Target: 60 fps at 100k atoms on a mid-range GPU
