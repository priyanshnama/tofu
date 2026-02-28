/*
 * bloom.wgsl — Single-pass 5×5 separable Gaussian bloom.
 *
 * Reads trail_buf (persistent f32 glow), applies a thresholded Gaussian
 * gather into bloom_buf. Only pixels above BLOOM_THRESHOLD contribute so
 * dim background regions don't spread noise.
 *
 * bloom_buf is then sampled additively in render.wgsl to create the
 * classic phosphor halo around bright atom clusters.
 *
 * Bindings (group 0):
 *   0  trail_buf — storage read        (f32, persistent glow)
 *   1  bloom_buf — storage read_write  (f32, blurred bloom output)
 */

const DENSITY_W      : u32 = 256u;
const DENSITY_H      : u32 = 256u;
const BLOOM_THRESHOLD: f32 = 1.5;   // trail value below which no bloom is emitted

// 1-D Gaussian weights for σ ≈ 1.5  (offsets -2 … +2)
// normalised so the 5 weights sum to 1.0
const W0 : f32 = 0.120;
const W1 : f32 = 0.234;
const W2 : f32 = 0.292;

@group(0) @binding(0) var<storage, read>       trail_buf : array<f32>;
@group(0) @binding(1) var<storage, read_write> bloom_buf : array<f32>;

fn sample_trail(ix : i32, iy : i32) -> f32 {
    let cx = clamp(ix, 0, i32(DENSITY_W) - 1);
    let cy = clamp(iy, 0, i32(DENSITY_H) - 1);
    let v  = trail_buf[u32(cy) * DENSITY_W + u32(cx)];
    return max(v - BLOOM_THRESHOLD, 0.0);
}

fn gauss_w(d : i32) -> f32 {
    if d == 0  { return W2; }
    if abs(d) == 1 { return W1; }
    return W0;
}

@compute @workgroup_size(256)
fn cs_bloom(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if i >= DENSITY_W * DENSITY_H { return; }

    let ix = i32(i % DENSITY_W);
    let iy = i32(i / DENSITY_W);

    // 5×5 separable Gaussian gather
    var sum = 0.0;
    for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
            sum += gauss_w(dx) * gauss_w(dy) * sample_trail(ix + dx, iy + dy);
        }
    }
    bloom_buf[i] = sum;
}
