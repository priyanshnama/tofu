/**
 * kmeans_divide.wgsl — Update centroid positions from accumulated sums, then clear.
 *
 * Combines the "divide" and "clear" steps so the accumulator buffers are reset
 * for the next iteration without a separate pass.
 *
 * One thread per centroid, dispatched as ceil(K/64) workgroups of size 64.
 */

const K     : u32 = 512u;
const SCALE : f32 = 16384.0;

@group(0) @binding(0) var<storage, read_write> sum_x     : array<atomic<i32>>;  // K
@group(0) @binding(1) var<storage, read_write> sum_y     : array<atomic<i32>>;  // K
@group(0) @binding(2) var<storage, read_write> counts    : array<atomic<u32>>;  // K
@group(0) @binding(3) var<storage, read_write> centroids : array<f32>;          // K×2

@compute @workgroup_size(64)
fn kmeans_divide(@builtin(global_invocation_id) gid: vec3<u32>) {
    let k = gid.x;
    if (k >= K) { return; }

    let sx = atomicLoad(&sum_x[k]);
    let sy = atomicLoad(&sum_y[k]);
    let c  = atomicLoad(&counts[k]);

    if (c > 0u) {
        centroids[k * 2u]      = f32(sx) / (SCALE * f32(c));
        centroids[k * 2u + 1u] = f32(sy) / (SCALE * f32(c));
    }
    // else: keep previous centroid position (handles empty cluster)

    // Clear accumulators for the next iteration
    atomicStore(&sum_x[k], 0i);
    atomicStore(&sum_y[k], 0i);
    atomicStore(&counts[k], 0u);
}
