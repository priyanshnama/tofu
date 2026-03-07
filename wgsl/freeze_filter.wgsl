/**
 * freeze_filter.wgsl
 *
 * Per-atom decision: if the OT-assigned target is already close to the atom's
 * current position, freeze it in place (source = target = current).
 * Otherwise write the assigned target through unchanged.
 *
 * Runs once per shape transition, after k-means OT assignment.
 * Writes the final per-atom target directly into target_buf (simulation buffer).
 */

@group(0) @binding(0) var<storage, read>       assigned_buf : array<f32>;  // N×2 OT result
@group(0) @binding(1) var<storage, read>       current_buf  : array<f32>;  // N×2 current positions
@group(0) @binding(2) var<storage, read_write> target_buf   : array<f32>;  // N×2 output

const N       : u32 = %%N%%;
const THRESH2 : f32 = 0.000225; // 0.015²  ≈ 1.5 % of NDC half-width

@compute @workgroup_size(256)
fn freeze_filter(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= N) { return; }

    let ax = assigned_buf[i * 2u];
    let ay = assigned_buf[i * 2u + 1u];
    let cx = current_buf [i * 2u];
    let cy = current_buf [i * 2u + 1u];

    let dx = ax - cx;
    let dy = ay - cy;

    // Atom is already at (or very near) its assigned target — freeze it.
    if (dx * dx + dy * dy < THRESH2) {
        target_buf[i * 2u]      = cx;
        target_buf[i * 2u + 1u] = cy;
    } else {
        target_buf[i * 2u]      = ax;
        target_buf[i * 2u + 1u] = ay;
    }
}
