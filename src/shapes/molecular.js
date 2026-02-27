/**
 * molecular.js — Tier 3 structural/molecular density generators.
 *
 * Shapes derived from real physical structures: DNA, carbon nanotubes, crystal
 * lattices.  Every function returns a Float32Array(GRID_SIZE²) with values in
 * [0,1].  Row 0 = NDC y = -1 (bottom), consistent with primitives.js.
 */

import { GRID_SIZE, gaussianBlur } from './primitives.js';

const G = GRID_SIZE;

// ── Shared helpers ─────────────────────────────────────────────────────────────

function rasterize(pts, sigma = 2.0) {
    const raw = new Float32Array(G * G);
    for (const [x, y] of pts) {
        const col = Math.round((x + 1) / 2 * (G - 1));
        const row = Math.round((y + 1) / 2 * (G - 1));
        if (row >= 0 && row < G && col >= 0 && col < G)
            raw[row * G + col] += 1;
    }
    return gaussianBlur(raw, G, G, sigma);
}

/** Push n evenly-spaced points along the segment (x1,y1)→(x2,y2). */
function pushSegment(arr, x1, y1, x2, y2, n = 20) {
    for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        arr.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
}


// ── Shape generators ──────────────────────────────────────────────────────────

/**
 * DNA double helix — side-on projection.
 * Two anti-phase sinusoidal strands with horizontal base-pair rungs.
 */
export function dna(freq = 2.8 * Math.PI, amp = 0.36, nRungs = 12) {
    const STRAND_STEPS = 4000;
    const pts = [];

    // Two strands: y is the helical axis, x oscillates ±amp
    for (let i = 0; i < STRAND_STEPS; i++) {
        const y = (i / STRAND_STEPS) * 1.8 - 0.9;
        pts.push([ amp * Math.sin(freq * y),  y]);   // strand 1
        pts.push([-amp * Math.sin(freq * y),  y]);   // strand 2 (anti-phase)
    }

    // Base-pair rungs — horizontal segments between the two strands
    for (let r = 0; r < nRungs; r++) {
        const y  = -0.88 + (r + 0.5) / nRungs * 1.76;
        const x1 =  amp * Math.sin(freq * y);
        const x2 = -amp * Math.sin(freq * y);
        pushSegment(pts, x1, y, x2, y, 28);
    }

    return rasterize(pts, 1.4);
}

/**
 * Carbon nanotube — side-on view, (10,0) zigzag flavour.
 * Atoms are arranged on the surface of a cylinder; the cylindrical projection
 * creates characteristic edge-brightening (many atoms project to x ≈ ±R).
 */
export function nanotube() {
    const pts   = [];
    const R     = 0.82;   // cylinder radius in NDC
    const N     = 20;     // atoms per circumference ring
    const RINGS = 18;     // rings along the tube axis
    const yMin  = -0.88, yMax = 0.88;

    for (let ring = 0; ring < RINGS; ring++) {
        const y      = yMin + (ring / (RINGS - 1)) * (yMax - yMin);
        // Zigzag stagger: even rings at 0, odd rings offset by half a step
        const offset = (ring % 2 === 0) ? 0 : Math.PI / N;
        for (let k = 0; k < N; k++) {
            const θ = (k / N) * 2 * Math.PI + offset;
            // Project cylinder surface → NDC: x = R·sin(θ), keep y
            pts.push([Math.sin(θ) * R, y]);
        }
    }

    return rasterize(pts, 1.5);
}

/**
 * Crystal lattice — 2D projection of a body-centred cubic (BCC) structure.
 * Corner atoms on a square grid + body-centre atoms at each cell midpoint.
 * Visually distinct from hexgrid (square symmetry vs hexagonal).
 */
export function crystal(spacing = 0.22) {
    const pts  = [];
    const half = spacing / 2;

    for (let x = -1.0 + spacing / 2; x <= 1.0; x += spacing) {
        for (let y = -1.0 + spacing / 2; y <= 1.0; y += spacing) {
            pts.push([x, y]);              // corner atom
            pts.push([x + half, y + half]); // body-centre atom
        }
    }

    return rasterize(pts, 0.9);
}

/**
 * Graphene — flat 2D hexagonal carbon lattice.
 * Two-atom unit cell: A sublattice + B sublattice offset by one bond.
 * Cleaner implementation than the primitives.js hexGrid.
 */
export function graphene2D(a = 0.155) {
    const pts = [];
    const bx  = a;                           // bond vector x
    const by  = 0;                           // bond vector y
    const ax  = a * Math.cos(Math.PI / 3);   // lattice vector a1 x
    const ay  = a * Math.sin(Math.PI / 3);   // lattice vector a1 y

    const N = Math.ceil(1.0 / a) + 2;
    for (let i = -N; i <= N; i++) {
        for (let j = -N; j <= N; j++) {
            // A sublattice
            const ax_ = i * a + j * ax;
            const ay_ = j * ay;
            // B sublattice (offset by one bond)
            const bx_ = ax_ + bx;
            const by_ = ay_ + by;
            if (Math.abs(ax_) < 1.05 && Math.abs(ay_) < 1.05) pts.push([ax_, ay_]);
            if (Math.abs(bx_) < 1.05 && Math.abs(by_) < 1.05) pts.push([bx_, by_]);
        }
    }

    return rasterize(pts, 0.9);
}
