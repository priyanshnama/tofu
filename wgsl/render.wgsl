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
 *     vel_buf     (u32) — current-frame accumulated speed (×256 fixed-point)
 *     density_buf (u32) — current-frame atom weights (×256 fixed-point)
 *
 *   Applies a 3×3 Gaussian filter (σ=1) for smooth anti-aliased appearance.
 *   Maps trail → brightness via log tone curve.
 *   Outputs green-phosphor colour ramp shifted white-hot for fast atoms.
 *
 * Bindings (group 0):
 *   0  trail_buf   — storage read  (f32, persistent decayed glow)
 *   1  vel_buf     — storage read  (u32, current frame speed accumulator)
 *   2  density_buf — storage read  (u32, current frame atom counts)
 */

@group(0) @binding(0) var<storage, read> trail_buf   : array<f32>;
@group(0) @binding(1) var<storage, read> vel_buf     : array<u32>;
@group(0) @binding(2) var<storage, read> density_buf : array<u32>;

const DENSITY_W : u32 = %%DENSITY_W%%;
const DENSITY_H : u32 = %%DENSITY_H%%;

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

// 3×3 Gaussian kernel weight from offset (dx, dy).
// σ=1: exp(-r²/(2σ²)) = exp(-r²/2), normalised so 3×3 sum = 1.
// Precomputed: centre=0.2042, edge=0.1238, corner=0.0751
fn gw(dx : i32, dy : i32) -> f32 {
    let r2 = dx*dx + dy*dy;
    return select(select(0.0751, 0.1238, r2 == 1), 0.2042, r2 == 0);
}

// ── Fragment ───────────────────────────────────────────────────────────────

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
    let ix = i32(in.uv.x * f32(DENSITY_W));
    let iy = i32(in.uv.y * f32(DENSITY_H));

    // 3×3 Gaussian filter — weights sum to 1, no post-divide needed
    var t_sum = 0.0;
    var v_sum = 0.0;
    var d_sum = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let w = gw(dx, dy);
            t_sum += w * read_trail  (ix + dx, iy + dy);
            v_sum += w * read_vel    (ix + dx, iy + dy);
            d_sum += w * read_density(ix + dx, iy + dy);
        }
    }
    // avg_t: persistent trail drives brightness
    // avg_v / avg_d: weighted-average speed (normalised 0–65535 by vel/density)
    let avg_t = t_sum;
    let avg_v = v_sum;
    let avg_d = d_sum;

    // Log tone mapping — constant 20 gives headroom for Gaussian splat trail scale
    let norm = clamp(log(1.0 + avg_t) / log(1.0 + 20.0), 0.0, 1.0);

    // Average normalised speed [0, 1] — vel and density have same ×256 weight factor
    // so the 256 cancels: vel_sum/(density_sum × 65535) = weighted_avg_speed
    let speed = select(0.0, clamp(avg_v / (avg_d * 65535.0), 0.0, 1.0), avg_d > 0.0);

    // Green-phosphor colour: dim = deep green, bright = yellow-green → white-hot
    let n2 = norm * norm;
    let n3 = n2 * norm;
    let r_base = n2 * 0.15 + n3 * 0.12;             // red rises late
    let g_base = norm * 0.20 + n2 * 0.50 + n3 * 0.30; // green always leads
    let b_base = n3 * 0.10;                           // cool blue only at peak

    // White-hot shift at high speed
    let blend = speed * 0.85;
    let r = mix(r_base, norm * 0.90, blend);
    let g = mix(g_base, norm,        blend);
    let b = mix(b_base, norm * 0.95, blend);

    return vec4<f32>(r, g, b, 1.0);
}
