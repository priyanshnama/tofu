# Context: Project Tofu (v2) - Fluid, Atom-Based Interface

Act as an expert graphics and AI engineer. We are building a custom physics engine and fluid UI from the ground up using WebGPU. 

## Core Philosophy & Constraints
*   **The Browser is the Engine:** The GPU is the brain. Everything that moves on screen is computed directly in WebGPU compute shaders (growth, physics, rendering, optimal transport) [1].
*   **100,000 Digital Atoms:** The interface consists of 100k points flowing at 60 FPS. We treat this as a dynamic point cloud using "unit mass" Optimal Transport and displacement interpolation.
*   **No Python/LLM in the Physics Loop:** The AI/LLM is only used asynchronously to generate static mathematical "blueprints" (128x128 density grids and label coordinates). The WebGPU engine handles all real-time movement natively [1].

## Technical Implementation Plan (Phase-by-Phase)

Please execute the following phases in order. Ask for confirmation before moving to the next phase.

### Phase 1: 2D Foundation & WebGPU Setup
**Goal:** Establish the bare-metal rendering and physics loop for 100,000 atoms.
*   **Data Structures:** Upgrade atoms to 2D `(x, y)` coordinates. Initialize 100k atoms using 32-bit float arrays.
*   **Memory Management:** Implement "ping-pong buffering" (Buffers A and B) for positions and velocities to safely update states at 60 FPS without read/write conflicts.
*   **Rendering:** Configure the WebGPU render pipeline using a `point-list` topology. Implement a basic "density splat" shader to render the atoms organically [2].
*   **Initial State:** Hardcode a simple compute shader to scatter atoms uniformly, then advect them into a basic geometric circle.

### Phase 2: Parametric Shape Library & CPU Placeholder OT
**Goal:** Allow text input to resolve into pure mathematical density grids [2].
*   **Shape Library:** Build a JS-side parametric library mapping names to pure mathematical functions that output `Float32Array(128x128)` density grids [3].
    *   *Tier 1:* circle, ring, square, polygon.
    *   *Tier 2:* sine_wave, lorenz_attractor.
*   **Placeholder Transport:** Since 2D GPU sorting is complex, implement a temporary CPU-side Optimal Transport approximation (e.g., random pairing with jitter) to calculate target coordinates for the 100k atoms based on the 128x128 density grid [2].
*   **Displacement Interpolation:** Update the compute shader to take a uniform time parameter `t` (0.0 to 1.0) and advect atoms along straight geodesic paths from their origin to their assigned target.

### Phase 3: Goal-Guided NCA on GPU (The "Life" Layer)
**Goal:** Add organic texture, life, and "breathing" movement to the hardcoded shapes using a Neural Cellular Automaton (GoalNCA).
*   **Architecture:** Implement the GoalNCA inference loop entirely in a WGSL compute shader (`nca_step.wgsl`) [4].
*   **Weight Loading:** Load pre-trained GoalNCA MLP weights (~40 KB JSON file) directly into WebGPU uniform/storage buffers [5].
*   **Execution:** At every step, apply the "hidden state perturbation" to the living cells based on the target shape's one-hot encoded goal. Apply a stochastic update mask (e.g., 50% cell fire rate) to mimic organic biological growth.

### Phase 4: GPU-Native Optimal Transport (Cluster-then-Assign)
**Goal:** Move the heavy OT math off the CPU and into parallel compute shaders to achieve true 60 FPS fluidity.
*   **Phase 4A:** Write a WGSL compute shader for K-means clustering (K=1024 centroids) to reduce the 100,000 points into manageable groups [5].
*   **Phase 4B:** Compute the cost matrix and execute the Earth Mover's Distance (Sinkhorn or Auction algorithm) between the reduced clusters on the GPU [5].
*   **Phase 4C:** Use K-Nearest Neighbors (KNN) in WGSL for the final point-to-point assignments [3].

### Phase 5: Visual Polish & Post-Processing
**Goal:** Make the digital universe feel like a fluid intelligence.
*   Implement a Bloom pass for glowing atoms [6].
*   Add a Trail persistence texture so fast-moving atoms leave a trace [6].
*   Map atom colors dynamically based on their current velocity, age, or shape identity [6].

### Phase 6: Hybrid LLM Blueprinting (Semantic UI)
**Goal:** Handle complex user queries (e.g., "mango leaf cell with labels") using an asynchronous LLM bridge.
*   **Server-Side Generation:** Create a pipeline where a prompt is sent to an LLM/Server. The server returns a JSON blueprint containing:
    1. A generated 128x128 Float32 density grid representing the complex biological/scientific structure.
    2. A list of semantic text labels (e.g., "Nucleus", "Cellulose Wall") and their exact `(x, y)` anchors relative to the grid.
*   **Hybrid Rendering:** Feed the density grid into the WebGPU pipeline so the 100k atoms flow into the shape. Simultaneously, render standard HTML/CSS text elements perfectly anchored over the WebGPU canvas using the coordinates provided by the LLM.

**Begin with Phase 1.** Please provide the complete `index.html`, `main.js`, and `compute.wgsl` setup to initialize the WebGPU canvas, the ping-pong buffers, and the basic density splat rendering for 100,000 atoms.