/**
 * registry.js — Shape name → density grid, and density → atom positions.
 *
 * Two responsibilities:
 *
 *   1. Shape registry: maps string names (+ aliases) to generator functions.
 *      Grids are cached after first generation so repeated calls are instant.
 *
 *   2. sampleFromDensity(): importance-sample N NDC positions from a 128×128
 *      density grid.  Used once per shape transition to produce raw target
 *      positions before the OT assignment step.
 */

import {
    circle, ring, star, diamond, spiral, heart, wave, hexGrid,
    GRID_SIZE,
} from './primitives.js';

import { N } from '../gpu/buffers.js';

// ── Shape registry ────────────────────────────────────────────────────────────

const REGISTRY = {
    circle:   () => circle(),
    ring:     () => ring(),
    star:     () => star(5),
    star6:    () => star(6),
    diamond:  () => diamond(),
    spiral:   () => spiral(),
    heart:    () => heart(),
    wave:     () => wave(),
    hexgrid:  () => hexGrid(),
    graphene: () => hexGrid(),
};

const ALIASES = {
    disc:       'circle',
    donut:      'ring',
    annulus:    'ring',
    'star5':    'star',
    pentagon:   'star',
    hex:        'hexgrid',
    nanotube:   'hexgrid',
    graphene:   'hexgrid',
    lattice:    'hexgrid',
    helix:      'spiral',
    galaxy:     'spiral',
    love:       'heart',
    sine:       'wave',
    sinewave:   'wave',
};

/** All registered shape names (canonical, no aliases). */
export const SHAPE_NAMES = Object.keys(REGISTRY);

// Cache: name → Float32Array(GRID_SIZE²)
const _cache = new Map();

/**
 * Return the density grid for the given name.
 * Throws if the name (after alias resolution) is unknown.
 *
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
 * Falls back to 'circle' if not found.
 */
export function resolveShape(input) {
    const k = input.toLowerCase().trim().replace(/\s+/g, '');
    if (REGISTRY[k])         return k;
    if (ALIASES[k])          return ALIASES[k];
    // Partial match: first registry key that starts with k
    const partial = SHAPE_NAMES.find(n => n.startsWith(k));
    return partial ?? 'circle';
}

function _resolve(name) {
    const k = name.toLowerCase().trim();
    if (REGISTRY[k]) return k;
    if (ALIASES[k])  return ALIASES[k];
    return 'circle';
}


// ── Density sampler ───────────────────────────────────────────────────────────

/**
 * Importance-sample N NDC positions from a density grid.
 *
 * Algorithm:
 *   1. Build a cumulative distribution function (CDF) from the flat grid.
 *   2. For each of N samples: draw a uniform random number, binary-search the CDF,
 *      map the winning cell to an NDC position with sub-cell jitter.
 *
 * Coordinate convention (matches splat.wgsl):
 *   grid row 0 → NDC y = -1 (bottom)
 *   grid col 0 → NDC x = -1 (left)
 *
 * @param {Float32Array} densityGrid   GRID_SIZE × GRID_SIZE, values ≥ 0
 * @returns {Float32Array}             N × 2 interleaved NDC positions
 */
export function sampleFromDensity(densityGrid) {
    const W = GRID_SIZE;
    const H = GRID_SIZE;

    // Build normalised CDF
    let total = 0;
    for (let i = 0; i < densityGrid.length; i++) total += densityGrid[i];

    if (total === 0) {
        // Degenerate grid — uniform scatter fallback
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
        // Binary search for a random CDF value
        let lo = 0, hi = cdf.length - 1;
        const r = Math.random();
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cdf[mid] < r) lo = mid + 1;
            else              hi = mid;
        }

        const row = Math.floor(lo / W);
        const col = lo % W;

        // Sub-cell jitter so atoms don't pile on grid centres
        out[i * 2    ] = ((col + Math.random()) / W) * 2 - 1;   // NDC x
        out[i * 2 + 1] = ((row + Math.random()) / H) * 2 - 1;   // NDC y (row 0 = bottom)
    }
    return out;
}
