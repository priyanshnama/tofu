/*
 * render.wgsl — Fullscreen density buffer → screen pixels.
 *
 * Vertex stage:
 *   Generates a fullscreen quad (2 triangles, 6 vertices) from vertex_index.
 *   UV (0,0) = NDC bottom-left, UV (1,1) = NDC top-right.
 *   This matches the splat shader's coordinate mapping exactly.
 *
 * Fragment stage:
 *   Reads from the density_buf (u32 counts), applies a 3×3 box filter for
 *   smooth appearance, maps count → brightness via log tone curve, outputs
 *   a green-phosphor colour ramp:
 *     dim  → dark forest green
 *     mid  → bright green
 *     peak → near-white with green tint
 *
 * Bindings (group 0):
 *   0  density_buf — storage read  (u32 counts, same buffer written by splat)
 */

@group(0) @binding(0) var<storage, read> density_buf : array<u32>;

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

    // 3×3 box filter — smooths out the hard per-texel steps
    var sum = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            sum += read_density(ix + dx, iy + dy);
        }
    }
    let avg = sum / 9.0;

    // Logarithmic tone mapping — compresses bright clusters, lifts dim halos
    // log(1 + avg) / log(1 + ref) where ref ≈ expected peak density
    let norm = clamp(log(1.0 + avg) / log(1.0 + 12.0), 0.0, 1.0);

    // Green-phosphor colour ramp
    //   norm = 0.0 → pure black
    //   norm = 0.5 → rich green
    //   norm = 1.0 → near-white (saturated phosphor glow)
    let r = norm * norm * 0.18;
    let g = 0.35 * norm + 0.65 * norm * norm;
    let b = norm * norm * 0.10;

    return vec4<f32>(r, g, b, 1.0);
}
