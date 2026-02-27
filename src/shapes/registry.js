/**
 * registry.js — Shape name → density grid, and density → atom positions.
 *
 * Rule: every entry in REGISTRY produces a VISUALLY DISTINCT density grid.
 *       ALIASES are reserved for true synonyms only (same concept, different word).
 */

import {
    circle, ring, star, diamond, spiral, heart, wave, hexGrid,
    triangle, cross,
    GRID_SIZE,
} from './primitives.js';

import {
    lissajous, lorenz, interference, julia, dragon, rabbit,
    rossler, rose, logSpiral, mandelbrot,
} from './mathematical.js';

import {
    dna, nanotube, crystal, graphene2D,
} from './molecular.js';

import { N } from '../gpu/buffers.js';

// ── Shape registry ────────────────────────────────────────────────────────────
// Each key → unique visual.  No two entries share a generator + params combo.

const REGISTRY = {
    // ── Tier 1: geometric primitives ──────────────────────────────────────────
    circle:       () => circle(),
    ring:         () => ring(),
    star:         () => star(5),
    star6:        () => star(6),
    star8:        () => star(8),
    diamond:      () => diamond(),
    triangle:     () => triangle(),
    cross:        () => cross(),
    spiral:       () => spiral(),
    heart:        () => heart(),
    wave:         () => wave(),
    hexgrid:      () => hexGrid(),

    // ── Tier 2: mathematical ──────────────────────────────────────────────────
    lissajous:    () => lissajous(3, 2, Math.PI / 4),   // pretzel
    pretzel:      () => lissajous(5, 4, Math.PI / 6),   // denser pretzel
    trefoil:      () => lissajous(3, 1, Math.PI / 2),   // 3-lobed curve
    rose:         () => rose(4),                         // 8-petal rose
    rose3:        () => rose(3),                         // 6-petal rose
    lorenz:       () => lorenz(),                        // double-wing butterfly
    rossler:      () => rossler(),                       // single-scroll spiral
    interference: () => interference(),                  // wave fringes
    galaxy:       () => logSpiral(),                     // logarithmic spiral arms
    julia:        () => julia(-0.7, 0.27),               // dendrite / lightning
    dragon:       () => dragon(),                        // archipelago islands
    rabbit:       () => rabbit(),                        // Douady's 3-lobed rabbit
    mandelbrot:   () => mandelbrot(),                    // classic cardioid

    // ── Tier 3: molecular / structural ────────────────────────────────────────
    dna:          () => dna(),
    nanotube:     () => nanotube(),
    crystal:      () => crystal(),
    graphene:     () => graphene2D(),
};

// ── True synonyms only — different word, identical visual ─────────────────────
const ALIASES = {
    // geometric
    disc:           'circle',
    donut:          'ring',
    annulus:        'ring',
    square:         'diamond',   // close enough visually
    plus:           'cross',
    hex:            'hexgrid',

    // mathematical
    butterfly:      'lorenz',
    attractor:      'lorenz',
    chaos:          'rossler',
    scroll:         'rossler',
    fringes:        'interference',
    diffraction:    'interference',
    waves:          'interference',
    fractal:        'julia',
    lightning:      'julia',

    // molecular
    doublehelix:    'dna',
    dnahelix:       'dna',
    tube:           'nanotube',
    cnt:            'nanotube',
    carbon:         'nanotube',
    cubic:          'crystal',
    bcc:            'crystal',
    lattice:        'crystal',
    carbongrid:     'graphene',
};

/** All registered shape names (canonical, no aliases). */
export const SHAPE_NAMES = Object.keys(REGISTRY);

// Cache: name → Float32Array(GRID_SIZE²)
const _cache = new Map();

/**
 * Return the density grid for the given name.
 * @param {string} name
 * @returns {Float32Array}  GRID_SIZE × GRID_SIZE, values in [0, 1]
 */
export function getShape(name) {
    const key = _resolve(name);
    if (!_cache.has(key)) {
        if (!REGISTRY[key]) throw new Error(`Unknown shape: "${name}"`);
        _cache.set(key, REGISTRY[key]());
    }
    return _cache.get(key);
}

/**
 * Resolve a user-typed string to a canonical registry key.
 * Falls back to 'circle' if nothing matches.
 */
export function resolveShape(input) {
    const k = input.toLowerCase().trim().replace(/\s+/g, '');
    if (REGISTRY[k])  return k;
    if (ALIASES[k])   return ALIASES[k];
    const partial = SHAPE_NAMES.find(n => n.startsWith(k));
    return partial ?? 'circle';
}

function _resolve(name) {
    const k = name.toLowerCase().trim().replace(/\s+/g, '');
    if (REGISTRY[k]) return k;
    if (ALIASES[k])  return ALIASES[k];
    return 'circle';
}


// ── Density sampler ───────────────────────────────────────────────────────────

/**
 * Importance-sample N NDC positions from a density grid.
 *
 * @param {Float32Array} densityGrid   GRID_SIZE × GRID_SIZE, values ≥ 0
 * @returns {Float32Array}             N × 2 interleaved NDC positions
 */
export function sampleFromDensity(densityGrid) {
    const W = GRID_SIZE;
    const H = GRID_SIZE;

    let total = 0;
    for (let i = 0; i < densityGrid.length; i++) total += densityGrid[i];

    if (total === 0) {
        const out = new Float32Array(N * 2);
        for (let i = 0; i < N; i++) {
            out[i * 2    ] = (Math.random() * 2 - 1) * 0.85;
            out[i * 2 + 1] = (Math.random() * 2 - 1) * 0.85;
        }
        return out;
    }

    const cdf = new Float32Array(densityGrid.length);
    let cumsum = 0;
    for (let i = 0; i < densityGrid.length; i++) {
        cumsum += densityGrid[i] / total;
        cdf[i] = cumsum;
    }

    const out = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
        let lo = 0, hi = cdf.length - 1;
        const r = Math.random();
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cdf[mid] < r) lo = mid + 1;
            else              hi = mid;
        }
        const row = Math.floor(lo / W);
        const col = lo % W;
        out[i * 2    ] = ((col + Math.random()) / W) * 2 - 1;
        out[i * 2 + 1] = ((row + Math.random()) / H) * 2 - 1;
    }
    return out;
}
