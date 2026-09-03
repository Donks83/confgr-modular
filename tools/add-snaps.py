#!/usr/bin/env python
"""Generate snap planes into converted components, from youk/snap-spec.json.

    python tools/add-snaps.py youk --spec youk/snap-spec.json

This is the step no converter does for you: deciding where two parts join.
It is driven entirely by the spec file so that the DECISIONS live in reviewable
data and this file holds only the mechanics.

WHAT A SNAP PLANE IS, and every constraint here comes from the pipeline:

  * A flat quad, exactly 4 vertices, no thickness. component.js refuses
    anything else, because a subdivided or solidified plane has no single
    unambiguous centre.
  * Local +Z is the facing. Two snaps may join only when their facings oppose,
    so the node's rotation is what makes a joint work.
  * The mask travels in the node name: md-snap.<mask>.<label>. Two snaps join
    only if their masks match exactly, which is how a depth-200 accessory is
    kept off a depth-320 frame.
  * Position and rotation must be on the NODE, not baked into the vertices -
    the loader reads node.position and node.quaternion.

THE JOINTS, for the record. A frame offers a socket at each rung, on its
centreline, facing both ways. Snap centres coincide when connected, so:

    frame socket   (0, rungTop, 0) facing +X
    shelf plug     (-(halfWidth - 15), 0, 0) facing -X
    hang plug      (slotCentre, topY - 1.5, 0) facing -X

The shelf's base lands on the rung's top face with its end flush to the frame's
outer face, and its OTHER plug then accepts a second frame - so a bay is a chain
rather than a two-point constraint the engine cannot express. A hang accessory's
top sheet lands on the same rung face, its slot over the rung's hole, and it
cantilevers off that one frame with nothing attaching to its far side.

Both families share ONE mask per depth, because both bolt to the same hole in
the same rung face and must therefore compete for it. Separate masks would put
two snaps at the same point and filling one would not fill the other.

Sockets on BOTH faces of every rung are deliberate: a middle frame in a
three-bay run carries a shelf on each side.
"""

import argparse
import json
import math
import sys
from pathlib import Path

SNAP_SIZE_MM = 30.0              # drawn size of a snap plane; cosmetic only

# How far down from a hang part's highest point to look for its mounting slot.
# Not zero, because a moulded lid can stand proud of the bracket; not the whole
# part, because a tall accessory has other geometry at the same z.
SLOT_SEARCH_MM = 25.0

# glTF quaternions are [x, y, z, w]. A snap's facing is its local +Z, so these
# rotate +Z onto each axis.
ROOT_HALF = math.sqrt(0.5)
FACING_QUAT = {
    "+z": (0.0, 0.0, 0.0, 1.0),
    "+x": (0.0, ROOT_HALF, 0.0, ROOT_HALF),
    "-z": (0.0, 1.0, 0.0, 0.0),
    "-x": (0.0, -ROOT_HALF, 0.0, ROOT_HALF),
}


def quat_matrix(q):
    """[x,y,z,w] -> 4x4, for handing to trimesh as a node transform."""
    import numpy as np

    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 0.0],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 0.0],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ])


def snap_quad(size_mm=SNAP_SIZE_MM):
    """The 4-vertex flat plane component.js insists on, in the local XY plane."""
    import numpy as np
    import trimesh

    h = size_mm / 2000.0  # millimetres to metres, halved
    return trimesh.Trimesh(
        vertices=np.array([[-h, -h, 0.0], [h, -h, 0.0], [h, h, 0.0], [-h, h, 0.0]]),
        faces=np.array([[0, 1, 2], [0, 2, 3]]),
        process=False,          # never weld or reorder - 4 vertices must stay 4
    )


def load_body(glb):
    import trimesh

    scene = trimesh.load(str(glb), force="scene")

    # Snapping is not idempotent - it rotates - so it must never read its own
    # output. It used to, and a second run turned every frame 90 degrees again
    # and produced a model that assembled confidently in the wrong orientation.
    # The converter now writes <id>.converted.glb and this writes <id>.glb, but
    # refuse loudly anyway rather than trust the naming.
    snapped = [n for n in scene.graph.nodes_geometry if n.startswith("md-snap")]
    if snapped:
        raise RuntimeError(
            f"input already has {len(snapped)} snap nodes - this is a snapped "
            "component, not the converter's output. Re-run youk:convert."
        )

    parts = [
        scene.geometry[scene.graph[n][1]].copy().apply_transform(scene.graph[n][0])
        for n in scene.graph.nodes_geometry
        if isinstance(scene.geometry[scene.graph[n][1]], trimesh.Trimesh)
        and len(scene.geometry[scene.graph[n][1]].vertices) > 4
    ]
    if not parts:
        raise RuntimeError("no mesh geometry")
    return trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0]


def frame_snaps(mesh, part, spec):
    """A socket at every rung that fits, facing both ways."""
    depth = str(part["depth"])
    tops = spec["rungTopsMm"].get(depth)
    if tops is None:
        raise RuntimeError(f"no rungTopsMm entry for depth {depth}")

    height_mm = float(mesh.extents[1]) * 1000.0
    usable = [t for t in tops if t <= height_mm]
    if not usable:
        raise RuntimeError(f"no rung fits inside {height_mm:.0f}mm")

    mask = f"youk-d{depth}"
    snaps = []
    for i, top in enumerate(usable, 1):
        for side, facing in (("right", "+x"), ("left", "-x")):
            snaps.append({
                "name": f"md-snap.{mask}.rung-{i}-{side}",
                "position_mm": (0.0, top, 0.0),
                "facing": facing,
                "role": "socket",
            })
    return snaps, {"rungs": len(usable), "rungTops": usable, "mask": mask}


def span_snaps(mesh, part, spec):
    """A plug at each end, inset by half a frame thickness.

    Which FACE bears on the rung differs across the family, and getting it wrong
    puts the part a whole part-height out of position:

      base  a shelf is dropped in from above and its bracket's underside is the
            part's own base, so the plug sits at y = 0
      top   a clothes rail hangs BELOW the rung - its 1.5mm top sheet bears on
            the rung's top face, exactly like a hang accessory's, so the plug
            sits at maxY minus that sheet

    The shelf is the odd one out. Every other bracket in this range presents its
    top sheet to the rung, which is why "top" reuses topSheetMm rather than
    carrying a number of its own.
    """
    depth = str(part["depth"])
    inset = float(spec.get("frameThicknessMm", 30.0)) / 2.0
    half_width_mm = float(mesh.extents[0]) * 1000.0 / 2.0
    x = half_width_mm - inset

    bearing = part.get("bearing", "base")
    if bearing == "base":
        y = 0.0
    elif bearing == "top":
        y = float(mesh.vertices[:, 1].max()) * 1000.0 - float(spec.get("topSheetMm", 1.5))
    else:
        raise RuntimeError(f'unknown bearing {bearing!r} - use "base" or "top"')

    mask = f"youk-d{depth}"
    snaps = [
        {"name": f"md-snap.{mask}.mount-left",
         "position_mm": (-x, y, 0.0), "facing": "-x", "role": "plug"},
        {"name": f"md-snap.{mask}.mount-right",
         "position_mm": (x, y, 0.0), "facing": "+x", "role": "plug"},
    ]
    return snaps, {"plugX_mm": round(x, 2), "plugY_mm": round(y, 2),
                   "bearing": bearing, "spacing_mm": round(2 * x, 2), "mask": mask}


def hang_snaps(mesh, part, spec):
    """One plug, taken from the part's own mounting slot.

    A suspended element drops onto a rung from above (MA 406209): the 1.5mm top
    sheet's underside bears on the rung's top face, and an obround slot in that
    sheet drops over the 5x5 hole in the rung's top wall. So the joint is fully
    determined by geometry both parts already carry - find the slot and the plug
    is its centre. Nothing is typed in per part, which is the point: the same
    pressed bracket appears on the hook strip, the tray and the newspaper rack,
    and all three are measured rather than trusted to match.

    Along the rung the plug sits at z = 0. That is not an assumption either: the
    slots are at +/-95mm on every 320 accessory and the rung holes at +/-95mm on
    every 320 frame (35 for the 200s), so the part is centred on the frame's
    depth.
    """
    import numpy as np

    depth = str(part["depth"])
    hole = spec.get("mountHoleMm", {}).get(depth)
    if hole is None:
        raise RuntimeError(f"no mountHoleMm entry for depth {depth}")
    hole = float(hole)

    v = mesh.vertices * 1000.0
    top_y = float(v[:, 1].max())

    # Find the slot anywhere in the top of the part, then take BOTH the plug's
    # x and its y from it. Taking y as maxY minus a sheet thickness was wrong on
    # two of the four YouboXx sets, where a moulded lid stands a few millimetres
    # proud of the bracket - "the top 1.5mm" was lid, not sheet, and the search
    # found nothing. The slot's own lower ring IS the face that bears on the
    # rung, so measuring it needs no assumption about what sits above.
    near_top = v[v[:, 1] >= top_y - SLOT_SEARCH_MM]
    slot = near_top[np.abs(np.abs(near_top[:, 2]) - hole) <= 1.6]
    if len(slot) < 4:
        raise RuntimeError(
            f"no mounting slot at z = +/-{hole:.0f}mm within {SLOT_SEARCH_MM}mm "
            f"of the top ({len(slot)} vertices found) - wrong depth, wrong "
            "rotation, or this part does not use the standard hang bracket"
        )
    # One sheet only: a part can have more than one slot down its height.
    slot = slot[slot[:, 1] >= slot[:, 1].max() - 4.0]

    x = float((slot[:, 0].min() + slot[:, 0].max()) / 2.0)
    y = float(slot[:, 1].min())
    sheet = float(slot[:, 1].max()) - y
    mask = f"youk-d{depth}"
    snaps = [{
        "name": f"md-snap.{mask}.mount",
        "position_mm": (x, y, 0.0),
        "facing": "-x",
        "role": "plug",
    }]
    reach = float(v[:, 0].max()) - x
    return snaps, {
        "mask": mask,
        "plug_mm": (round(x, 2), round(y, 2)),
        "slotWidth_mm": round(float(slot[:, 0].max() - slot[:, 0].min()), 2),
        "sheet_mm": round(sheet, 2),
        "reach_mm": round(reach, 1),
    }


def build(glb, part, spec, kind, out_path):
    """Rotate if asked, add the snap nodes, write the GLB."""
    import numpy as np
    import trimesh

    mesh = load_body(glb)

    rotate = float(part.get("rotateYdeg", 0.0))
    if rotate:
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(math.radians(rotate), [0, 1, 0])
        )
        # Re-centre in plan and re-seat on y=0: a rotation about the origin can
        # leave both off, and the pipeline enforces origin at base centre.
        lo, hi = mesh.bounds
        mesh.apply_translation([
            -(lo[0] + hi[0]) / 2.0, -lo[1], -(lo[2] + hi[2]) / 2.0,
        ])

    snaps, detail = {
        "frame": frame_snaps, "span": span_snaps, "hang": hang_snaps,
    }[kind](mesh, part, spec)

    scene = trimesh.Scene()
    scene.add_geometry(mesh, node_name="body", geom_name="body")

    quad = snap_quad()
    for snap in snaps:
        transform = quat_matrix(FACING_QUAT[snap["facing"]])
        transform[:3, 3] = np.array(snap["position_mm"]) / 1000.0
        scene.add_geometry(
            quad.copy(), node_name=snap["name"], geom_name=snap["name"],
            transform=transform,
        )

    out_path.write_bytes(trimesh.exchange.gltf.export_glb(scene))
    return snaps, detail, mesh


def verify(out_path, snaps):
    """The output must be a flat scene of 4-vertex planes with the right names.

    describeGltf refuses a nested scene and component.js refuses a snap that is
    not a flat quad, so both are checked here rather than discovered later by
    a component that silently fails to load.
    """
    import trimesh

    scene = trimesh.load(str(out_path), force="scene")
    names = set(scene.graph.nodes_geometry)

    missing = [s["name"] for s in snaps if s["name"] not in names]
    if missing:
        raise RuntimeError(f"names did not survive export: {missing[:3]}")
    if "body" not in names:
        raise RuntimeError('no "body" node in the output')

    for snap in snaps:
        geom = scene.geometry[scene.graph[snap["name"]][1]]
        if len(geom.vertices) != 4:
            raise RuntimeError(
                f'{snap["name"]} exported with {len(geom.vertices)} vertices, not 4 '
                "- component.js will refuse it"
            )
    return len(names)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("folder", help="folder of converted .glb components")
    ap.add_argument("--spec", required=True)
    ap.add_argument("--suffix", default="", help="write to <id><suffix>.glb instead of in place")
    args = ap.parse_args()

    folder = Path(args.folder)
    spec = json.loads(Path(args.spec).read_text(encoding="utf8"))

    jobs = ([("frame", p) for p in spec.get("frames", [])]
            + [("span", p) for p in spec.get("span", [])]
            + [("hang", p) for p in spec.get("hang", [])])
    if not jobs:
        print("spec lists no parts", file=sys.stderr)
        return 1

    failures = 0
    for kind, part in jobs:
        source = folder / f'{part["id"]}.converted.glb'
        target = folder / f'{part["id"]}{args.suffix}.glb'
        if not source.exists():
            print(f'  {part["id"]:<46} MISSING {source.name}')
            failures += 1
            continue

        try:
            snaps, detail, mesh = build(source, part, spec, kind, target)
            nodes = verify(target, snaps)

            dims = [round(float(v) * 1000, 1) for v in mesh.extents]
            print(f'  {part["id"]:<46} {kind:<5} '
                  f'{dims[0]:>7.1f} x {dims[1]:>7.1f} x {dims[2]:>6.1f} mm  '
                  f'{len(snaps):>2} snaps, {nodes} nodes')
            if kind == "frame":
                print(f'  {"":<46}       {detail["rungs"]} rungs at '
                      f'{", ".join(f"{t:.0f}" for t in detail["rungTops"])} mm')
            elif kind == "span":
                print(f'  {"":<46}       plugs at x = +/-{detail["plugX_mm"]}, '
                      f'y {detail["plugY_mm"]} ({detail["bearing"]}) mm '
                      f'-> frames {detail["spacing_mm"]} mm apart')
            else:
                px, py = detail["plug_mm"]
                print(f'  {"":<46}       plug at x {px}, y {py} mm from a '
                      f'{detail["slotWidth_mm"]} mm slot in a {detail["sheet_mm"]} mm '
                      f'sheet; reaches {detail["reach_mm"]} mm out')

            # The roles go in the sidecar, which declare.mjs then applies. Kept
            # separate on purpose: the sidecar is what a human reviews.
            sidecar = folder / f'{part["id"]}{args.suffix}.confgr.json'
            existing = json.loads(sidecar.read_text(encoding="utf8")) if sidecar.exists() else {}
            existing["confgr"] = {
                "widthMm": dims[0], "heightMm": dims[1], "depthMm": dims[2],
                "unitScale": "metres",
            }
            existing["confgrRoles"] = {s["name"]: s["role"] for s in snaps}
            sidecar.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf8")

        except Exception as err:  # noqa: BLE001
            failures += 1
            print(f'  {part["id"]:<46} FAILED: {err}')

    print()
    print(f"{len(jobs) - failures}/{len(jobs)} parts given snap planes")
    print("Next: npm run declare youk   (applies the roles), then npm run inspect youk")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
