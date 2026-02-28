/**
 * buffers.js — All GPU buffer allocations for the tofu v2 simulation.
 *
 * Layout
 * ──────
 * Atom (16 bytes):  { pos: vec2<f32>, vel: vec2<f32> }
 * OT slot (8 bytes): vec2<f32>  — one NDC position per atom
 * Density (4 bytes): u32        — one atomic counter per texel
 *
 * All sizes are exported as named constants so shaders and JS stay in sync.
 */

export const N            = 100_000;
export const DENSITY_W    = 256;
export const DENSITY_H    = 256;

// Derived sizes
const ATOM_STRIDE   = 4 * 4;                            // 4 × f32 = 16 bytes
const OT_STRIDE     = 2 * 4;                            // 2 × f32 =  8 bytes
export const ATOM_BYTES    = N * ATOM_STRIDE;           // 1 600 000
export const OT_BYTES      = N * OT_STRIDE;             //   800 000
export const DENSITY_BYTES = DENSITY_W * DENSITY_H * 4;//   262 144
export const VEL_BYTES     = DENSITY_BYTES;             //   262 144  (same layout)
export const TRAIL_BYTES   = DENSITY_BYTES;             //   262 144  (f32, persistent)

// Dispatch counts (workgroup size 256)
export const DISPATCH = Math.ceil(N / 256);             // 391

/**
 * Allocate every GPU buffer the simulation needs.
 *
 * @param {GPUDevice} device
 * @returns {{
 *   atomBufs   : GPUBuffer[2],   ping-pong atom state
 *   sourceBuf  : GPUBuffer,      OT source positions
 *   targetBuf  : GPUBuffer,      OT target positions
 *   simBuf     : GPUBuffer,      SimParams uniform (16 bytes)
 *   densityBuf : GPUBuffer,      atomic u32 density accumulator
 * }}
 */
export function allocateBuffers(device) {
    const S  = GPUBufferUsage.STORAGE;
    const U  = GPUBufferUsage.UNIFORM;
    const CD = GPUBufferUsage.COPY_DST;

    const buf = (size, usage, label) =>
        device.createBuffer({ size, usage: usage | CD, label });

    return {
        atomBufs:   [0, 1].map(i => buf(ATOM_BYTES,    S,     `atoms-${i}`)),
        sourceBuf:               buf(OT_BYTES,      S,     'ot-source'),
        targetBuf:               buf(OT_BYTES,      S,     'ot-target'),
        simBuf:                  buf(16,             U,     'sim-params'),
        densityBuf:              buf(DENSITY_BYTES,  S,     'density'),
        velBuf:                  buf(VEL_BYTES,      S,     'velocity'),
        trailBuf:                buf(TRAIL_BYTES,    S,     'trail'),
    };
}

/**
 * Build the initial atom seed data (uniform random scatter over [-0.85, 0.85]²,
 * zero velocity) and write it into both ping-pong buffers.
 *
 * @param {GPUDevice}   device
 * @param {GPUBuffer[]} atomBufs
 * @returns {Float32Array}  cpuSeed — also used to initialise the OT source buffer
 */
export function seedAtoms(device, atomBufs) {
    const seed = new Float32Array(N * 4);   // {pos.x, pos.y, vel.x, vel.y} × N
    for (let i = 0; i < N; i++) {
        seed[i * 4    ] = (Math.random() * 2 - 1) * 0.85;  // pos.x
        seed[i * 4 + 1] = (Math.random() * 2 - 1) * 0.85;  // pos.y
        // vel.x, vel.y remain 0
    }
    device.queue.writeBuffer(atomBufs[0], 0, seed);
    device.queue.writeBuffer(atomBufs[1], 0, seed);
    return seed;
}
