/*
 * splat.wgsl — Soft Gaussian splat: each atom writes to a 3×3 pixel neighbourhood.
 *
 * Algorithm
 * ─────────
 * 1. Map atom NDC position → continuous pixel-space coords (fx, fy).
 * 2. Compute separable 1D Gaussian weights for the 3 columns and 3 rows
 *    surrounding the atom (σ ≈ 0.707 px, kernel: exp(-d²)).
 * 3. Write to 9 pixels with weights wx[i] × wy[j], fixed-point ×256.
 *
 * Why Gaussian instead of point / bilinear?
 *   • 9-pixel footprint per atom → near-100% coverage even at 40% fill rate.
 *   • Continuous sub-pixel weights → no binary pixel-flip jitter during morph.
 *   • Natural anti-aliasing: atom motion blends smoothly between adjacent pixels.
 *
 * Scale convention
 * ────────────────
 * Weights are fixed-point ×256: total across 9 pixels ≈ 256 per atom.
 * decay.wgsl divides density by 256 to restore unit-per-atom trail scale.
 * vel_buf uses same weights → vel/density ratio = weighted-average speed ✓
 *
 * Bindings (group 0):
 *   0  atoms       — storage read        (current atom positions)
 *   1  density_buf — storage read_write  (atomic u32, ×256 weight accumulation)
 *   2  vel_buf     — storage read_write  (atomic u32, speed × ×256 weight)
 */

struct Atom {
    pos : vec2<f32>,
    vel : vec2<f32>,
}

@group(0) @binding(0) var<storage, read>       atoms       : array<Atom>;
@group(0) @binding(1) var<storage, read_write> density_buf : array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> vel_buf     : array<atomic<u32>>;

const DENSITY_W : u32 = %%DENSITY_W%%;
const DENSITY_H : u32 = %%DENSITY_H%%;
const N         : u32 = %%N%%;

// 1D Gaussian weights for 3 consecutive pixels.
// s = sub-pixel offset of atom within its base pixel, s ∈ [0, 1).
// Pixel centres are at signed distances (-(s+0.5), (0.5-s), (1.5-s)) from atom.
// Kernel: exp(-d²)  →  σ = 1/√2 ≈ 0.707 px.  Weights normalised to sum = 1.
fn gauss1d(s: f32) -> vec3<f32> {
    let wL = exp(-(s + 0.5) * (s + 0.5));
    let wC = exp(-(s - 0.5) * (s - 0.5));
    let wR = exp(-(s - 1.5) * (s - 1.5));
    let inv = 1.0 / (wL + wC + wR);
    return vec3<f32>(wL * inv, wC * inv, wR * inv);
}

@compute @workgroup_size(256)
fn cs_splat(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if idx >= N { return; }

    let p = atoms[idx].pos;

    // NDC [-1,+1] → continuous pixel-space coords in [0, W/H)
    let fx_raw = (p.x * 0.5 + 0.5) * f32(DENSITY_W);
    let fy_raw = (p.y * 0.5 + 0.5) * f32(DENSITY_H);

    // Clamp so base pixel + neighbours are all in-bounds (guard handled in loop too)
    let fx = clamp(fx_raw, 0.0, f32(DENSITY_W - 1u));
    let fy = clamp(fy_raw, 0.0, f32(DENSITY_H - 1u));

    // Base pixel index (floor)
    let tx = i32(fx);
    let ty = i32(fy);

    // Sub-pixel offset within base pixel ∈ [0, 1)
    let sx = fx - f32(tx);
    let sy = fy - f32(ty);

    // Separable Gaussian weights for x and y axes
    let wx = gauss1d(sx);   // wx[0]=left, wx[1]=center, wx[2]=right
    let wy = gauss1d(sy);   // wy[0]=below, wy[1]=center, wy[2]=above

    // Speed (normalised 0–1) encoded as 0–65535
    let su = u32(clamp(length(atoms[idx].vel) / 0.55, 0.0, 1.0) * 65535.0);

    for (var dy = 0; dy < 3; dy++) {
        let cy = clamp(ty + dy - 1, 0, i32(DENSITY_H) - 1);
        let wy_d = wy[dy];
        for (var dx = 0; dx < 3; dx++) {
            let cx = clamp(tx + dx - 1, 0, i32(DENSITY_W) - 1);
            // Fixed-point weight: each atom distributes ≈256 units across 9 pixels
            let w  = u32(wx[dx] * wy_d * 256.0);
            let pi = u32(cy) * DENSITY_W + u32(cx);
            atomicAdd(&density_buf[pi], w);
            atomicAdd(&vel_buf[pi],     su * w);
        }
    }
}
