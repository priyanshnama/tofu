/**
 * mathematical.js — Tier 2 parametric density generators.
 *
 * Shapes derived from mathematical structures: attractors, fractals, wave
 * phenomena, and parametric curves.  Every function returns a
 * Float32Array(GRID_SIZE²) with values in [0,1].
 * Row 0 = NDC y = -1 (bottom), consistent with primitives.js convention.
 */

import { GRID_SIZE, gaussianBlur } from './primitives.js';

const G = GRID_SIZE;

// ── Shared helpers ─────────────────────────────────────────────────────────────

/** Accumulate an array of [x,y] NDC points into a grid, then blur. */
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

/** Linearly interpolate n points between two NDC positions and push into arr. */
function pushSegment(arr, x1, y1, x2, y2, n = 24) {
    for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        arr.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
}


// ── Shape generators ──────────────────────────────────────────────────────────

/**
 * Lissajous figure: x = sin(a·t + δ),  y = sin(b·t).
 * Default a=3, b=2, δ=π/4 gives a classic pretzel knot.
 */
export function lissajous(a = 3, b = 2, delta = Math.PI / 4) {
    const STEPS = 10000;
    const pts   = [];
    for (let i = 0; i < STEPS; i++) {
        const t = (i / STEPS) * 2 * Math.PI;
        pts.push([
            Math.sin(a * t + delta) * 0.82,
            Math.sin(b * t)         * 0.82,
        ]);
    }
    return rasterize(pts, 1.8);
}

/**
 * Lorenz attractor, X-Z projection (the classic butterfly silhouette).
 * σ=10, ρ=28, β=8/3 — standard chaotic parameters.
 */
export function lorenz() {
    const σ = 10, ρ = 28, β = 8 / 3, dt = 0.005;
    let lx = 0.1, ly = 0, lz = 0;

    const WARMUP = 3000, STEPS = 60000;
    const pts = [];

    for (let i = 0; i < WARMUP + STEPS; i++) {
        const dx = σ * (ly - lx);
        const dy = lx * (ρ - lz) - ly;
        const dz = lx * ly - β * lz;
        lx += dx * dt;
        ly += dy * dt;
        lz += dz * dt;
        if (i >= WARMUP) pts.push([lx, lz]);   // XZ → butterfly silhouette
    }

    // Fit to [-0.88, 0.88]
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const span  = Math.max(maxX - minX, maxY - minY);
    const scale = (0.88 * 2) / span;
    const cx    = (minX + maxX) / 2;
    const cy    = (minY + maxY) / 2;

    return rasterize(pts.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]), 1.2);
}

/**
 * Two-source interference pattern.
 * Constructive maxima form concentric arc fringes that intersect beautifully.
 */
export function interference(k = 22, d = 0.32) {
    const raw = new Float32Array(G * G);
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const x  = (col / (G - 1)) * 2 - 1;
            const y  = (row / (G - 1)) * 2 - 1;
            const r1 = Math.hypot(x + d, y);
            const r2 = Math.hypot(x - d, y);
            // Constructive when path-length difference ≈ nλ
            const I  = Math.cos(k * r1) + Math.cos(k * r2);
            raw[row * G + col] = I > 1.2 ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.3);
}

/**
 * Julia set: z → z² + c.
 * Default c = −0.7 + 0.27i gives a dramatic dendrite/rabbit pattern.
 * High density inside the bounded (non-escaping) region.
 */
export function julia(cx = -0.7, cy = 0.27, maxIter = 90) {
    const raw  = new Float32Array(G * G);
    const SPAN = 1.55;   // view ±SPAN in both axes
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            let zx   = (col / (G - 1)) * (2 * SPAN) - SPAN;
            let zy   = (row / (G - 1)) * (2 * SPAN) - SPAN;
            let iter = 0;
            while (iter < maxIter && zx * zx + zy * zy < 4) {
                const tx = zx * zx - zy * zy + cx;
                zy = 2 * zx * zy + cy;
                zx = tx;
                iter++;
            }
            // Filled set = dense; near-boundary gets a faint glow for softness
            raw[row * G + col] = iter === maxIter ? 1.0
                                                  : (iter / maxIter) * 0.12;
        }
    }
    return gaussianBlur(raw, G, G, 0.7);
}

/**
 * Dragon Julia set: c = 0.285 + 0.01i.
 * Produces fragmented archipelago islands — visually unlike the dendrite julia.
 */
export function dragon() {
    return julia(0.285, 0.01, 100);
}

/**
 * Douady's Rabbit: c = −0.123 + 0.745i.
 * Three-lobed symmetry — completely different silhouette from julia/dragon.
 */
export function rabbit() {
    return julia(-0.123, 0.745, 100);
}

/**
 * Rössler attractor, XY projection.
 * A single-scroll spiral — visually distinct from the Lorenz double-wing.
 */
export function rossler() {
    const a = 0.2, b = 0.2, c = 5.7, dt = 0.01;
    let rx = 1, ry = 0, rz = 0;

    const WARMUP = 1000, STEPS = 50000;
    const pts = [];

    for (let i = 0; i < WARMUP + STEPS; i++) {
        const dx = -ry - rz;
        const dy =  rx + a * ry;
        const dz =  b + rz * (rx - c);
        rx += dx * dt;
        ry += dy * dt;
        rz += dz * dt;
        if (i >= WARMUP) pts.push([rx, ry]);   // XY → outward spiral
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const span  = Math.max(maxX - minX, maxY - minY);
    const scale = (0.88 * 2) / span;
    const cx    = (minX + maxX) / 2;
    const cy    = (minY + maxY) / 2;

    return rasterize(pts.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]), 1.2);
}

/**
 * Rose curve: r = cos(k·θ).
 * k=4 → 8 petals.  Elegant radial symmetry, unlike any other shape here.
 */
export function rose(k = 4) {
    const STEPS = 12000;
    const pts   = [];
    // Rose curve repeats every π (odd k) or 2π (even k); sample 2π to be safe
    for (let i = 0; i < STEPS; i++) {
        const θ = (i / STEPS) * 2 * Math.PI;
        const r = Math.cos(k * θ);
        pts.push([r * Math.cos(θ) * 0.82, r * Math.sin(θ) * 0.82]);
    }
    return rasterize(pts, 1.8);
}

/**
 * Logarithmic spiral: r = a·e^(b·θ).
 * Tighter inner coil than the Archimedean spiral — more "galaxy arm" feel.
 */
export function logSpiral(b = 0.18, turns = 3.5, width = 0.055) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);

    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const x = (col / (G - 1)) * 2 - 1;
            const y = (row / (G - 1)) * 2 - 1;
            const r = Math.hypot(x, y);
            if (r < 0.01 || r > 0.90) continue;
            const θ   = ((Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI));
            // How many wraps back does this angle correspond to?
            const logR = Math.log(r) / b;      // θ_0 for this radius
            // Nearest spiral arm angle
            for (let wrap = 0; wrap < turns; wrap++) {
                const armTheta = logR + wrap * 2 * Math.PI;
                const diff     = ((θ - (armTheta % (2 * Math.PI))) + 2 * Math.PI) % (2 * Math.PI);
                const closest  = Math.min(diff, 2 * Math.PI - diff);
                if (closest * r < width) { raw[row * G + col] = 1; break; }
            }
        }
    }
    return gaussianBlur(raw, G, G, 1.6);
}

/**
 * Mandelbrot set (c-plane view).
 * The iconic cardioid + bulb silhouette.
 */
export function mandelbrot(maxIter = 80) {
    const raw  = new Float32Array(G * G);
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            // View: re ∈ [−2.5, 1.0], im ∈ [−1.25, 1.25]
            const cr = (col / (G - 1)) * 3.5 - 2.5;
            const ci = (row / (G - 1)) * 2.5 - 1.25;
            let zr = 0, zi = 0, iter = 0;
            while (iter < maxIter && zr * zr + zi * zi < 4) {
                const tr = zr * zr - zi * zi + cr;
                zi = 2 * zr * zi + ci;
                zr = tr;
                iter++;
            }
            raw[row * G + col] = iter === maxIter ? 1.0
                                                  : (iter / maxIter) * 0.10;
        }
    }
    return gaussianBlur(raw, G, G, 0.7);
}
