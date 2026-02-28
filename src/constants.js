/**
 * constants.js — Single source of truth for all simulation parameters.
 *
 * JS files import directly from here.
 * WGSL files receive these values via the Vite wgsl-constants plugin, which
 * replaces %%CONST_NAME%% placeholders at transform time.
 */

export const N         = 2_000_000; // atom count — sweet spot for solid 4K coverage at ~60fps
export const DENSITY_W = 3840;      // density grid width  (pixels)
export const DENSITY_H = 2160;      // density grid height (pixels)
export const K         = 512;       // k-means centroids
export const K_ITERS   = 6;         // k-means iterations
export const SCALE     = 1024.0;    // fixed-point scale for k-means accumulator
export const DECAY     = 0.91;      // trail persistence per frame  (0 = instant clear, 1 = never fades)
