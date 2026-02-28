/**
 * pipelines.js — Build all WebGPU pipelines and bind groups.
 *
 * Four pipelines:
 *   physics  (compute) — wander / morph interpolation
 *   splat    (compute) — atom positions → density buffer
 *   decay    (compute) — density → persistent trail (phosphor afterglow)
 *   render   (render)  — trail + vel + density → screen (fullscreen quad)
 *
 * Ping-pong convention:
 *   slot = frame & 1
 *   physicsBGs[slot]  — physics reads atomBufs[slot],   writes atomBufs[1-slot]
 *   splatBGs[slot]    — splat   reads atomBufs[1-slot]  (what physics just wrote)
 *   decayBG / renderBG — fixed, always same buffers
 */

import physicsCode from '../../wgsl/physics.wgsl?raw';
import splatCode   from '../../wgsl/splat.wgsl?raw';
import decayCode   from '../../wgsl/decay.wgsl?raw';
import renderCode  from '../../wgsl/render.wgsl?raw';

import { DISPATCH } from './buffers.js';

export async function buildPipelines(device, buffers, format) {
    const { atomBufs, sourceBuf, targetBuf, simBuf, densityBuf, velBuf, trailBuf } = buffers;

    // ── Shader modules ──────────────────────────────────────────────────────
    const physicsMod = device.createShaderModule({ label: 'physics', code: physicsCode });
    const splatMod   = device.createShaderModule({ label: 'splat',   code: splatCode   });
    const decayMod   = device.createShaderModule({ label: 'decay',   code: decayCode   });
    const renderMod  = device.createShaderModule({ label: 'render',  code: renderCode  });

    // Log any shader compilation errors
    for (const [name, mod] of [['physics', physicsMod], ['splat', splatMod], ['decay', decayMod], ['render', renderMod]]) {
        const info = await mod.getCompilationInfo();
        for (const m of info.messages) {
            if (m.type === 'error') console.error(`[${name}] L${m.lineNum}: ${m.message}`);
            else                    console.warn (`[${name}] L${m.lineNum}: ${m.message}`);
        }
    }

    // ── Compute pipelines ──────────────────────────────────────────────────
    const [physicsPipeline, splatPipeline, decayPipeline] = await Promise.all([
        device.createComputePipelineAsync({
            label:   'physics',
            layout:  'auto',
            compute: { module: physicsMod, entryPoint: 'cs_main' },
        }),
        device.createComputePipelineAsync({
            label:   'splat',
            layout:  'auto',
            compute: { module: splatMod, entryPoint: 'cs_splat' },
        }),
        device.createComputePipelineAsync({
            label:   'decay',
            layout:  'auto',
            compute: { module: decayMod, entryPoint: 'cs_decay' },
        }),
    ]);

    // ── Render pipeline ────────────────────────────────────────────────────
    const renderPipeline = await device.createRenderPipelineAsync({
        label:    'render',
        layout:   'auto',
        vertex:   { module: renderMod, entryPoint: 'vs_main' },
        fragment: { module: renderMod, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
    });

    // ── Bind groups ────────────────────────────────────────────────────────
    const physBGL   = physicsPipeline.getBindGroupLayout(0);
    const splatBGL  = splatPipeline.getBindGroupLayout(0);
    const decayBGL  = decayPipeline.getBindGroupLayout(0);
    const renderBGL = renderPipeline.getBindGroupLayout(0);

    const buf = (b) => ({ buffer: b });

    // Physics — two slots for ping-pong
    const physicsBGs = [0, 1].map(slot =>
        device.createBindGroup({
            label:  `physics-bg-${slot}`,
            layout: physBGL,
            entries: [
                { binding: 0, resource: buf(atomBufs[slot])     },  // src
                { binding: 1, resource: buf(atomBufs[1 - slot]) },  // dst
                { binding: 2, resource: buf(simBuf)              },  // params
                { binding: 3, resource: buf(targetBuf)           },  // OT target
                { binding: 4, resource: buf(sourceBuf)           },  // OT source
            ],
        })
    );

    // Splat — two slots: reads from the DST of the matching physics slot
    const splatBGs = [0, 1].map(slot =>
        device.createBindGroup({
            label:  `splat-bg-${slot}`,
            layout: splatBGL,
            entries: [
                { binding: 0, resource: buf(atomBufs[1 - slot]) },  // physics wrote here
                { binding: 1, resource: buf(densityBuf)          },
                { binding: 2, resource: buf(velBuf)              },  // velocity accumulator
            ],
        })
    );

    // Decay — reads density (current frame), writes trail (persistent)
    const decayBG = device.createBindGroup({
        label:  'decay-bg',
        layout: decayBGL,
        entries: [
            { binding: 0, resource: buf(densityBuf) },
            { binding: 1, resource: buf(trailBuf)   },
        ],
    });

    // Render — trail (brightness) + vel (speed tint) + density (speed denominator)
    const renderBG = device.createBindGroup({
        label:  'render-bg',
        layout: renderBGL,
        entries: [
            { binding: 0, resource: buf(trailBuf)   },
            { binding: 1, resource: buf(velBuf)     },
            { binding: 2, resource: buf(densityBuf) },
        ],
    });

    return { physicsPipeline, splatPipeline, decayPipeline, renderPipeline,
             physicsBGs, splatBGs, decayBG, renderBG };
}

/**
 * Encode one complete frame into a command encoder:
 *   1. Physics compute pass
 *   2. Splat compute pass
 *   3. Decay compute pass  (density → persistent trail)
 *   4. Render pass         (fullscreen quad)
 *
 * @param {GPUCommandEncoder} enc
 * @param {object}            pipelines  — result of buildPipelines()
 * @param {GPUTextureView}    view       — current swap-chain texture view
 * @param {number}            slot       — frame & 1  (ping-pong selector)
 */
// 2560×1440 = 3686400 texels / 256 threads per workgroup = 14400 workgroups
const DECAY_DISPATCH = 14400;

export function encodeFrame(enc, pipelines, view, slot) {
    const { physicsPipeline, splatPipeline, decayPipeline, renderPipeline,
            physicsBGs, splatBGs, decayBG, renderBG } = pipelines;

    // Physics
    const cp = enc.beginComputePass({ label: 'physics' });
    cp.setPipeline(physicsPipeline);
    cp.setBindGroup(0, physicsBGs[slot]);
    cp.dispatchWorkgroups(DISPATCH);
    cp.end();

    // Splat
    const sp = enc.beginComputePass({ label: 'splat' });
    sp.setPipeline(splatPipeline);
    sp.setBindGroup(0, splatBGs[slot]);
    sp.dispatchWorkgroups(DISPATCH);
    sp.end();

    // Decay — density → trail (persistent phosphor glow)
    const dp = enc.beginComputePass({ label: 'decay' });
    dp.setPipeline(decayPipeline);
    dp.setBindGroup(0, decayBG);
    dp.dispatchWorkgroups(DECAY_DISPATCH);
    dp.end();

    // Render
    const rp = enc.beginRenderPass({
        label: 'render',
        colorAttachments: [{
            view,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp:  'clear',
            storeOp: 'store',
        }],
    });
    rp.setPipeline(renderPipeline);
    rp.setBindGroup(0, renderBG);
    rp.draw(6);   // fullscreen quad: 6 vertices = 2 triangles
    rp.end();
}
