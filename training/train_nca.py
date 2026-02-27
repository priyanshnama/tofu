#!/usr/bin/env python3
"""
train_nca.py — Train GoalNCA weights for Project Tofu.

The GoalNCA learns to "grow" any of the parametric shapes from an all-zero
initial state, guided by a goal density grid provided at every step.
After training, weights are exported to ../public/nca_weights.json (~18 KB)
and loaded by the browser at runtime.

Architecture (must match wgsl/nca_step_mlp.wgsl exactly)
──────────────────────────────────────────────────────────
  State     : 16 channels per cell, ch0 = alpha/density
  Perception: identity + Sobel-X + Sobel-Y on all 16 ch = 48 floats
  Goal feat : 8 hand-engineered nonlinear features of g ∈ [0,1]
  MLP       : FC(56 → 64, ReLU) → FC(64 → 16) → delta
  Update    : state = clamp(state + delta * bernoulli(0.5), -1, 1)

Training strategy (Growing NCA paper approach)
───────────────────────────────────────────────
  • Pool of 256 states — prevents catastrophic forgetting
  • Curriculum — start 16 steps, ramp up to 64 over training
  • Occasionally reset one batch member to zero (seed regeneration)
  • Gradient clipping at 1.0

Usage
─────
  cd training
  pip install -r requirements.txt
  python train_nca.py           # CPU (~20 min) or GPU (~3 min)

Output
──────
  ../public/nca_weights.json    # ~18 KB, auto-loaded by browser
"""

import os, sys, json, math, random, time
import numpy as np
from scipy.ndimage import gaussian_filter

import torch
import torch.nn as nn
import torch.nn.functional as F

# ── Hyper-parameters ──────────────────────────────────────────────────────────

GRID       = 128       # density grid resolution (must match NCA_W/H in WGSL)
C_STATE    = 16        # NCA state channels  (must match C in WGSL)
N_HIDDEN   = 64        # MLP hidden units    (must match NHD in WGSL)
FIRE_RATE  = 0.5       # fraction of cells that update per step
BATCH      = 4         # training batch size
POOL_SIZE  = 256       # experience replay pool size
STEPS_MIN  = 16        # curriculum: initial step count
STEPS_MAX  = 64        # curriculum: final step count
N_ITER     = 10_000    # total training iterations
LR         = 2e-3      # Adam learning rate
DEVICE     = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
OUT_PATH   = os.path.join(os.path.dirname(__file__), '..', 'public', 'nca_weights.json')


# ── Shape generators (Python mirrors of src/shapes/*.js) ─────────────────────

G = GRID

def _ndc_grids():
    """Return (x_grid, y_grid) meshes in NDC [-1,1]."""
    lin = np.linspace(-1.0, 1.0, G, dtype=np.float32)
    return np.meshgrid(lin, lin)   # col → x, row → y

def _blur(raw, sigma=1.5):
    b = gaussian_filter(raw.astype(np.float32), sigma)
    m = b.max()
    return b / m if m > 0 else b

def _rasterize(pts, sigma=2.0):
    """Accumulate (x,y) NDC point list into G×G grid, then blur."""
    raw = np.zeros((G, G), dtype=np.float32)
    for x, y in pts:
        col = int(round((x + 1) / 2 * (G - 1)))
        row = int(round((y + 1) / 2 * (G - 1)))
        if 0 <= row < G and 0 <= col < G:
            raw[row, col] += 1.0
    return _blur(raw, sigma)

# ── Tier 1: geometric ──────────────────────────────────────────────────────────

def s_circle(r=0.72):
    x, y = _ndc_grids()
    return _blur((x**2 + y**2 < r**2).astype(np.float32))

def s_ring(r=0.65, w=0.14):
    x, y = _ndc_grids()
    d = np.sqrt(x**2 + y**2)
    return _blur((np.abs(d - r) < w / 2).astype(np.float32))

def s_diamond(half=0.70):
    x, y = _ndc_grids()
    return _blur((np.abs(x) + np.abs(y) < half).astype(np.float32))

def s_star(n=5, outer=0.72, inner=0.32):
    raw = np.zeros((G, G), np.float32)
    for row in range(G):
        for col in range(G):
            px = (col / (G - 1)) * 2 - 1
            py = (row / (G - 1)) * 2 - 1
            theta = math.atan2(py, px)
            r     = math.hypot(px, py)
            wedge = theta % (2 * math.pi / n)
            if wedge < 0: wedge += 2 * math.pi / n
            norm  = wedge / (2 * math.pi / n)
            star_r = inner + (outer - inner) * abs(1 - 2 * norm)
            raw[row, col] = 1.0 if r < star_r else 0.0
    return _blur(raw)

def s_triangle(r=0.78):
    raw = np.zeros((G, G), np.float32)
    verts = [(math.cos(-math.pi/2 + i * 2 * math.pi / 3) * r,
              math.sin(-math.pi/2 + i * 2 * math.pi / 3) * r) for i in range(3)]
    for row in range(G):
        for col in range(G):
            px = (col / (G - 1)) * 2 - 1
            py = (row / (G - 1)) * 2 - 1
            inside = True
            for i in range(3):
                ax, ay = verts[i]
                bx, by = verts[(i + 1) % 3]
                if (bx - ax) * (py - ay) - (by - ay) * (px - ax) < 0:
                    inside = False; break
            raw[row, col] = 1.0 if inside else 0.0
    return _blur(raw)

def s_cross(arm=0.72, w=0.22):
    x, y = _ndc_grids()
    h = w / 2
    return _blur(((np.abs(x) < arm) & (np.abs(y) < h) |
                  (np.abs(y) < arm) & (np.abs(x) < h)).astype(np.float32))

def s_heart():
    raw = np.zeros((G, G), np.float32)
    for row in range(G):
        for col in range(G):
            px =  ((col / (G - 1)) * 2 - 1) * 1.3
            py = -((row / (G - 1)) * 2 - 1) * 1.3
            v  = (px*px + py*py - 1)**3 - px*px * py**3
            raw[row, col] = 1.0 if v < 0 else 0.0
    return _blur(raw)

def s_wave(freq=2.5, amp=0.45, thick=0.10):
    x, y = _ndc_grids()
    wave_y = amp * np.sin(freq * math.pi * x)
    return _blur((np.abs(y - wave_y) < thick).astype(np.float32))

def s_spiral(turns=2.5, r0=0.08, r1=0.78, w=0.07):
    raw = np.zeros((G, G), np.float32)
    for row in range(G):
        for col in range(G):
            px = (col / (G - 1)) * 2 - 1
            py = (row / (G - 1)) * 2 - 1
            r     = math.hypot(px, py)
            theta = (math.atan2(py, px) + 2 * math.pi) % (2 * math.pi)
            on = False
            for wrap in range(int(turns) + 1):
                t  = (wrap + theta / (2 * math.pi)) / turns
                sr = r0 + (r1 - r0) * t
                if abs(r - sr) < w: on = True; break
            raw[row, col] = 1.0 if on else 0.0
    return _blur(raw, sigma=1.8)

def s_hexgrid(spacing=0.18):
    raw = np.zeros((G, G), np.float32)
    a = spacing; h = a * math.sqrt(3) / 2; rn = spacing * 0.25
    for row in range(G):
        for col in range(G):
            px = (col / (G - 1)) * 2 - 1
            py = (row / (G - 1)) * 2 - 1
            col_ = px / a; row_ = py / h
            qx   = round(col_ + (0.5 if round(row_) % 2 != 0 else 0))
            qy   = round(row_)
            ox   = 0.5 if qy % 2 != 0 else 0.0
            nx   = (qx - ox) * a; ny = qy * h
            raw[row, col] = 1.0 if math.hypot(px - nx, py - ny) < rn else 0.0
    return _blur(raw, sigma=1.2)

# ── Tier 2: mathematical ───────────────────────────────────────────────────────

def s_lissajous(a=3, b=2, delta=math.pi/4, sigma=1.8):
    pts = [(math.sin(a*t+delta)*0.82, math.sin(b*t)*0.82)
           for t in (i/10000*2*math.pi for i in range(10000))]
    return _rasterize(pts, sigma)

def s_lorenz():
    sx=10; rho=28; beta=8/3; dt=0.005
    lx, ly, lz = 0.1, 0.0, 0.0
    pts = []
    for i in range(63000):
        dx=sx*(ly-lx); dy=lx*(rho-lz)-ly; dz=lx*ly-beta*lz
        lx+=dx*dt; ly+=dy*dt; lz+=dz*dt
        if i >= 3000: pts.append((lx, lz))
    pts = np.array(pts, np.float32)
    mn, mx = pts.min(0), pts.max(0)
    scale = 0.88 * 2 / max(mx - mn)
    ctr   = (mn + mx) / 2
    pts   = (pts - ctr) * scale
    return _rasterize(pts.tolist(), sigma=1.2)

def s_julia(cx=-0.7, cy=0.27, max_iter=90):
    lin = np.linspace(-1.55, 1.55, G, dtype=np.float32)
    cr, ci_grid = np.meshgrid(lin, lin)
    zr, zi = cr.copy(), ci_grid.copy()
    raw = np.ones((G, G), np.float32) * max_iter
    for _ in range(max_iter):
        mask = zr**2 + zi**2 < 4
        tr = zr**2 - zi**2 + cx
        zi = np.where(mask, 2*zr*zi + cy, zi)
        zr = np.where(mask, tr, zr)
        raw -= mask.astype(np.float32)
    inside = raw == 0
    result = inside.astype(np.float32) + (~inside).astype(np.float32) * (raw / max_iter) * 0.12
    return _blur(result, sigma=0.7)

def s_interference(k=22, d=0.32):
    x, y = _ndc_grids()
    r1 = np.sqrt((x + d)**2 + y**2)
    r2 = np.sqrt((x - d)**2 + y**2)
    I  = np.cos(k * r1) + np.cos(k * r2)
    return _blur((I > 1.2).astype(np.float32), sigma=1.3)

def s_mandelbrot(max_iter=80):
    cr  = np.linspace(-2.5,  1.0, G, dtype=np.float32)
    ci_ = np.linspace(-1.25, 1.25, G, dtype=np.float32)
    CR, CI = np.meshgrid(cr, ci_)
    zr, zi = np.zeros((G, G), np.float32), np.zeros((G, G), np.float32)
    raw    = np.ones((G, G),  np.float32) * max_iter
    for _ in range(max_iter):
        mask = zr**2 + zi**2 < 4
        tr   = zr**2 - zi**2 + CR
        zi   = np.where(mask, 2*zr*zi + CI, zi)
        zr   = np.where(mask, tr, zr)
        raw -= mask.astype(np.float32)
    inside = raw == 0
    result = inside.astype(np.float32) + (~inside) * (raw / max_iter) * 0.10
    return _blur(result.astype(np.float32), sigma=0.7)

def s_rose(k=4):
    pts = []
    for i in range(12000):
        theta = i / 12000 * 2 * math.pi
        r     = math.cos(k * theta)
        pts.append((r * math.cos(theta) * 0.82, r * math.sin(theta) * 0.82))
    return _rasterize(pts, sigma=1.8)

def s_rossler():
    a=0.2; b=0.2; c=5.7; dt=0.01
    rx, ry, rz = 1.0, 0.0, 0.0
    pts = []
    for i in range(51000):
        dx=-ry-rz; dy=rx+a*ry; dz=b+rz*(rx-c)
        rx+=dx*dt; ry+=dy*dt; rz+=dz*dt
        if i >= 1000: pts.append((rx, ry))
    pts = np.array(pts, np.float32)
    mn, mx = pts.min(0), pts.max(0)
    scale = 0.88 * 2 / max(mx - mn)
    ctr   = (mn + mx) / 2
    pts   = (pts - ctr) * scale
    return _rasterize(pts.tolist(), sigma=1.2)

# ── Tier 3: molecular ─────────────────────────────────────────────────────────

def s_dna(freq=2.8*math.pi, amp=0.36, n_rungs=12):
    pts = []
    for i in range(4000):
        y = i / 4000 * 1.8 - 0.9
        pts += [(amp * math.sin(freq * y), y), (-amp * math.sin(freq * y), y)]
    for r in range(n_rungs):
        y  = -0.88 + (r + 0.5) / n_rungs * 1.76
        x1 =  amp * math.sin(freq * y)
        x2 = -x1
        for k in range(28):
            pts.append((x1 + (x2 - x1) * k / 27, y))
    return _rasterize(pts, sigma=1.4)

def s_nanotube():
    pts = []
    R=0.82; N=20; RINGS=18
    for ring in range(RINGS):
        y      = -0.88 + ring / (RINGS - 1) * 1.76
        offset = 0 if ring % 2 == 0 else math.pi / N
        for k in range(N):
            theta = k / N * 2 * math.pi + offset
            pts.append((math.sin(theta) * R, y))
    return _rasterize(pts, sigma=1.5)

def s_crystal(spacing=0.22):
    pts  = []
    half = spacing / 2
    xs   = np.arange(-1 + spacing/2, 1 + spacing, spacing)
    for x in xs:
        for y in xs:
            pts += [(float(x), float(y)), (float(x + half), float(y + half))]
    return _rasterize(pts, sigma=0.9)

def s_graphene(a=0.155):
    pts = []
    bx  = a
    ax  = a * math.cos(math.pi / 3)
    ay  = a * math.sin(math.pi / 3)
    N   = int(1.0 / a) + 2
    for i in range(-N, N+1):
        for j in range(-N, N+1):
            ax_ = i * a + j * ax
            ay_ = j * ay
            bx_ = ax_ + bx; by_ = ay_
            if abs(ax_) < 1.05 and abs(ay_) < 1.05: pts.append((ax_, ay_))
            if abs(bx_) < 1.05 and abs(by_) < 1.05: pts.append((bx_, by_))
    return _rasterize(pts, sigma=0.9)


# ── Shape registry ────────────────────────────────────────────────────────────

SHAPES = {
    'circle':      s_circle,
    'ring':        s_ring,
    'diamond':     s_diamond,
    'star5':       lambda: s_star(5),
    'star8':       lambda: s_star(8),
    'triangle':    s_triangle,
    'cross':       s_cross,
    'heart':       s_heart,
    'wave':        s_wave,
    'spiral':      s_spiral,
    'hexgrid':     s_hexgrid,
    'lissajous':   s_lissajous,
    'pretzel':     lambda: s_lissajous(5, 4, math.pi/6),
    'trefoil':     lambda: s_lissajous(3, 1, math.pi/2),
    'rose4':       lambda: s_rose(4),
    'rose3':       lambda: s_rose(3),
    'lorenz':      s_lorenz,
    'rossler':     s_rossler,
    'interference':s_interference,
    'julia':       s_julia,
    'dragon':      lambda: s_julia(0.285, 0.01),
    'rabbit':      lambda: s_julia(-0.123, 0.745),
    'mandelbrot':  s_mandelbrot,
    'dna':         s_dna,
    'nanotube':    s_nanotube,
    'crystal':     s_crystal,
    'graphene':    s_graphene,
}


# ── GoalNCA model ─────────────────────────────────────────────────────────────

class GoalNCA(nn.Module):
    """
    GoalNCA with architecture matching wgsl/nca_step_mlp.wgsl.

    State  : (B, C, H, W)  — 16 channels, ch0 = alpha
    Goal   : (B, H, W)     — scalar density in [0,1]
    Output : updated state (same shape)
    """

    def __init__(self, channels: int = C_STATE, hidden: int = N_HIDDEN):
        super().__init__()
        self.channels = channels
        n_perceive    = channels * 3   # identity + Sobel-X + Sobel-Y
        n_goal_feat   = 8
        n_in          = n_perceive + n_goal_feat   # 56

        self.fc1 = nn.Linear(n_in, hidden)
        self.fc2 = nn.Linear(hidden, channels)

        # Zero-init output layer — stable start (near-identity updates)
        nn.init.zeros_(self.fc2.weight)
        nn.init.zeros_(self.fc2.bias)

    # ── Perception ────────────────────────────────────────────────────────────

    def perceive(self, state: torch.Tensor) -> torch.Tensor:
        """3×3 depth-wise Sobel + identity on all C channels → (B, 3C, H, W)."""
        B, C, H, W = state.shape
        dev = state.device

        sx = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
                          dtype=torch.float32, device=dev).view(1, 1, 3, 3) / 8.0
        sy = torch.tensor([[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
                          dtype=torch.float32, device=dev).view(1, 1, 3, 3) / 8.0
        si = torch.zeros(1, 1, 3, 3, dtype=torch.float32, device=dev)
        si[0, 0, 1, 1] = 1.0

        # Expand kernels depth-wise over C channels
        sx = sx.expand(C, -1, -1, -1)
        sy = sy.expand(C, -1, -1, -1)
        si = si.expand(C, -1, -1, -1)

        s = F.pad(state, [1, 1, 1, 1], 'replicate')
        return torch.cat([
            F.conv2d(s, si, groups=C),
            F.conv2d(s, sx, groups=C),
            F.conv2d(s, sy, groups=C),
        ], dim=1)   # (B, 3C, H, W)

    # ── Goal features ─────────────────────────────────────────────────────────

    @staticmethod
    def goal_features(goal: torch.Tensor) -> torch.Tensor:
        """
        8 hand-engineered nonlinear features of scalar g — no learned encoder.
        Must match inp[48..55] in wgsl/nca_step_mlp.wgsl.
        goal: (B, H, W) → (B, 8, H, W)
        """
        g   = goal.unsqueeze(1).clamp(0.0, 1.0)  # (B, 1, H, W)
        pi  = math.pi
        return torch.cat([
            g,
            g ** 2,
            1.0 - g,
            torch.sin(pi * g),
            torch.cos(2 * pi * g),
            torch.sqrt(g),
            4.0 * g * (1.0 - g),
            (g > 0.5).float(),
        ], dim=1)   # (B, 8, H, W)

    # ── Forward ───────────────────────────────────────────────────────────────

    def forward(self, state: torch.Tensor, goal: torch.Tensor,
                fire_rate: float = FIRE_RATE) -> torch.Tensor:
        B, C, H, W = state.shape

        perception = self.perceive(state)           # (B, 3C, H, W)
        goal_feat  = self.goal_features(goal)       # (B,  8, H, W)

        x = torch.cat([perception, goal_feat], dim=1)  # (B, 56, H, W)
        x = x.permute(0, 2, 3, 1).reshape(B * H * W, -1)

        h     = F.relu(self.fc1(x))
        delta = self.fc2(h)
        delta = delta.reshape(B, H, W, C).permute(0, 3, 1, 2)

        # Stochastic update mask — same fire_rate as WGSL
        mask = (torch.rand(B, 1, H, W, device=state.device) < fire_rate).float()

        return (state + delta * mask).clamp(-1.0, 1.0)


# ── Training ──────────────────────────────────────────────────────────────────

def run_nca(model, state, goal, steps, fire_rate=FIRE_RATE):
    for _ in range(steps):
        state = model(state, goal, fire_rate)
    return state


def train():
    print(f"Device : {DEVICE}")
    print(f"Shapes : {len(SHAPES)}")
    print(f"Iters  : {N_ITER}  •  Pool : {POOL_SIZE}  •  Batch : {BATCH}")
    print()

    # ── Pre-generate all goal grids (CPU, once) ───────────────────────────────
    print("Generating shape grids … ", end='', flush=True)
    shape_grids = {}
    for name, fn in SHAPES.items():
        shape_grids[name] = torch.tensor(fn(), dtype=torch.float32)
    shape_names = list(shape_grids.keys())
    print("done")

    # ── Experience replay pool ────────────────────────────────────────────────
    # pool[i] : (C, H, W) state;  pool_goals[i] : shape name
    pool       = torch.zeros(POOL_SIZE, C_STATE, GRID, GRID)
    pool_goals = [random.choice(shape_names) for _ in range(POOL_SIZE)]

    # ── Model + optimiser ─────────────────────────────────────────────────────
    model = GoalNCA(C_STATE, N_HIDDEN).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=LR)

    t0 = time.time()

    for it in range(N_ITER):
        # Sample batch from pool
        idx   = random.sample(range(POOL_SIZE), BATCH)
        state = pool[idx].to(DEVICE)
        names = [pool_goals[i] for i in idx]
        goal  = torch.stack([shape_grids[n] for n in names]).to(DEVICE)  # (B, H, W)

        # Occasionally reset one member to zero to encourage growth from scratch
        if random.random() < 0.05:
            state[0] = 0.0

        # Curriculum: linear ramp from STEPS_MIN to STEPS_MAX
        progress = min(it / (N_ITER * 0.5), 1.0)
        n_steps  = int(STEPS_MIN + (STEPS_MAX - STEPS_MIN) * progress)

        # ── Forward ──────────────────────────────────────────────────────────
        for _ in range(n_steps):
            state = model(state, goal)

        # ── Loss ─────────────────────────────────────────────────────────────
        alpha    = state[:, 0].clamp(0.0, 1.0)      # density channel
        loss_mse = F.mse_loss(alpha, goal)           # match goal shape

        # Keep hidden channels bounded (prevents explosion)
        overflow = (state[:, 1:].abs() - 1.0).clamp(min=0.0).mean()

        loss = loss_mse + overflow * 0.1

        # ── Backward ─────────────────────────────────────────────────────────
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()

        # ── Update pool ───────────────────────────────────────────────────────
        pool[idx] = state.detach().cpu()
        for i, pi in enumerate(idx):
            # Occasionally assign a new target shape to keep diversity
            if random.random() < 0.1:
                pool_goals[pi] = random.choice(shape_names)

        # ── Logging ──────────────────────────────────────────────────────────
        if it % 200 == 0:
            elapsed = time.time() - t0
            remain  = elapsed / max(it, 1) * (N_ITER - it)
            print(f"[{it:5d}/{N_ITER}]  loss={loss.item():.4f}  "
                  f"mse={loss_mse.item():.4f}  steps={n_steps}  "
                  f"elapsed={elapsed:.0f}s  eta={remain:.0f}s")

    print(f"\nTraining complete in {time.time()-t0:.0f}s")

    # ── Export weights ────────────────────────────────────────────────────────
    # Layout must match the WGSL buffer access pattern:
    #   w1[j * NIN + k]  → fc1.weight[j, k]   (shape: NHD × NIN)
    #   w2[j * NHD + k]  → fc2.weight[j, k]   (shape: C × NHD)

    weights = {
        'channels': C_STATE,
        'hidden':   N_HIDDEN,
        'w1': model.fc1.weight.detach().cpu().tolist(),   # (NHD, NIN)
        'b1': model.fc1.bias.detach().cpu().tolist(),     # (NHD,)
        'w2': model.fc2.weight.detach().cpu().tolist(),   # (C, NHD)
        'b2': model.fc2.bias.detach().cpu().tolist(),     # (C,)
    }

    os.makedirs(os.path.dirname(os.path.abspath(OUT_PATH)), exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(weights, f, separators=(',', ':'))

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"Weights → {OUT_PATH}  ({size_kb:.1f} KB)")
    print("Restart `npm run dev` — the browser will auto-load the weights.")


if __name__ == '__main__':
    train()
