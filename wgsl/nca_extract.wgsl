/**
 * nca_extract.wgsl — Extract alpha channel (ch 0) from 16-channel NCA state.
 *
 * After NCA_STEPS MLP passes, the state tensor has shape W×H×16.
 * Channel 0 is the "alpha" / density channel that the NCA is trained to match
 * against the goal grid.  This pass extracts it into a compact W×H buffer
 * so the CPU readback is 64 KB instead of 1 MB.
 */

const W : u32 = 128u;
const H : u32 = 128u;
const C : u32 = 16u;

@group(0) @binding(0) var<storage, read>       state : array<f32>;  // W*H*C  (1 MB)
@group(0) @binding(1) var<storage, read_write> alpha : array<f32>;  // W*H    (64 KB)

@compute @workgroup_size(8, 8)
fn extract(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= W || gid.y >= H) { return; }
    let i    = gid.y * W + gid.x;
    // Channel 0 is alpha; clamp to [0,1] for density sampling
    alpha[i] = clamp(state[i * C], 0.0, 1.0);
}
