/**
 * nca_step_mlp.wgsl — GoalNCA step with learned MLP weights.
 *
 * Architecture (mirrors training/train_nca.py exactly):
 *   State   : 16 channels per cell  — ch0 = alpha/density in [-1,1]
 *   Perceive: identity + Sobel-X + Sobel-Y applied to all 16 channels = 48 floats
 *   Goal    : 8 hand-engineered features of the scalar goal density g ∈ [0,1]
 *   MLP     : FC(56→64, ReLU) → FC(64→16) → delta_state
 *   Update  : state += delta × stochastic_mask   (mask via PCG hash, no RNG buffer)
 *             state = clamp(state + delta*mask, -1, 1)
 *
 * Buffer layout
 * ─────────────
 * s_in / s_out : flat array, cell-major interleaved channels
 *   index = (row * W + col) * C + channel
 *
 * Weight layout (matches PyTorch fc.weight, row-major)
 *   w1[j * NIN + k]  — row j (hidden unit j), column k (input k)
 *   w2[j * NHD + k]  — row j (output ch  j), column k (hidden k)
 */

const W   : u32 = 128u;
const H   : u32 = 128u;
const C   : u32 = 16u;      // state channels
const NIN : u32 = 56u;      // 48 perception + 8 goal features
const NHD : u32 = 64u;      // hidden units

struct Params {
    step      : u32,
    fire_rate : f32,
    _pad0     : u32,
    _pad1     : u32,
}

@group(0) @binding(0) var<storage, read>       s_in   : array<f32>;  // W*H*C
@group(0) @binding(1) var<storage, read_write> s_out  : array<f32>;  // W*H*C
@group(0) @binding(2) var<storage, read>       goal   : array<f32>;  // W*H
@group(0) @binding(3) var<storage, read>       w1_buf : array<f32>;  // NHD * NIN
@group(0) @binding(4) var<storage, read>       b1_buf : array<f32>;  // NHD
@group(0) @binding(5) var<storage, read>       w2_buf : array<f32>;  // C * NHD
@group(0) @binding(6) var<storage, read>       b2_buf : array<f32>;  // C
@group(0) @binding(7) var<uniform>             params : Params;

// Thread-private working arrays (registers / private memory)
var<private> inp : array<f32, 56>;
var<private> hid : array<f32, 64>;
var<private> dlt : array<f32, 16>;

// Border-clamped read of state channel ch at (col, row)
fn rd(col: i32, row: i32, ch: u32) -> f32 {
    let c = u32(clamp(col, 0, i32(W) - 1));
    let r = u32(clamp(row, 0, i32(H) - 1));
    return s_in[(r * W + c) * C + ch];
}

// PCG hash → uniform [0,1) — no external RNG buffer needed
fn pcg_rand(x: u32, y: u32, t: u32) -> f32 {
    var s = x * 1973u + y * 9277u + t * 26699u + 1u;
    s = (s ^ (s >> 17u)) * 0x45d9f3bu;
    s = s ^ (s >> 15u);
    return f32(s & 0x7fffffffu) / f32(0x7fffffffu);
}

@compute @workgroup_size(8, 8)
fn nca_step(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= W || gid.y >= H) { return; }

    let col  = i32(gid.x);
    let row  = i32(gid.y);
    let base = (gid.y * W + gid.x) * C;
    let g    = clamp(goal[gid.y * W + gid.x], 0.0, 1.0);

    // ── 1. Perception (48 floats) ─────────────────────────────────────────────
    // Three 3×3 kernels applied depth-wise to all 16 state channels:
    //   identity (as-is), Sobel-X (÷8), Sobel-Y (÷8)

    for (var ch = 0u; ch < C; ch++) {
        let tl = rd(col-1, row-1, ch);  let tc = rd(col, row-1, ch);  let tr = rd(col+1, row-1, ch);
        let ml = rd(col-1, row,   ch);  let mc = rd(col, row,   ch);  let mr = rd(col+1, row,   ch);
        let bl = rd(col-1, row+1, ch);  let bc = rd(col, row+1, ch);  let br = rd(col+1, row+1, ch);

        inp[     ch] = mc;                                               // identity
        inp[C  + ch] = (-tl + tr - 2.0*ml + 2.0*mr - bl + br) / 8.0;  // Sobel-X
        inp[2u*C+ch] = (-tl - 2.0*tc - tr + bl + 2.0*bc + br) / 8.0;  // Sobel-Y
    }

    // ── 2. Goal features (8 floats) ───────────────────────────────────────────
    // Hand-engineered nonlinear features of the scalar g — no encoder weights.
    // Identical to GoalNCA.goal_features() in train_nca.py.

    inp[48] = g;
    inp[49] = g * g;
    inp[50] = 1.0 - g;
    inp[51] = sin(3.14159265 * g);
    inp[52] = cos(6.28318530 * g);
    inp[53] = sqrt(g);
    inp[54] = 4.0 * g * (1.0 - g);
    inp[55] = select(0.0, 1.0, g > 0.5);

    // ── 3. FC1 : hid = ReLU(W1 × inp + b1) ───────────────────────────────────

    for (var j = 0u; j < NHD; j++) {
        var acc = b1_buf[j];
        let off = j * NIN;
        for (var k = 0u; k < NIN; k++) {
            acc += w1_buf[off + k] * inp[k];
        }
        hid[j] = max(0.0, acc);
    }

    // ── 4. FC2 : dlt = W2 × hid + b2 ─────────────────────────────────────────

    for (var j = 0u; j < C; j++) {
        var acc = b2_buf[j];
        let off = j * NHD;
        for (var k = 0u; k < NHD; k++) {
            acc += w2_buf[off + k] * hid[k];
        }
        dlt[j] = acc;
    }

    // ── 5. Stochastic mask + update ───────────────────────────────────────────
    // mask = 1 with probability fire_rate, 0 otherwise (per-cell, per-step hash)

    let fire = pcg_rand(gid.x, gid.y, params.step);
    let mask = select(0.0, 1.0, fire < params.fire_rate);

    for (var ch = 0u; ch < C; ch++) {
        s_out[base + ch] = clamp(s_in[base + ch] + dlt[ch] * mask, -1.0, 1.0);
    }
}
