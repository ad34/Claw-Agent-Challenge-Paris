"""Rendu d'un packshot produit à partir d'une recette JSON.

Usage : blender -b --factory-startup -P render.py -- recette.json
Écrit l'image (recipe["output"]) et un rapport JSON à côté (même nom, .json).
"""
import json
import math
import sys
import time
import traceback

import bpy
from mathutils import Vector

recipe_path = sys.argv[sys.argv.index("--") + 1]
with open(recipe_path, encoding="utf-8") as f:
    R = json.load(f)
report = {"ok": False}
t0 = time.time()


def hex_rgb(h, alpha=True):
    h = h.lstrip("#")
    rgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    rgb = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]  # sRGB -> linéaire
    return (*rgb, 1.0) if alpha else tuple(rgb)


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def new_material(name, color, roughness=0.6, metallic=0.0):
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    bsdf = principled(mat)
    bsdf.inputs["Base Color"].default_value = hex_rgb(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def spherical(target, dist, az_deg, el_deg):
    az, el = math.radians(az_deg), math.radians(el_deg)
    return target + Vector((dist * math.sin(az) * math.cos(el), -dist * math.cos(az) * math.cos(el), dist * math.sin(el)))


def aim(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def sweep_mesh(width=40, depth=14, height=14, radius=2.0, segments=16):
    # Assez large pour que les caméras en orbite (clips héros) ne voient jamais le bord.
    """Fond studio « cyclo » : sol + courbe + mur, sans arête visible."""
    profile = [(-depth, 0.0), (0.0, 0.0)]
    for i in range(1, segments + 1):
        a = (math.pi / 2) * i / segments
        profile.append((radius * math.sin(a), radius * (1 - math.cos(a))))
    profile.append((radius, height))
    verts, faces = [], []
    for x in (-width / 2, width / 2):
        for y, z in profile:
            verts.append((x, y, z))
    n = len(profile)
    for i in range(n - 1):
        faces.append((i, i + 1, n + i + 1, n + i))
    mesh = bpy.data.meshes.new("Sweep")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for p in mesh.polygons:
        p.use_smooth = True
    return mesh


try:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # --- Produit : import, mise à l'échelle (plus grande dimension = 1 m), posé au sol et centré
    before = set(bpy.data.objects)
    model = R["model"]
    if model.lower().endswith((".gltf", ".glb")):
        bpy.ops.import_scene.gltf(filepath=model)
    elif model.lower().endswith(".obj"):
        bpy.ops.wm.obj_import(filepath=model)
    else:
        bpy.ops.import_scene.fbx(filepath=model)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    roots = [o for o in imported if o.parent is None]
    pivot = bpy.data.objects.new("Product", None)
    scene.collection.objects.link(pivot)
    for o in roots:
        o.parent = pivot
    bpy.context.view_layer.update()

    def bbox():
        pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        return lo, hi

    lo, hi = bbox()
    s = 1.0 / max(hi - lo)
    pivot.scale = (s, s, s)
    bpy.context.view_layer.update()
    lo, hi = bbox()
    pivot.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    # Règle de packshot : présenter le côté le plus large à la caméra (un modèle photo→3D arrive souvent
    # orienté dans la profondeur, on le verrait « en bout »).
    base_rot = 90 if (hi.y - lo.y) > (hi.x - lo.x) * 1.15 else 0
    report["auto_rotation_deg"] = base_rot
    pivot.rotation_euler.z = math.radians(base_rot + R.get("product", {}).get("rotation_deg", 0))
    bpy.context.view_layer.update()

    # --- Socle éventuel : le produit est posé dessus
    ped = R.get("pedestal")
    base_z = 0.0
    if ped:
        lo, hi = bbox()
        footprint = max(hi.x - lo.x, hi.y - lo.y)
        h = ped.get("height", 0.25)
        r = footprint * ped.get("scale", 0.75)
        if ped.get("shape", "cylinder") == "box":
            bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, h / 2))
            bpy.context.object.scale = (r * 2, r * 2, h)
        else:
            bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=r, depth=h, location=(0, 0, h / 2))
            bpy.ops.object.shade_smooth()
        p = bpy.context.object
        p.name = "Pedestal"
        bev = p.modifiers.new("Bevel", "BEVEL")
        bev.width = 0.01
        bev.segments = 4
        p.data.materials.append(new_material("PedestalMat", ped.get("color", "#d9d4cc"), ped.get("roughness", 0.5), ped.get("metallic", 0.0)))
        base_z = h
        pivot.location.z += h
        bpy.context.view_layer.update()

    lo, hi = bbox()
    target = (lo + hi) / 2
    radius = (hi - lo).length / 2
    report["product_dims"] = [round(v, 3) for v in (hi - lo)]

    # --- Fond
    bg = R.get("background", {"type": "sweep", "color": "#e9e6e1"})
    if bg.get("type", "sweep") != "none":
        mesh = sweep_mesh() if bg.get("type", "sweep") == "sweep" else None
        if mesh is None:
            bpy.ops.mesh.primitive_plane_add(size=40)
            ground = bpy.context.object
        else:
            ground = bpy.data.objects.new("Backdrop", mesh)
            scene.collection.objects.link(ground)
            ground.location.y = bg.get("wall_distance", 2.5)
        ground.data.materials.append(new_material("BackdropMat", bg.get("color", "#e9e6e1"), bg.get("roughness", 0.7)))

    # --- Monde : HDRI (éclairage, reflets) ou couleur unie
    world = bpy.data.worlds.new("World")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    nt = world.node_tree
    bg_node = next(n for n in nt.nodes if n.type == "BACKGROUND")
    if R.get("hdri"):
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(R["hdri"])
        mapping = nt.nodes.new("ShaderNodeMapping")
        coord = nt.nodes.new("ShaderNodeTexCoord")
        mapping.inputs["Rotation"].default_value[2] = math.radians(R.get("hdri_rotation_deg", 0))
        nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
        nt.links.new(env.outputs["Color"], bg_node.inputs["Color"])
        bg_node.inputs["Strength"].default_value = R.get("hdri_strength", 1.0)
    else:
        bg_node.inputs["Color"].default_value = hex_rgb(R.get("world_color", "#202020"))
        bg_node.inputs["Strength"].default_value = R.get("world_strength", 0.3)

    # --- Lumières (softbox = area light orientée vers le produit)
    for i, L in enumerate(R.get("lights", [])):
        kind = L.get("type", "area").upper()
        data = bpy.data.lights.new(f"Light{i}", kind)
        data.energy = L.get("power", 300)
        data.color = hex_rgb(L.get("color", "#ffffff"), alpha=False)
        if kind == "AREA":
            data.shape = "RECTANGLE"
            data.size = L.get("size", 1.2)
            data.size_y = L.get("size_y", L.get("size", 1.2))
        elif kind == "SPOT":
            data.spot_size = math.radians(L.get("spot_deg", 40))
            data.spot_blend = 0.4
        obj = bpy.data.objects.new(f"Light{i}", data)
        scene.collection.objects.link(obj)
        obj.location = spherical(target, L.get("distance", 2.5) * max(radius, 0.3) / 0.6, L.get("azimuth", 45), L.get("elevation", 35))
        aim(obj, target)

    # --- Caméra : cadrée pour que le produit occupe `fill` du plus petit côté de l'image
    cam_r = R.get("camera", {})
    res = R.get("resolution", [1080, 1350])
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = cam_r.get("focal_mm", 70)
    cam_data.sensor_fit = "AUTO"
    half_large = math.atan(cam_data.sensor_width / 2 / cam_data.lens)
    half_small = math.atan(math.tan(half_large) * min(res) / max(res))
    fill = cam_r.get("fill", 0.62)
    dist = radius / (fill * math.tan(half_small))
    cam = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam)
    look_at = target + Vector((0, 0, cam_r.get("look_offset_z", 0.0) * radius))
    cam.location = spherical(look_at, dist, cam_r.get("azimuth", 20), cam_r.get("elevation", 12))
    cam.location.z = max(cam.location.z, base_z + 0.02)
    aim(cam, look_at)
    if cam_r.get("dof"):
        cam_data.dof.use_dof = True
        cam_data.dof.focus_distance = (look_at - cam.location).length
        cam_data.dof.aperture_fstop = cam_r.get("fstop", 4.0)
    scene.camera = cam

    # --- Rendu Cycles sur GPU (OptiX si dispo)
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for dev_type in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = dev_type
            break
        except TypeError:
            continue
    try:
        prefs.refresh_devices()
    except AttributeError:
        prefs.get_devices()
    gpus = [d for d in prefs.devices if d.type in ("OPTIX", "CUDA")]
    for d in prefs.devices:
        d.use = d in gpus
    scene.cycles.device = "GPU" if gpus else "CPU"
    report["device"] = [d.name for d in gpus] or ["CPU"]
    scene.cycles.samples = R.get("samples", 128)
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.exposure = R.get("exposure", 0.0)
    # --- Export de livrables (optionnel) : scène .blend autonome + GLB du produit et de son socle.
    exp = R.get("export") or {}
    if exp.get("glb"):
        try:
            bpy.ops.object.select_all(action="DESELECT")
            for o in meshes + [o for o in scene.objects if o.name.startswith("Pedestal")]:
                o.select_set(True)
            bpy.ops.export_scene.gltf(filepath=exp["glb"], export_format="GLB", use_selection=True, export_apply=True)
            report["glb"] = exp["glb"]
        except Exception as e:
            report["glb_error"] = f"{type(e).__name__}: {e}"
    if exp.get("blend"):
        try:
            bpy.ops.file.pack_all()  # textures + HDRI embarquées : le fichier s'ouvre sur n'importe quelle machine
            bpy.ops.wm.save_as_mainfile(filepath=exp["blend"], copy=True, compress=True)
            report["blend"] = exp["blend"]
        except Exception as e:
            report["blend_error"] = f"{type(e).__name__}: {e}"

    turntable = int(R.get("turntable_frames", 0))
    motion = R.get("motion")
    if R.get("export_only"):
        # Viewer 3D : on veut juste le GLB, pas d'image.
        report["export_only"] = True
    elif motion:
        # Clip héros : travelling avant + orbite de la caméra, légère rotation du produit, mouvements adoucis.
        n = int(motion.get("frames", 120))
        az0, az1 = motion.get("azimuth", [cam_r.get("azimuth", 20) - 28, cam_r.get("azimuth", 20) + 12])
        el0, el1 = motion.get("elevation", [cam_r.get("elevation", 12) + 10, cam_r.get("elevation", 12)])
        f0, f1 = motion.get("fill", [fill * 0.78, fill])
        r0, r1 = motion.get("product_rotation", [0, 20])
        base = pivot.rotation_euler.z
        stem = R["output"].rsplit(".", 1)[0]
        for i in range(n):
            t = i / max(n - 1, 1)
            e = 0.5 - 0.5 * math.cos(math.pi * t)  # easeInOutSine
            lerp = lambda a, b: a + (b - a) * e
            d = radius / (lerp(f0, f1) * math.tan(half_small))
            cam.location = spherical(look_at, d, lerp(az0, az1), lerp(el0, el1))
            cam.location.z = max(cam.location.z, base_z + 0.02)
            aim(cam, look_at)
            if cam_data.dof.use_dof:
                cam_data.dof.focus_distance = (look_at - cam.location).length
            pivot.rotation_euler.z = base + math.radians(lerp(r0, r1))
            scene.render.filepath = f"{stem}_{i:04d}.png"
            bpy.ops.render.render(write_still=True)
        report["frames"] = n
    elif turntable:
        # 360° : le produit tourne sur lui-même, caméra et lumières fixes. Une image par pas.
        base = pivot.rotation_euler.z
        stem = R["output"].rsplit(".", 1)[0]
        for i in range(turntable):
            pivot.rotation_euler.z = base + 2 * math.pi * i / turntable
            scene.render.filepath = f"{stem}_{i:04d}.png"
            bpy.ops.render.render(write_still=True)
        report["frames"] = turntable
    else:
        scene.render.filepath = R["output"]
        bpy.ops.render.render(write_still=True)
    report["ok"] = True
except Exception as e:
    report["error"] = f"{type(e).__name__}: {e}"
    report["trace"] = traceback.format_exc()[-2000:]

report["seconds"] = round(time.time() - t0, 1)
with open(R["output"].rsplit(".", 1)[0] + ".json", "w", encoding="utf-8") as f:
    json.dump(report, f, indent=1)
