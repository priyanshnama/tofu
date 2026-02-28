/**
 * kmeans_update.wgsl — Accumulate each point's position into its centroid's sum.
 *
 * Uses fixed-point arithmetic (scale=16384) so positions ∈ [-1,1] map to i32
 * values ∈ [-16384, 16384].  Max accumulation per centroid: 100k × 16384 = 1.64B,
 * safely within i32 range (2.1B).
 *
 * Dispatched as ceil(N/256) workgroups of size 256.
 */

const N     : u32 = %%N%%;
const SCALE : f32 = %%SCALE%%;

@group(0) @binding(0) var<storage, read>       pos    : array<f32>;          // N×2
@group(0) @binding(1) var<storage, read>       labels : array<u32>;          // N
@group(0) @binding(2) var<storage, read_write> sum_x  : array<atomic<i32>>;  // K
@group(0) @binding(3) var<storage, read_write> sum_y  : array<atomic<i32>>;  // K
@group(0) @binding(4) var<storage, read_write> counts : array<atomic<u32>>;  // K

@compute @workgroup_size(256)
fn kmeans_update(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= N) { return; }

    let k  = labels[i];
    let ix = i32(pos[i * 2u]       * SCALE);
    let iy = i32(pos[i * 2u + 1u] * SCALE);

    atomicAdd(&sum_x[k], ix);
    atomicAdd(&sum_y[k], iy);
    atomicAdd(&counts[k], 1u);
}
