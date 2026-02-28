/*
 * physics.wgsl — Per-atom physics: wander + OT-morph interpolation.
 *
 * Two modes, selected by SimParams.has_targets:
 *
 *   Morph mode (has_targets > 0):
 *     Smoothstep interpolation from source_buf → target_buf over morph_t ∈ [0,1].
 *     Velocity dims to zero on arrival so atoms settle cleanly.
 *
 *   Wander mode (has_targets == 0):
 *     Two-frequency sinusoidal force field with per-atom phase offsets.
 *     Soft quadratic wall repulsion keeps atoms inside ±BOUND.
 *
 * Bindings (group 0):
 *   0  src_atoms  — storage read       (ping-pong source)
 *   1  dst_atoms  — storage read_write (ping-pong destination)
 *   2  params     — uniform            (dt, time, has_targets, morph_t)
 *   3  target_buf — storage read       (OT-assigned 2D target positions)
 *   4  source_buf — storage read       (OT source positions at transition start)
 */

struct Atom {
    pos : vec2<f32>,
    vel : vec2<f32>,
}

struct SimParams {
    dt          : f32,
    time        : f32,
    has_targets : f32,
    morph_t     : f32,
}

@group(0) @binding(0) var<storage, read>       src_atoms  : array<Atom>;
@group(0) @binding(1) var<storage, read_write> dst_atoms  : array<Atom>;
@group(0) @binding(2) var<uniform>             params     : SimParams;
@group(0) @binding(3) var<storage, read>       target_buf : array<vec2<f32>>;
@group(0) @binding(4) var<storage, read>       source_buf : array<vec2<f32>>;

const MAX_VEL : f32 = 0.55;
const N       : u32 = 1500000u;
const BOUND   : f32 = 0.92;

@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if idx >= N { return; }

    var a = src_atoms[idx];

    // ── Morph mode ──────────────────────────────────────────────────────────
    if params.has_targets > 0.5 {
        let t  = clamp(params.morph_t, 0.0, 1.0);
        let te = t * t * (3.0 - 2.0 * t);   // smoothstep — ease in/out

        let sp = source_buf[idx];
        let tp = target_buf[idx];

        a.pos = mix(sp, tp, te);
        a.vel = (tp - sp) * (1.0 - te);     // velocity dims to zero on arrival

        dst_atoms[idx] = a;
        return;
    }

    // ── Wander mode ─────────────────────────────────────────────────────────
    let fi = f32(idx);
    let t  = params.time;

    // Two-frequency sinusoidal force field — different phases per atom
    // X and Y use different base frequencies so motion looks uncorrelated
    let fx = (sin(t * 1.30 + fi * 0.00731) + sin(t * 0.47 + fi * 0.01234) * 0.4) * 0.055;
    let fy = (sin(t * 1.10 + fi * 0.00512) + sin(t * 0.83 + fi * 0.00891) * 0.4) * 0.055;

    // Soft quadratic wall repulsion — pulls atoms back when near edges
    var wall = vec2<f32>(0.0);
    if a.pos.x < -BOUND { wall.x =  5.5 * (-BOUND - a.pos.x); }
    if a.pos.x >  BOUND { wall.x = -5.5 * ( a.pos.x - BOUND); }
    if a.pos.y < -BOUND { wall.y =  5.5 * (-BOUND - a.pos.y); }
    if a.pos.y >  BOUND { wall.y = -5.5 * ( a.pos.y - BOUND); }

    // Velocity update: force + wall, then damp
    a.vel = (a.vel + (vec2<f32>(fx, fy) + wall) * params.dt) * 0.992;

    // Speed clamp
    let spd = length(a.vel);
    if spd > MAX_VEL { a.vel *= MAX_VEL / spd; }

    a.pos = clamp(a.pos + a.vel * params.dt, vec2<f32>(-1.0), vec2<f32>(1.0));
    dst_atoms[idx] = a;
}
