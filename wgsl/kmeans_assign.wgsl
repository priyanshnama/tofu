/**
 * kmeans_assign.wgsl — Assign each of N points to its nearest centroid.
 *
 * One thread per point. Inner loop over all K centroids (K=512, 512 MADs per thread).
 * Dispatched as ceil(N/256) workgroups of size 256.
 */

const N : u32 = 1500000u;
const K : u32 = 512u;

@group(0) @binding(0) var<storage, read>       pos       : array<f32>;  // N×2 (x,y interleaved)
@group(0) @binding(1) var<storage, read>       centroids : array<f32>;  // K×2
@group(0) @binding(2) var<storage, read_write> labels    : array<u32>;  // N

@compute @workgroup_size(256)
fn kmeans_assign(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= N) { return; }

    let px = pos[i * 2u];
    let py = pos[i * 2u + 1u];

    var best_d = 1e38f;
    var best_k = 0u;

    for (var k = 0u; k < K; k++) {
        let dx = px - centroids[k * 2u];
        let dy = py - centroids[k * 2u + 1u];
        let d2 = dx * dx + dy * dy;
        if (d2 < best_d) {
            best_d = d2;
            best_k = k;
        }
    }

    labels[i] = best_k;
}
