"""AstroTwin procedural human -> .blend + .glb (raw and Draco).

Run (reproducible, no network, no paid APIs):
  ~/.local/bin/blender -b --factory-startup --python scripts/blender/build_astrotwin.py -- \
      --out public/models [--preview scripts/blender/preview] [--quick]

Pipeline: analytic SDF primitives (profiles, round cones, lofted tubes along
Catmull-Rom curves, smooth unions) -> OpenVDB iso-surface (voxel remesh) ->
Laplacian smoothing -> collapse decimation to a polygon budget -> glTF.
"""
import argparse
import json
import math
import os
import sys
import time

import bpy
import bmesh
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sdf  # noqa: E402
import anatomy as A  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "public", "models"))
ap.add_argument("--preview", default="")
ap.add_argument("--quick", action="store_true", help="coarser voxels for fast iteration")
ap.add_argument("--parts", default="all")
args = ap.parse_args(argv)
OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)
Q = 1.6 if args.quick else 1.0
WANT = set(args.parts.split(","))


def want(x):
    return "all" in WANT or x in WANT


T0 = time.time()
LOG = []


def log(*a):
    msg = " ".join(str(x) for x in a)
    LOG.append(msg)
    print(f"[{time.time() - T0:7.1f}s] {msg}", flush=True)


# ------------------------------------------------------------------ scene

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for me in list(bpy.data.meshes):
    bpy.data.meshes.remove(me)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"


def material(name, rgb, alpha=1.0, rough=0.5, metal=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Alpha"].default_value = alpha
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    m.diffuse_color = (*rgb, alpha)
    if alpha < 1:
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    return m


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


MAT = {
    "skin": material("mat_skin", srgb("#7fdcff"), 0.35, 0.35),
    "bone": material("mat_bone", srgb("#e8e2d4"), 1.0, 0.55),
    "muscle": material("mat_muscle", srgb("#c9748a"), 1.0, 0.5),
    "heart": material("mat_heart", srgb("#ff7a59"), 1.0, 0.4),
    "lungs": material("mat_lungs", srgb("#9b7bff"), 1.0, 0.5),
    "brain": material("mat_brain", srgb("#c4a7ff"), 1.0, 0.45),
    "digestive": material("mat_digestive", srgb("#38d6c4"), 1.0, 0.45),
    "kidneys": material("mat_kidneys", srgb("#8f6bff"), 1.0, 0.45),
    "suit": material("mat_suit_pearl", srgb("#e9edf2"), 1.0, 0.32),
    "graphite": material("mat_suit_graphite", srgb("#2b313b"), 1.0, 0.4, 0.3),
    "visor": material("mat_visor", srgb("#3a7bff"), 0.6, 0.05, 0.6),
    "core": material("mat_suit_core", srgb("#5fe3ff"), 1.0, 0.2, 0, srgb("#5fe3ff"), 4.0),
}

LAYERS = {}
for lid in ("skeleton", "organs", "muscle", "skin", "suit"):
    e = bpy.data.objects.new(f"layer_{lid}", None)
    e.empty_display_size = 0.1
    scene.collection.objects.link(e)
    LAYERS[lid] = e


# ------------------------------------------------------------------ mesh helpers

def mesh_from_arrays(name, pts, tris, quads):
    me = bpy.data.meshes.new(name)
    nv, nq, nt = len(pts), len(quads), len(tris)
    me.vertices.add(nv)
    me.vertices.foreach_set("co", pts.astype(np.float32).ravel())
    me.loops.add(nq * 4 + nt * 3)
    me.loops.foreach_set("vertex_index", np.concatenate([quads.ravel(), tris.ravel()]).astype(np.int32))
    me.polygons.add(nq + nt)
    starts = np.concatenate([np.arange(nq, dtype=np.int32) * 4, nq * 4 + np.arange(nt, dtype=np.int32) * 3])
    me.polygons.foreach_set("loop_start", starts.astype(np.int32))
    me.polygons.foreach_set("loop_total", np.concatenate([np.full(nq, 4), np.full(nt, 3)]).astype(np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    return me


def tri_count(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def remove_small_islands(me, min_faces):
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    seen = set()
    kill = []
    islands = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]
        comp = []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        islands.append(len(comp))
        if len(comp) < min_faces:
            kill.extend(comp)
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return sorted(islands, reverse=True), len(kill)


def finalize(name, D, grid, layer, mat, target_tris, smooth=2, min_island=40):
    pts, tris, quads = sdf.polygonize(D, grid)
    if len(pts) == 0:
        log(f"!! {name}: empty surface")
        return None
    me = mesh_from_arrays(name, pts, tris, quads)
    raw = tri_count(me)
    islands, killed = remove_small_islands(me, min_island)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if smooth:
        m = ob.modifiers.new("smooth", "LAPLACIANSMOOTH")
        m.iterations = smooth
        m.lambda_factor = 0.35
        m.use_volume_preserve = True
    cur = raw
    if target_tris and cur > target_tris:
        m = ob.modifiers.new("decimate", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = target_tris / cur
        m.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = new
    bpy.data.meshes.remove(old)
    new.name = name
    new.shade_smooth()
    new.materials.append(mat)
    ob.parent = layer
    final = tri_count(new)
    log(f"{name}: grid {grid.shape} vox {grid.vox * 1000:.1f}mm raw {raw} tris -> {final} tris; islands {islands[:4]} removed {killed} faces")
    STATS["objects"][name] = {"layer": layer.name, "raw_tris": raw, "tris": final, "verts": len(new.vertices),
                              "voxel_mm": round(grid.vox * 1000, 2), "islands_before_cleanup": len(islands),
                              "faces_removed_as_specks": killed}
    return ob


def eval_points(part, P, init=1.0):
    """Evaluate a Part at arbitrary points (N,3)."""
    D = np.full(len(P), init, np.float32)
    for kind, prim, k in part.ops:
        if kind == "int":
            idx = np.arange(len(P))
        else:
            m = k + 0.004
            msk = np.all((P >= prim.lo - m) & (P <= prim.hi + m), axis=1)
            idx = np.nonzero(msk)[0]
        if len(idx) == 0:
            continue
        d = prim.fn(P[idx]).astype(np.float32)
        if kind == "add":
            D[idx] = sdf.smin(D[idx], d, k)
        elif kind == "sub":
            D[idx] = sdf.smax(D[idx], -d, k)
        else:
            D[idx] = sdf.smax(D[idx], d, k)
    return D


STATS = {"generator": "scripts/blender/build_astrotwin.py", "blender": bpy.app.version_string, "objects": {}}

# ------------------------------------------------------------------ build

SKIN, SKIN_TAGS = A.skin_part()

if want("skin"):
    g = sdf.grid_for(SKIN, 0.0025 * Q)
    log("skin grid", g.shape, g.voxel_count())
    D = sdf.evaluate(SKIN, g)
    finalize("skin", D, g, LAYERS["skin"], MAT["skin"], 48000, smooth=2)
    del D

if want("suit"):
    SUIT = A.suit_body_part()
    g = sdf.grid_for(SUIT, 0.0032 * Q)
    D = sdf.evaluate(SUIT, g)
    finalize("suit_body", D, g, LAYERS["suit"], MAT["suit"], 34000, smooth=2)
    # panels follow the suit surface: (suit inflated by 5.5 mm) intersected with regions
    regions = sdf.Part("suit_regions")
    regions.add(sdf.rbox((0, -0.14, 1.31), (0.068, 0.06, 0.052), 0.012))
    for name, S in A.SIDES:
        sh, el, wr = A.arm_landmarks(S)
        regions.add(sdf.ellipsoid((S * 0.21, 0.004, 1.405), (0.058, 0.075, 0.055)))
        regions.add(sdf.sphere((S * 0.097, -0.07, 0.49), 0.048))
        regions.add(sdf.sphere(sdf.lerp(el, wr, 0.78), 0.035))
        regions.add(sdf.rbox((S * 0.165, 0.0, 0.66), (0.03, 0.022, 0.17), 0.006))
        regions.add(sdf.rbox((S * 0.1, -0.02, 0.045), (0.07, 0.13, 0.02), 0.004))   # boot soles / toe caps
    regions.add(sdf.rbox((0, 0.0, 0.975), (0.3, 0.2, 0.016), 0.003))                # belt
    lo, hi = regions.bounds(0.02)
    lo = np.maximum(lo, SUIT.bounds(0.01)[0])
    hi = np.minimum(hi, SUIT.bounds(0.01)[1])
    g = sdf.Grid(lo, hi, 0.0028 * Q)
    SD = sdf.evaluate(SUIT, g)
    RD = sdf.evaluate(regions, g)
    PD = sdf.smax(SD - 0.0055, RD, 0.004)
    del SD, RD
    pack = sdf.Part("pack")
    pack.add(sdf.rbox((0, 0.165, 1.26), (0.105, 0.035, 0.15), 0.022))
    pack.add(sdf.capsule((-0.07, 0.205, 1.12), (-0.07, 0.205, 1.40), 0.018), 0.01)
    pack.add(sdf.capsule((0.07, 0.205, 1.12), (0.07, 0.205, 1.40), 0.018), 0.01)
    PD = np.minimum(PD, sdf.evaluate(pack, g))
    finalize("suit_panels", PD, g, LAYERS["suit"], MAT["graphite"], 16000, smooth=1)
    # chest core sits exactly on the chest plate surface
    ys = np.linspace(-0.25, 0.0, 600, dtype=np.float32)
    line = np.stack([np.zeros_like(ys), ys, np.full_like(ys, 1.31)], -1)
    sd_line = eval_points(SUIT, line) - 0.0055
    y_surf = float(ys[np.argmax(sd_line < 0)])
    A.ANCHORS["suit"] = (0.0, y_surf - 0.004, 1.31)
    core = sdf.Part("core")
    Rm = sdf.frame_from_axis((0, -1, 0), (0, 0, 1))
    core.add(sdf.torus((0, y_surf - 0.001, 1.31), 0.022, 0.0045, Rm))
    core.add(sdf.ellipsoid((0, y_surf + 0.001, 1.31), (0.012, 0.004, 0.012)), 0.002)
    g = sdf.grid_for(core, 0.0008)
    finalize("suit_core", sdf.evaluate(core, g), g, LAYERS["suit"], MAT["core"], 1500, smooth=0)
    H = A.helmet_part()
    g = sdf.grid_for(H, 0.0018 * Q)
    finalize("suit_helmet", sdf.evaluate(H, g), g, LAYERS["suit"], MAT["suit"], 9000, smooth=1)
    Vp = A.visor_part()
    g = sdf.grid_for(Vp, 0.0016 * Q)
    finalize("suit_visor", sdf.evaluate(Vp, g), g, LAYERS["suit"], MAT["visor"], 3000, smooth=1)

if want("muscle"):
    sk_lo, sk_hi = SKIN.bounds(0.0)
    for name, regs, top, bottom in A.define_muscles():
        lo = np.min([r.lo for r in regs], 0)
        hi = np.max([r.hi for r in regs], 0)
        lo = np.maximum(lo, sk_lo)
        hi = np.minimum(hi, sk_hi)
        g = sdf.Grid(lo, hi, 0.0026 * Q)
        s = -sdf.evaluate(SKIN, g)
        rp = sdf.Part("r")
        rp.add(regs)
        R = sdf.evaluate(rp, g)
        c = np.clip(-R / 0.02, 0, 1)
        f = c * (2 - c)
        d0 = 0.0035
        s_top = d0 + top * (1 - f)
        s_bot = d0 + top + bottom * f
        Gm = np.maximum(s_top - s, s - s_bot) + 0.0007
        finalize(name, Gm.astype(np.float32), g, LAYERS["muscle"], MAT["muscle"], 1400, smooth=1, min_island=60)

if want("skeleton"):
    for key, (part, vox, budget) in A.skeleton_parts().items():
        g = sdf.grid_for(part, vox * (1.3 if args.quick else 1.0))
        field = np.maximum(sdf.evaluate(part, g), sdf.evaluate(SKIN, g) + 0.003)
        finalize(part.name, field, g, LAYERS["skeleton"], MAT["bone"], budget, smooth=1, min_island=30)

if want("organs"):
    for part, vox, budget, mat in (
        (A.heart_part(), 0.0013, 6000, "heart"),
        (A.lungs_part(), 0.0018, 7000, "lungs"),
        (A.brain_part(), 0.0011, 14000, "brain"),
        (A.digestive_part(), 0.0014, 14000, "digestive"),
        (A.kidneys_part(), 0.0012, 2000, "kidneys"),
    ):
        g = sdf.grid_for(part, vox * (1.4 if args.quick else 1.0))
        field = np.maximum(sdf.evaluate(part, g), sdf.evaluate(SKIN, g) + 0.003)
        finalize(part.name, field, g, LAYERS["organs"], MAT[mat], budget, smooth=1)

for key, pos in A.ANCHORS.items():
    e = bpy.data.objects.new(f"anchor_{key}", None)
    e.empty_display_size = 0.03
    e.location = pos
    scene.collection.objects.link(e)
    e.parent = LAYERS["suit" if key == "suit" else "organs"]

# ------------------------------------------------------------------ containment vs analytic skin

cont = {}
for ob in scene.objects:
    if ob.type != "MESH":
        continue
    P = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get("co", P)
    P = P.reshape(-1, 3)
    d = eval_points(SKIN, P)
    if ob.parent and ob.parent.name in ('layer_skeleton', 'layer_organs'):
        # Enforce a small safety margin after smoothing/decimation, which can
        # move surface vertices outside an earlier voxel intersection.
        for _ in range(5):
            ids = np.flatnonzero(d > -0.001)
            if len(ids) == 0:
                break
            pts = P[ids]
            grads = []
            for axis in range(3):
                offset = np.zeros(3, np.float32)
                offset[axis] = 0.0005
                grads.append((eval_points(SKIN, pts + offset) - eval_points(SKIN, pts - offset)) / 0.001)
            grad = np.stack(grads, axis=-1)
            grad /= np.maximum(np.linalg.norm(grad, axis=1, keepdims=True), 1e-6)
            P[ids] -= grad * (d[ids, None] + 0.0015)
            d = eval_points(SKIN, P)
        ob.data.vertices.foreach_set('co', P.ravel())
        ob.data.update()
    cont[ob.name] = {"min_mm": round(float(d.min()) * 1000, 2), "max_mm": round(float(d.max()) * 1000, 2),
                     "inside_frac": round(float((d < 0.0005).mean()), 5), "outside_frac": round(float((d > -0.0005).mean()), 5)}
STATS["containment_vs_skin_sdf"] = cont
for k, v in cont.items():
    log("contain", k, v)

# ------------------------------------------------------------------ preview renders

if args.preview:
    os.makedirs(args.preview, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_specular_highlight = True
    scene.render.resolution_x = 700
    scene.render.resolution_y = 1000
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    scene.world = world
    cam = bpy.data.objects.new("PreviewCam", bpy.data.cameras.new("PreviewCam"))
    scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 1.95
    scene.camera = cam
    meshes = [o for o in scene.objects if o.type == "MESH"]

    def shot(fname, layers, view="front", scale=1.95, target=(0, 0, 0.9)):
        for o in meshes:
            o.hide_render = o.parent.name.replace("layer_", "") not in layers
        cam.data.ortho_scale = scale
        tx, ty, tz = target
        if view == "front":
            cam.location = (tx, ty - 4, tz)
            cam.rotation_euler = (math.radians(90), 0, 0)
        elif view == "back":
            cam.location = (tx, ty + 4, tz)
            cam.rotation_euler = (math.radians(90), 0, math.radians(180))
        else:
            cam.location = (tx + 4, ty, tz)
            cam.rotation_euler = (math.radians(90), 0, math.radians(90))
        scene.render.filepath = os.path.join(args.preview, fname)
        bpy.ops.render.render(write_still=True)

    try:
        shot("skin_front.png", {"skin"})
        shot("skin_side.png", {"skin"}, "side")
        shot("suit_front.png", {"suit"})
        shot("muscle_front.png", {"muscle"})
        shot("muscle_back.png", {"muscle"}, "back")
        shot("skeleton_front.png", {"skeleton"})
        shot("skeleton_side.png", {"skeleton"}, "side")
        shot("organs_front.png", {"organs"}, "front", 0.9, (0, 0, 1.2))
        shot("head_front.png", {"skin"}, "front", 0.35, (0, 0, 1.62))
        shot("hand.png", {"skin", "skeleton"}, "side", 0.3, (0.33, 0, 0.82))
    except Exception as ex:  # rendering is optional evidence only
        log("preview failed", ex)
    bpy.data.objects.remove(cam, do_unlink=True)

# ------------------------------------------------------------------ save + export

if args.parts == "all":
    blend = os.path.join(OUT, "astrotwin_human.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    raw_glb = os.path.join(HERE, "out", "astrotwin_human_raw.glb")
    os.makedirs(os.path.dirname(raw_glb), exist_ok=True)
    common = dict(export_format="GLB", export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
                  export_extras=False, export_materials="EXPORT", export_texcoords=False, export_normals=True)
    bpy.ops.export_scene.gltf(filepath=raw_glb, **common)
    glb = os.path.join(OUT, "astrotwin_human.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=7, export_draco_position_quantization=14,
                              export_draco_normal_quantization=10, **common)
    STATS["files"] = {
        "blend_bytes": os.path.getsize(blend),
        "glb_raw_bytes": os.path.getsize(raw_glb),
        "glb_draco_bytes": os.path.getsize(glb),
    }
    STATS["total_tris"] = sum(v["tris"] for v in STATS["objects"].values())
    STATS["build_seconds"] = round(time.time() - T0, 1)
    with open(os.path.join(OUT, "astrotwin_human.stats.json"), "w") as fh:
        json.dump(STATS, fh, indent=1)
    log("files", STATS["files"], "total tris", STATS["total_tris"])
log("done")
