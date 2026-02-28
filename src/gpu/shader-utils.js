/**
 * shader-utils.js — Runtime WGSL constant injection.
 *
 * WGSL files use %%CONST_NAME%% placeholders.  applyConstants() replaces
 * them with the values from src/constants.js before the code is passed to
 * device.createShaderModule().
 */

import { N, DENSITY_W, DENSITY_H, K, SCALE, DECAY } from '../constants.js';

const SUBS = [
    ['%%N%%',         `${N}u`],
    ['%%DENSITY_W%%', `${DENSITY_W}u`],
    ['%%DENSITY_H%%', `${DENSITY_H}u`],
    ['%%K%%',         `${K}u`],
    ['%%SCALE%%',     `${SCALE}`],
    ['%%DECAY%%',     `${DECAY}`],
];

export function applyConstants(code) {
    let out = code;
    for (const [placeholder, value] of SUBS) {
        out = out.replaceAll(placeholder, value);
    }
    return out;
}
