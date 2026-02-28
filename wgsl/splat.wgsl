/*
 * splat.wgsl — Accumulate atom positions into a 2D density buffer.
 *
 * Bilinear kernel: each atom distributes its contribution across the 4
 * surrounding pixels using sub-pixel weights (sum = 256).  This eliminates
 * both coverage gaps and pixel-quantisation jitter during morph.
 *
 * Coordinate mapping:
 *   NDC pos.x ∈ [-1, +1]  →  col ∈ [0, DENSITY_W)   left → right
 *   NDC pos.y ∈ [-1, +1]  →  row ∈ [0, DENSITY_H)   bottom → top
 *
 * Bindings (group 0):
 *   0  atoms       — storage read        (current atom positions)
 *   1  density_buf — storage read_write  (atomic u32, bilinear-weight accumulation)
 *   2  vel_buf     — storage read_write  (atomic u32, speed × bilinear weight)
 */

struct Atom {
    pos : vec2<f32>,
    vel : vec2<f32>,
}

@group(0) @binding(0) var<storage, read>       atoms       : array<Atom>;
@group(0) @binding(1) var<storage, read_write> density_buf : array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> vel_buf     : array<atomic<u32>>;

const DENSITY_W : u32 = 2560u;
const DENSITY_H : u32 = 1440u;
const N         : u32 = 1500000u;

@compute @workgroup_size(256)
fn cs_splat(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if idx >= N { return; }

    let p = atoms[idx].pos;

    // NDC [-1,+1] → sub-pixel float in [0, W/H).
    // Clamped to [0, W-2] so tx0+1 is always a valid column index.
    let fx = clamp((p.x * 0.5 + 0.5) * f32(DENSITY_W), 0.0, f32(DENSITY_W - 2u));
    let fy = clamp((p.y * 0.5 + 0.5) * f32(DENSITY_H), 0.0, f32(DENSITY_H - 2u));

    let tx0 = u32(fx);
    let ty0 = u32(fy);
    let tx1 = tx0 + 1u;
    let ty1 = ty0 + 1u;

    // Bilinear weights in ×256 fixed-point — four weights sum to exactly 256.
    let wx1 = u32(fract(fx) * 256.0);
    let wy1 = u32(fract(fy) * 256.0);
    let wx0 = 256u - wx1;
    let wy0 = 256u - wy1;

    // Products in [0, 65536], >>8 brings back to [0, 256] range.
    let w00 = (wx0 * wy0) >> 8u;
    let w10 = (wx1 * wy0) >> 8u;
    let w01 = (wx0 * wy1) >> 8u;
    let w11 = (wx1 * wy1) >> 8u;

    let i00 = ty0 * DENSITY_W + tx0;
    let i10 = ty0 * DENSITY_W + tx1;
    let i01 = ty1 * DENSITY_W + tx0;
    let i11 = ty1 * DENSITY_W + tx1;

    atomicAdd(&density_buf[i00], w00);
    atomicAdd(&density_buf[i10], w10);
    atomicAdd(&density_buf[i01], w01);
    atomicAdd(&density_buf[i11], w11);

    // Speed accumulator: same bilinear weights so vel/density ratio = avg speed.
    // Max per write: 65535 × 256 = 16.7M — well within u32 (4.3B).
    let su = u32(clamp(length(atoms[idx].vel) / 0.55, 0.0, 1.0) * 65535.0);
    atomicAdd(&vel_buf[i00], su * w00);
    atomicAdd(&vel_buf[i10], su * w10);
    atomicAdd(&vel_buf[i01], su * w01);
    atomicAdd(&vel_buf[i11], su * w11);
}
