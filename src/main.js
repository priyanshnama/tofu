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
 *   [JS] text → resolveShape → getShape → sampleFromDensity → assignTargets
 *   [JS] write source + target buffers to GPU
 *   [JS] reset morph_t = 0, has_targets = 1
 *
 * No backend.  No LLM.  Everything runs in the browser GPU.
 */

import { initDevice }                    from './gpu/device.js';
import { allocateBuffers, seedAtoms,
         N, DENSITY_BYTES }              from './gpu/buffers.js';
import { buildPipelines, encodeFrame }   from './gpu/pipelines.js';
import { assignTargets }                 from './gpu/ot.js';
import { getShape, resolveShape,
         sampleFromDensity, SHAPE_NAMES } from './shapes/registry.js';
import { initPanel, tickFPS,
         setStatus, setPhase,
         showResponse }                  from './ui/panel.js';


// ── Constants ─────────────────────────────────────────────────────────────────

const MORPH_DURATION  = 2.0;    // seconds: source → target travel
const HOLD_DURATION   = 3.0;    // seconds: pause at target before auto-advance
const AUTO_CYCLE      = [...SHAPE_NAMES];   // cycle through all shapes

// Pre-allocated zero buffer for density clear (no shader needed)
const DENSITY_CLEAR = new Uint8Array(DENSITY_BYTES);


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
    // Layout: [x0, y0, x1, y1, …]  (N × 2 float32)
    const cpuSource = new Float32Array(N * 2);
    const cpuTarget = new Float32Array(N * 2);

    // Initialise both from the seed (x,y from each atom's first two floats)
    for (let i = 0; i < N; i++) {
        cpuSource[i * 2    ] = cpuTarget[i * 2    ] = seedData[i * 4    ];
        cpuSource[i * 2 + 1] = cpuTarget[i * 2 + 1] = seedData[i * 4 + 1];
    }
    device.queue.writeBuffer(buffers.sourceBuf, 0, cpuSource);
    device.queue.writeBuffer(buffers.targetBuf, 0, cpuTarget);

    // ── Pipelines ──────────────────────────────────────────────────────────────
    const pipelines = await buildPipelines(device, buffers, format);

    // ── Sim params (uniform buffer) ────────────────────────────────────────────
    // [dt, time, has_targets, morph_t]
    const simData = new Float32Array(4);

    // ── Morph state ────────────────────────────────────────────────────────────
    const morph = { t: 0.0, hold: 0.0 };
    let userControlled = false;
    let shapeIdx       = -1;

    // ── Core transition primitive ──────────────────────────────────────────────

    /**
     * Transition all atoms from their current positions to a new set of targets.
     * This is the single entry point for ALL shape transitions.
     *
     * @param {Float32Array} newTargets  N × 2 interleaved NDC positions (OT-assigned)
     * @param {string}       label       Shown in HUD status row
     */
    function goToPositions(newTargets, label) {
        // Freeze current logical end state as the new source
        cpuSource.set(cpuTarget);
        cpuTarget.set(newTargets);

        device.queue.writeBuffer(buffers.sourceBuf, 0, cpuSource);
        device.queue.writeBuffer(buffers.targetBuf, 0, cpuTarget);

        morph.t    = 0.0;
        morph.hold = 0.0;
        simData[2] = 1.0;   // has_targets → morph mode
        simData[3] = 0.0;   // morph_t

        setStatus(label);
    }

    /**
     * Resolve a shape name, sample N target positions from its density grid,
     * compute OT assignment from current positions, and trigger a morph.
     *
     * @param {string} name  Any registered name or alias
     */
    function goToShape(name) {
        const canonical = resolveShape(name);
        const grid      = getShape(canonical);
        const rawTgt    = sampleFromDensity(grid);
        const assigned  = assignTargets(cpuSource, rawTgt, N);
        goToPositions(assigned, canonical);
        return canonical;
    }

    /** Auto-cycle helper — advances to the next shape in the cycle sequence. */
    function advanceCycle() {
        shapeIdx = (shapeIdx + 1) % AUTO_CYCLE.length;
        goToShape(AUTO_CYCLE[shapeIdx]);
    }

    // Start immediately with the first shape
    advanceCycle();

    // ── UI panel ───────────────────────────────────────────────────────────────
    initPanel({
        onSubmit(text) {
            const name = goToShape(text);
            userControlled = true;
            showResponse(name);
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

                if (!userControlled && morph.hold >= HOLD_DURATION) {
                    advanceCycle();
                }
            }
            simData[3] = morph.t;
        }

        // ── Write sim params ────────────────────────────────────────────────
        simData[0] = dt;
        simData[1] = totalSec;
        device.queue.writeBuffer(buffers.simBuf, 0, simData);

        // ── Clear density buffer ────────────────────────────────────────────
        // Done via writeBuffer (no PCIe issue: 256KB at 60 fps ≈ 15 MB/s)
        device.queue.writeBuffer(buffers.densityBuf, 0, DENSITY_CLEAR);

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
