/**
 * device.js — WebGPU adapter and device initialisation.
 *
 * Single responsibility: obtain a GPUDevice and configure the canvas context.
 * Returns the device, context, and preferred swap-chain format.
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{ device: GPUDevice, ctx: GPUCanvasContext, format: GPUTextureFormat }>}
 */
export async function initDevice(canvas) {
    if (!navigator.gpu) {
        throw new Error('WebGPU not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
    });
    if (!adapter) {
        throw new Error('No WebGPU adapter found (driver/browser issue).');
    }

    const device = await adapter.requestDevice({ label: 'tofu-v2' });
    device.lost.then(info => {
        console.error('[gpu] Device lost:', info.reason, info.message);
    });

    const ctx    = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    return { device, ctx, format };
}
