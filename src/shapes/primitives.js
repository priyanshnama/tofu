/**
 * primitives.js — Parametric density-grid generators.
 *
 * Every function returns a Float32Array of shape (GRID_SIZE × GRID_SIZE) with
 * values in [0, 1].  Row 0 = NDC y = -1 (bottom), row GRID_SIZE-1 = y = +1 (top).
 * This matches the splat/render coordinate convention exactly.
 *
 * The density field is importance-sampled by registry.sampleFromDensity() to
 * produce the N atom target positions for each shape.
 *
 * A Gaussian blur is applied to every grid before returning it so:
 *   • shape boundaries are soft (atoms form natural clouds, not hard edges)
 *   • the importance sampler has smooth probability gradients to follow
 */

export const GRID_SIZE = 128;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * 2-pass separable Gaussian blur on a flat Float32Array (row-major).
 * @param {Float32Array} src   W×H input
 * @param {number}       W
 * @param {number}       H
 * @param {number}       sigma  standard deviation in pixels
 * @returns {Float32Array}       blurred, normalised to [0, 1]
 */
export function gaussianBlur(src, W, H, sigma) {
    const radius = Math.ceil(sigma * 3);
    const kernel = [];
    let ks = 0;
    for (let i = -radius; i <= radius; i++) {
        const k = Math.exp(-(i * i) / (2 * sigma * sigma));
        kernel.push(k);
        ks += k;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= ks;

    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);

    // Horizontal pass
    for (let row = 0; row < H; row++) {
        for (let col = 0; col < W; col++) {
            let sum = 0;
            for (let k = 0; k < kernel.length; k++) {
                const c = Math.min(Math.max(col + k - radius, 0), W - 1);
                sum += src[row * W + c] * kernel[k];
            }
            tmp[row * W + col] = sum;
        }
    }

    // Vertical pass
    for (let row = 0; row < H; row++) {
        for (let col = 0; col < W; col++) {
            let sum = 0;
            for (let k = 0; k < kernel.length; k++) {
                const r = Math.min(Math.max(row + k - radius, 0), H - 1);
                sum += tmp[r * W + col] * kernel[k];
            }
            out[row * W + col] = sum;
        }
    }

    // Normalise to [0, 1]
    let mx = 0;
    for (let i = 0; i < out.length; i++) if (out[i] > mx) mx = out[i];
    if (mx > 0) for (let i = 0; i < out.length; i++) out[i] /= mx;
    return out;
}

/** Convert pixel coordinates to NDC. Row 0 → y=-1. */
function toNDC(col, row, W, H) {
    return {
        x:  (col / (W - 1)) * 2 - 1,
        y:  (row / (H - 1)) * 2 - 1,   // row 0 = bottom = y = -1
    };
}


// ── Shape generators ──────────────────────────────────────────────────────────

/** Filled disc. */
export function circle(r = 0.72) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const { x, y } = toNDC(col, row, G, G);
            raw[row * G + col] = Math.hypot(x, y) < r ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.5);
}

/** Hollow annulus. */
export function ring(r = 0.65, width = 0.14) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const { x, y } = toNDC(col, row, G, G);
            const d = Math.hypot(x, y);
            raw[row * G + col] = Math.abs(d - r) < width / 2 ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.5);
}

/** N-pointed star. */
export function star(points = 5, outerR = 0.72, innerR = 0.32) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const { x, y } = toNDC(col, row, G, G);
            const theta  = Math.atan2(y, x);
            const r      = Math.hypot(x, y);
            const wedge  = ((theta % (2 * Math.PI / points)) + 2 * Math.PI) % (2 * Math.PI / points);
            const norm   = wedge / (2 * Math.PI / points);   // 0 = tip, 0.5 = valley
            const starR  = innerR + (outerR - innerR) * Math.abs(1 - 2 * norm);
            raw[row * G + col] = r < starR ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.5);
}

/** Filled diamond (L1 ball). */
export function diamond(half = 0.70) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const { x, y } = toNDC(col, row, G, G);
            raw[row * G + col] = Math.abs(x) + Math.abs(y) < half ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.5);
}

/** Archimedean spiral band: r = startR + (endR - startR) * θ / (2π * turns). */
export function spiral(turns = 2.5, startR = 0.08, endR = 0.78, width = 0.07) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const { x, y } = toNDC(col, row, G, G);
            const r     = Math.hypot(x, y);
            const theta = ((Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI));

            // For each wrap of the spiral, check if point is near the arm
            let onSpiral = false;
            for (let wrap = 0; wrap < turns; wrap++) {
                const t       = (wrap + theta / (2 * Math.PI)) / turns;
                const spiralR = startR + (endR - startR) * t;
                if (Math.abs(r - spiralR) < width) { onSpiral = true; break; }
            }
            raw[row * G + col] = onSpiral ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.8);
}

/** Heart using algebraic implicit: (x²+y²−1)³ − x²y³ < 0. */
export function heart() {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            // Map to [-1.3, 1.3] and flip Y so heart points up
            const x =  ((col / (G - 1)) * 2 - 1) * 1.3;
            const y = -((row / (G - 1)) * 2 - 1) * 1.3;
            const v = Math.pow(x*x + y*y - 1, 3) - x*x * y*y*y;
            raw[row * G + col] = v < 0 ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.5);
}

/** Standing sine wave — atoms form a horizontal density band. */
export function wave(freq = 2.5, amp = 0.45, thickness = 0.10) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const { x, y } = toNDC(col, row, G, G);
            const waveY = amp * Math.sin(freq * Math.PI * x);
            raw[row * G + col] = Math.abs(y - waveY) < thickness ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.5);
}

/** Equilateral triangle. */
export function triangle(r = 0.78) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    // Three edge normals of an equilateral triangle pointing up
    const verts = [0, 1, 2].map(i => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        return [Math.cos(a) * r, Math.sin(a) * r];
    });
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const { x, y } = toNDC(col, row, G, G);
            // Inside triangle iff on the correct side of all three edges
            let inside = true;
            for (let i = 0; i < 3; i++) {
                const [ax, ay] = verts[i];
                const [bx, by] = verts[(i + 1) % 3];
                if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) {
                    inside = false; break;
                }
            }
            raw[row * G + col] = inside ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.5);
}

/** Plus / cross shape. */
export function cross(arm = 0.72, width = 0.22) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    const h   = width / 2;
    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const { x, y } = toNDC(col, row, G, G);
            const horiz = Math.abs(x) < arm && Math.abs(y) < h;
            const vert  = Math.abs(y) < arm && Math.abs(x) < h;
            raw[row * G + col] = horiz || vert ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.5);
}

/**
 * Eiffel Tower silhouette.
 * Four curved legs with parabolic arch → first-floor platform → tapering body
 * → second-floor platform → spire → thin antenna.
 */
export function eiffelTower() {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);

    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const x  = (col / (G - 1)) * 2 - 1;
            const y  = (row / (G - 1)) * 2 - 1;
            const ax = Math.abs(x);
            let   v  = 0;

            // ── Legs  (base → first floor) ────────────────────────────────
            if (y >= -0.88 && y < -0.08) {
                const t = (y + 0.88) / 0.80;          // 0 = base, 1 = first floor

                // Outer profile: wide at base, power-curve to first floor
                const xOuter = 0.52 * Math.pow(1 - t, 0.60) + 0.10;

                // Inner arch: parabolic opening at base, closes at first floor
                const xInner = 0.20 * (1 - t) * (1 - t * 0.5);

                v = (ax >= xInner && ax <= xOuter) ? 1 : 0;
            }

            // ── First-floor platform ──────────────────────────────────────
            else if (y >= -0.08 && y < -0.03) {
                v = ax <= 0.14 ? 1 : 0;
            }

            // ── Middle body  (first → second floor) ──────────────────────
            else if (y >= -0.03 && y < 0.18) {
                const t = (y + 0.03) / 0.21;
                v = ax <= (0.10 - 0.03 * t) ? 1 : 0;
            }

            // ── Second-floor platform ─────────────────────────────────────
            else if (y >= 0.18 && y < 0.25) {
                v = ax <= 0.07 ? 1 : 0;
            }

            // ── Spire  (second floor → top) ───────────────────────────────
            else if (y >= 0.25 && y < 0.82) {
                const t = (y - 0.25) / 0.57;
                v = ax <= 0.062 * (1 - 0.88 * t) ? 1 : 0;
            }

            // ── Antenna ───────────────────────────────────────────────────
            else if (y >= 0.82 && y <= 0.92) {
                v = ax <= 0.016 ? 1 : 0;
            }

            raw[row * G + col] = v;
        }
    }

    return gaussianBlur(raw, G, G, 1.5);
}

/** Projected hexagonal lattice (graphene / nanotube cross-section). */
export function hexGrid(spacing = 0.18) {
    const G   = GRID_SIZE;
    const raw = new Float32Array(G * G);
    const r   = spacing * 0.25;   // node radius

    for (let row = 0; row < G; row++) {
        for (let col = 0; col < G; col++) {
            const { x, y } = toNDC(col, row, G, G);

            // Nearest hexagonal lattice point
            const a  = spacing;
            const h  = a * Math.sqrt(3) / 2;
            const col_ = x / a;
            const row_ = y / h;
            const qx = Math.round(col_ + (Math.round(row_) % 2 === 0 ? 0 : 0.5));
            const qy = Math.round(row_);
            const ox = (Math.round(row_) % 2 === 0 ? 0 : 0.5);
            const nx = (qx - ox) * a;
            const ny = qy * h;

            raw[row * G + col] = Math.hypot(x - nx, y - ny) < r ? 1 : 0;
        }
    }
    return gaussianBlur(raw, G, G, 1.2);
}
