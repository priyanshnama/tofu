/**
 * ot.js — Optimal Transport assignment (Phase 1: sort-by-angle approximation).
 *
 * Responsibility: given N source positions and N target positions (both as
 * Float32Array of interleaved [x0,y0, x1,y1, …]), return a reordered copy
 * of targetPositions such that result[i] is the assigned target for source[i].
 *
 * Phase 1 strategy — sort-by-angle
 * ─────────────────────────────────
 * Sort both source and target by polar angle from the centroid of each cloud.
 * Pair the k-th source (by angle rank) with the k-th target (by angle rank).
 *
 * This is not strictly OT but produces near-optimal, largely non-crossing
 * trajectories for centrosymmetric shapes (circle, ring, star, spiral…) which
 * are the primary use case.  It runs in O(N log N) in JS and only executes
 * at shape-transition time — never during the frame loop.
 *
 * Phase 4 will replace this with GPU k-means + auction algorithm WGSL shaders.
 *
 * @param {Float32Array} srcPos   N × 2 interleaved source positions
 * @param {Float32Array} tgtPos   N × 2 interleaved target positions
 * @param {number}       N        atom count
 * @returns {Float32Array}        N × 2 interleaved — reordered targets
 */
export function assignTargets(srcPos, tgtPos, N) {
    // ── Compute centroid of each cloud ──────────────────────────────────────
    let scx = 0, scy = 0, tcx = 0, tcy = 0;
    for (let i = 0; i < N; i++) {
        scx += srcPos[i * 2];
        scy += srcPos[i * 2 + 1];
        tcx += tgtPos[i * 2];
        tcy += tgtPos[i * 2 + 1];
    }
    scx /= N; scy /= N;
    tcx /= N; tcy /= N;

    // ── Sort both clouds by polar angle from their centroid ─────────────────
    const srcOrder = _sortByAngle(srcPos, N, scx, scy);
    const tgtOrder = _sortByAngle(tgtPos, N, tcx, tcy);

    // ── Pair by rank ────────────────────────────────────────────────────────
    // srcOrder[k] = index of the k-th atom when sorted by angle
    // tgtOrder[k] = index of the k-th target when sorted by angle
    // → atom srcOrder[k] is assigned target tgtOrder[k]
    const result = new Float32Array(N * 2);
    for (let k = 0; k < N; k++) {
        const si = srcOrder[k];
        const ti = tgtOrder[k];
        result[si * 2    ] = tgtPos[ti * 2    ];
        result[si * 2 + 1] = tgtPos[ti * 2 + 1];
    }
    return result;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _sortByAngle(pos, N, cx, cy) {
    // Build [index, angle] pairs and sort by angle
    const pairs = new Array(N);
    for (let i = 0; i < N; i++) {
        pairs[i] = { i, a: Math.atan2(pos[i * 2 + 1] - cy, pos[i * 2] - cx) };
    }
    pairs.sort((a, b) => a.a - b.a);
    return pairs.map(p => p.i);
}
