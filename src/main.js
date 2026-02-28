/**
 * main.js — tofu v2 orchestrator.
 *
 * Pipeline every frame:
 *   [JS] update morph_t → write simParams
 *   [GPU] clear density buffer (writeBuffer)
 *   [GPU] physics compute  — wander / smoothstep morph
 *   [GPU] splat compute    — atom positions → density u32 buffer
 *   [GPU] render pass      — density → fullscreen phosphor quad
 *
 * Pipeline at shape transition:
 *   [JS]  text → resolveShape → getShape → goalGrid
 *   [GPU] NCA (64 steps): goalGrid → organicDensity   ← Phase 3
 *   [JS]  sampleFromDensity(organicDensity) → rawTargets
 *   [GPU] k-means (K=512, 6 iters) × 2 clouds + CPU centroid OT → assignedTargets
 *   [JS]  write source + target buffers to GPU, reset morph_t
 *
 * No backend.  No LLM.  Everything runs in the browser GPU.
 */

import { initDevice }                    from './gpu/device.js';
import { allocateBuffers, seedAtoms,
         N, DENSITY_BYTES, VEL_BYTES }  from './gpu/buffers.js';
import { buildPipelines, encodeFrame }   from './gpu/pipelines.js';
import { buildNCA, runNCA }              from './gpu/nca.js';
import { buildOTGpu, assignTargetsGpu }  from './gpu/ot_gpu.js';
import { getShape, resolveShape,
         sampleFromDensity, SHAPE_NAMES } from './shapes/registry.js';
import { initPanel, tickFPS,
         setStatus, setPhase,
         showResponse }                  from './ui/panel.js';


// ── Constants ─────────────────────────────────────────────────────────────────

const MORPH_DURATION  = 2.0;    // seconds: source → target travel
const HOLD_DURATION   = 3.5;    // seconds: pause at target before auto-advance
const AUTO_CYCLE      = [...SHAPE_NAMES];

// Pre-allocated zero buffers for per-frame clears
const DENSITY_CLEAR = new Uint8Array(DENSITY_BYTES);
const VEL_CLEAR     = new Uint8Array(VEL_BYTES);


// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {

    // ── Canvas setup ──────────────────────────────────────────────────────────
    const canvas     = document.getElementById('canvas');
    const canvasWrap = document.getElementById('canvas-wrap');

    function resizeCanvas() {
        canvas.width  = canvasWrap.clientWidth;
        canvas.height = canvasWrap.clientHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ── GPU init ───────────────────────────────────────────────────────────────
    const { device, ctx, format } = await initDevice(canvas);

    // ── Buffers ────────────────────────────────────────────────────────────────
    const buffers  = allocateBuffers(device);
    const seedData = seedAtoms(device, buffers.atomBufs);

    // CPU-side position mirrors — used to compute OT assignments
    const cpuSource = new Float32Array(N * 2);
    const cpuTarget = new Float32Array(N * 2);

    for (let i = 0; i < N; i++) {
        cpuSource[i * 2    ] = cpuTarget[i * 2    ] = seedData[i * 4    ];
        cpuSource[i * 2 + 1] = cpuTarget[i * 2 + 1] = seedData[i * 4 + 1];
    }
    device.queue.writeBuffer(buffers.sourceBuf, 0, cpuSource);
    device.queue.writeBuffer(buffers.targetBuf, 0, cpuTarget);

    // ── Pipelines ──────────────────────────────────────────────────────────────
    const pipelines = await buildPipelines(device, buffers, format);

    // ── NCA ────────────────────────────────────────────────────────────────────
    const nca = await buildNCA(device);

    // ── GPU OT ─────────────────────────────────────────────────────────────────
    const ot = await buildOTGpu(device);

    // ── Sim params (uniform buffer) ────────────────────────────────────────────
    // [dt, time, has_targets, morph_t]
    const simData = new Float32Array(4);

    // ── Morph state ────────────────────────────────────────────────────────────
    const morph = { t: 0.0, hold: 0.0 };
    let userControlled  = false;
    let shapeIdx        = -1;
    let transitioning   = false;   // true while NCA is running (prevents overlap)

    // ── Core transition primitive ──────────────────────────────────────────────

    function goToPositions(newTargets, label) {
        cpuSource.set(cpuTarget);
        cpuTarget.set(newTargets);

        device.queue.writeBuffer(buffers.sourceBuf, 0, cpuSource);
        device.queue.writeBuffer(buffers.targetBuf, 0, cpuTarget);

        morph.t    = 0.0;
        morph.hold = 0.0;
        simData[2] = 1.0;
        simData[3] = 0.0;

        setStatus(label);
    }

    /**
     * Resolve a shape name, run NCA on GPU to grow an organic density field,
     * sample N targets, compute OT assignment, then trigger a morph.
     *
     * Async because NCA requires a GPU→CPU readback (mapAsync).
     * The `transitioning` flag prevents concurrent calls.
     */
    async function goToShape(name) {
        if (transitioning) return null;
        transitioning = true;

        try {
            const canonical = resolveShape(name);

            // ── Phase 2: parametric blueprint (CPU) ──────────────────────────
            const goalGrid = getShape(canonical);

            // ── Phase 3: NCA growth (GPU, 64 steps) ─────────────────────────
            setPhase('nca · growing');
            const organicDensity = await runNCA(device, nca, goalGrid);

            // ── Sampling + GPU OT ────────────────────────────────────────────
            setPhase('ot · k-means');
            const rawTgt   = sampleFromDensity(organicDensity);
            const assigned = await assignTargetsGpu(device, ot, cpuSource, rawTgt);

            goToPositions(assigned, canonical);
            return canonical;

        } finally {
            transitioning = false;
        }
    }

    /** Auto-cycle helper. */
    function advanceCycle() {
        shapeIdx = (shapeIdx + 1) % AUTO_CYCLE.length;
        goToShape(AUTO_CYCLE[shapeIdx]);   // fire-and-forget (async)
    }

    // Start immediately with the first shape
    advanceCycle();

    // ── UI panel ───────────────────────────────────────────────────────────────
    initPanel({
        async onSubmit(text) {
            const name = await goToShape(text);
            if (name !== null) {
                userControlled = true;
                showResponse(name);
            }
        },
        onClear() {
            userControlled = false;
            advanceCycle();
        },
    });

    // ── Frame loop ─────────────────────────────────────────────────────────────

    let frame    = 0;
    let lastMs   = performance.now();
    let totalSec = 0;

    function tick() {
        const nowMs = performance.now();
        const dt    = Math.min((nowMs - lastMs) / 1000, 0.033);
        lastMs      = nowMs;
        totalSec   += dt;

        tickFPS(nowMs);

        // ── Morph timing ────────────────────────────────────────────────────
        if (simData[2] > 0.5) {
            if (morph.t < 1.0) {
                morph.t = Math.min(morph.t + dt / MORPH_DURATION, 1.0);
                setPhase(`morph ${Math.round(morph.t * 100)}%`);
            } else {
                morph.hold += dt;
                setPhase(`hold ${morph.hold.toFixed(1)}s`);

                // Auto-advance only when idle (not user-controlled, not mid-NCA)
                if (!userControlled && !transitioning && morph.hold >= HOLD_DURATION) {
                    advanceCycle();
                }
            }
            simData[3] = morph.t;
        }

        // ── Write sim params ────────────────────────────────────────────────
        simData[0] = dt;
        simData[1] = totalSec;
        device.queue.writeBuffer(buffers.simBuf, 0, simData);

        // ── Clear density + velocity buffers ────────────────────────────────
        device.queue.writeBuffer(buffers.densityBuf, 0, DENSITY_CLEAR);
        device.queue.writeBuffer(buffers.velBuf,     0, VEL_CLEAR);

        // ── Encode + submit frame ───────────────────────────────────────────
        const slot = frame & 1;
        const enc  = device.createCommandEncoder();
        encodeFrame(enc, pipelines, ctx.getCurrentTexture().createView(), slot);
        device.queue.submit([enc.finish()]);

        frame++;
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}


// ── Error display ─────────────────────────────────────────────────────────────

function showError(msg) {
    document.getElementById('error-msg').textContent = msg;
    document.getElementById('error').classList.add('visible');
}

main().catch(e => {
    console.error(e);
    showError(String(e));
});
