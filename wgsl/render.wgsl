/*
 * render.wgsl — Fullscreen density buffer → screen pixels.
 *
 * Vertex stage:
 *   Generates a fullscreen quad (2 triangles, 6 vertices) from vertex_index.
 *   UV (0,0) = NDC bottom-left, UV (1,1) = NDC top-right.
 *   This matches the splat shader's coordinate mapping exactly.
 *
 * Fragment stage:
 *   Reads from three buffers:
 *     trail_buf   (f32) — decayed persistent glow (phosphor afterglow)
 *     vel_buf     (u32) — current-frame accumulated speed (fixed-point)
 *     density_buf (u32) — current-frame atom counts (speed denominator)
 *
 *   Applies a 3×3 box filter for smooth appearance.
 *   Maps trail → brightness via log tone curve.
 *   Outputs green-phosphor colour ramp shifted white-hot for fast atoms.
 *
 * Bindings (group 0):
 *   0  trail_buf   — storage read  (f32, persistent decayed glow)
 *   1  vel_buf     — storage read  (u32, current frame speed accumulator)
 *   2  density_buf — storage read  (u32, current frame atom counts)
 *   3  bloom_buf   — storage read  (f32, Gaussian-blurred halo)
 */

@group(0) @binding(0) var<storage, read> trail_buf   : array<f32>;
@group(0) @binding(1) var<storage, read> vel_buf     : array<u32>;
@group(0) @binding(2) var<storage, read> density_buf : array<u32>;
@group(0) @binding(3) var<storage, read> bloom_buf   : array<f32>;

const DENSITY_W : u32 = 256u;
const DENSITY_H : u32 = 256u;

// ── Vertex ─────────────────────────────────────────────────────────────────

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
    // Two triangles covering [-1, +1]² in NDC
    // UV derived directly from NDC so UV (0,0) = bottom-left (NDC -1,-1)
    //                                   UV (1,1) = top-right  (NDC +1,+1)
    var xs = array<f32, 6>(-1.0,  1.0, -1.0, -1.0,  1.0,  1.0);
    var ys = array<f32, 6>(-1.0, -1.0,  1.0,  1.0, -1.0,  1.0);

    let x = xs[vi];
    let y = ys[vi];

    var out : VSOut;
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    out.uv  = vec2<f32>((x + 1.0) * 0.5, (y + 1.0) * 0.5);
    return out;
}

// ── Fragment helpers ───────────────────────────────────────────────────────

fn read_trail(ix : i32, iy : i32) -> f32 {
    let cx = clamp(ix, 0, i32(DENSITY_W) - 1);
    let cy = clamp(iy, 0, i32(DENSITY_H) - 1);
    return trail_buf[u32(cy) * DENSITY_W + u32(cx)];
}

fn read_bloom(ix : i32, iy : i32) -> f32 {
    let cx = clamp(ix, 0, i32(DENSITY_W) - 1);
    let cy = clamp(iy, 0, i32(DENSITY_H) - 1);
    return bloom_buf[u32(cy) * DENSITY_W + u32(cx)];
}

fn read_vel(ix : i32, iy : i32) -> f32 {
    let cx = clamp(ix, 0, i32(DENSITY_W) - 1);
    let cy = clamp(iy, 0, i32(DENSITY_H) - 1);
    return f32(vel_buf[u32(cy) * DENSITY_W + u32(cx)]);
}

fn read_density(ix : i32, iy : i32) -> f32 {
    let cx = clamp(ix, 0, i32(DENSITY_W) - 1);
    let cy = clamp(iy, 0, i32(DENSITY_H) - 1);
    return f32(density_buf[u32(cy) * DENSITY_W + u32(cx)]);
}

// ── Fragment ───────────────────────────────────────────────────────────────

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
    let ix = i32(in.uv.x * f32(DENSITY_W));
    let iy = i32(in.uv.y * f32(DENSITY_H));

    // 3×3 box filter on all four buffers
    var t_sum  = 0.0;
    var v_sum  = 0.0;
    var d_sum  = 0.0;
    var bm_sum = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            t_sum  += read_trail(ix + dx, iy + dy);
            v_sum  += read_vel(ix + dx, iy + dy);
            d_sum  += read_density(ix + dx, iy + dy);
            bm_sum += read_bloom(ix + dx, iy + dy);
        }
    }
    let avg_t  = t_sum  / 9.0;   // persistent trail — drives brightness
    let avg_v  = v_sum  / 9.0;   // current-frame speed accumulator
    let avg_d  = d_sum  / 9.0;   // current-frame atom count — speed denominator
    let avg_bm = bm_sum / 9.0;   // Gaussian-blurred halo

    // Logarithmic tone mapping from persistent trail
    let norm = clamp(log(1.0 + avg_t) / log(1.0 + 12.0), 0.0, 1.0);

    // Average normalised speed [0, 1] from current frame only
    let speed = select(0.0, clamp(avg_v / (avg_d * 65535.0), 0.0, 1.0), avg_d > 0.0);

    // Green-phosphor base colour
    let r_base = norm * norm * 0.18;
    let g_base = 0.35 * norm + 0.65 * norm * norm;
    let b_base = norm * norm * 0.10;

    // White hot at high speed
    let blend = speed * 0.85;
    let r = mix(r_base, norm * 0.90, blend);
    let g = mix(g_base, norm,        blend);
    let b = mix(b_base, norm * 0.95, blend);

    // Additive bloom halo — same phosphor green, soft glow from neighbours
    let bm = clamp(log(1.0 + avg_bm) / log(1.0 + 12.0), 0.0, 1.0) * 0.55;
    let r_out = min(r + bm * bm * 0.18, 1.0);
    let g_out = min(g + bm * 0.65,      1.0);
    let b_out = min(b + bm * bm * 0.08, 1.0);

    return vec4<f32>(r_out, g_out, b_out, 1.0);
}
