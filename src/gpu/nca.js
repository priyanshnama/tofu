/**
 * nca.js — NCA pipeline: MLP mode (trained weights) or RDS fallback.
 *
 * On startup, buildNCA() tries to fetch /nca_weights.json:
 *
 *   • Found  → MLP mode: 16-channel GoalNCA, architecture matches
 *              wgsl/nca_step_mlp.wgsl + training/train_nca.py exactly.
 *              Each shape grows organically from a zero state.
 *
 *   • Missing → RDS mode: single-channel reaction-diffusion (existing
 *              wgsl/nca_step.wgsl), adds organic texture to the parametric
 *              goal grid.  No training required.
 *
 * Both modes expose the same API:
 *   const nca = await buildNCA(device);
 *   const density = await runNCA(device, nca, goalGrid);  // Float32Array(128×128)
 */

import rdsCode from '../../wgsl/nca_step.wgsl?raw';
import mlpCode from '../../wgsl/nca_step_mlp.wgsl?raw';
import extCode from '../../wgsl/nca_extract.wgsl?raw';

export const NCA_W = 128;
export const NCA_H = 128;

const NCA_CELLS    = NCA_W * NCA_H;
const NCA_CHANNELS = 16;                        // MLP state channels
const NCA_STEPS    = 64;

const BYTES_SINGLE = NCA_CELLS * 4;             // 1-channel state  (64 KB)
const BYTES_MULTI  = NCA_CELLS * NCA_CHANNELS * 4; // 16-channel state (1 MB)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBuffer(device, size, usage, label) {
    return device.createBuffer({ label, size, usage });
}
const S  = GPUBufferUsage.STORAGE;
const CD = GPUBufferUsage.COPY_DST;
const CS = GPUBufferUsage.COPY_SRC;
const MR = GPUBufferUsage.MAP_READ;
const U  = GPUBufferUsage.UNIFORM;

async function compilePipeline(device, code, entryPoint, label) {
    const mod  = device.createShaderModule({ label, code });
    const info = await mod.getCompilationInfo();
    for (const m of info.messages) {
        const fn = m.type === 'error' ? console.error : console.warn;
        fn(`[${label}] L${m.lineNum}: ${m.message}`);
    }
    return device.createComputePipelineAsync({
        label,
        layout:  'auto',
        compute: { module: mod, entryPoint },
    });
}

// ── Weight loading ────────────────────────────────────────────────────────────

/**
 * Fetch /nca_weights.json (produced by training/train_nca.py).
 * Returns null if the file is not found or is malformed.
 */
async function fetchWeights() {
    try {
        const resp = await fetch('/nca_weights.json');
        if (!resp.ok) return null;
        const json = await resp.json();
        if (!json.w1 || !json.b1 || !json.w2 || !json.b2) return null;
        return {
            w1: new Float32Array(json.w1.flat()),   // (NHD × NIN)
            b1: new Float32Array(json.b1),          // (NHD,)
            w2: new Float32Array(json.w2.flat()),   // (C × NHD)
            b2: new Float32Array(json.b2),          // (C,)
        };
    } catch {
        return null;
    }
}

// ── MLP mode ──────────────────────────────────────────────────────────────────

async function buildMLP(device, weights) {
    const [stepPipeline, extPipeline] = await Promise.all([
        compilePipeline(device, mlpCode, 'nca_step',  'nca-mlp-step'),
        compilePipeline(device, extCode, 'extract',    'nca-extract'),
    ]);

    // State ping-pong (1 MB each)
    const stateBufs = [0, 1].map(i =>
        makeBuffer(device, BYTES_MULTI, S | CD | CS, `nca-state-${i}`));

    // Goal buffer (64 KB, single channel)
    const goalBuf = makeBuffer(device, BYTES_SINGLE, S | CD, 'nca-goal');

    // Weight buffers
    const w1Buf = makeBuffer(device, weights.w1.byteLength, S | CD, 'nca-w1');
    const b1Buf = makeBuffer(device, weights.b1.byteLength, S | CD, 'nca-b1');
    const w2Buf = makeBuffer(device, weights.w2.byteLength, S | CD, 'nca-w2');
    const b2Buf = makeBuffer(device, weights.b2.byteLength, S | CD, 'nca-b2');

    device.queue.writeBuffer(w1Buf, 0, weights.w1);
    device.queue.writeBuffer(b1Buf, 0, weights.b1);
    device.queue.writeBuffer(w2Buf, 0, weights.w2);
    device.queue.writeBuffer(b2Buf, 0, weights.b2);

    // Params uniform: { step: u32, fire_rate: f32, pad, pad } = 16 bytes
    const paramsBuf  = makeBuffer(device, 16, U | CD, 'nca-params');
    const paramsData = new ArrayBuffer(16);
    const paramsU32  = new Uint32Array(paramsData);
    const paramsF32  = new Float32Array(paramsData);
    paramsF32[1] = 0.5;   // fire_rate (baked in; step updated per dispatch)

    // Alpha extraction buffer (64 KB, single channel)
    const alphaBuf   = makeBuffer(device, BYTES_SINGLE, S | CD | CS, 'nca-alpha');
    const readbackBuf = makeBuffer(device, BYTES_SINGLE, CD | MR, 'nca-readback');

    // Bind groups for MLP step (ping-pong)
    const stepBGL = stepPipeline.getBindGroupLayout(0);
    const stepBGs = [0, 1].map(slot => device.createBindGroup({
        label:  `nca-step-bg-${slot}`,
        layout: stepBGL,
        entries: [
            { binding: 0, resource: { buffer: stateBufs[slot]     } },  // s_in
            { binding: 1, resource: { buffer: stateBufs[1 - slot] } },  // s_out
            { binding: 2, resource: { buffer: goalBuf              } },  // goal
            { binding: 3, resource: { buffer: w1Buf                } },
            { binding: 4, resource: { buffer: b1Buf                } },
            { binding: 5, resource: { buffer: w2Buf                } },
            { binding: 6, resource: { buffer: b2Buf                } },
            { binding: 7, resource: { buffer: paramsBuf            } },  // params
        ],
    }));

    // Bind group for alpha extraction
    const extBGL = extPipeline.getBindGroupLayout(0);

    return {
        mode: 'mlp',
        stepPipeline, extPipeline,
        stateBufs, goalBuf, alphaBuf, readbackBuf,
        stepBGs, extBGL,
        paramsBuf, paramsData, paramsU32,
    };
}

async function runMLP(device, nca, goalGrid) {
    const { stepPipeline, extPipeline, stateBufs, goalBuf,
            alphaBuf, readbackBuf, stepBGs, extBGL,
            paramsBuf, paramsData, paramsU32 } = nca;

    // Upload goal
    device.queue.writeBuffer(goalBuf, 0, goalGrid);

    // Seed: all-zero initial state (NCA learns to grow from scratch)
    device.queue.writeBuffer(stateBufs[0], 0, new Uint8Array(BYTES_MULTI));

    // Run NCA_STEPS MLP passes — one writeBuffer(params) per step for the hash seed
    for (let step = 0; step < NCA_STEPS; step++) {
        paramsU32[0] = step;
        device.queue.writeBuffer(paramsBuf, 0, paramsData);

        const enc  = device.createCommandEncoder({ label: `nca-step-${step}` });
        const pass = enc.beginComputePass();
        pass.setPipeline(stepPipeline);
        pass.setBindGroup(0, stepBGs[step & 1]);
        pass.dispatchWorkgroups(NCA_W / 8, NCA_H / 8);
        pass.end();
        device.queue.submit([enc.finish()]);
    }

    // Extract alpha channel from 16-channel state → compact 64 KB buffer
    const finalSlot = NCA_STEPS & 1;   // 64 & 1 = 0
    const extBG = device.createBindGroup({
        layout:  extBGL,
        entries: [
            { binding: 0, resource: { buffer: stateBufs[finalSlot] } },
            { binding: 1, resource: { buffer: alphaBuf              } },
        ],
    });
    const enc2 = device.createCommandEncoder({ label: 'nca-extract' });
    const ep   = enc2.beginComputePass();
    ep.setPipeline(extPipeline);
    ep.setBindGroup(0, extBG);
    ep.dispatchWorkgroups(NCA_W / 8, NCA_H / 8);
    ep.end();
    enc2.copyBufferToBuffer(alphaBuf, 0, readbackBuf, 0, BYTES_SINGLE);
    device.queue.submit([enc2.finish()]);

    // CPU readback
    await readbackBuf.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readbackBuf.getMappedRange().slice(0));
    readbackBuf.unmap();
    return result;
}

// ── RDS (reaction-diffusion) fallback mode ────────────────────────────────────

async function buildRDS(device) {
    const pipeline = await compilePipeline(device, rdsCode, 'nca_step', 'nca-rds');

    const stateBufs   = [0, 1].map(i =>
        makeBuffer(device, BYTES_SINGLE, S | CD | CS, `nca-rds-state-${i}`));
    const goalBuf     = makeBuffer(device, BYTES_SINGLE, S | CD,     'nca-rds-goal');
    const readbackBuf = makeBuffer(device, BYTES_SINGLE, CD | MR,    'nca-rds-readback');

    const bgl = pipeline.getBindGroupLayout(0);
    const bgs = [0, 1].map(slot => device.createBindGroup({
        label:  `nca-rds-bg-${slot}`,
        layout: bgl,
        entries: [
            { binding: 0, resource: { buffer: stateBufs[slot]     } },
            { binding: 1, resource: { buffer: stateBufs[1 - slot] } },
            { binding: 2, resource: { buffer: goalBuf              } },
        ],
    }));

    return { mode: 'rds', pipeline, stateBufs, goalBuf, readbackBuf, bgs };
}

async function runRDS(device, nca, goalGrid) {
    const { pipeline, stateBufs, goalBuf, readbackBuf, bgs } = nca;

    device.queue.writeBuffer(goalBuf, 0, goalGrid);

    // Seed: goalGrid + tiny noise
    const seed = new Float32Array(NCA_CELLS);
    for (let i = 0; i < NCA_CELLS; i++)
        seed[i] = Math.max(0, Math.min(1, goalGrid[i] + (Math.random() - 0.5) * 0.08));
    device.queue.writeBuffer(stateBufs[0], 0, seed);

    const enc = device.createCommandEncoder({ label: 'nca-rds-run' });
    for (let step = 0; step < NCA_STEPS; step++) {
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bgs[step & 1]);
        pass.dispatchWorkgroups(NCA_W / 8, NCA_H / 8);
        pass.end();
    }
    const finalSlot = NCA_STEPS & 1;
    enc.copyBufferToBuffer(stateBufs[finalSlot], 0, readbackBuf, 0, BYTES_SINGLE);
    device.queue.submit([enc.finish()]);

    await readbackBuf.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readbackBuf.getMappedRange().slice(0));
    readbackBuf.unmap();
    return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build all GPU resources for the NCA pipeline.
 * Tries to load trained weights; falls back to reaction-diffusion if missing.
 *
 * @param {GPUDevice} device
 * @returns {Promise<NCAHandle>}
 */
export async function buildNCA(device) {
    const weights = await fetchWeights();
    if (weights) {
        try {
            const handle = await buildMLP(device, weights);
            console.log('[nca] MLP mode active (trained weights loaded)');
            return handle;
        } catch (e) {
            console.warn('[nca] MLP pipeline failed, falling back to RDS:', e);
        }
    } else {
        console.log('[nca] No weights found → RDS fallback  |  run: cd training && python train_nca.py');
    }
    return buildRDS(device);
}

/**
 * Run NCA inference on the goal grid.
 *
 * @param {GPUDevice}    device
 * @param {object}       nca       Returned by buildNCA()
 * @param {Float32Array} goalGrid  NCA_W × NCA_H density values in [0,1]
 * @returns {Promise<Float32Array>} NCA_W × NCA_H organic density
 */
export async function runNCA(device, nca, goalGrid) {
    return nca.mode === 'mlp'
        ? runMLP(device, nca, goalGrid)
        : runRDS(device, nca, goalGrid);
}
