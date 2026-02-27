/**
 * nca_step.wgsl — One step of goal-conditioned reaction-diffusion NCA.
 *
 * Run this shader N_STEPS times (ping-pong on s_in/s_out) to organically
 * grow a parametric goal grid into a textured, living density field.
 *
 * Update rule (no training required):
 *
 *   avg      = 3×3 Gaussian-weighted neighbourhood (excludes centre)
 *   laplacian = avg - s                   ← diffusion: smooths gradients
 *   reaction  = s · (1 - s) · goal        ← logistic: peaks at s=0.5, inside goal
 *   goal_pull = (goal - s) · 0.04         ← soft drift back toward parametric target
 *
 *   Δs = laplacian · 0.15 + reaction · 0.10 + goal_pull
 *   s' = clamp(s + Δs, 0, 1)
 *
 * The reaction term adds organic texture in transition zones (where s ≈ 0.5)
 * while the goal_pull prevents the density from drifting away from the shape.
 * Result: shapes that look "grown" rather than mathematically stamped.
 */

const W : u32 = 128u;
const H : u32 = 128u;

@group(0) @binding(0) var<storage, read>       s_in  : array<f32>;   // W × H
@group(0) @binding(1) var<storage, read_write> s_out : array<f32>;   // W × H
@group(0) @binding(2) var<storage, read>       goal  : array<f32>;   // W × H

// Clamped read from s_in (border = repeat edge value)
fn rd(c: i32, r: i32) -> f32 {
    let cc = clamp(c, 0, i32(W) - 1);
    let rr = clamp(r, 0, i32(H) - 1);
    return s_in[u32(rr) * W + u32(cc)];
}

@compute @workgroup_size(8, 8)
fn nca_step(@builtin(global_invocation_id) gid: vec3<u32>) {
    let col = i32(gid.x);
    let row = i32(gid.y);
    if (gid.x >= W || gid.y >= H) { return; }

    let i   = gid.y * W + gid.x;
    let s   = s_in[i];
    let g   = goal[i];

    // 3×3 Gaussian kernel (excludes centre), weights sum to 1:
    //   corners=1/12  edges=2/12
    let avg =
        rd(col-1, row-1) * (1.0/12.0) +
        rd(col  , row-1) * (2.0/12.0) +
        rd(col+1, row-1) * (1.0/12.0) +
        rd(col-1, row  ) * (2.0/12.0) +
        rd(col+1, row  ) * (2.0/12.0) +
        rd(col-1, row+1) * (1.0/12.0) +
        rd(col  , row+1) * (2.0/12.0) +
        rd(col+1, row+1) * (1.0/12.0);

    let laplacian = avg - s;                    // diffusion
    let reaction  = s * (1.0 - s) * g;          // logistic inside goal
    let goal_pull = (g - s) * 0.04;             // soft anchor to shape

    let ds = laplacian * 0.15 + reaction * 0.10 + goal_pull;
    s_out[i] = clamp(s + ds, 0.0, 1.0);
}
