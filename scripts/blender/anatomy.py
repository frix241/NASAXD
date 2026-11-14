"""Procedural, stylised (educational, NOT clinically validated) adult human.

Pure geometry definitions built on sdf.py. Blender axes: +X = body's left,
-Y = front, Z = up, feet on Z = 0, height ~1.76 m.  Every layer is derived
from the same landmark set so all parts share one origin and alignment.
"""
import math
import numpy as np
from sdf import (V, norm, lerp, frame_from_axis, rot_x, rot_z, Part, sphere, ellipsoid,
                 rcone, capsule, rbox, torus, halfspace_below, shell, catmull, tube, custom,
                 smin, smax)

SIDES = (("L", 1.0), ("R", -1.0))

# ------------------------------------------------------------- landmarks

def arm_landmarks(S):
    sh = V((S * 0.185, 0.012, 1.415))
    el = V((S * 0.272, 0.024, 1.135))
    wr = V((S * 0.322, -0.002, 0.897))
    return sh, el, wr


def leg_landmarks(S):
    hip = V((S * 0.088, 0.0, 0.905))
    knee = V((S * 0.097, -0.008, 0.49))
    ankle = V((S * 0.103, 0.028, 0.082))
    return hip, knee, ankle


def hand_frame(S):
    sh, el, wr = arm_landmarks(S)
    dh = norm(wr - el)
    m = np.array([-S, 0.15, 0.0])           # palm faces the thigh, slightly back
    pn = norm(m - np.dot(m, dh) * dh)       # palm normal
    wa = norm(np.cross(dh, pn))             # across the palm
    if wa[1] > 0:                           # thumb / index side towards the front
        wa = -wa
    return wr, dh, pn, wa


def _bend(d, toward, deg):
    t = norm(toward - np.dot(toward, d) * d)
    a = math.radians(deg)
    return norm(math.cos(a) * d + math.sin(a) * t)


def finger_chains(S):
    """Return list of (points, base_radius, tip_radius) for 4 fingers + thumb."""
    wr, dh, pn, wa = hand_frame(S)
    knuckle = wr + 0.088 * dh
    chains = []
    specs = [  # offset across palm, length, base r, back-shift
        (0.026, 0.074, 0.0088, 0.000),
        (0.009, 0.082, 0.0090, -0.002),
        (-0.009, 0.077, 0.0086, 0.000),
        (-0.025, 0.061, 0.0076, 0.008),
    ]
    for off, L, r0, back in specs:
        p = knuckle + off * wa - back * dh
        d = norm(dh + off * 1.6 * wa)
        pts = [p]
        for frac, curl in ((0.46, 9.0), (0.31, 15.0), (0.23, 12.0)):
            d = _bend(d, pn, curl)
            p = p + L * frac * d
            pts.append(p)
        chains.append(([V(q) for q in pts], r0, r0 * 0.78))
    # thumb
    p = wr + 0.022 * dh + 0.026 * wa + 0.006 * pn
    d = norm(0.62 * dh + 0.72 * wa + 0.32 * pn)
    pts = [p]
    for L, curl in ((0.040, 0.0), (0.034, 14.0), (0.029, 12.0)):
        d = _bend(d, pn, curl)
        p = p + L * d
        pts.append(p)
    chains.append(([V(q) for q in pts], 0.0135, 0.0085))
    return chains


def toe_chains(S):
    cx = S * 0.108
    specs = [  # x offset towards midline (-), base y, tip y, base r
        (-0.027, -0.128, -0.192, 0.0125),
        (-0.007, -0.136, -0.184, 0.0085),
        (0.007, -0.130, -0.174, 0.0082),
        (0.019, -0.122, -0.162, 0.0078),
        (0.030, -0.110, -0.148, 0.0072),
    ]
    out = []
    for xo, yb, yt, r in specs:
        x = cx + S * xo
        out.append(([V((x, yb, 0.021)), V((x + S * 0.002, (yb + yt) / 2, 0.018)), V((x + S * 0.003, yt, r * 0.95))], r, r * 0.85))
    return out


def spine_y(z):
    zs = [0.84, 0.88, 0.95, 0.99, 1.06, 1.15, 1.25, 1.35, 1.44, 1.50, 1.57]
    ys = [0.060, 0.068, 0.058, 0.040, 0.030, 0.042, 0.052, 0.048, 0.030, 0.020, 0.012]
    return float(np.interp(z, zs, ys))


# ------------------------------------------------------------- skin

def skin_part():
    """Returns (Part, tags) where tags[i] in body/head/hand/foot/neck for each op."""
    P = Part("skin")
    tags = []

    def add(prims, k, tag):
        for p in (prims if isinstance(prims, list) else [prims]):
            P.ops.append(("add", p, k))
            tags.append(tag)

    def sub(prims, k, tag):
        for p in (prims if isinstance(prims, list) else [prims]):
            P.ops.append(("sub", p, k))
            tags.append(tag)

    # torso
    add(ellipsoid((0, -0.004, 1.31), (0.158, 0.106, 0.175)), 0.0, "body")
    add(ellipsoid((0, -0.018, 1.405), (0.135, 0.085, 0.055)), 0.05, "body")
    add(rcone((-0.15, 0.01, 1.43), (0.15, 0.01, 1.43), 0.058, 0.058), 0.06, "body")
    for name, S in SIDES:
        add(ellipsoid((S * 0.066, -0.074, 1.335), (0.072, 0.04, 0.058)), 0.045, "body")      # pec mass
        add(rcone((0, 0.025, 1.50), (S * 0.16, 0.02, 1.435), 0.045, 0.042), 0.05, "body")   # trapezius
        add(ellipsoid((S * 0.105, 0.06, 1.22), (0.055, 0.05, 0.12)), 0.06, "body")          # lats
    add(ellipsoid((0, -0.004, 1.09), (0.13, 0.098, 0.15)), 0.08, "body")                    # abdomen
    add(ellipsoid((0, 0.004, 0.95), (0.168, 0.108, 0.13)), 0.07, "body")                    # pelvis
    for name, S in SIDES:
        add(ellipsoid((S * 0.072, 0.062, 0.88), (0.075, 0.06, 0.08)), 0.05, "body")          # glutes
    sub(sphere((0, -0.107, 1.03), 0.0065), 0.004, "body")                                   # navel

    # neck + head
    add(rcone((0, 0.004, 1.44), (0, 0.012, 1.56), 0.06, 0.05), 0.035, "neck")
    add(ellipsoid((0, 0.008, 1.645), (0.074, 0.093, 0.095)), 0.0, "head")
    add(ellipsoid((0, -0.03, 1.578), (0.058, 0.064, 0.07)), 0.03, "head")                   # face / jaw
    add(sphere((0, -0.068, 1.532), 0.022), 0.022, "head")                                   # chin
    add(rcone((0, -0.092, 1.628), (0, -0.108, 1.597), 0.0065, 0.0125), 0.012, "head")       # nose
    add(capsule((-0.032, -0.083, 1.657), (0.032, -0.083, 1.657), 0.012), 0.016, "head")     # brow
    for name, S in SIDES:
        add(sphere((S * 0.045, -0.058, 1.597), 0.025), 0.02, "head")                        # cheek
        add(ellipsoid((S * 0.076, 0.006, 1.622), (0.011, 0.02, 0.029)), 0.008, "head")      # ear
        sub(sphere((S * 0.032, -0.097, 1.636), 0.0135), 0.009, "head")                      # eye socket
        add(ellipsoid((S * 0.032, -0.086, 1.636), (0.012, 0.007, 0.0075)), 0.004, "head")   # eyelid/eye
    add(ellipsoid((0, -0.091, 1.566), (0.021, 0.009, 0.0085)), 0.008, "head")               # lips

    # arms + hands
    for name, S in SIDES:
        sh, el, wr = arm_landmarks(S)
        ua = norm(el - sh)
        fa = norm(wr - el)
        add(ellipsoid((S * 0.198, 0.008, 1.395), (0.052, 0.056, 0.07)), 0.035, "body")      # deltoid
        add(rcone(sh + V((0, 0, -0.02)), el, 0.046, 0.035), 0.04, "body")
        add(ellipsoid(lerp(sh, el, 0.5) + V((0, -0.012, 0)), (0.033, 0.034, 0.08), frame_from_axis(ua)), 0.03, "body")
        add(sphere(el, 0.035), 0.02, "body")
        add(rcone(el, wr, 0.037, 0.0245), 0.03, "body")
        add(ellipsoid(lerp(el, wr, 0.3), (0.04, 0.035, 0.07), frame_from_axis(fa)), 0.03, "body")
        wr_, dh, pn, wa = hand_frame(S)
        R = np.array([wa, pn, dh], dtype=np.float32)
        add(rcone(wr, wr + 0.04 * dh, 0.024, 0.022), 0.012, "hand")
        add(ellipsoid(wr + 0.052 * dh, (0.040, 0.0135, 0.046), R), 0.012, "hand")            # palm
        add(ellipsoid(wr + 0.03 * dh + 0.02 * wa + 0.008 * pn, (0.016, 0.014, 0.026), R), 0.012, "hand")  # thenar
        for pts, r0, r1 in finger_chains(S):
            add(tube(pts, [r0, r0 * 0.93, r0 * 0.86, r1]), 0.0045, "hand")

    # legs + feet
    for name, S in SIDES:
        hip, knee, ankle = leg_landmarks(S)
        add(rcone(hip + V((S * 0.012, 0.0, 0.01)), knee, 0.088, 0.05), 0.05, "body")
        add(ellipsoid((S * 0.106, -0.036, 0.70), (0.055, 0.05, 0.14)), 0.045, "body")      # quads
        add(ellipsoid((S * 0.095, 0.035, 0.68), (0.055, 0.048, 0.13)), 0.045, "body")      # hamstrings
        add(sphere(knee + V((0, -0.006, 0)), 0.048), 0.03, "body")
        add(rcone(knee, ankle, 0.047, 0.03), 0.035, "body")
        add(ellipsoid((S * 0.103, 0.035, 0.36), (0.046, 0.044, 0.095)), 0.04, "body")      # calf
        add(sphere(ankle + V((0, 0.0, 0.004)), 0.032), 0.02, "foot")
        add(ellipsoid((S * 0.103, 0.045, 0.038), (0.032, 0.042, 0.04)), 0.02, "foot")      # heel
        add(ellipsoid((S * 0.108, -0.05, 0.032), (0.043, 0.09, 0.033)), 0.03, "foot")      # foot body
        add(rcone((S * 0.103, 0.02, 0.07), (S * 0.11, -0.095, 0.03), 0.032, 0.024), 0.03, "foot")
        for pts, r0, r1 in toe_chains(S):
            add(tube(pts, [r0, r0 * 0.92, r1]), 0.006, "foot")
    sub(halfspace_below(0.0, (-0.3, -0.3, -0.08), (0.3, 0.2, 0.0)), 0.0, "foot")          # flat soles
    return P, tags


def skin_inner(margin):
    """SDF evaluator of the skin shrunk by margin (negative inside)."""
    P, _ = skin_part()
    return P, margin


# ------------------------------------------------------------- suit

def suit_body_part():
    skin, tags = skin_part()
    inflate = {"body": 0.011, "neck": 0.012, "hand": 0.0042, "foot": 0.013, "head": None}
    S = Part("suit_body")
    for (kind, p, k), tag in zip(skin.ops, tags):
        if tag == "head":
            continue
        if kind == "add":
            S.ops.append((kind, p.inflate(inflate[tag]), k))
        else:
            S.ops.append((kind, p, k))
    # cut neck opening under the helmet ring
    S.ops.append(("sub", custom(lambda P: 1.502 - P[:, 2], (-0.12, -0.12, 1.502), (0.12, 0.12, 1.62)), 0.004))
    return S


HELMET_C = V((0, -0.008, 1.628))
HELMET_R = 0.150


def helmet_part():
    H = Part("suit_helmet")
    sh = shell(sphere(HELMET_C, HELMET_R), 0.0045)
    H.add(sh)
    H.sub(custom(lambda P: P[:, 2] - 1.505, (-0.2, -0.2, 1.40), (0.2, 0.2, 1.505)), 0.0)
    H.sub(visor_region(), 0.004)
    H.add(torus((0, -0.002, 1.503), 0.088, 0.013), 0.006)          # neck ring
    for S in (1, -1):                                             # side lamps
        H.add(capsule((S * 0.148, -0.03, 1.66), (S * 0.148, 0.03, 1.66), 0.011), 0.008)
    return H


def visor_region():
    return ellipsoid((0, -0.16, 1.618), (0.112, 0.12, 0.066))


def visor_part():
    Vp = Part("suit_visor")
    Vp.add(shell(sphere(HELMET_C, HELMET_R + 0.0015), 0.0035))
    Vp.inter(visor_region(), 0.002)
    return Vp


# ------------------------------------------------------------- skeleton

def skeleton_parts():
    parts = {}
    # skull (hollow cranium)
    sk = Part("skeleton_skull")
    sk.add(shell(ellipsoid((0, 0.008, 1.648), (0.066, 0.083, 0.083)), 0.0032))
    sk.sub(custom(lambda P: P[:, 2] - 1.585, (-0.08, -0.03, 1.55), (0.08, 0.1, 1.585)), 0.006)  # foramen / base opening
    sk.add(ellipsoid((0, -0.045, 1.588), (0.047, 0.042, 0.048)), 0.012)                       # maxilla / face
    for S in (1, -1):
        sk.add(capsule((S * 0.03, -0.07, 1.6), (S * 0.064, -0.02, 1.605), 0.008), 0.008)      # zygomatic
        sk.sub(sphere((S * 0.03, -0.087, 1.633), 0.0185), 0.005)                              # orbit
    sk.sub(ellipsoid((0, -0.088, 1.6), (0.01, 0.02, 0.014)), 0.003)                           # nasal aperture
    jaw = catmull([(-0.056, 0.012, 1.6), (-0.05, -0.005, 1.548), (-0.03, -0.05, 1.528), (0, -0.067, 1.526),
                   (0.03, -0.05, 1.528), (0.05, -0.005, 1.548), (0.056, 0.012, 1.6)], 6)
    sk.add(tube(jaw, 0.0085), 0.004)
    sk.add(ellipsoid((0, -0.065, 1.555), (0.034, 0.012, 0.012)), 0.006)                       # teeth row
    parts["skull"] = (sk, 0.0016, 9000)

    # spine
    sp = Part("skeleton_spine")
    zs = list(np.linspace(1.565, 1.455, 7)) + list(np.linspace(1.43, 1.155, 12)) + list(np.linspace(1.13, 0.995, 5))
    for i, z in enumerate(zs):
        y = spine_y(z)
        if i < 7:
            rb, h, proc, sp_len, sp_r = 0.0095, 0.0055, 0.022, 0.028, 0.0035
        elif i < 19:
            t = (i - 7) / 11
            rb, h, proc, sp_len, sp_r = 0.012 + 0.006 * t, 0.007 + 0.002 * t, 0.028, 0.036, 0.0042
        else:
            rb, h, proc, sp_len, sp_r = 0.02, 0.0095, 0.034, 0.038, 0.0058
        c = V((0, y, z))
        sp.add(ellipsoid(c, (rb * 1.15, rb, h)), 0.003)
        sp.add(capsule(c + V((0, rb * 0.8, 0)), c + V((0, rb + sp_len, -0.012)), sp_r), 0.004)       # spinous
        sp.add(capsule(c + V((-proc, rb * 0.9, 0.001)), c + V((proc, rb * 0.9, 0.001)), 0.0038), 0.004)  # transverse
        if i + 1 < len(zs):
            z2 = zs[i + 1]
            sp.add(ellipsoid(V((0, (y + spine_y(z2)) / 2, (z + z2) / 2)), (rb * 0.95, rb * 0.85, abs(z - z2) * 0.5)), 0.002)  # disc
    sp.add(ellipsoid((0, 0.058, 0.935), (0.042, 0.016, 0.058), rot_x(-25)), 0.008)                # sacrum
    sp.add(rcone((0, 0.052, 0.99), (0, 0.06, 0.96), 0.02, 0.03), 0.006)
    sp.add(rcone((0, 0.075, 0.882), (0, 0.068, 0.852), 0.007, 0.004), 0.004)                      # coccyx
    parts["spine"] = (sp, 0.0016, 9000)

    # rib cage, sternum, clavicles, scapulae
    rc = Part("skeleton_ribcage")
    A = [0.055, 0.084, 0.103, 0.116, 0.124, 0.128, 0.130, 0.128, 0.122, 0.113, 0.102, 0.088]
    B = [0.045, 0.057, 0.066, 0.071, 0.074, 0.075, 0.075, 0.074, 0.072, 0.069, 0.065, 0.058]
    ends = []
    for i in range(12):
        z0 = 1.425 - 0.0225 * i
        yb = spine_y(z0) + 0.014
        a, b = A[i], B[i]
        drop = 0.035 + 0.0065 * min(i, 7)
        if i < 7:
            phi_end = math.pi - math.asin(0.017 / a)
        elif i < 10:
            phi_end = 0.86 * math.pi
        else:
            phi_end = (0.62 if i == 10 else 0.5) * math.pi
        for S in (1, -1):
            pts = []
            phi0 = math.asin(min(0.02 / a, 0.9))
            n = 16
            for j in range(n + 1):
                phi = phi0 + (phi_end - phi0) * j / n
                u = (phi - phi0) / (math.pi - phi0)
                x = S * a * math.sin(phi)
                y = yb - b * (1 - math.cos(phi))
                z = z0 - drop * (u ** 1.3)
                pts.append(V((x, y, z)))
            pts = [V((S * 0.012, spine_y(z0) + 0.012, z0 + 0.002))] + pts
            r = 0.0048 if i else 0.0055
            rc.add(tube(pts, lambda t: r * (1.0 - 0.15 * t)), 0.002)
            if S == 1:
                ends.append(pts[-1])
    rc.add(ellipsoid((0, -0.083, 1.305), (0.016, 0.0065, 0.095), rot_x(-8)), 0.006)             # sternum
    rc.add(ellipsoid((0, -0.077, 1.395), (0.024, 0.008, 0.02)), 0.008)                          # manubrium
    for S in (1, -1):
        cl = catmull([(S * 0.018, -0.078, 1.418), (S * 0.07, -0.072, 1.432), (S * 0.125, -0.05, 1.442), (S * 0.168, 0.002, 1.444)], 6)
        rc.add(tube(cl, 0.0062), 0.003)                                                         # clavicle
        rc.add(ellipsoid((S * 0.088, 0.072, 1.325), (0.045, 0.006, 0.072), rot_z(S * 22)), 0.004)  # scapula
        rc.add(rcone((S * 0.055, 0.079, 1.365), (S * 0.168, 0.012, 1.442), 0.005, 0.009), 0.006)  # scapular spine / acromion
        rc.add(sphere((S * 0.163, 0.014, 1.412), 0.013), 0.006)                                  # glenoid
        rc.add(rcone((S * 0.13, 0.04, 1.4), (S * 0.163, 0.014, 1.412), 0.009, 0.011), 0.006)
        for i in range(7, 10):                                                                   # costal cartilage
            e = ends[i]
            rc.add(tube(catmull([(S * abs(e[0]), e[1], e[2]), (S * 0.05, -0.08, 1.215), (S * 0.016, -0.084, 1.212)], 4), 0.0042), 0.002)
    parts["ribcage"] = (rc, 0.0016, 15000)

    # pelvis
    pv = Part("skeleton_pelvis")
    for S in (1, -1):
        bowl = shell(sphere((S * 0.015, 0.0, 1.065), 0.115), 0.0028)
        region = rbox((S * 0.092, 0.003, 0.99), (0.05, 0.056, 0.047), 0.0)
        pv.add(custom(lambda P, bowl=bowl, region=region: np.maximum(bowl.fn(P), region.fn(P)),
                      np.maximum(bowl.lo, region.lo), np.minimum(bowl.hi, region.hi)), 0.0)
        pv.add(capsule((S * 0.06, 0.004, 0.958), (S * 0.08, 0.0, 0.915), 0.013), 0.008)          # ilium body
        pv.add(sphere((S * 0.075, 0.0, 0.905), 0.019), 0.006)                                     # acetabulum
        pv.add(tube(catmull([(S * 0.075, -0.006, 0.9), (S * 0.045, -0.04, 0.888), (S * 0.006, -0.055, 0.883)], 5), 0.0075), 0.003)
        pv.add(tube(catmull([(S * 0.075, 0.006, 0.895), (S * 0.068, 0.016, 0.862), (S * 0.055, 0.01, 0.838),
                             (S * 0.035, -0.02, 0.848), (S * 0.02, -0.048, 0.874)], 5), 0.0078), 0.003)
        pv.add(capsule((S * 0.028, 0.055, 0.965), (S * 0.077, 0.05, 0.985), 0.011), 0.006)         # sacro-iliac
    parts["pelvis"] = (pv, 0.0016, 6000)

    # limbs
    for name, S in SIDES:
        sh, el, wr = arm_landmarks(S)
        ua = norm(el - sh)
        fa = norm(wr - el)
        ar = Part(f"skeleton_arm_{name}")
        ar.add(sphere(sh, 0.0215))
        ar.add(rcone(sh + 0.02 * ua, el - 0.012 * ua, 0.0115, 0.0098), 0.008)
        ar.add(ellipsoid(el, (0.026, 0.013, 0.012), np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=np.float32)), 0.008)
        back = norm(V((0, 1, 0)) - np.dot(V((0, 1, 0)), fa) * fa)
        ar.add(rcone(el + 0.008 * back - 0.006 * fa, wr + 0.009 * back, 0.0075, 0.0052), 0.004)   # ulna
        ar.add(rcone(el - 0.006 * back + 0.004 * fa, wr - 0.008 * back, 0.0062, 0.0085), 0.004)   # radius
        parts[f"arm_{name}"] = (ar, 0.0018, 3500)

        hd = Part(f"skeleton_hand_{name}")
        wr_, dh, pn, wa = hand_frame(S)
        carp = wr + 0.018 * dh
        hd.add(ellipsoid(carp, (0.021, 0.008, 0.013), np.array([wa, pn, dh], dtype=np.float32)))
        hd.add(rcone(wr - 0.008 * back, carp, 0.007, 0.008), 0.003)
        for idx, (pts, r0, r1) in enumerate(finger_chains(S)):
            if idx < 4:
                hd.add(capsule(carp + (pts[0] - carp) * 0.25, pts[0] - 0.004 * dh, 0.0036), 0.002)  # metacarpal
                hd.add(tube(pts, [0.0036, 0.0032, 0.0028, 0.0024]), 0.0015)
            else:
                hd.add(tube(pts, [0.0045, 0.004, 0.0034, 0.0028]), 0.0015)
        parts[f"hand_{name}"] = (hd, 0.0011, 4500)

        hip, knee, ankle = leg_landmarks(S)
        lg = Part(f"skeleton_leg_{name}")
        lg.add(sphere(hip + V((-S * 0.002, 0, 0)), 0.023))
        lg.add(rcone(hip, V((S * 0.126, 0.006, 0.885)), 0.014, 0.016), 0.006)
        lg.add(sphere((S * 0.13, 0.008, 0.888), 0.017), 0.008)
        lg.add(rcone(V((S * 0.122, 0.004, 0.87)), V((S * 0.098, 0.0, 0.53)), 0.0135, 0.013), 0.008)
        lg.add(ellipsoid((S * 0.097, 0.004, 0.506), (0.035, 0.026, 0.021)), 0.012)                # condyles
        lg.add(ellipsoid((S * 0.097, -0.028, 0.497), (0.019, 0.0085, 0.022)), 0.003)              # patella
        lg.add(ellipsoid((S * 0.097, 0.005, 0.478), (0.035, 0.027, 0.014)), 0.004)                # tibial plateau
        lg.add(rcone(V((S * 0.097, 0.004, 0.47)), V((S * 0.101, 0.022, 0.085)), 0.0145, 0.0115), 0.008)
        lg.add(sphere((S * 0.09, 0.022, 0.082), 0.0125), 0.004)                                    # medial malleolus
        lg.add(rcone(V((S * 0.118, 0.012, 0.47)), V((S * 0.117, 0.03, 0.09)), 0.0085, 0.006), 0.004)  # fibula
        lg.add(sphere((S * 0.117, 0.032, 0.08), 0.0105), 0.004)
        parts[f"leg_{name}"] = (lg, 0.0018, 4000)

        ft = Part(f"skeleton_foot_{name}")
        ft.add(ellipsoid((S * 0.103, 0.026, 0.062), (0.019, 0.024, 0.015)))                        # talus
        ft.add(ellipsoid((S * 0.104, 0.048, 0.034), (0.017, 0.032, 0.019), rot_x(-15)), 0.006)     # calcaneus
        ft.add(ellipsoid((S * 0.106, -0.022, 0.045), (0.027, 0.02, 0.014)), 0.006)                 # tarsals
        for pts, r0, r1 in toe_chains(S):
            base = V((S * 0.106 + (pts[0][0] - S * 0.106) * 0.5, -0.03, 0.043))
            rr = 0.0055 if r0 > 0.01 else 0.0036
            ft.add(capsule(base, pts[0], rr), 0.002)                                                # metatarsal
            ft.add(tube(pts, [rr * 0.95, rr * 0.85, rr * 0.75]), 0.0015)
        parts[f"foot_{name}"] = (ft, 0.0013, 3500)
    return parts


# ------------------------------------------------------------- organs

HEART_C = V((0.02, -0.04, 1.268))
HEART_AX = norm((0.5, -0.42, -0.76))


def heart_part():
    H = Part("heart")
    H.add(ellipsoid(HEART_C, (0.037, 0.034, 0.055), frame_from_axis(HEART_AX)))
    H.add(sphere(HEART_C + 0.046 * HEART_AX, 0.02), 0.025)
    H.add(sphere((-0.006, -0.022, 1.302), 0.025), 0.018)          # right atrium
    H.add(sphere((0.032, -0.006, 1.305), 0.021), 0.018)           # left atrium
    H.add(tube(catmull([(0.008, -0.035, 1.3), (0.006, -0.03, 1.345), (-0.002, 0.0, 1.37), (0.012, 0.028, 1.356), (0.018, 0.03, 1.3), (0.02, 0.032, 1.235)], 5), 0.0105), 0.006)
    H.add(tube(catmull([(0.026, -0.052, 1.29), (0.022, -0.042, 1.335), (0.0, -0.022, 1.345), (-0.038, -0.006, 1.335)], 5), 0.0085), 0.005)
    H.add(tube(catmull([(0.022, -0.042, 1.335), (0.048, -0.01, 1.338)], 4), 0.0075), 0.004)
    H.add(capsule((-0.016, -0.016, 1.3), (-0.016, -0.008, 1.385), 0.0085), 0.006)   # superior vena cava
    return H


def lungs_part():
    L = Part("lungs")
    L.add(ellipsoid((-0.068, 0.012, 1.31), (0.055, 0.071, 0.112)))
    L.add(sphere((-0.055, 0.008, 1.395), 0.034), 0.035)
    L.add(ellipsoid((0.07, 0.016, 1.312), (0.05, 0.069, 0.108)), 0.0)
    L.add(sphere((0.056, 0.01, 1.395), 0.032), 0.035)
    L.sub(ellipsoid(HEART_C, (0.047, 0.045, 0.066), frame_from_axis(HEART_AX)), 0.012)
    L.sub(rbox((0, 0.0, 1.30), (0.012, 0.2, 0.25)), 0.01)
    L.sub(capsule((0, 0.05, 1.1), (0, 0.04, 1.5), 0.026), 0.01)
    L.sub(sphere((-0.04, -0.01, 1.075), 0.125), 0.02)            # right diaphragm dome
    L.sub(sphere((0.05, -0.01, 1.065), 0.125), 0.02)             # left diaphragm dome
    L.add(capsule((0, -0.012, 1.505), (0, -0.01, 1.365), 0.0085), 0.004)   # trachea
    for S in (1, -1):
        L.add(tube(catmull([(0, -0.01, 1.365), (S * 0.035, -0.002, 1.34), (S * 0.058, 0.008, 1.31)], 4), [0.0072, 0.0058, 0.0045]), 0.004)
    return L


def brain_part():
    B = Part("brain")
    base = ellipsoid((0, 0.008, 1.657), (0.058, 0.074, 0.066))
    a = 2 * math.pi / 0.024

    def gyri(P, base=base):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        n = (np.sin(a * x + 1.7 * np.sin(a * 0.5 * z)) * np.sin(a * y + 0.9) * np.sin(a * z + 0.4)
             + 0.5 * np.sin(1.9 * a * y + 2.0 * np.sin(a * 0.6 * x)) * np.sin(1.7 * a * z))
        return base.fn(P) + 0.0019 * n

    B.add(custom(gyri, base.lo - 0.004, base.hi + 0.004))
    B.sub(rbox((0, 0.008, 1.72), (0.0016, 0.09, 0.06)), 0.002)           # longitudinal fissure
    B.add(ellipsoid((0, 0.052, 1.605), (0.046, 0.026, 0.022)), 0.006)    # cerebellum
    B.add(rcone((0, 0.02, 1.625), (0, 0.03, 1.555), 0.012, 0.009), 0.008)  # brainstem
    return B


def digestive_part():
    D = Part("digestive")
    D.add(tube(catmull([(0, 0.022, 1.5), (0.004, 0.024, 1.36), (0.018, 0.016, 1.235), (0.032, -0.018, 1.2)], 5), 0.0065), 0.003)  # esophagus
    stomach = catmull([(0.032, -0.02, 1.2), (0.068, -0.03, 1.185), (0.082, -0.045, 1.14), (0.058, -0.06, 1.102), (0.018, -0.06, 1.106), (-0.018, -0.05, 1.12)], 5)
    D.add(tube(stomach, [0.024, 0.033, 0.032, 0.026, 0.017, 0.011]), 0.012)
    D.add(ellipsoid((-0.052, -0.022, 1.152), (0.082, 0.062, 0.042), rot_z(-8)), 0.01)   # liver
    D.add(ellipsoid((0.012, -0.045, 1.168), (0.038, 0.032, 0.022)), 0.015)
    colon = catmull([(-0.078, -0.028, 0.935), (-0.088, -0.03, 1.02), (-0.084, -0.035, 1.085), (-0.06, -0.05, 1.098), (0.0, -0.062, 1.078),
                     (0.06, -0.05, 1.1), (0.086, -0.03, 1.088), (0.09, -0.022, 1.0), (0.08, -0.03, 0.93), (0.04, -0.035, 0.905), (0.005, 0.0, 0.89), (0.0, 0.03, 0.87)], 10)
    D.add(tube(colon, lambda t: 0.0145 + 0.0028 * math.sin(t * 2 * math.pi * 26)), 0.004)
    # small intestine: two serpentine layers
    for layer, (y0, ph) in enumerate(((-0.05, 0.0), (-0.022, 0.5))):
        pts = []
        n = 260
        for j in range(n + 1):
            u = 5.0 * j / n
            x = 0.052 * math.cos(math.pi * (u + ph))
            z = 1.045 - 0.023 * u - 0.006 * layer
            y = y0 + 0.008 * math.sin(math.pi * 1.5 * u + layer)
            pts.append(V((x, y, z)))
        D.add(tube(pts[::2], 0.0105), 0.003)
    return D


def kidneys_part():
    K = Part("kidneys")
    for S in (1, -1):
        c = V((S * 0.062, 0.056, 1.07 - (0.008 if S < 0 else 0)))
        K.add(ellipsoid(c, (0.021, 0.017, 0.048), rot_z(S * 12)))
        K.sub(sphere(c + V((-S * 0.026, -0.004, 0)), 0.012), 0.006)
    return K


ANCHORS = {
    "heart": (0.02, -0.04, 1.27),
    "lungs": (0.0, 0.0, 1.31),
    "brain": (0.0, 0.008, 1.66),
    "digestive": (0.0, -0.04, 1.06),
    "suit": (0.0, -0.13, 1.30),
}


# ------------------------------------------------------------- muscles (shell over skin)

MUSCLES = []  # (name, regions[list of Prim], top, bottom)


def _m(name, regions, top=0.006, bottom=0.011):
    MUSCLES.append((name, regions if isinstance(regions, list) else [regions], top, bottom))


def define_muscles():
    MUSCLES.clear()
    for name, S in SIDES:
        sh, el, wr = arm_landmarks(S)
        hip, knee, ankle = leg_landmarks(S)
        ua = norm(el - sh)
        fa = norm(wr - el)
        _m(f"muscle_pectoral_{name}", ellipsoid((S * 0.078, -0.1, 1.338), (0.074, 0.07, 0.058), rot_x(0)), 0.007, 0.012)
        _m(f"muscle_deltoid_{name}", ellipsoid((S * 0.205, 0.004, 1.39), (0.058, 0.075, 0.075)), 0.006, 0.012)
        mid = lerp(sh, el, 0.55)
        _m(f"muscle_biceps_{name}", ellipsoid(mid + V((0, -0.04, 0)), (0.028, 0.034, 0.085), frame_from_axis(ua)), 0.006, 0.012)
        _m(f"muscle_triceps_{name}", ellipsoid(mid + V((0, 0.042, 0.01)), (0.03, 0.034, 0.1), frame_from_axis(ua)), 0.006, 0.011)
        _m(f"muscle_forearm_{name}", ellipsoid(lerp(el, wr, 0.32), (0.06, 0.06, 0.075), frame_from_axis(fa)), 0.005, 0.009)
        _m(f"muscle_obliques_{name}", ellipsoid((S * 0.118, -0.055, 1.085), (0.045, 0.07, 0.085)), 0.005, 0.009)
        _m(f"muscle_latissimus_{name}", ellipsoid((S * 0.115, 0.085, 1.22), (0.065, 0.06, 0.11)), 0.005, 0.009)
        _m(f"muscle_gluteus_{name}", ellipsoid((S * 0.075, 0.095, 0.885), (0.075, 0.07, 0.085)), 0.007, 0.012)
        _m(f"muscle_quadriceps_{name}", [
            ellipsoid((S * 0.098, -0.075, 0.70), (0.032, 0.06, 0.165)),     # rectus femoris
            ellipsoid((S * 0.15, -0.025, 0.68), (0.036, 0.06, 0.15)),       # vastus lateralis
            ellipsoid((S * 0.06, -0.05, 0.585), (0.033, 0.05, 0.08)),       # vastus medialis
        ], 0.007, 0.012)
        _m(f"muscle_hamstrings_{name}", ellipsoid((S * 0.097, 0.075, 0.68), (0.055, 0.05, 0.16)), 0.006, 0.011)
        _m(f"muscle_gastrocnemius_{name}", [
            ellipsoid((S * 0.085, 0.07, 0.375), (0.024, 0.05, 0.09)),
            ellipsoid((S * 0.122, 0.068, 0.385), (0.024, 0.05, 0.085)),
        ], 0.007, 0.012)
        _m(f"muscle_tibialis_{name}", ellipsoid((S * 0.112, -0.045, 0.33), (0.02, 0.04, 0.12)), 0.004, 0.008)
    _m("muscle_trapezius", [ellipsoid((0, 0.1, 1.42), (0.16, 0.07, 0.07)), ellipsoid((0, 0.1, 1.33), (0.045, 0.06, 0.1))], 0.006, 0.01)
    rows = [(1.215, 0.024), (1.155, 0.024), (1.095, 0.024), (1.012, 0.046)]
    regs = []
    for zc, hz in rows:
        for S in (1, -1):
            regs.append(ellipsoid((S * 0.032, -0.105, zc), (0.027, 0.06, hz)))
    _m("muscle_abdomen", regs, 0.006, 0.01)
    return MUSCLES
