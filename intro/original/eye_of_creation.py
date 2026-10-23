#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
 ███  EYE OF CREATION  ███   — an infinite, procedural ASCII zoom.

   EYE -> (pupil) -> CREATION -> (spark) -> BIG BANG -> GALAXY -> BLACK HOLE -> (horizon) -> EYE ...

 Everything is generated live with numpy (signed-distance fields + noise),
 then drawn as coloured ASCII glyphs with bloom. No images, no assets.

 install :  pip install pygame-ce numpy      (plain `pygame` works too)
 run     :  python eye_of_creation.py                  (1280x720)
            python eye_of_creation.py --size 720x1280  (portrait / reels)
            python eye_of_creation.py --fullscreen

 controls:
   mouse        the eye follows you · in CREATION you steer God's hand
   click        blink
   SPACE        pause            RIGHT    skip to next world
   UP / DOWN    time speed       + / -    glyph size (detail)
   C            colour mode      B        bloom on/off
   G            CRT scanlines    H        hide/show HUD
   S            screenshot       R        record PNG frames (30 fps, for reels)
   F1           this help        ESC / Q  quit
"""
import argparse
import math
import os
import sys
import time

import numpy as np

TAU = 2.0 * math.pi
F32 = np.float32


# ════════════════════════════════════════════════════════════════════════
#  small math toolbox
# ════════════════════════════════════════════════════════════════════════
def clamp01(x):
    return np.clip(x, 0.0, 1.0)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def sstep(e0, e1, x):  # scalar version (plain float, cheap)
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def rgb(r, g, b):
    return np.array([r, g, b], dtype=F32)


def mix(a, b, t):
    """lerp colour images / colours; t is a scalar or a (rows, cols) mask."""
    t = np.asarray(t, dtype=F32)
    if t.ndim:
        t = t[..., None]
    return a + (b - a) * t


def tint(mask, colour):
    return np.asarray(mask, dtype=F32)[..., None] * colour


def _hash(ix, iy):
    n = (ix * 374761393 + iy * 668265263) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    n = n ^ (n >> 16)
    return (n & 0xFFFF).astype(F32) * F32(1.0 / 65535.0)


def vnoise(x, y, period=None):
    """2-D value noise in [0,1]. `period` makes it tile along x (for angles)."""
    fx0 = np.floor(x)
    fy0 = np.floor(y)
    fx = (x - fx0).astype(F32)
    fy = (y - fy0).astype(F32)
    ix = fx0.astype(np.int64)
    iy = fy0.astype(np.int64)
    ix1 = ix + 1
    if period:
        ix %= period
        ix1 %= period
    ux = fx * fx * (3 - 2 * fx)
    uy = fy * fy * (3 - 2 * fy)
    a = _hash(ix, iy)
    b = _hash(ix1, iy)
    c = _hash(ix, iy + 1)
    d = _hash(ix1, iy + 1)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy


def fbm(x, y, octaves=4, period=None):
    total = 0.0
    amp = 0.5
    norm = 0.0
    for i in range(octaves):
        total = total + amp * vnoise(x, y, period)
        norm += amp
        amp *= 0.5
        if period:  # exact doubling keeps it tileable
            x = x * 2.0
            y = y * 2.0 + 7.3
            period *= 2
        else:
            x = x * 2.03 + 17.1
            y = y * 2.03 - 9.2
    return total / norm


# signed-distance helpers ------------------------------------------------
def sd_capsule(X, Y, ax, ay, bx, by, ra, rb):
    """tapered capsule from (ax,ay) radius ra to (bx,by) radius rb."""
    pax = X - ax
    pay = Y - ay
    bax = bx - ax
    bay = by - ay
    h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay), 0.0, 1.0)
    return np.hypot(pax - bax * h, pay - bay * h) - (ra + (rb - ra) * h)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def chain(X, Y, pts, radii, k=0.012):
    """a finger: a poly-line of tapered capsules, smoothly welded."""
    d = None
    for i in range(len(pts) - 1):
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        s = sd_capsule(X, Y, ax, ay, bx, by, radii[i], radii[i + 1])
        d = s if d is None else smin(d, s, k)
    return d


def fire(I):
    """black-body-ish ramp: black → red → orange → yellow → white."""
    I = np.asarray(I, dtype=F32)
    return np.stack([clamp01(I * 1.9), clamp01(I * 1.6 - 0.45) ** 1.1, clamp01(I * 2.2 - 1.35)], -1)


# ════════════════════════════════════════════════════════════════════════
#  WORLDS
#  each world:  render(X, Y, t, pt, zoom) -> (rgb[rows,cols,3], starmask)
#    X, Y  : world coordinates of every glyph cell
#    t     : global time      pt : time since this world became active
#            (pt < 0 while it is still only visible through a portal)
#  portal(t, pt) -> (x, y, r): where the next world is hiding
#  mode : "mask" = next world seen through a hard circular hole
#         "fade" = next world fades in over the whole screen
# ════════════════════════════════════════════════════════════════════════
class World:
    name = "?"
    dur = 10.0
    hold = 3.0
    mode = "fade"
    roll = 0.0       # camera roll during the dive (radians, returns to 0)
    peek = 0.0       # fade mode: how visible the next world is before the fade
    fade = (0.35, 1.0)  # fade mode: dive progress over which the next world takes over

    def dive(self, pt):
        return sstep(self.hold, self.dur, pt)


# ── 1. THE EYE ───────────────────────────────────────────────────────────
class Eye(World):
    name = "EYE"
    dur = 12.0
    hold = 5.5
    mode = "mask"
    roll = 0.45

    def __init__(self):
        self.gaze = np.zeros(2)
        self.blink_t = -99.0

    def gaze_at(self, pt):
        k = sstep(0.0, 1.6, pt) * (1.0 - self.dive(pt))
        return float(self.gaze[0]) * 0.30 * k, float(self.gaze[1]) * 0.17 * k

    def pupil(self, t, pt):
        return 0.115 * (1.0 + 0.07 * math.sin(t * 0.8)) * (1.0 + 0.55 * self.dive(pt))

    def openness(self, t, pt):
        arrive = sstep(-1.5, 0.25, pt)
        if self.dive(pt) > 0.0:
            return arrive
        ph = t % 5.3
        auto = 1.0 - math.exp(-((ph - 5.0) / 0.08) ** 2)
        click = 1.0 - math.exp(-((t - self.blink_t - 0.12) / 0.08) ** 2)
        return arrive * min(auto, click)

    def portal(self, t, pt):
        gx, gy = self.gaze_at(pt)
        return gx, gy, self.pupil(t, pt)

    def render(self, X, Y, t, pt, zoom):
        d = self.dive(pt)
        gx, gy = self.gaze_at(pt)
        op = self.openness(t, pt)

        # ── eyelids (almond) ──
        xn = np.clip(X / 1.32, -1.6, 1.6)
        lid = np.clip(1.0 - xn * xn, 0.0, None)
        closed = -0.06 * lid - 0.02
        upper = closed + (0.66 * lid ** 0.7 + 0.04 * xn - closed) * op
        lower = closed + (-0.46 * lid ** 0.85 + 0.02 * xn - closed) * min(1.0, op * 1.25)
        du = upper - Y
        dl = Y - lower
        inside = smoothstep(0.0, 0.022, du) * smoothstep(0.0, 0.022, dl) * (lid > 0)

        # ── sclera ──
        dx = X - gx
        dy = Y - gy
        r = np.hypot(dx, dy) + 1e-6
        edge = np.minimum(du, dl)
        ao = 0.22 + 0.78 * smoothstep(0.0, 0.24, edge)
        corner = 1.0 - 0.5 * smoothstep(0.5, 1.0, np.abs(xn))
        v = fbm(X * 3.3 + 3.1, Y * 3.3 - 1.7, 3)
        veins = (1.0 - smoothstep(0.0, 0.03, np.abs(v - 0.5))) * smoothstep(0.48, 1.0, r)
        scl = tint(ao * corner, rgb(0.93, 0.88, 0.84))
        scl = mix(scl, tint(ao, rgb(0.8, 0.12, 0.10)), veins * 0.75)
        car = np.exp(-((X + 1.13) ** 2 / 0.006 + (Y + 0.01) ** 2 / 0.004))  # caruncle
        scl = mix(scl, rgb(0.85, 0.35, 0.38), np.clip(car, 0, 1) * 0.8)

        # ── iris ──
        Ri = 0.40
        Rp = self.pupil(t, pt)
        tt = np.clip((r - Rp) / (Ri - Rp), 0.0, 1.0)
        a = np.arctan2(dy, dx)
        u = (a / TAU + 0.5) * 48.0
        f = fbm(u, r * 7.0 - t * 0.03, 3, period=48)
        f2 = fbm(u * 0.25, r * 3.0 + 5.0, 2, period=12)
        fib = np.clip(0.22 + 1.15 * f ** 1.6 + 0.35 * (f2 - 0.5), 0.0, 2.0)
        ic = mix(rgb(1.0, 0.60, 0.16), rgb(0.10, 0.52, 0.48), smoothstep(0.18, 0.85, tt + 0.15 * (f2 - 0.5)))
        coll = 0.55 * np.exp(-((tt - 0.27) / 0.07) ** 2)                 # collarette
        limbus = 1.0 - 0.88 * smoothstep(0.78, 1.0, tt)
        pring = smoothstep(0.0, 0.07, tt)
        shade = 0.42 + 0.58 * smoothstep(0.0, 0.22, du)                 # lid shadow
        iris = tint((fib + coll * f) * limbus * pring * shade, ic)
        im = smoothstep(Ri + 0.012, Ri - 0.012, r)
        pm = smoothstep(Rp + 0.006, Rp - 0.006, r)
        ball = mix(scl, iris, im) * (1.0 - pm)[..., None]
        spec = (np.exp(-((dx + 0.14) ** 2 + (dy - 0.14) ** 2) / 0.0018) * 1.9
                + np.exp(-((dx - 0.10) ** 2 + (dy + 0.10) ** 2) / 0.0005) * 0.9)
        ball = ball + tint(spec * (1.0 - pm), rgb(1, 1, 1))

        # ── skin ──
        sk = fbm(X * 2.2, Y * 2.2 + 4.0, 3)
        crease = np.exp(-((Y - (0.66 * lid ** 0.55 + 0.17)) / 0.035) ** 2) * lid
        near = smoothstep(0.0, 0.13, np.minimum(np.abs(du), np.abs(dl)))
        fall = np.exp(-(X * X / 5.0 + Y * Y / 1.5))
        skin = tint((0.42 + 0.75 * sk) * (0.22 + 0.78 * near) * (1.0 - 0.7 * crease) * fall,
                    rgb(0.62, 0.36, 0.26))
        rim = np.exp(-((dl + 0.014) / 0.012) ** 2) * lid * op             # wet lower rim
        skin = skin + tint(rim * 0.8, rgb(0.9, 0.42, 0.42))

        return mix(skin, ball, inside), 0.0


# ── 2. CREATION (Michelangelo, 1512 — two hands, one spark) ────────────
class Creation(World):
    name = "CREATION"
    dur = 13.0
    hold = 7.0
    mode = "fade"
    roll = -0.25
    peek = 0.0
    fade = (0.72, 1.0)

    def __init__(self):
        self.hand = np.zeros(2)   # mouse steering for God's hand

    def offsets(self, t, pt):
        """returns (God hand dx,dy), (Adam hand dx,dy)."""
        d = self.dive(pt)
        approach = 0.34 * (1.0 - sstep(-1.0, 6.0, pt))
        live = 1.0 - d
        gdx = approach + float(self.hand[0]) * 0.10 * live + 0.006 * math.sin(t * 1.3) * live
        gdy = float(self.hand[1]) * 0.08 * live + 0.008 * math.sin(t * 0.9) * live
        ady = 0.010 * math.sin(t * 0.7 + 1.0) * live + 0.02 * (sstep(3.0, 6.5, pt) - 1.0) * live
        return (gdx, gdy), (0.0, ady)

    def tips(self, t, pt):
        (gdx, gdy), (adx, ady) = self.offsets(t, pt)
        return (0.07 + gdx, 0.02 + gdy), (-0.07 + adx, 0.0 + ady)

    S = 1.5   # framing: how close the camera sits to the hands

    def portal(self, t, pt):
        (gx, gy), (ax, ay) = self.tips(t, pt)
        return (gx + ax) * 0.5 * self.S, (gy + ay) * 0.5 * self.S, 0.03 * self.S

    @staticmethod
    def adam(X, Y):
        d = sd_capsule(X, Y, -2.9, -0.55, -1.12, -0.20, 0.19, 0.135)           # forearm
        d = smin(d, sd_capsule(X, Y, -1.12, -0.20, -0.66, -0.10, 0.135, 0.12), 0.06)  # hand
        d = smin(d, sd_capsule(X, Y, -1.00, -0.24, -0.70, -0.17, 0.11, 0.09), 0.05)
        fingers = [
            ([(-0.64, -0.05), (-0.36, -0.005), (-0.07, 0.0)], [0.052, 0.045, 0.036]),   # index
            ([(-0.65, -0.11), (-0.43, -0.16), (-0.29, -0.25)], [0.050, 0.044, 0.036]),  # middle
            ([(-0.69, -0.15), (-0.51, -0.23), (-0.41, -0.32)], [0.046, 0.041, 0.034]),  # ring
            ([(-0.73, -0.19), (-0.61, -0.27), (-0.55, -0.34)], [0.040, 0.036, 0.030]),  # pinky
            ([(-0.90, -0.06), (-0.66, 0.06), (-0.47, 0.075)], [0.060, 0.048, 0.038]),   # thumb
        ]
        return Creation._assemble(X, Y, d, fingers)

    @staticmethod
    def god(X, Y):
        d = sd_capsule(X, Y, 2.9, 0.62, 1.15, 0.22, 0.21, 0.145)               # forearm
        d = smin(d, sd_capsule(X, Y, 1.15, 0.22, 0.68, 0.09, 0.145, 0.12), 0.06)
        d = smin(d, sd_capsule(X, Y, 1.02, 0.25, 0.72, 0.16, 0.11, 0.09), 0.05)
        fingers = [
            ([(0.66, 0.06), (0.37, 0.03), (0.07, 0.02)], [0.054, 0.046, 0.037]),     # index — pointing
            ([(0.67, 0.13), (0.45, 0.17), (0.34, 0.09)], [0.050, 0.044, 0.038]),     # curled
            ([(0.71, 0.18), (0.53, 0.22), (0.45, 0.14)], [0.047, 0.041, 0.035]),
            ([(0.76, 0.22), (0.62, 0.26), (0.56, 0.19)], [0.041, 0.037, 0.031]),
            ([(0.88, 0.04), (0.66, -0.05), (0.50, -0.065)], [0.060, 0.048, 0.039]),  # thumb
        ]
        return Creation._assemble(X, Y, d, fingers)

    @staticmethod
    def _assemble(X, Y, d, fingers):
        """weld fingers onto the hand; also return each part's own outline so the
        gaps between fingers can be drawn as dark creases."""
        parts = [d]
        for pts, rad in fingers:
            f = chain(X, Y, pts, rad)
            parts.append(f)
            d = smin(d, f, 0.03)
        return d, parts

    def render(self, X, Y, t, pt, zoom):
        X, Y, zoom = X / self.S, Y / self.S, zoom * self.S
        s = self.dive(pt)
        (gdx, gdy), (adx, ady) = self.offsets(t, pt)
        dA, pA = self.adam(X - adx, Y - ady)
        dG, pG = self.god(X - gdx, Y - gdy)
        # world-space step of one grid row / one grid column (works under roll + zoom)
        rvx, rvy = float(X[1, 0] - X[0, 0]), float(Y[1, 0] - Y[0, 0])
        cvx, cvy = float(X[0, 1] - X[0, 0]), float(Y[0, 1] - Y[0, 0])
        det = rvx * cvy - rvy * cvx
        det = det if abs(det) > 1e-12 else 1e-12
        cell = max(math.hypot(rvx, rvy), 1e-5)

        # background: dark heaven, god-rays from the upper right, drifting nebula
        bx, by = X - 1.15, Y - 0.85
        ra = np.arctan2(by, bx)
        rays = (0.5 + 0.5 * np.cos(ra * 14.0 + 2.0 * fbm(ra * 3.0, t * 0.15, 2))) ** 6
        rays *= np.exp(-np.hypot(bx, by) / 1.6) * 0.35
        neb = fbm(X * 1.2 + t * 0.03, Y * 1.2, 4)
        bg = tint(rays, rgb(1.0, 0.78, 0.42)) + tint(smoothstep(0.45, 0.85, neb) * 0.22,
                                                    rgb(0.35, 0.22, 0.55))

        # shading: turn the SDF into a height field and light it
        def shade_hand(dist, parts, base, sleeve=None):
            q = np.clip(-dist / 0.075, 0.0, 1.0)             # round profile, ~finger radius
            h = 0.075 * np.sqrt(1.0 - (1.0 - q) ** 2)
            hr, hc = np.gradient(h)              # per-row, per-column change
            # solve [rv; cv] · (gx, gy) = (hr, hc) for the world-space gradient
            gx_ = np.clip((hr * cvy - hc * rvy) / det, -4.0, 4.0)
            gy_ = np.clip((hc * rvx - hr * cvx) / det, -4.0, 4.0)
            nz = 1.0 / np.sqrt(1.0 + gx_ * gx_ + gy_ * gy_)
            nx, ny = -gx_ * nz, -gy_ * nz
            L = np.array([-0.45, 0.75, 0.48]) / np.linalg.norm([-0.45, 0.75, 0.48])
            diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0.0, 1.0)
            fill = np.clip(nx * 0.35 - ny * 0.65 + nz * 0.4, 0.0, 1.0) * 0.35   # warm bounce
            spec = np.clip(nx * -0.3 + ny * 0.55 + nz * 0.78, 0.0, 1.0) ** 24 * 0.6
            body = smoothstep(cell * 0.6, -cell * 0.6, dist)
            # creases: where two parts (finger/finger, finger/palm) meet at their surfaces
            cw = 0.005 + cell * 0.8
            two = np.partition(np.stack(parts), 1, axis=0)[:2]
            crease = np.exp(-(two[0] ** 2 + two[1] ** 2) / (cw * cw)) * smoothstep(0.0, -cw, dist)
            rim = np.exp(-(np.clip(dist, 0, None) / (0.014 + cell)) ** 2) * (dist > 0)
            pores = 0.92 + 0.16 * vnoise(X * 45.0, Y * 45.0)
            light = (0.12 + 1.25 * diff ** 1.4 + fill) * pores * (1.0 - 0.7 * crease)
            col = tint(light, base) + tint(spec * (1.0 - crease), rgb(1.0, 0.95, 0.85))
            if sleeve is not None:
                col = mix(col, sleeve[0] * (0.2 + 1.0 * diff ** 1.2)[..., None], sleeve[1])
            return col, body, rim

        robe = smoothstep(1.02, 1.10, X - gdx + 0.3 * (Y - gdy)) * (0.6 + 0.6 * fbm((X - gdx) * 9.0, (Y - gdy) * 3.0, 3))
        cG, bG, rG = shade_hand(dG, pG, rgb(1.0, 0.76, 0.55), (rgb(0.78, 0.30, 0.50), clamp01(robe)))
        cA, bA, rA = shade_hand(dA, pA, rgb(1.0, 0.70, 0.48))

        out = bg
        out = mix(out, cA, bA) + tint(rA * 0.35, rgb(1.0, 0.85, 0.55))
        out = mix(out, cG, bG) + tint(rG * 0.45, rgb(1.0, 0.82, 0.5))

        # ── the spark ──
        (gx, gy), (ax, ay) = self.tips(t, pt)
        mx, my = (gx + ax) * 0.5, (gy + ay) * 0.5
        gap = max(gx - ax, 1e-3)
        charge = sstep(2.5, 6.5, pt) * (1.0 - 0.0 * s)
        q = np.clip((X - ax) / gap, 0.0, 1.0)
        env = np.sin(np.pi * q)
        bolt = None
        for k in range(3):
            jy = (vnoise(X * 70.0 + k * 13.0, np.full_like(X, t * 14.0 + k * 5.0)) - 0.5) * 0.022 * env
            yb = ay + (gy - ay) * q + jy
            line = np.exp(-((Y - yb) / (0.0025 + cell * 0.55)) ** 2) * ((X > ax) & (X < gx))
            bolt = line if bolt is None else np.maximum(bolt, line * 0.7)
        flicker = 0.75 + 0.25 * math.sin(t * 37.0) * math.sin(t * 23.0)
        rr = np.hypot(X - mx, Y - my)
        glow = np.exp(-rr * zoom / (0.03 + 0.07 * charge)) * charge * 1.3   # screen-sized
        out = out + tint(bolt * charge * flicker * 1.6, rgb(0.75, 0.9, 1.0)) + tint(glow, rgb(1.0, 0.9, 0.7))
        # the flash that becomes the Big Bang
        flash = sstep(0.6, 1.0, s)
        out = out + tint(np.exp(-rr * zoom / (0.25 + 2.0 * flash)) * flash * 1.6, rgb(1.0, 0.97, 0.9))
        return out, 0.45 * (1.0 - bG) * (1.0 - bA)


# ── 3. BIG BANG / HYPERSPACE ─────────────────────────────────────────────
class BigBang(World):
    name = "BIG BANG"
    dur = 8.0
    hold = 1.0
    mode = "fade"
    roll = 0.6
    peek = 0.55

    def portal(self, t, pt):
        return 0.0, 0.0, 0.05

    def render(self, X, Y, t, pt, zoom):
        r = np.hypot(X, Y) + 1e-4
        a = np.arctan2(Y, X)
        p = max(pt, 0.0)
        speed = 0.6 + 2.6 * p                     # accelerating
        dist = 0.6 * pt + 1.3 * p * p
        out = np.zeros(X.shape + (3,), F32)
        for N, K, seed, colr in ((90, 1.0, 1, rgb(0.7, 0.85, 1.0)),
                                 (150, 1.6, 2, rgb(1.0, 0.75, 0.95)),
                                 (240, 2.4, 3, rgb(0.85, 1.0, 1.0))):
            u = (a / TAU + 0.5) * N + seed * 0.37
            v = K / r + dist * 1.5
            cu = np.floor(u).astype(np.int64) % N
            cv = np.floor(v).astype(np.int64)
            h = _hash(cu + seed * 7919, cv)
            h2 = _hash(cu + 31, cv + seed * 104729)
            fu = (u - np.floor(u)) - (0.3 + 0.4 * h2)
            fv = (v - np.floor(v)) - 0.5
            arc = fu * TAU * r / N
            length = min(0.48, 0.04 + speed * 0.05)
            radial = clamp01(1.0 - np.abs(fv) / length)
            star = (h > 0.80) * np.exp(-(arc / 0.010) ** 2) * radial * smoothstep(0.03, 0.35, r)
            out = out + tint(star * (0.5 + 0.9 * h2) * 1.4, colr)
        # primordial plasma tunnel
        nu = (a / TAU + 0.5) * 10.0
        neb = fbm(nu, 2.0 / (r + 0.08) + dist * 2.0, 3, period=10)
        plasma = smoothstep(0.55, 0.95, neb) * smoothstep(0.05, 0.6, r) * (0.10 + 0.07 * min(p, 3.0))
        out = out + tint(plasma, rgb(0.55, 0.25, 0.85)) + tint(plasma ** 2 * 0.8, rgb(0.2, 0.6, 1.0))
        # birth flash, cooling off
        heat = math.exp(-max(pt + 0.3, 0.0) * 1.6)
        out = out + tint(np.exp(-r / (0.12 + 1.0 * heat)) * (0.25 + 1.3 * heat), rgb(1.0, 0.92, 0.8))
        return out, 0.0


# ── 4. GALAXY ────────────────────────────────────────────────────────────
class Galaxy(World):
    name = "GALAXY"
    dur = 10.0
    hold = 3.0
    mode = "fade"
    roll = -0.5
    peek = 0.0
    fade = (0.2, 0.85)

    def portal(self, t, pt):
        return 0.0, 0.0, 0.035

    def render(self, X, Y, t, pt, zoom):
        c, s_ = math.cos(0.45), math.sin(0.45)
        xr = X * c - Y * s_
        yr = (X * s_ + Y * c) / 0.58               # tilted disc
        r = np.hypot(xr, yr) + 1e-4
        a = np.arctan2(yr, xr)
        th = a + t * 0.10                          # arms = density wave, rotates rigidly
        ts = a + t * 0.25 / (r + 0.35)             # the gas/stars shear past it
        xx, yy = r * np.cos(ts), r * np.sin(ts)
        spiral = th - 2.3 * np.log(r)
        arm = (0.5 + 0.5 * np.cos(2.0 * spiral)) ** 3
        n = fbm(xx * 4.0, yy * 4.0, 4)
        dust = (0.5 + 0.5 * np.cos(2.0 * spiral - 0.55)) ** 8 * smoothstep(0.06, 0.3, r)
        disk = np.exp(-r / 0.45)
        dens = disk * (0.18 + 1.25 * arm * (0.35 + 0.95 * n)) * (1.0 - 0.65 * dust * n)
        bulge = np.exp(-(r / 0.13) ** 2) * 1.1 + np.exp(-r / 0.02) * 0.9
        knots = smoothstep(0.80, 0.95, vnoise(xx * 26.0, yy * 26.0)) * arm * disk * 2.5
        dens = dens * 1.5
        out = (tint(dens, rgb(0.45, 0.62, 1.0)) + tint(bulge, rgb(1.0, 0.82, 0.52))
               + tint(knots, rgb(1.0, 0.32, 0.62)))
        halo = np.exp(-np.hypot(X, Y) / 0.9) * 0.08
        out = out + tint(halo, rgb(0.5, 0.4, 0.9))
        return out, 1.0


# ── 5. BLACK HOLE ────────────────────────────────────────────────────────
class BlackHole(World):
    name = "BLACK HOLE"
    dur = 11.0
    hold = 3.5
    mode = "mask"
    roll = 0.35
    Rh = 0.26

    def portal(self, t, pt):
        return 0.0, 0.0, self.Rh * 0.97

    def render(self, X, Y, t, pt, zoom):
        Rh = self.Rh
        c, s_ = math.cos(0.1), math.sin(0.1)
        Xt = X * c - Y * s_
        Yt = X * s_ + Y * c
        r = np.hypot(Xt, Yt) + 1e-5
        a = np.arctan2(Yt, Xt)

        # accretion disc (seen almost edge-on)
        dx, dy = Xt, Yt / 0.19
        rd = np.hypot(dx, dy) + 1e-5
        ad = np.arctan2(dy, dx)
        rot = ad - t * 0.9 / (rd ** 1.5 + 0.1)
        n = fbm((rot / TAU) * 24.0, rd * 9.0, 3, period=24)
        band = smoothstep(Rh * 1.25, Rh * 1.7, rd) * smoothstep(1.6, 0.75, rd)
        dop = 1.0 + 0.7 * (-dx / rd)                       # approaching side brighter
        disk = band * (0.3 + 1.2 * n * n) * (0.55 / rd) ** 1.2 * dop
        disk = disk * ~((Yt > 0) & (r < Rh * 1.02))         # far side hidden by the hole

        # gravitationally-lensed image of the far side, wrapped around the shadow
        lr = r - Rh * 1.12
        hn = fbm((a / TAU) * 20.0 - t * 0.5, r * 10.0, 2, period=20)
        halo = (np.exp(-(lr / 0.05) ** 2) + 0.3 * np.exp(-np.clip(lr, 0, None) / 0.12)) * (r > Rh)
        halo = halo * (0.35 + 0.9 * hn) * (1.0 + 0.5 * (-Xt / r)) * (0.55 + 0.45 * np.abs(np.sin(a)))
        ring = np.exp(-((r - Rh * 1.03) / 0.012) ** 2) * 1.4  # photon ring
        shadow = smoothstep(Rh * 0.97, Rh * 1.02, r)
        I = (halo * 0.9 + ring) * shadow + disk
        out = fire(I * 0.9) + tint(ring * shadow * 0.25, rgb(0.6, 0.8, 1.0))
        return out, shadow * clamp01(1.0 - I)


# ════════════════════════════════════════════════════════════════════════
#  backdrop starfield (screen space, streams outward as we zoom forever)
# ════════════════════════════════════════════════════════════════════════
def starfield(X, Y, logz, t):
    r = np.hypot(X, Y) + 1e-5
    a = np.arctan2(Y, X)
    out = np.zeros(X.shape + (3,), F32)
    for N, K, par, seed in ((120, 8.0, 0.22, 1), (220, 14.0, 0.45, 5)):
        u = (a / TAU + 0.5) * N
        v = (np.log(r) - par * logz) * K
        cu = np.floor(u).astype(np.int64) % N
        cv = np.floor(v).astype(np.int64)
        p = np.clip(26.0 * TAU * r * r / (N * K), 0.0, 0.9)
        h = _hash(cu + seed * 1013, cv)
        h2 = _hash(cu + 77, cv + seed * 389)
        arc = ((u - np.floor(u)) - (0.25 + 0.5 * h2)) * TAU * r / N
        rad = ((v - np.floor(v)) - 0.5) * r / K
        tw = 0.65 + 0.35 * np.sin(t * (1.5 + 4.0 * h2) + h2 * 60.0)
        b = (h < p) * np.exp(-(arc * arc + rad * rad) / 0.00022) * (0.35 + 0.9 * h2) * tw
        colr = mix(rgb(0.65, 0.78, 1.0), rgb(1.0, 0.85, 0.7), h2)
        out = out + b[..., None] * colr
    return out


# ════════════════════════════════════════════════════════════════════════
#  ENGINE — runs the infinite zoom and turns colour into glyphs
# ════════════════════════════════════════════════════════════════════════
RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
PALETTES = ["COSMIC", "MATRIX", "AMBER", "INFERNO", "PRISM"]


class Engine:
    def __init__(self):
        self.eye = Eye()
        self.creation = Creation()
        self.worlds = [self.eye, self.creation, BigBang(), Galaxy(), BlackHole()]
        self.cur = 0
        self.pt = -1.6          # start with the eye still closed
        self.t = 0.0
        self.logz_total = 0.0
        self.glitch = 0.0
        self.palette = 0
        self.rng = np.random.default_rng(7)

    # grid ---------------------------------------------------------------
    def set_grid(self, cols, rows, cell_w, cell_h):
        self.cols, self.rows = cols, rows
        aspect = (cols * cell_w) / (rows * cell_h)
        fit = max(1.0, 1.45 / aspect)           # portrait: zoom out so the eye fits
        xs = ((np.arange(cols) + 0.5) - cols / 2.0) * cell_w / (rows * cell_h / 2.0)
        ys = -((np.arange(rows) + 0.5) - rows / 2.0) / (rows / 2.0)
        X, Y = np.meshgrid(xs.astype(F32), ys.astype(F32))
        self.X, self.Y = X * fit, Y * fit
        self.RHO = math.hypot(aspect * fit, fit) * 1.06
        vx = xs / max(abs(xs).max(), 1e-6)
        vig = 1.0 - 0.55 * (vx[None, :] ** 2 * 0.6 + ys[:, None] ** 2 * 0.5)
        self.vignette = np.clip(vig, 0.25, 1.0).astype(F32)[..., None]

    # time ---------------------------------------------------------------
    def advance(self, dt):
        self.t += dt
        self.pt += dt
        self.glitch = max(0.0, self.glitch - dt)
        w = self.worlds[self.cur]
        if self.pt >= w.dur:
            self._switch()

    def skip(self):
        self.pt = self.worlds[self.cur].dur
        self._switch()

    def _switch(self):
        w = self.worlds[self.cur]
        _, _, pr = w.portal(self.t, w.dur)
        self.logz_total += math.log(self.RHO / pr)
        self.pt -= w.dur
        self.cur = (self.cur + 1) % len(self.worlds)
        self.glitch = 0.35

    @property
    def world(self):
        return self.worlds[self.cur]

    def zoom_exponent(self):
        w = self.world
        _, _, pr = w.portal(self.t, self.pt)
        e = w.dive(self.pt)
        return (self.logz_total + e * math.log(self.RHO / pr)) / math.log(10.0)

    # one frame of colour ------------------------------------------------
    def colour(self):
        t, pt = self.t, self.pt
        w = self.worlds[self.cur]
        nxt = self.worlds[(self.cur + 1) % len(self.worlds)]
        s = 0.0 if pt < w.hold else min(1.0, (pt - w.hold) / (w.dur - w.hold))
        e = s * s * (3.0 - 2.0 * s)
        px, py, pr = w.portal(t, pt)
        lnZ = math.log(self.RHO / pr)
        zoom = math.exp(e * lnZ)
        th = w.roll * math.sin(math.pi * e)
        ct, st = math.cos(th), math.sin(th)
        X = self.X * ct - self.Y * st
        Y = self.X * st + self.Y * ct
        ec = 1.0 - (1.0 - e) ** 3                   # camera centres on the portal early
        cx, cy = px * ec, py * ec

        col, sm = w.render(cx + X / zoom, cy + Y / zoom, t, pt, zoom)

        sx, sy = (px - cx) * zoom, (py - cy) * zoom
        rho = pr * zoom
        IX = (X - sx) / rho * self.RHO
        IY = (Y - sy) / rho * self.RHO
        sm = np.broadcast_to(np.asarray(sm, F32), self.X.shape)
        if w.mode == "mask":
            rs = np.hypot(X - sx, Y - sy)
            ed = 0.006 + 0.015 * rho
            m = smoothstep(rho + ed, rho - ed, rs)
            rr_, cc_ = np.nonzero(m > 0)
            if rr_.size:
                r0, r1 = max(rr_.min() - 1, 0), min(rr_.max() + 2, self.rows)
                c0, c1 = max(cc_.min() - 1, 0), min(cc_.max() + 2, self.cols)
                if r1 - r0 >= 2 and c1 - c0 >= 2:
                    box = (slice(r0, r1), slice(c0, c1))
                    icol, ism = nxt.render(IX[box], IY[box], t, pt - w.dur, 1.0)
                    mb = m[box]
                    col[box] = mix(col[box], icol, mb)
                    sm = np.array(sm)
                    sm[box] = sm[box] * (1.0 - mb) + np.asarray(ism, F32) * mb
        else:
            alpha = sstep(w.fade[0], w.fade[1], s)
            wi = alpha + (1.0 - alpha) * w.peek
            if wi > 0.0:
                icol, ism = nxt.render(IX, IY, t, pt - w.dur, 1.0)
                col = col * (1.0 - alpha) + icol * wi
                sm = sm * (1.0 - alpha) + np.asarray(ism, F32) * alpha

        logz = self.logz_total + e * lnZ
        col = col + starfield(X, Y, logz, t) * sm[..., None]
        return col

    # palette + glyph selection -----------------------------------------
    def frame(self, glyph_levels):
        col = self.colour() * self.vignette
        tm = 1.0 - np.exp(-np.clip(col, 0, None) * 1.6)           # tone map
        tm = self._palette(tm)
        L = (tm[..., 0] * 0.30 + tm[..., 1] * 0.55 + tm[..., 2] * 0.15)
        L = clamp01((L - 0.035) * 1.2) ** 0.72            # black point kills grey haze
        # pick the glyph whose ink coverage best matches the brightness
        idx = np.searchsorted(glyph_levels, L).clip(0, len(glyph_levels) - 1)
        # living text: neighbouring glyphs shimmer like the video
        jit = (self.rng.random(idx.shape) < 0.10) * self.rng.integers(-1, 2, idx.shape)
        idx = np.clip(idx + jit * (idx > 1), 0, len(glyph_levels) - 1)
        mx = tm.max(axis=-1, keepdims=True)
        hue = tm / np.maximum(mx, 1e-3)
        fg = clamp01(hue * (0.62 + 0.7 * mx)) * 255.0   # glyph ink carries the brightness
        bloom = tm
        if self.glitch > 0:
            idx, fg, bloom = self._glitch(idx, fg, bloom)
        return idx, fg.astype(np.uint16), bloom

    def _palette(self, tm):
        p = PALETTES[self.palette]
        if p == "COSMIC":
            return tm
        L = (tm[..., 0] * 0.3 + tm[..., 1] * 0.55 + tm[..., 2] * 0.15)[..., None]
        if p == "MATRIX":
            return L * rgb(0.25, 1.0, 0.45)
        if p == "AMBER":
            return L * rgb(1.0, 0.64, 0.18)
        if p == "INFERNO":
            return fire(L[..., 0] * 1.3)
        # PRISM — rotate hue around the grey axis over time
        a = self.t * 0.6
        c, s = math.cos(a), math.sin(a)
        k = 1.0 / 3.0
        sq = math.sqrt(k)
        m = np.array([[c + (1 - c) * k, k * (1 - c) - sq * s, k * (1 - c) + sq * s],
                      [k * (1 - c) + sq * s, c + k * (1 - c), k * (1 - c) - sq * s],
                      [k * (1 - c) - sq * s, k * (1 - c) + sq * s, c + k * (1 - c)]], F32)
        return clamp01(tm @ m.T * 1.15)

    def _glitch(self, idx, fg, bloom):
        idx, fg, bloom = idx.copy(), fg.copy(), bloom.copy()
        n = int(self.rows * 0.25 * (self.glitch / 0.35))
        for row in self.rng.integers(0, self.rows, n):
            sh = int(self.rng.integers(-12, 13))
            idx[row] = np.roll(idx[row], sh)
            fg[row] = np.roll(fg[row], sh, axis=0)
            if self.rng.random() < 0.3:
                idx[row] = self.rng.integers(0, idx.max() + 1, self.cols)
                fg[row] = fg[row][:, [2, 0, 1]]
        return idx, fg, bloom


# ════════════════════════════════════════════════════════════════════════
#  glyph atlas → pixels (pure numpy, fast)
# ════════════════════════════════════════════════════════════════════════
class Atlas:
    def __init__(self, bitmaps, chars):
        """bitmaps: list of uint8 arrays (cell_h, cell_w), one per char."""
        cov = np.array([b.mean() for b in bitmaps], F32)
        order = np.argsort(cov, kind="stable")
        self.chars = "".join(chars[i] for i in order)
        self.glyphs = np.stack([bitmaps[i] for i in order]).astype(np.uint16)
        self.glyphs8 = self.glyphs.astype(np.uint8)
        cov = cov[order]
        cov = (cov - cov[0]) / max(cov[-1] - cov[0], 1e-6)
        # thresholds half-way between successive coverage levels
        self.levels = ((cov[1:] + cov[:-1]) * 0.5).astype(F32)
        self.levels = np.append(self.levels, 2.0)
        self.cell_h, self.cell_w = self.glyphs.shape[1:]

    def mask(self, idx):
        """idx (rows, cols) → grey glyph image (W, H) uint8, x-major (for pygame)."""
        g = self.glyphs8[idx]                                  # rows, cols, ch, cw
        rows, cols = idx.shape
        return g.transpose(1, 3, 0, 2).reshape(cols * self.cell_w, rows * self.cell_h)

    def compose(self, idx, fg):
        """idx (rows, cols), fg (rows, cols, 3) uint16 → image (W, H, 3) uint8, x-major."""
        g = self.glyphs[idx]                                   # rows, cols, ch, cw
        img = (g[..., None] * fg[:, :, None, None, :]) >> 8    # rows, cols, ch, cw, 3
        rows, cols = idx.shape
        return img.astype(np.uint8).transpose(1, 3, 0, 2, 4).reshape(
            cols * self.cell_w, rows * self.cell_h, 3)


# ════════════════════════════════════════════════════════════════════════
#  pygame front-end
# ════════════════════════════════════════════════════════════════════════
def build_atlas_pygame(pygame, size):
    font = None
    for name in ("consolas", "dejavusansmono", "menlo", "couriernew", "liberationmono", "monospace"):
        path = pygame.font.match_font(name, bold=True)
        if path:
            font = pygame.font.Font(path, size)
            break
    if font is None:
        font = pygame.font.Font(None, int(size * 1.4))
    cw, ch = font.size("M")
    cw = max(cw, 3)
    ch = max(font.get_linesize(), 6)
    bitmaps = []
    for c in RAMP:
        surf = pygame.Surface((cw, ch))
        surf.fill((0, 0, 0))
        g = font.render(c, True, (255, 255, 255), (0, 0, 0))
        surf.blit(g, ((cw - g.get_width()) // 2, (ch - g.get_height()) // 2))
        bitmaps.append(pygame.surfarray.array3d(surf)[:, :, 0].T.copy())
    return Atlas(bitmaps, RAMP)


def run(args):
    import pygame

    pygame.init()
    pygame.display.set_caption("EYE OF CREATION")
    flags = pygame.RESIZABLE | (pygame.FULLSCREEN if args.fullscreen else 0)
    W, H = (0, 0) if args.fullscreen else args.size
    screen = pygame.display.set_mode((W, H), flags)
    W, H = screen.get_size()
    clock = pygame.time.Clock()
    hud_font = pygame.font.Font(pygame.font.match_font("consolas,dejavusansmono,menlo,couriernew") or None, 14)

    eng = Engine()
    font_size = args.font
    state = dict(atlas=None, ox=0, oy=0)

    def rebuild():
        atlas = build_atlas_pygame(pygame, font_size)
        cols = max(20, W // atlas.cell_w)
        rows = max(10, H // atlas.cell_h)
        eng.set_grid(cols, rows, atlas.cell_w, atlas.cell_h)
        size = (cols * atlas.cell_w, rows * atlas.cell_h)
        gray = pygame.Surface(size, 0, 8)
        gray.set_palette([(i, i, i) for i in range(256)])
        state.update(atlas=atlas, ox=(W - size[0]) // 2, oy=(H - size[1]) // 2,
                     canvas=pygame.Surface(size).convert(), gray=gray)

    rebuild()
    scan = pygame.Surface((W, H), pygame.SRCALPHA)
    for y in range(0, H, 3):
        pygame.draw.line(scan, (0, 0, 0, 70), (0, y), (W, y))

    paused, show_hud, show_help, use_bloom, crt = False, True, False, True, False
    speed, recording, rec_n, rec_dir = 1.0, False, 0, None
    last_mouse, idle = (0, 0), 0.0
    t_prev = time.perf_counter()

    while True:
        now = time.perf_counter()
        dt = min(now - t_prev, 0.1)
        t_prev = now
        if recording:
            dt = 1.0 / 30.0

        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                pygame.quit()
                return
            if ev.type == pygame.VIDEORESIZE and not args.fullscreen:
                W, H = max(ev.w, 200), max(ev.h, 150)
                screen = pygame.display.set_mode((W, H), flags)
                scan = pygame.Surface((W, H), pygame.SRCALPHA)
                for y in range(0, H, 3):
                    pygame.draw.line(scan, (0, 0, 0, 70), (0, y), (W, y))
                rebuild()
            if ev.type == pygame.MOUSEBUTTONDOWN:
                eng.eye.blink_t = eng.t
            if ev.type == pygame.KEYDOWN:
                k = ev.key
                if k in (pygame.K_ESCAPE, pygame.K_q):
                    pygame.quit()
                    return
                elif k == pygame.K_SPACE:
                    paused = not paused
                elif k == pygame.K_RIGHT:
                    eng.skip()
                elif k == pygame.K_UP:
                    speed = min(4.0, speed * 1.25)
                elif k == pygame.K_DOWN:
                    speed = max(0.1, speed / 1.25)
                elif k in (pygame.K_PLUS, pygame.K_EQUALS, pygame.K_KP_PLUS):
                    font_size = max(6, font_size - 1)   # smaller glyphs = more detail
                    rebuild()
                elif k in (pygame.K_MINUS, pygame.K_KP_MINUS):
                    font_size = min(28, font_size + 1)
                    rebuild()
                elif k == pygame.K_c:
                    eng.palette = (eng.palette + 1) % len(PALETTES)
                elif k == pygame.K_b:
                    use_bloom = not use_bloom
                elif k == pygame.K_g:
                    crt = not crt
                elif k == pygame.K_h:
                    show_hud = not show_hud
                elif k == pygame.K_F1 or ev.unicode == "?":
                    show_help = not show_help
                elif k == pygame.K_s:
                    name = time.strftime("eye_of_creation_%Y%m%d_%H%M%S.png")
                    pygame.image.save(screen, name)
                    print("saved", name)
                elif k == pygame.K_r:
                    recording = not recording
                    if recording:
                        rec_dir = time.strftime("frames_%Y%m%d_%H%M%S")
                        os.makedirs(rec_dir, exist_ok=True)
                        rec_n = 0
                        print("recording to", rec_dir)
                    else:
                        print(f"stopped. make a video with:\n  ffmpeg -framerate 30 -i {rec_dir}/%05d.png "
                              f"-c:v libx264 -pix_fmt yuv420p -crf 17 eye_of_creation.mp4")

        # mouse → gaze / God's hand (wanders by itself when idle)
        mxp, myp = pygame.mouse.get_pos()
        if (mxp, myp) != last_mouse:
            idle, last_mouse = 0.0, (mxp, myp)
        else:
            idle += dt
        tx = (mxp / max(W, 1)) * 2 - 1
        ty = -((myp / max(H, 1)) * 2 - 1)
        if idle > 3.0:
            tx = 0.8 * math.sin(eng.t * 0.37) * math.cos(eng.t * 0.11)
            ty = 0.7 * math.sin(eng.t * 0.53 + 1.0)
        target = np.array([tx, ty])
        sacc = np.array([math.sin(eng.t * 7.1) * math.sin(eng.t * 2.3), math.cos(eng.t * 5.3)]) * 0.03
        eng.eye.gaze += (np.clip(target, -1, 1) + sacc - eng.eye.gaze) * min(1.0, dt * 7.0)
        eng.creation.hand += (np.clip(target, -1, 1) - eng.creation.hand) * min(1.0, dt * 2.5)

        if not paused:
            eng.advance(dt * speed)

        atlas = state["atlas"]
        idx, fg, bloom = eng.frame(atlas.levels)
        canvas, gray = state["canvas"], state["gray"]
        # glyph ink (8-bit grey) × per-cell colour (nearest-upscaled) — all done in C
        pygame.surfarray.blit_array(gray, atlas.mask(idx))
        canvas.blit(gray, (0, 0))
        tint_cells = pygame.surfarray.make_surface(np.ascontiguousarray(fg.astype(np.uint8).transpose(1, 0, 2)))
        canvas.blit(pygame.transform.scale(tint_cells, canvas.get_size()), (0, 0),
                    special_flags=pygame.BLEND_MULT)
        screen.fill((0, 0, 0))
        screen.blit(canvas, (state["ox"], state["oy"]))

        if use_bloom:
            small = pygame.surfarray.make_surface(
                np.ascontiguousarray((clamp01(bloom * 0.5) * 255).astype(np.uint8).transpose(1, 0, 2)))
            small = pygame.transform.smoothscale(small, (max(2, eng.cols // 3), max(2, eng.rows // 3)))
            glow = pygame.transform.smoothscale(small, canvas.get_size())
            screen.blit(glow, (state["ox"], state["oy"]), special_flags=pygame.BLEND_ADD)
        if crt:
            screen.blit(scan, (0, 0))

        if show_hud:
            names = [w.name for w in eng.worlds]
            x = 14
            for i, nm in enumerate(names):
                on = i == eng.cur
                txt = hud_font.render(("> " if on else "  ") + nm, True,
                                      (255, 210, 120) if on else (90, 90, 110))
                screen.blit(txt, (x, 10))
                x += txt.get_width() + 14
            info = (f"ZOOM x10^{eng.zoom_exponent():5.1f}   {PALETTES[eng.palette]}   "
                    f"{clock.get_fps():4.0f} fps   speed {speed:.2f}"
                    + ("   * REC" if recording else "") + ("   || PAUSED" if paused else "") + "   [F1] help")
            screen.blit(hud_font.render(info, True, (120, 140, 170)), (14, H - 24))
        if show_help:
            lines = __doc__.split("controls:")[1].strip("\n").splitlines()
            box = pygame.Surface((560, 22 * len(lines) + 20), pygame.SRCALPHA)
            box.fill((0, 0, 0, 200))
            for i, ln in enumerate(lines):
                box.blit(hud_font.render(ln, True, (220, 220, 230)), (14, 10 + 22 * i))
            screen.blit(box, ((W - 560) // 2, (H - box.get_height()) // 2))

        pygame.display.flip()
        if recording:
            pygame.image.save(screen, os.path.join(rec_dir, f"{rec_n:05d}.png"))
            rec_n += 1
        clock.tick(args.fps)


def main():
    ap = argparse.ArgumentParser(description="EYE OF CREATION — infinite ASCII zoom")
    ap.add_argument("--size", default="1280x720", help="window size, e.g. 1920x1080 or 720x1280")
    ap.add_argument("--font", type=int, default=10, help="glyph size in px (smaller = more detail)")
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--fullscreen", action="store_true")
    args = ap.parse_args()
    args.size = tuple(int(v) for v in args.size.lower().split("x"))
    try:
        run(args)
    except ImportError:
        sys.exit("pygame is missing  ->  pip install pygame-ce numpy")


if __name__ == "__main__":
    main()
