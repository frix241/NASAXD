"""Small signed-distance-field toolkit used by build_astrotwin.py.

Everything is plain numpy (bundled with Blender) + the OpenVDB python module
bundled with Blender 4.x/5.x.  Distances are in metres.  Blender axes:
X = lateral (+X is the body's LEFT), -Y = front, Z = up, feet on Z=0.
"""
import math
import numpy as np

F = np.float32


def V(a):
    return np.asarray(a, dtype=F)


def norm(v):
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v)
    return (v / n) if n > 0 else v


def lerp(a, b, t):
    return V(a) * (1 - t) + V(b) * t


def frame_from_axis(axis, hint=(0.0, -1.0, 0.0)):
    """Rotation matrix whose rows are local x, y, z with local z == axis."""
    z = norm(axis)
    h = np.asarray(hint, dtype=np.float64)
    if abs(np.dot(h, z)) > 0.95:
        h = np.array([1.0, 0.0, 0.0])
    x = norm(np.cross(h, z))
    y = np.cross(z, x)
    return np.array([x, y, z], dtype=F)


def rot_x(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=F)


def rot_z(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=F)


class Prim:
    __slots__ = ("fn", "lo", "hi")

    def __init__(self, fn, lo, hi):
        self.fn = fn
        self.lo = V(lo)
        self.hi = V(hi)

    def inflate(self, d):
        fn = self.fn
        return Prim(lambda P: fn(P) - d, self.lo - d, self.hi + d)


def sphere(c, r):
    c = V(c)
    return Prim(lambda P: np.sqrt(((P - c) ** 2).sum(-1)) - r, c - r, c + r)


def ellipsoid(c, r, R=None):
    c = V(c)
    r = V(r)
    R = None if R is None else V(R)

    def fn(P):
        q = P - c
        if R is not None:
            q = q @ R.T
        k0 = np.sqrt(((q / r) ** 2).sum(-1))
        k1 = np.sqrt(((q / (r * r)) ** 2).sum(-1))
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

    e = r if R is None else np.full(3, float(r.max()), F)
    return Prim(fn, c - e, c + e)


def rcone(a, b, ra, rb):
    """Exact round-cone (tapered capsule) SDF (Inigo Quilez)."""
    a = V(a)
    b = V(b)
    ba = b - a
    l2 = float(ba @ ba)
    rr = float(ra - rb)
    a2 = l2 - rr * rr
    if a2 <= 0:
        raise ValueError("round cone too short for radii")
    il2 = 1.0 / l2
    srr = float(np.sign(rr))

    def fn(P):
        pa = P - a
        y = pa @ ba
        z = y - l2
        w = pa * l2 - y[:, None] * ba
        x2 = (w * w).sum(-1)
        y2 = y * y * l2
        z2 = z * z * l2
        k = srr * rr * rr * x2
        d1 = np.sqrt(x2 + z2) * il2 - rb
        d2 = np.sqrt(x2 + y2) * il2 - ra
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - ra
        return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))

    lo = np.minimum(a - ra, b - rb)
    hi = np.maximum(a + ra, b + rb)
    return Prim(fn, lo, hi)


def capsule(a, b, r):
    return rcone(a, b, r, r)


def rbox(c, h, rad=0.0, R=None):
    c = V(c)
    h = V(h)
    R = None if R is None else V(R)

    def fn(P):
        q = P - c
        if R is not None:
            q = q @ R.T
        q = np.abs(q) - h
        return np.sqrt((np.maximum(q, 0) ** 2).sum(-1)) + np.minimum(q.max(-1), 0) - rad

    e = (h + rad) if R is None else np.full(3, float(np.linalg.norm(h) + rad), F)
    return Prim(fn, c - e, c + e)


def torus(c, R_major, r_minor, Rm=None):
    c = V(c)
    Rm = None if Rm is None else V(Rm)

    def fn(P):
        q = P - c
        if Rm is not None:
            q = q @ Rm.T
        t = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - R_major
        return np.sqrt(t * t + q[:, 2] ** 2) - r_minor

    e = R_major + r_minor
    return Prim(fn, c - e, c + e)


def halfspace_below(z0, lo, hi):
    """Region z < z0 (negative inside) restricted to a bbox for culling."""
    return Prim(lambda P: P[:, 2] - z0, lo, hi)


def halfspace_above(z0, lo, hi):
    return Prim(lambda P: z0 - P[:, 2], lo, hi)


def shell(prim, t):
    fn = prim.fn
    return Prim(lambda P: np.abs(fn(P)) - t, prim.lo - t, prim.hi + t)


def catmull(points, n_per=8):
    pts = [V(p) for p in points]
    pts = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for j in range(n_per):
            t = j / n_per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-2])
    return out


def tube(points, radii):
    """List of round-cone prims along a polyline; radii scalar, list, or callable(t)."""
    n = len(points)
    if callable(radii):
        rs = [radii(i / (n - 1)) for i in range(n)]
    elif np.isscalar(radii):
        rs = [radii] * n
    else:
        rs = list(radii)
        if len(rs) != n:  # resample linearly
            src = np.linspace(0, 1, len(rs))
            rs = list(np.interp(np.linspace(0, 1, n), src, rs))
    prims = []
    for i in range(n - 1):
        a, b = V(points[i]), V(points[i + 1])
        L = float(np.linalg.norm(b - a))
        if L < 1e-6:
            continue
        ra, rb = float(rs[i]), float(rs[i + 1])
        if abs(ra - rb) >= L * 0.95:
            m = (ra + rb) / 2
            ra = rb = m
        prims.append(rcone(a, b, ra, rb))
    return prims


def custom(fn, lo, hi):
    return Prim(fn, lo, hi)


# ---------------------------------------------------------------- operators

def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


class Part:
    """Ordered list of CSG operations: ('add'|'sub'|'int', prim, k)."""

    def __init__(self, name):
        self.name = name
        self.ops = []

    def add(self, prims, k=0.0):
        for p in (prims if isinstance(prims, (list, tuple)) else [prims]):
            self.ops.append(("add", p, k))
        return self

    def sub(self, prims, k=0.0):
        for p in (prims if isinstance(prims, (list, tuple)) else [prims]):
            self.ops.append(("sub", p, k))
        return self

    def inter(self, prims, k=0.0):
        for p in (prims if isinstance(prims, (list, tuple)) else [prims]):
            self.ops.append(("int", p, k))
        return self

    def bounds(self, margin=0.01):
        los = [p.lo - k for kind, p, k in self.ops if kind == "add"]
        his = [p.hi + k for kind, p, k in self.ops if kind == "add"]
        return np.min(los, 0) - margin, np.max(his, 0) + margin

    def inflated(self, name, amount_fn):
        """Copy with every 'add' prim inflated by amount_fn(index)."""
        out = Part(name)
        for i, (kind, p, k) in enumerate(self.ops):
            if kind == "add":
                out.ops.append((kind, p.inflate(amount_fn(i)), k))
            else:
                out.ops.append((kind, p, k))
        return out


class Grid:
    def __init__(self, lo, hi, vox):
        self.vox = float(vox)
        self.origin = V(lo)
        self.shape = tuple(int(math.ceil((h - l) / vox)) + 1 for l, h in zip(lo, hi))

    def axis(self, i, a, b):
        return self.origin[i] + self.vox * np.arange(a, b, dtype=F)

    def points(self, lo, hi):
        xs, ys, zs = (self.axis(i, lo[i], hi[i]) for i in range(3))
        X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
        return np.stack([X.ravel(), Y.ravel(), Z.ravel()], -1)

    def voxel_count(self):
        return self.shape[0] * self.shape[1] * self.shape[2]


MAX_PTS = 2_500_000


def _apply(D, grid, kind, prim, k, lo, hi):
    # chunk along x to bound memory
    nyz = (hi[1] - lo[1]) * (hi[2] - lo[2])
    step = max(1, MAX_PTS // max(nyz, 1))
    for x0 in range(lo[0], hi[0], step):
        x1 = min(hi[0], x0 + step)
        l2 = (x0, lo[1], lo[2])
        h2 = (x1, hi[1], hi[2])
        P = grid.points(l2, h2)
        d = prim.fn(P).astype(F).reshape(x1 - x0, hi[1] - lo[1], hi[2] - lo[2])
        sl = D[x0:x1, lo[1]:hi[1], lo[2]:hi[2]]
        if kind == "add":
            sl[...] = smin(sl, d, k)
        elif kind == "sub":
            sl[...] = smax(sl, -d, k)
        else:
            sl[...] = smax(sl, d, k)


def evaluate(part, grid, init=1.0):
    D = np.full(grid.shape, init, F)
    shape = np.array(grid.shape)
    for kind, prim, k in part.ops:
        if kind == "int":
            _apply(D, grid, kind, prim, k, (0, 0, 0), tuple(shape))
            continue
        m = k + 3 * grid.vox
        lo = np.floor((prim.lo - m - grid.origin) / grid.vox).astype(int)
        hi = np.ceil((prim.hi + m - grid.origin) / grid.vox).astype(int) + 1
        lo = np.maximum(lo, 0)
        hi = np.minimum(hi, shape)
        if np.any(hi <= lo):
            continue
        _apply(D, grid, kind, prim, k, tuple(lo), tuple(hi))
    return D


def grid_for(part, vox, margin=0.012):
    lo, hi = part.bounds(margin)
    return Grid(lo, hi, vox)


def polygonize(D, grid):
    """Isosurface (D == 0) -> (verts, tris, quads) in world coordinates."""
    import openvdb as vdb

    band = 3.0 * grid.vox
    A = np.ascontiguousarray(np.clip(D, -band, band), dtype=F)
    g = vdb.FloatGrid(band)
    g.copyFromArray(A, (0, 0, 0), 0.0)
    g.prune(0.0)
    g.transform = vdb.createLinearTransform(voxelSize=grid.vox)
    pts, tris, quads = g.convertToPolygons(isovalue=0.0, adaptivity=0.0)
    pts = np.asarray(pts, dtype=F) + grid.origin
    return pts, np.asarray(tris, dtype=np.int32), np.asarray(quads, dtype=np.int32)
