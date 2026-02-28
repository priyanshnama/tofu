/*
 * decay.wgsl — Phosphor trail persistence.
 *
 * Runs after splat (which has written current-frame atom counts into
 * density_buf) and before render.
 *
 * Each texel:  trail_buf[i] = trail_buf[i] * DECAY + f32(density_buf[i])
 *
 * trail_buf is f32 and is NEVER cleared — it accumulates across frames,
 * decaying exponentially to give a phosphor afterglow effect.
 *
 * Bindings (group 0):
 *   0  density_buf — storage read        (u32, current frame atom counts)
 *   1  trail_buf   — storage read_write  (f32, persistent decayed glow)
 */

const DENSITY_W : u32 = 2560u;
const DENSITY_H : u32 = 1440u;
const DECAY     : f32 = 0.88;

@group(0) @binding(0) var<storage, read>       density_buf : array<u32>;
@group(0) @binding(1) var<storage, read_write> trail_buf   : array<f32>;

@compute @workgroup_size(256)
fn cs_decay(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if i >= DENSITY_W * DENSITY_H { return; }
    trail_buf[i] = trail_buf[i] * DECAY + f32(density_buf[i]);
}
