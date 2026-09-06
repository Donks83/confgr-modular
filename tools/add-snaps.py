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

# For the `bolted` family. How far off a face plane a vertex can be and still
# count as on it, and how far a declared hole may be from real geometry before
# the whole part is refused. The second is deliberately TIGHT: the point of
# declaring a hole is that it can be checked, and a loose check is the same as
# no check - which is how the office arm ended up in the wrong family.
HOLE_PLANE_TOL_MM = 0.6
HOLE_FIND_TOL_MM = 3.5

# glTF quaternions are [x, y, z, w]. A snap's facing is its local +Z, so these
# rotate +Z onto each axis.
ROOT_HALF = math.sqrt(0.5)
FACING_QUAT = {
    "+z": (0.0, 0.0, 0.0, 1.0),
    "+x": (0.0, ROOT_HALF, 0.0, ROOT_HALF),
    "-z": (0.0, 1.0, 0.0, 0.0),
    "-x": (0.0, -ROOT_HALF, 0.0, ROOT_HALF),
    # Flat faces, for a part LAID ON another rather than met edge-on: the
    # carcase on its brackets, the office desktop on its shelf supports. The
    # engine refused these outright until the vertical joint went in - see
    # solveChildTransform. Only emitted when the spec asks for one, which is
    # what stops a snap ending up flat by accident.
    "+y": (-ROOT_HALF, 0.0, 0.0, ROOT_HALF),
    "-y": (ROOT_HALF, 0.0, 0.0, ROOT_HALF),
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


def tops_for_depth(spec, depth):
    """The rung heights for a ladder depth. One list, read in two places."""
    tops = spec["rungTopsMm"].get(str(depth))
    if tops is None:
        raise RuntimeError(f"no rungTopsMm entry for depth {depth}")
    return tops


def frame_snaps(mesh, part, spec):
    """A socket at every rung that fits, facing both ways."""
    depth = str(part["depth"])
    tops = tops_for_depth(spec, depth)

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
    # A bracket that CARRIES something adds a second snap: a flat socket on the
    # face the carried part rests on. `Carcass holder` step 3 - the carcase sits
    # on the brackets and is screwed up from below - and step 5 puts the usual
    # 1.5mm packer between bracket and carcase underside, so the socket sits a
    # packer above the plate rather than on it.
    #
    # The plate's top face is MEASURED, not declared. It is the part's own
    # highest point, which for the 8mm carcase brackets is y = 8.0. Typing that
    # in per part is exactly how the extension brackets would end up wrong.
    #
    # Its own mask, so a carcase can only meet a bracket. Sharing the rung mask
    # would let a cabinet hang straight off a ladder with nothing under it.
    # WHERE this part may hang, when the answer is not "any rung".
    #
    # `Office solution` page 3 opens with a tick and a cross over four ladders,
    # green across one rung line and red across two others. Matt read it
    # correctly and I did not: it marks the only levels the desktop assembly may
    # be fitted at, and it is the one rule in the range that masks and roles
    # cannot express. A mask says what kind of thing fits; a role says which way
    # round; neither says "this kind, but only there".
    #
    # The SPEC says `minRung: 3`. The list of labels is expanded here, so the
    # decision stays one number a person can check against the drawing and the
    # eight strings stay mechanical. A knock-on falls straight out of it: the
    # 550mm frame has only rungs 1 and 2, so no label it offers is in the list
    # and it cannot take a desk at all - which is what the sheet shows.
    min_rung = part.get("minRung")
    if min_rung:
        allowed = [f"rung-{i}-{side}"
                   for i in range(int(min_rung), len(tops_for_depth(spec, depth)) + 1)
                   for side in ("right", "left")]
        snaps[0]["condition"] = {
            "otherLabelAnyOf": allowed,
            "because": part.get(
                "minRungBecause",
                f"This fits at rung {min_rung} and above only.",
            ),
        }

    reach = float(v[:, 0].max()) - x
    return snaps, {
        "mask": mask,
        "plug_mm": (round(x, 2), round(y, 2)),
        "slotWidth_mm": round(float(slot[:, 0].max() - slot[:, 0].min()), 2),
        "sheet_mm": round(sheet, 2),
        "reach_mm": round(reach, 1),
    }


def carries_socket(mesh, part, spec):
    """A flat socket on the face this part carries something on.

    Was written inside hang_snaps, because the first two parts that carried
    anything - the cabinet brackets - were hang parts. The office arm is not: it
    bolts to a plate. Moving this out of the family and composing it in build()
    is the same fix as the bolted sockets, and for the same reason. WHAT A PART
    CARRIES IS INDEPENDENT OF HOW IT IS HELD.

    `Carcass holder` step 5 and `Office solution` step 7 both put the usual
    1.5mm packer between bracket and the underside above it, so the socket sits
    a packer above the part's own highest point - measured, not declared.

    IN Z the socket sits at the part's own middle, UNLESS the part declares
    `carriesBackStop` - it has something at its rear end for the carried part to
    sit against. The office arm does: `Office solution` step 4 bolts a CLAMPING
    ANGLE there and step 6 draws a tick and a cross for whether the board's back
    edge is against its upstand. The arm is 310mm long on a 320mm ladder, so
    back-flush measured off the nominal ladder depth put the board 5mm too far
    back and it passed straight through the angle. With the stop declared, the
    socket moves half a ladder-depth forward of the part's own rear end, which
    lands the board's back edge on that end whatever the board's depth.

    Deliberately NOT the rule for everything. A cabinet bracket is 315mm on a
    320mm ladder and has no stop of any kind: its cabinet is centred, which is
    what §5.6 verified and what a symmetric part with nothing to butt against
    should do. Making this universal would have moved every cabinet 2.5mm
    forward to satisfy a piece of metal that only exists on the desk.
    """
    v = mesh.vertices * 1000.0
    top_y = float(v[:, 1].max())
    packer = float(spec.get("topSheetMm", 1.5))
    z = 0.0
    if part.get("carriesBackStop"):
        # +z is the WALL - see carcase_snaps. Half a ladder-depth in from this
        # part's own WALL end is where a carried part's plugs must meet it for
        # that part's back edge to land on the end, whatever its own depth.
        z = float(v[:, 2].max()) - float(part["depth"]) / 2.0
    return [{
        "name": f"md-snap.youk-{part['carries']}-d{part['depth']}.carries",
        "position_mm": (0.0, top_y + packer, z),
        "facing": "+y",
        "role": "socket",
    }], {"carriesY_mm": round(top_y + packer, 2), "carriesZ_mm": round(z, 2)}


def carcase_snaps(mesh, part, spec):
    """Two plugs on the UNDERSIDE, one over each bracket.

    The mirror image of the span family. A shelf meets the rungs edge-on and its
    plugs face outward along x; a carcase is laid on top of two brackets and its
    plugs face straight down, because that is the only face it mates on. Nothing
    holds it sideways - `Carcass holder` step 3 screws it up from below, and step
    4 puts two dowels in for location.

    The plugs sit at the extreme ends, not inset. That is not a shortcut: the
    box is generated exactly as wide as the gap between the two bracket centres,
    so its ends and its plugs are the same place. tools/make-timber.py derives
    that width by READING the bracket's own plug offset out of the snapped GLB
    rather than being told it, which is what keeps the two in step.

    ALONG THE DEPTH the plugs are NOT at the part's middle, and this is the rule
    that makes the office desktop work. A carried part sits with its BACK FLUSH
    to the WALL end of what carries it - `Office solution` step 6 draws a tick
    and a cross over exactly that, the desktop's rear edge against the clamping
    angle. So a part deeper than the ladder hangs its plugs on the WALL side of
    its own centre by half the difference, and the rest projects into the room.

    +Z IS THE WALL, and that is measured rather than assumed. It was assumed
    wrongly here until the foot needed a front: the frame's wall fixings - a
    10 mm hole and a 6.5 mm slot, top and bottom - are on its +z face ONLY, and
    the upper slot's centre sits 55 mm below the top of the frame, which is the
    dimension `mounting instructions.pdf` step 2 tells you to mark on the wall.
    The sign below used to be the other way round, so a 600 mm desktop projected
    290 mm THROUGH the wall while looking perfectly reasonable from the front.

    A cabinet is exactly as deep as its ladder, so this is zero either way and
    the cabinets never showed it.
    """
    depth_mm = float(part["depth"])
    depth = str(part["depth"])
    half = float(mesh.extents[0]) * 1000.0 / 2.0
    z = (float(mesh.extents[2]) * 1000.0 - depth_mm) / 2.0
    mask = f"youk-{part.get('carriedBy', 'carcase')}-d{depth}"
    snaps = [
        {"name": f"md-snap.{mask}.rest-left",
         "position_mm": (-half, 0.0, z), "facing": "-y", "role": "plug"},
        {"name": f"md-snap.{mask}.rest-right",
         "position_mm": (half, 0.0, z), "facing": "-y", "role": "plug"},
    ]
    return snaps, {"mask": mask, "plugX_mm": round(half, 2),
                   "plugZ_mm": round(z, 2), "spacing_mm": round(2 * half, 2)}


def bolted_snaps(mesh, part, spec):
    """A part bolted flat against another part's face, through named holes.

    THE FAMILY THAT EXISTS BECAUSE OF A MISTAKE. The office arm was authored as
    a `hang` part because the slot search found a ~6mm feature near its top and
    reported a mounting slot. It is a hole the DESKTOP screws into. The sheet
    said all along that the arm bolts to the plate; a geometric search overruled
    a drawing that had already been read.

    So this family inverts the relationship. The SPEC names the hole - which is
    a decision, and a decision a person can check against the drawing - and this
    script VERIFIES that a hole is really there before authoring anything. The
    search no longer decides; it corroborates, and it fails loudly when the
    geometry and the decision disagree.

    Spec shape:

        face:      "-x" | "+x" | "-y" | "+y" | "-z" | "+z"   the part's own face
        boltMask:  the mask that face's holes join on
        holes: [ { label, x, y, z, role?, roll?, face?, mask?, slotEnds? }, ... ]

    Every hole gives all three coordinates. The one along its face's axis IS
    the face plane - it is not read off the bounding box - so a face that is
    not the part's extreme needs no new field: the clamping angle bolts on the
    INNER surface of its own 3mm leg, at z -6.99 of a part that runs to -9.99.
    The plane is then checked like everything else: a face with fewer than 8
    vertices on it is refused, so a typo names a face that is not there.

    `face` and `mask` may be given PER HOLE, defaulting to the part's own. A
    part is not limited to one bolted joint: the office arm bolts to the plate
    on its web (-x) and hosts the clamping angle on its rear end (-z), and the
    two joints must not share a mask or a clamping angle would bolt to a plate.

    `slotEnds` says the hole is a SLOT - two ends, and the chosen position
    between them. The arm's rear end has one so the clamping angle can be set
    to the thickness of the board. Both ends are verified against real geometry
    AND the chosen point must lie on the segment between them, so declaring a
    slot is a tighter check than declaring a hole, never a way round one.

    `roll` is a turn about the joint axis, in degrees. The plate carries two
    sets of holes: level, and dropping 39.11mm over 246.92mm, which is 9.000
    degrees exactly. Same parts, two angles - a desk or a drawing board.
    """
    import numpy as np

    v = mesh.vertices * 1000.0
    lo, hi = v.min(axis=0), v.max(axis=0)

    holes = part.get("holes", [])
    if not holes:
        raise RuntimeError("bolted part declares no holes")

    snaps, report = [], []
    for hole in holes:
        label = hole.get("label", "?")
        face = hole.get("face", part.get("face"))
        if face not in FACING_QUAT:
            raise RuntimeError(
                f'hole {label} needs a face, one of {sorted(FACING_QUAT)}'
            )
        bolt_mask = hole.get("mask", part.get("boltMask"))
        if not bolt_mask:
            raise RuntimeError(f"hole {label} has no mask, and the part sets none")
        mask = f"youk-{bolt_mask}"

        axis = {"x": 0, "y": 1, "z": 2}[face[1]]
        # The two in-plane axes, in the order the spec writes them, so a hole
        # reads as (y, z) on an x-face and (x, y) on a z-face without saying so.
        across = [i for i in (0, 1, 2) if i != axis]
        if "xyz"[axis] not in hole:
            raise RuntimeError(
                f'hole {label} on face {face} gives no {"xyz"[axis]} - that '
                f"coordinate IS the face plane and has to be declared"
            )
        plane = float(hole["xyz"[axis]])
        if not (lo[axis] - HOLE_PLANE_TOL_MM <= plane <= hi[axis] + HOLE_PLANE_TOL_MM):
            raise RuntimeError(
                f'hole {label} puts face {face} at {plane:.2f}mm, outside the '
                f"part ({lo[axis]:.2f} to {hi[axis]:.2f}mm)"
            )

        on = v[np.abs(v[:, axis] - plane) <= HOLE_PLANE_TOL_MM]
        if len(on) < 8:
            raise RuntimeError(
                f"face {face} at {plane:.2f}mm has only {len(on)} vertices - wrong face?"
            )
        near = on[:, across]

        def at(d):
            return np.array([float(d["xyz"[a]]) for a in across])

        want = at(hole)
        ends = hole.get("slotEnds")
        if ends is not None and len(ends) != 2:
            raise RuntimeError(f"hole {label}: slotEnds needs exactly two ends")

        found = []
        for target in ([at(e) for e in ends] if ends else [want]):
            d = np.linalg.norm(near - target, axis=1)
            if d.min() > HOLE_FIND_TOL_MM:
                raise RuntimeError(
                    f"no hole within {HOLE_FIND_TOL_MM}mm of {label} at "
                    f"{tuple(target)} on face {face} - nearest vertex is "
                    f"{d.min():.2f}mm away. The spec names holes; if the geometry "
                    f"moved, the spec is what has to change, deliberately."
                )
            found.append(round(float(d.min()), 2))

        if ends:
            a, b = at(ends[0]), at(ends[1])
            along = b - a
            span = float(np.dot(along, along))
            if span <= 0:
                raise RuntimeError(f"hole {label}: both slot ends are the same point")
            t = float(np.dot(want - a, along) / span)
            off = float(np.linalg.norm(a + t * along - want))
            if not (0.0 <= t <= 1.0) or off > HOLE_PLANE_TOL_MM:
                raise RuntimeError(
                    f"{label} at {tuple(want)} is not ON the slot from {tuple(a)} "
                    f"to {tuple(b)}: {off:.2f}mm off the line, {t * 100:.0f}% along "
                    f"it. A slot is a line, and where a part sits on it is a "
                    f"decision that still has to land on the metal."
                )

        pos = [0.0, 0.0, 0.0]
        pos[axis] = plane
        for i, a in enumerate(across):
            pos[a] = float(want[i])
        snaps.append({
            "name": f"md-snap.{mask}.{label}",
            "position_mm": tuple(pos),
            "facing": face,
            "role": hole.get("role", "socket"),
            "roll": float(hole.get("roll", 0.0)),
        })
        report.append({
            "label": label, "mask": mask, "face": face,
            "role": hole.get("role", "socket"),
            "plane_mm": round(plane, 2), "roll": float(hole.get("roll", 0.0)),
            "found_mm": max(found), "slot": bool(ends),
        })

    return snaps, {"holes": report}


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
        "carcase": carcase_snaps, "bolted": bolted_snaps,
    }[kind](mesh, part, spec)

    # A part can be in one family AND be something else's bolt-on host. The
    # office plate hooks a rung (so it is `hang`) and offers the four sockets the
    # arm bolts to. Composed here rather than special-cased inside hang_snaps,
    # so any family can host a bolted part without knowing about it.
    if kind != "bolted" and part.get("holes"):
        extra, extra_detail = bolted_snaps(mesh, part, spec)
        snaps = list(snaps) + extra
        detail = {**detail, "bolted": extra_detail}

    # And what it carries, for the same reason - see carries_socket.
    if part.get("carries"):
        extra, extra_detail = carries_socket(mesh, part, spec)
        snaps = list(snaps) + extra
        detail = {**detail, **extra_detail}

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
            + [("hang", p) for p in spec.get("hang", [])]
            + [("carcase", p) for p in spec.get("carcase", [])]
            + [("bolted", p) for p in spec.get("bolted", [])]
            + [("wall", p) for p in spec.get("wall", [])])
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
            if kind == "wall":
                # Nothing to author, because this part joins nothing. The YouK
                # shoe rack is marked out with a spirit level and screwed
                # straight to the wall - no ladder appears anywhere in its
                # instruction sheet - so the absence of snaps is a fact about
                # the part rather than a step somebody forgot.
                #
                # It still goes through here rather than being copied by hand,
                # so the spec stays the single list of what is authored, and so
                # the declaration that MAKES the absence legal is written by the
                # same pass that decides it.
                import shutil

                mesh = load_body(source)
                shutil.copyfile(source, target)
                dims = [round(float(v) * 1000, 1) for v in mesh.extents]
                print(f'  {part["id"]:<46} {kind:<5} '
                      f'{dims[0]:>7.1f} x {dims[1]:>7.1f} x {dims[2]:>6.1f} mm  '
                      f'no snaps, fixes to the wall')

                sidecar = folder / f'{part["id"]}{args.suffix}.confgr.json'
                existing = json.loads(sidecar.read_text(encoding="utf8")) if sidecar.exists() else {}
                existing["confgr"] = {
                    "widthMm": dims[0], "heightMm": dims[1], "depthMm": dims[2],
                    "unitScale": "metres",
                    "mounting": "wall",
                }
                existing.pop("confgrRoles", None)
                sidecar.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf8")
                continue

            snaps, detail, mesh = build(source, part, spec, kind, target)
            nodes = verify(target, snaps)

            dims = [round(float(v) * 1000, 1) for v in mesh.extents]
            print(f'  {part["id"]:<46} {kind:<5} '
                  f'{dims[0]:>7.1f} x {dims[1]:>7.1f} x {dims[2]:>6.1f} mm  '
                  f'{len(snaps):>2} snaps, {nodes} nodes')
            bolt = detail if kind == "bolted" else detail.get("bolted")
            if bolt:
                for h in bolt["holes"]:
                    tilt = f'roll {h["roll"]:+.0f} deg' if h["roll"] else 'flat'
                    what = "slot" if h["slot"] else "hole"
                    print(f'  {"":<46}       {h["label"]:<18} {h["role"]:<6} '
                          f'{h["mask"]:<18} face {h["face"]} at {h["plane_mm"]:>8.2f} mm  '
                          f'{tilt:<12} {what} verified, {h["found_mm"]} mm from '
                          f'real geometry')

            if kind == "bolted":
                pass
            elif kind == "frame":
                faces = (f', front {part["front"]}' if part.get("front")
                         else ', no front declared')
                print(f'  {"":<46}       {detail["rungs"]} rungs at '
                      f'{", ".join(f"{t:.0f}" for t in detail["rungTops"])} mm{faces}')
            elif kind == "span":
                faces = f', front {part["front"]}' if part.get("front") else ''
                print(f'  {"":<46}       plugs at x = +/-{detail["plugX_mm"]}, '
                      f'y {detail["plugY_mm"]} ({detail["bearing"]}) mm '
                      f'-> frames {detail["spacing_mm"]} mm apart{faces}')
            elif kind == "carcase":
                print(f'  {"":<46}       plugs DOWN at x = +/-{detail["plugX_mm"]}, '
                      f'z {detail["plugZ_mm"]} mm '
                      f'-> brackets {detail["spacing_mm"]} mm apart')
            else:
                px, py = detail["plug_mm"]
                print(f'  {"":<46}       plug at x {px}, y {py} mm from a '
                      f'{detail["slotWidth_mm"]} mm slot in a {detail["sheet_mm"]} mm '
                      f'sheet; reaches {detail["reach_mm"]} mm out')

            # Outside the family branches: what a part carries no longer depends
            # on how it is held.
            if detail.get("carriesY_mm") is not None:
                where = ('centred' if not detail["carriesZ_mm"]
                         else 'back edge on its own rear end, where the stop is')
                print(f'  {"":<46}       carries a part at y '
                      f'{detail["carriesY_mm"]} mm (its own top + packer), '
                      f'z {detail["carriesZ_mm"]} mm - {where}')

            # The roles go in the sidecar, which declare.mjs then applies. Kept
            # separate on purpose: the sidecar is what a human reviews.
            sidecar = folder / f'{part["id"]}{args.suffix}.confgr.json'
            existing = json.loads(sidecar.read_text(encoding="utf8")) if sidecar.exists() else {}
            existing["confgr"] = {
                "widthMm": dims[0], "heightMm": dims[1], "depthMm": dims[2],
                "unitScale": "metres",
            }
            # Which way round the part is fitted, when the part has a way round.
            # Written into confgr rather than a table of its own because it is a
            # fact about the PART, like its size, not about one of its snaps -
            # and because a reviewer reading the sidecar should see it next to
            # the dimensions rather than three blocks further down.
            if part.get("front"):
                existing["confgr"]["front"] = part["front"]
            existing["confgrRoles"] = {s["name"]: s["role"] for s in snaps}
            # Conditions travel the same way, and are REPLACED rather than
            # merged: the spec is the source, so a rule removed from the spec
            # has to disappear from the model too. A stale allow-list left
            # behind would go on refusing joints with nothing saying why.
            conditions = {s["name"]: s["condition"] for s in snaps if s.get("condition")}
            if conditions:
                existing["confgrConditions"] = conditions
            else:
                existing.pop("confgrConditions", None)
            # Roll travels the same way, replaced rather than merged. A stale
            # 9 degrees left on a snap whose spec entry went back to flat would
            # tilt a desk with nothing saying why.
            rolls = {s["name"]: s["roll"] for s in snaps if s.get("roll")}
            if rolls:
                existing["confgrRolls"] = rolls
            else:
                existing.pop("confgrRolls", None)
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
