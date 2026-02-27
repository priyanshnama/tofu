/*
 * splat.wgsl — Accumulate atom positions into a 2D density buffer.
 *
 * Each atom increments one uint32 cell in the density buffer atomically.
 * The density buffer must be cleared to zero (via writeBuffer) before
 * each frame's splat pass.
 *
 * Coordinate mapping:
 *   NDC pos.x ∈ [-1, +1]  →  col ∈ [0, DENSITY_W)   left → right
 *   NDC pos.y ∈ [-1, +1]  →  row ∈ [0, DENSITY_H)   bottom → top
 *
 * This matches the render shader's UV → row/col mapping so atoms appear
 * at correct screen positions.
 *
 * Bindings (group 0):
 *   0  atoms       — storage read        (current atom positions)
 *   1  density_buf — storage read_write  (atomic u32 accumulation)
 */

struct Atom {
    pos : vec2<f32>,
    vel : vec2<f32>,
}

@group(0) @binding(0) var<storage, read>       atoms       : array<Atom>;
@group(0) @binding(1) var<storage, read_write> density_buf : array<atomic<u32>>;

const DENSITY_W : u32 = 256u;
const DENSITY_H : u32 = 256u;
const N         : u32 = 100000u;

@compute @workgroup_size(256)
fn cs_splat(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if idx >= N { return; }

    let pos = atoms[idx].pos;

    // NDC [-1, +1] → texel [0, DENSITY_W/H)
    // Clamp guards against atoms exactly at ±1.0 writing out of bounds
    let tx = u32(clamp(
        (pos.x * 0.5 + 0.5) * f32(DENSITY_W),
        0.0,
        f32(DENSITY_W - 1u)
    ));
    let ty = u32(clamp(
        (pos.y * 0.5 + 0.5) * f32(DENSITY_H),
        0.0,
        f32(DENSITY_H - 1u)
    ));

    atomicAdd(&density_buf[ty * DENSITY_W + tx], 1u);
}
