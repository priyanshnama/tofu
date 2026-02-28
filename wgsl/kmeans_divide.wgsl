/**
 * kmeans_divide.wgsl — Compute new centroid positions from accumulated sums.
 *
 * Runs AFTER kmeans_update.wgsl.  Reads sum_x/sum_y/counts (written atomically
 * by the update pass) and writes new centroid positions.
 *
 * Clearing the accumulators for the next iteration is done on the CPU side via
 * device.queue.writeBuffer() between submissions — safer than atomicStore here.
 *
 * One thread per centroid, dispatched as ceil(K/64) workgroups of size 64.
 */

const K     : u32 = 512u;
const SCALE : f32 = 1024.0;   // must match kmeans_update.wgsl

// Declared as non-atomic for reading — safe because the update pass has
// fully completed (separate command encoder submission) before this runs.
@group(0) @binding(0) var<storage, read>       sum_x     : array<i32>;   // K
@group(0) @binding(1) var<storage, read>       sum_y     : array<i32>;   // K
@group(0) @binding(2) var<storage, read>       counts    : array<u32>;   // K
@group(0) @binding(3) var<storage, read_write> centroids : array<f32>;   // K×2

@compute @workgroup_size(64)
fn kmeans_divide(@builtin(global_invocation_id) gid: vec3<u32>) {
    let k = gid.x;
    if (k >= K) { return; }

    let c = counts[k];
    if (c > 0u) {
        centroids[k * 2u]      = f32(sum_x[k]) / (SCALE * f32(c));
        centroids[k * 2u + 1u] = f32(sum_y[k]) / (SCALE * f32(c));
    }
    // else: keep previous centroid (handles empty cluster gracefully)
}
