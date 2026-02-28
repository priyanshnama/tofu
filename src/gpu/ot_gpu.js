/**
 * ot_gpu.js — GPU-native Optimal Transport via hierarchical K-means (Phase 4).
 *
 * Algorithm
 * ─────────
 * 1. GPU K-means on source cloud  → K source centroids + per-atom labels
 * 2. GPU K-means on target cloud  → K target centroids + per-target labels
 * 3. CPU: sort-by-angle OT on K centroids (512 items — trivial)
 * 4. CPU: intra-cluster round-robin pairing
 *    • atoms in source cluster i  →  targets in matched cluster map[i]
 * 5. Return Float32Array(N×2) — assigned target position per source atom
 *
 * Key fix vs previous attempt
 * ───────────────────────────
 * The original single-encoder approach combined divide+atomicStore(clear) in one
 * huge encoder (K_ITERS × 3 passes).  On some WebGPU implementations the
 * intra-encoder ordering was not reliable for atomic stores feeding the next
 * update pass.
 *
 * Now each iteration is a separate command encoder submission.  Accumulator
 * buffers are cleared via device.queue.writeBuffer() between submissions —
 * the queue guarantees ordering between writeBuffer and the next submit.
 */

import assignCode from '../../wgsl/kmeans_assign.wgsl?raw';
import updateCode from '../../wgsl/kmeans_update.wgsl?raw';
import divideCode from '../../wgsl/kmeans_divide.wgsl?raw';

// ── Constants ─────────────────────────────────────────────────────────────────

const K       = 512;      // centroids per cloud
const K_ITERS = 6;        // k-means iterations (converges well in 6)
export const OT_N = 1_500_000;

const K_F32_BYTES = K * 2 * 4;       // K centroids × 2 floats × 4 B  =   4 096
const K_I32_BYTES = K * 4;           // K × i32                        =   2 048
const N_U32_BYTES = OT_N * 4;        // N × u32  (labels)              = 400 000
const N_F32_BYTES = OT_N * 2 * 4;    // N × 2 × f32  (positions)      = 800 000

const DISP_N = Math.ceil(OT_N / 256);  // 391 workgroups
const DISP_K = Math.ceil(K / 64);      //   8 workgroups

// Pre-allocated zero arrays for clearing accumulators — avoids GC pressure
const ZEROS_I32 = new Int32Array(K);
const ZEROS_U32 = new Uint32Array(K);

// ── Helpers ───────────────────────────────────────────────────────────────────

const S  = GPUBufferUsage.STORAGE;
const CD = GPUBufferUsage.COPY_DST;
const CS = GPUBufferUsage.COPY_SRC;
const MR = GPUBufferUsage.MAP_READ;

function mkBuf(device, size, usage, label) {
    return device.createBuffer({ label, size, usage });
}

async function compilePipeline(device, code, entryPoint, label) {
    const mod  = device.createShaderModule({ label, code });
    const info = await mod.getCompilationInfo();
    for (const m of info.messages) {
        const fn = m.type === 'error' ? console.error : console.warn;
        fn(`[ot_gpu/${label}] L${m.lineNum}: ${m.message}`);
    }
    return device.createComputePipelineAsync({
        label, layout: 'auto',
        compute: { module: mod, entryPoint },
    });
}

// ── Build ─────────────────────────────────────────────────────────────────────

/**
 * Compile all three k-means pipelines and allocate GPU buffers.
 * Call once at startup; reuse the handle for every transition.
 */
export async function buildOTGpu(device) {
    const [assignPipeline, updatePipeline, dividePipeline] = await Promise.all([
        compilePipeline(device, assignCode, 'kmeans_assign', 'km-assign'),
        compilePipeline(device, updateCode, 'kmeans_update', 'km-update'),
        compilePipeline(device, divideCode, 'kmeans_divide', 'km-divide'),
    ]);

    // Positions buffer — reused for src then tgt
    const posBuf        = mkBuf(device, N_F32_BYTES, S | CD,       'km-pos');
    const centroidsBuf  = mkBuf(device, K_F32_BYTES, S | CD | CS,  'km-centroids');
    const labelsBuf     = mkBuf(device, N_U32_BYTES, S | CD | CS,  'km-labels');

    // Fixed-point accumulator buffers
    const sumXBuf   = mkBuf(device, K_I32_BYTES, S | CD, 'km-sum-x');
    const sumYBuf   = mkBuf(device, K_I32_BYTES, S | CD, 'km-sum-y');
    const countsBuf = mkBuf(device, K_I32_BYTES, S | CD, 'km-counts');

    // CPU readback staging
    const centroidsStaging = mkBuf(device, K_F32_BYTES, CD | MR, 'km-centroids-rb');
    const labelsStaging    = mkBuf(device, N_U32_BYTES, CD | MR, 'km-labels-rb');

    // ── Bind groups ───────────────────────────────────────────────────────────

    const assignBG = device.createBindGroup({
        label: 'km-assign-bg',
        layout: assignPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: posBuf       } },  // pos
            { binding: 1, resource: { buffer: centroidsBuf } },  // centroids (read)
            { binding: 2, resource: { buffer: labelsBuf    } },  // labels (write)
        ],
    });

    const updateBG = device.createBindGroup({
        label: 'km-update-bg',
        layout: updatePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: posBuf    } },  // pos
            { binding: 1, resource: { buffer: labelsBuf } },  // labels (read)
            { binding: 2, resource: { buffer: sumXBuf   } },  // sum_x (atomic)
            { binding: 3, resource: { buffer: sumYBuf   } },  // sum_y (atomic)
            { binding: 4, resource: { buffer: countsBuf } },  // counts (atomic)
        ],
    });

    const divideBG = device.createBindGroup({
        label: 'km-divide-bg',
        layout: dividePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: sumXBuf      } },  // sum_x (read)
            { binding: 1, resource: { buffer: sumYBuf      } },  // sum_y (read)
            { binding: 2, resource: { buffer: countsBuf    } },  // counts (read)
            { binding: 3, resource: { buffer: centroidsBuf } },  // centroids (write)
        ],
    });

    console.log(`[ot_gpu] ready  K=${K}  iters=${K_ITERS}`);

    return {
        assignPipeline, updatePipeline, dividePipeline,
        posBuf, centroidsBuf, labelsBuf,
        sumXBuf, sumYBuf, countsBuf,
        centroidsStaging, labelsStaging,
        assignBG, updateBG, divideBG,
    };
}

// ── K-means ───────────────────────────────────────────────────────────────────

/**
 * Run GPU K-means on `positions` (Float32Array N×2).
 * Returns { centroids: Float32Array(K×2), labels: Uint32Array(N) }.
 */
async function runKMeans(device, ot, positions) {
    const {
        posBuf, centroidsBuf, labelsBuf,
        sumXBuf, sumYBuf, countsBuf,
        centroidsStaging, labelsStaging,
        assignBG, updateBG, divideBG,
        assignPipeline, updatePipeline, dividePipeline,
    } = ot;

    // ── Upload positions ──────────────────────────────────────────────────────
    device.queue.writeBuffer(posBuf, 0, positions);

    // ── Seed centroids: evenly-spaced indices across the point set ────────────
    const step = Math.floor(OT_N / K);
    const initC = new Float32Array(K * 2);
    for (let k = 0; k < K; k++) {
        initC[k * 2    ] = positions[k * step * 2    ];
        initC[k * 2 + 1] = positions[k * step * 2 + 1];
    }
    device.queue.writeBuffer(centroidsBuf, 0, initC);

    // ── K-means iterations — one submit per iteration ─────────────────────────
    // Clearing via writeBuffer between submits is safer than atomicStore inside
    // the encoder (avoids potential intra-encoder ordering edge cases).

    for (let iter = 0; iter < K_ITERS; iter++) {
        // Clear accumulators before this iteration's update pass
        device.queue.writeBuffer(sumXBuf,   0, ZEROS_I32);
        device.queue.writeBuffer(sumYBuf,   0, ZEROS_I32);
        device.queue.writeBuffer(countsBuf, 0, ZEROS_U32);

        const enc = device.createCommandEncoder({ label: `km-iter-${iter}` });

        // 1. Assign each point to nearest centroid
        {
            const p = enc.beginComputePass({ label: 'assign' });
            p.setPipeline(assignPipeline);
            p.setBindGroup(0, assignBG);
            p.dispatchWorkgroups(DISP_N);
            p.end();
        }
        // 2. Accumulate positions into centroid sums
        {
            const p = enc.beginComputePass({ label: 'update' });
            p.setPipeline(updatePipeline);
            p.setBindGroup(0, updateBG);
            p.dispatchWorkgroups(DISP_N);
            p.end();
        }
        // 3. Divide sums by counts → new centroid positions
        {
            const p = enc.beginComputePass({ label: 'divide' });
            p.setPipeline(dividePipeline);
            p.setBindGroup(0, divideBG);
            p.dispatchWorkgroups(DISP_K);
            p.end();
        }

        device.queue.submit([enc.finish()]);
    }

    // ── Final assign pass + copy to staging ───────────────────────────────────
    // (labels now correspond to the final converged centroids)
    const encFinal = device.createCommandEncoder({ label: 'km-final' });
    {
        const p = encFinal.beginComputePass({ label: 'assign-final' });
        p.setPipeline(assignPipeline);
        p.setBindGroup(0, assignBG);
        p.dispatchWorkgroups(DISP_N);
        p.end();
    }
    encFinal.copyBufferToBuffer(centroidsBuf, 0, centroidsStaging, 0, K_F32_BYTES);
    encFinal.copyBufferToBuffer(labelsBuf,    0, labelsStaging,    0, N_U32_BYTES);
    device.queue.submit([encFinal.finish()]);

    // ── CPU readback ──────────────────────────────────────────────────────────
    await Promise.all([
        centroidsStaging.mapAsync(GPUMapMode.READ),
        labelsStaging.mapAsync(GPUMapMode.READ),
    ]);

    const centroids = new Float32Array(centroidsStaging.getMappedRange().slice(0));
    const labels    = new Uint32Array(labelsStaging.getMappedRange().slice(0));
    centroidsStaging.unmap();
    labelsStaging.unmap();

    return { centroids, labels };
}

// ── Centroid-level OT (CPU, K items) ─────────────────────────────────────────

/**
 * Sort-by-angle matching of K source centroids → K target centroids.
 * Returns Uint32Array(K): map[src_centroid] = matched_tgt_centroid.
 */
function matchCentroids(srcC, tgtC) {
    let scx = 0, scy = 0, tcx = 0, tcy = 0;
    for (let k = 0; k < K; k++) {
        scx += srcC[k * 2];  scy += srcC[k * 2 + 1];
        tcx += tgtC[k * 2];  tcy += tgtC[k * 2 + 1];
    }
    scx /= K;  scy /= K;
    tcx /= K;  tcy /= K;

    const srcRanked = sortByAngle(srcC, K, scx, scy);
    const tgtRanked = sortByAngle(tgtC, K, tcx, tcy);

    const map = new Uint32Array(K);
    for (let rank = 0; rank < K; rank++) {
        map[srcRanked[rank]] = tgtRanked[rank];
    }
    return map;
}

function sortByAngle(pos, n, cx, cy) {
    const arr = Array.from({ length: n }, (_, i) => ({
        i, a: Math.atan2(pos[i * 2 + 1] - cy, pos[i * 2] - cx),
    }));
    arr.sort((a, b) => a.a - b.a);
    return arr.map(p => p.i);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Assign N source atoms to N target positions using GPU K-means + CPU centroid OT.
 *
 * @param {GPUDevice}    device
 * @param {object}       ot       Handle from buildOTGpu()
 * @param {Float32Array} srcPos   N×2 source positions
 * @param {Float32Array} tgtPos   N×2 target positions
 * @returns {Promise<Float32Array>} N×2 assigned target per source atom
 */
export async function assignTargetsGpu(device, ot, srcPos, tgtPos) {
    // Run k-means sequentially (they share GPU buffers)
    const src = await runKMeans(device, ot, srcPos);
    const tgt = await runKMeans(device, ot, tgtPos);

    // Centroid-level OT (512 items — fast on CPU)
    const centroidMap = matchCentroids(src.centroids, tgt.centroids);

    // Build per-target-centroid member list
    const tgtCluster = Array.from({ length: K }, () => []);
    for (let j = 0; j < OT_N; j++) {
        tgtCluster[tgt.labels[j]].push(j);
    }

    // Assign each source atom to a target from its matched cluster (round-robin)
    const tgtCursor = new Uint32Array(K);
    const result    = new Float32Array(OT_N * 2);

    for (let i = 0; i < OT_N; i++) {
        const srcC = src.labels[i];
        const tgtC = centroidMap[srcC];
        const pool = tgtCluster[tgtC];

        if (pool.length === 0) {
            // Empty cluster fallback: use centroid position directly
            result[i * 2    ] = tgt.centroids[tgtC * 2    ];
            result[i * 2 + 1] = tgt.centroids[tgtC * 2 + 1];
            continue;
        }

        const j = pool[tgtCursor[tgtC] % pool.length];
        tgtCursor[tgtC]++;

        result[i * 2    ] = tgtPos[j * 2    ];
        result[i * 2 + 1] = tgtPos[j * 2 + 1];
    }

    return result;
}
