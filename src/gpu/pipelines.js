/**
 * pipelines.js — Build all WebGPU pipelines and bind groups.
 *
 * Three pipelines:
 *   physics  (compute) — wander / morph interpolation
 *   splat    (compute) — atom positions → density buffer
 *   render   (render)  — density buffer → screen (fullscreen quad)
 *
 * Ping-pong convention:
 *   slot = frame & 1
 *   physicsBGs[slot]  — physics reads atomBufs[slot],   writes atomBufs[1-slot]
 *   splatBGs[slot]    — splat   reads atomBufs[1-slot]  (what physics just wrote)
 *   renderBG          — fixed, always reads densityBuf
 */

import physicsCode from '../../wgsl/physics.wgsl?raw';
import splatCode   from '../../wgsl/splat.wgsl?raw';
import renderCode  from '../../wgsl/render.wgsl?raw';

import { DISPATCH } from './buffers.js';

/**
 * @param {GPUDevice} device
 * @param {object}    buffers   — result of allocateBuffers()
 * @param {string}    format    — swap-chain texture format
 * @returns {Promise<{
 *   physicsPipeline : GPUComputePipeline,
 *   splatPipeline   : GPUComputePipeline,
 *   renderPipeline  : GPURenderPipeline,
 *   physicsBGs      : GPUBindGroup[2],
 *   splatBGs        : GPUBindGroup[2],
 *   renderBG        : GPUBindGroup,
 * }>}
 */
export async function buildPipelines(device, buffers, format) {
    const { atomBufs, sourceBuf, targetBuf, simBuf, densityBuf } = buffers;

    // ── Shader modules ──────────────────────────────────────────────────────
    const physicsMod = device.createShaderModule({ label: 'physics', code: physicsCode });
    const splatMod   = device.createShaderModule({ label: 'splat',   code: splatCode   });
    const renderMod  = device.createShaderModule({ label: 'render',  code: renderCode  });

    // Log any shader compilation errors
    for (const [name, mod] of [['physics', physicsMod], ['splat', splatMod], ['render', renderMod]]) {
        const info = await mod.getCompilationInfo();
        for (const m of info.messages) {
            if (m.type === 'error') console.error(`[${name}] L${m.lineNum}: ${m.message}`);
            else                    console.warn (`[${name}] L${m.lineNum}: ${m.message}`);
        }
    }

    // ── Compute pipelines ──────────────────────────────────────────────────
    const [physicsPipeline, splatPipeline] = await Promise.all([
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
            ],
        })
    );

    // Render — fixed (always the same density buffer)
    const renderBG = device.createBindGroup({
        label:  'render-bg',
        layout: renderBGL,
        entries: [{ binding: 0, resource: buf(densityBuf) }],
    });

    return { physicsPipeline, splatPipeline, renderPipeline, physicsBGs, splatBGs, renderBG };
}

/**
 * Encode one complete frame into a command encoder:
 *   1. Physics compute pass
 *   2. Splat compute pass
 *   3. Render pass (fullscreen quad)
 *
 * @param {GPUCommandEncoder} enc
 * @param {object}            pipelines  — result of buildPipelines()
 * @param {GPUTextureView}    view       — current swap-chain texture view
 * @param {number}            slot       — frame & 1  (ping-pong selector)
 */
export function encodeFrame(enc, pipelines, view, slot) {
    const { physicsPipeline, splatPipeline, renderPipeline,
            physicsBGs, splatBGs, renderBG } = pipelines;

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
