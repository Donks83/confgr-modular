"""Generate the timber parts, which have no supplier CAD and never will.

Kesseboehmer say so themselves. YouK-Brochure_EN.pdf page 3: the wooden shelves
"are made individually by a carpenter (or woodworker) and are therefore not
included in the YouK range". Almost every shelf in their own photography is one
of these, so a configurator without them shows a metal frame where the customer
expects furniture - and there is no STEP file coming, ever.

So these are OURS: modelled to Matt's spec rather than converted, and priced by
PWS rather than by Kesseboehmer.

WHY THIS WRITES <id>.converted.glb RATHER THAN A FINISHED COMPONENT. That suffix
is what tools/add-snaps.py reads. Writing it means a generated board goes through
exactly the same pipeline as a supplier part - snap authoring from the spec,
declare, inspect, and check-joint against real frame geometry - instead of
getting a private path that nothing verifies. A part we invented is the LAST
thing that should skip the checks.

THE SPEC (Matt, 5 Sep 2026):

  boards      25mm thick, always. That is Kesseboehmer's own figure too -
              annotated five times on page 4 of the office-solution sheet.
  lengths     the standard bay widths: 450 / 600 / 900 / 1200
  cabinets    six-piece box construction, small chamfer, no internal detail

Widths here are the MEASURED overall lengths of the equivalent metal shelves,
not the nominal sizes, because the whole point is that a bay carries either. A
900 metal shelf measures 950.2mm and sets its frames 920.1mm apart; a timber 900
must do the same or it is not an alternative, it is a different product.
"""

import argparse
import json
import math
import sys
from pathlib import Path

# Nominal -> real overall length, taken from what add-snaps REPORTS for the
# equivalent metal shelf, not from a separate measurement of the same file.
#
# That distinction cost a version. Reading the geometry directly gave 950.2 for
# the 900 and the pipeline reports 950.1, so the first run put the timber
# shelf's frames 920.2mm apart against the metal shelf's 920.1. A tenth of a
# millimetre is invisible and completely wrong: the whole claim is that a bay
# carries EITHER, and two parts asking for bays 0.1mm apart do not.
#
# Deliberately not computed as nominal + 50 either: the 600 is 649.5, not 650.
SHELF_LENGTH_MM = {450: 500.1, 600: 649.5, 900: 950.1, 1200: 1250.1}

# Bearing depth by ladder depth, from the general mounting instructions: a shelf
# is usable to 169mm on a 200 frame and 289mm on a 320.
SHELF_DEPTH_MM = {200: 169.0, 320: 289.0}

BOARD_THICKNESS_MM = 25.0

# The ladder stile, 30 mm. A shelf's plugs are inset half of it at each end, so
# the bay's ladder spacing is the shelf's overall length less this. Matches
# frameThicknessMm in youk/snap-spec.json, which is where add-snaps reads it.
FRAME_THICKNESS_MM = 30.0

# Cabinet heights. Kesseböhmer cap the carcase at 450 mm on the carcase-holder
# sheet, so 450 is their maximum rather than a round number we liked; the other
# two are Matt's, to give a run something to vary. Width is NOT a free choice -
# it is whatever makes the box land on both brackets - and depth is the ladder
# depth, which is their stated minimum.
CABINET_HEIGHTS_MM = (200, 300, 450)

# Desktop depths, from page 4 of `mounting instructions Office solution.pdf`:
# 600 or 700 mm. Their 650 / 750 mm figures on the same page are floor-to-top
# HEIGHTS, not variants of the part - where the desk ends up depends on how high
# the ladder is hung, which is a mounting choice and not a property of the board
# (§5.1). The third figure, 750 with 100 mm underneath, is the frame on feet.
#
# The 9-degree angled option on that page is NOT generated. It would need a
# wedge rather than a board and a joint that tilts, and neither exists yet.
DESKTOP_DEPTHS_MM = (600, 700)

# The office solution is a 320-only assembly: its plate is 315 mm across the
# ladder depth and its arm 310 mm long. There is no 200 version to make.
DESKTOP_LADDER_DEPTH_MM = 320

# Small enough to catch a highlight and read as a real edge, small enough that
# nobody would call it a bevel. Not a spec number - a rendering one.
CHAMFER_MM = 1.5

# An INDICATIVE light-oak finish, not a Kesseboehmer decor and not a PWS one
# either - there is no decor range to match yet, and inventing a named finish
# would be the same mistake as inventing a price. It exists because the first
# render made the point: an untextured board takes the viewer's default grey,
# so the timber shelf came out looking like a second metal one and the whole
# reason for building these parts - a picture that looks like their photography
# rather than like a steel frame - was lost. Rough and non-metallic matters
# more than the exact hue; replace the hue the day there is a real decor.
TIMBER_BASE_COLOR = (0.760, 0.588, 0.400, 1.0)
TIMBER_ROUGHNESS = 0.75
TIMBER_METALLIC = 0.0


def timber_material():
    import trimesh

    return trimesh.visual.material.PBRMaterial(
        name="pws-timber",
        baseColorFactor=TIMBER_BASE_COLOR,
        roughnessFactor=TIMBER_ROUGHNESS,
        metallicFactor=TIMBER_METALLIC,
    )


def board(length_mm, thickness_mm, depth_mm, chamfer_mm=CHAMFER_MM):
    """A board, origin at base centre, with its top edges eased.

    Origin placement matches the converter's rule and the pipeline enforces it,
    so getting it wrong here fails at inspect rather than looking subtly odd
    later.
    """
    import numpy as np
    import trimesh

    x = length_mm / 2000.0
    y = thickness_mm / 1000.0
    z = depth_mm / 2000.0
    c = min(chamfer_mm, thickness_mm / 3.0) / 1000.0

    # Two stacked rectangles: the full section, then a slightly inset top face.
    # Enough to break the edge without pretending to be joinery.
    lo = [
        (-x, 0.0, -z), (x, 0.0, -z), (x, 0.0, z), (-x, 0.0, z),
        (-x, y - c, -z), (x, y - c, -z), (x, y - c, z), (-x, y - c, z),
    ]
    top = [
        (-x + c, y, -z + c), (x - c, y, -z + c), (x - c, y, z - c), (-x + c, y, z - c),
    ]
    verts = np.array(lo + top, dtype=float)

    # Wound counter-clockwise seen from OUTSIDE, so every normal points out of
    # the board. The first version had all twenty backwards - consistently, so
    # nothing complained: trimesh reported the mesh watertight and the winding
    # consistent, the snap planes were unaffected, and the checks all passed.
    # Matt spotted it in a screenshot. Hence the assertion in write(): a signed
    # volume is the cheap test that would have caught it, and consistency alone
    # is not the same thing as correctness.
    faces = [
        (0, 1, 2), (0, 2, 3),                    # base, facing down
        (0, 5, 1), (0, 4, 5),                    # sides of the main section
        (1, 6, 2), (1, 5, 6),
        (2, 7, 3), (2, 6, 7),
        (3, 4, 0), (3, 7, 4),
        (4, 9, 5), (4, 8, 9),                    # the chamfer band
        (5, 10, 6), (5, 9, 10),
        (6, 11, 7), (6, 10, 11),
        (7, 8, 4), (7, 11, 8),
        (8, 10, 9), (8, 11, 10),                 # top, facing up
    ]

    mesh = trimesh.Trimesh(vertices=verts, faces=np.array(faces), process=False)
    mesh.name = "body"
    return mesh


def dressed(mesh):
    """Give a mesh the timber material. Applied once, after any assembly."""
    import numpy as np
    import trimesh

    # UVs the material does not use, but glTF export drops the material without
    # a TextureVisuals to hang it on.
    mesh.visual = trimesh.visual.TextureVisuals(
        uv=np.zeros((len(mesh.vertices), 2), dtype=float),
        material=timber_material(),
    )
    mesh.name = "body"
    return mesh


# Which way is the wall. attach.js parks a wall-fixed part at the assembly's
# MINIMUM z (`bounds.min[2] - min[2]` in freePositionFor), so -z is the wall and
# +z is the room. That decides which panel is the door, and it is read off the
# engine rather than guessed - a cabinet with its door against the wall is the
# kind of thing that survives to a client demo.
WALL_AXIS = "-z"
DOOR_AXIS = "+z"


def panel(length_mm, thickness_mm, depth_mm, outward, centre_mm):
    """One board of a box, turned so its chamfered face looks along `outward`.

    board() eases the edges of its +y face only. Orienting every panel so that
    face points OUT of the box means each one is eased where it can be seen, and
    the chamfers meet as a shadow gap between panels - which is what makes six
    slabs read as a piece of furniture rather than a solid block.
    """
    import numpy as np
    import trimesh

    slab = board(length_mm, thickness_mm, depth_mm)
    # board() sits on y = 0; centre it before rotating about its own middle.
    slab.apply_translation([0.0, -thickness_mm / 2000.0, 0.0])

    rot = {
        "+y": (0.0, [1, 0, 0]),
        "-y": (math.pi, [1, 0, 0]),
        "+z": (math.pi / 2, [1, 0, 0]),
        "-z": (-math.pi / 2, [1, 0, 0]),
        "+x": (-math.pi / 2, [0, 0, 1]),
        "-x": (math.pi / 2, [0, 0, 1]),
    }[outward]
    slab.apply_transform(trimesh.transformations.rotation_matrix(rot[0], rot[1]))
    slab.apply_translation(np.array(centre_mm) / 1000.0)
    return slab


def cabinet(width_mm, height_mm, depth_mm, thickness_mm=BOARD_THICKNESS_MM):
    """Six panels, origin at base centre, door to the room and back to the wall.

    Six-piece box construction to Matt's spec, no internal detail: two sides,
    base, top, back, and a full-overlay door across the front. The door overlays
    rather than sits between the sides because that is how a PWS door is made,
    and because an inset front reads as a drawer.

    Overall depth INCLUDES the door, so the carcase behind it is depth - t. That
    keeps the box's footprint equal to the ladder depth, which is what
    Kesseböhmer's minimum ("depth at least the ladder depth") is about.
    """
    import trimesh

    t = thickness_mm
    w, h, d = width_mm, height_mm, depth_mm
    box_d = d - t                       # everything behind the door
    box_z = -d / 2 + box_d / 2          # centre of that, in the part's own frame

    panels = [
        # sides: full height, outward faces are the ends of the run
        panel(h, t, box_d, "-x", (-w / 2 + t / 2, h / 2, box_z)),
        panel(h, t, box_d, "+x", (w / 2 - t / 2, h / 2, box_z)),
        # base and top, between the sides
        panel(w - 2 * t, t, box_d, "-y", (0.0, t / 2, box_z)),
        panel(w - 2 * t, t, box_d, "+y", (0.0, h - t / 2, box_z)),
        # back, between the sides and between base and top
        panel(w - 2 * t, t, h - 2 * t, WALL_AXIS, (0.0, h / 2, -d / 2 + t / 2)),
        # door, full overlay
        panel(w, t, h, DOOR_AXIS, (0.0, h / 2, d / 2 - t / 2)),
    ]
    return trimesh.util.concatenate(panels)


def write(mesh, path):
    import trimesh

    # The three things a hand-wound mesh can get wrong, checked before it leaves.
    # Watertight and consistent were BOTH true of the inside-out first version -
    # the signed volume is the one that catches it. Nothing downstream looks at
    # normals (snaps come from the spec, joints from vertex positions), so
    # without this the only detector is somebody noticing the lighting.
    if not mesh.is_watertight:
        raise SystemExit(f"{path.name}: not watertight")
    if not mesh.is_winding_consistent:
        raise SystemExit(f"{path.name}: winding is not consistent")
    if mesh.volume <= 0:
        raise SystemExit(
            f"{path.name}: signed volume {mesh.volume:.6f} - the normals point "
            f"inward, so the board renders inside out"
        )

    scene = trimesh.Scene()
    scene.add_geometry(mesh, node_name="body", geom_name="body")
    path.write_bytes(trimesh.exchange.gltf.export_glb(scene))


def bracket_plug_offset_mm(folder, depth):
    """How far inboard of its ladder a cabinet bracket sits, read off the GLB.

    THE NUMBER THAT SETS THE CABINET'S WIDTH, so it is read rather than typed.

    A bracket straddles the ladder stile, and its plug - the point that lands on
    the rung - is offset from its own centre. For the 320 outer bracket that is
    15.1 mm, so on a bay whose ladders are 920.1 mm apart the two brackets end up
    889.9 mm apart, and a carcase must be exactly that wide for its second plug
    to arrive over the second bracket.

    This is the same class of mistake as the 0.1 mm that nearly shipped in the
    shelf lengths, and the same fix: take the number from what the pipeline
    actually produced. Reading the snapped GLB means the day somebody re-authors
    the brackets, the cabinets follow.
    """
    ids = {320: "008558-outer-cabinet-bracket-for-ladder-depth-320mm",
           200: "008557-outer-cabinet-bracket-for-ladder-depth-200mm"}
    return plug_offset_mm(folder, ids[depth])


def snap_x_mm(folder, part_id, ends_with):
    """The x offset of one named snap on a snapped part, in millimetres."""
    import trimesh

    glb = folder / f"{part_id}.glb"
    if not glb.exists():
        raise SystemExit(
            f"{glb.name} is not there. The timber is sized from the brackets that "
            f"carry it, so those have to be snapped first: npm run youk:snap"
        )
    scene = trimesh.load(str(glb), force="scene")
    for name in scene.graph.nodes_geometry:
        if name.endswith(ends_with):
            return float(scene.graph.get(name)[0][0, 3]) * 1000.0
    raise SystemExit(f"{glb.name} has no snap ending '{ends_with}' - re-run npm run youk:snap")


def office_arm_inset_mm(folder):
    """How far inboard of its ladder an office ARM ends up, along the whole chain.

    Not one number: the arm is three joints away from the ladder, so this walks
    them. Ladder centre -> the plate's rung plug -> the plate's bolt face -> the
    arm's own bolt face.

    THE REASON THIS IS A FUNCTION AND NOT A CONSTANT. The desktop's width used to
    come from the arm's RUNG plug offset, 15.0 mm, because the arm was wrongly
    authored as hooking a rung. Fixing that moved the arm from 15.0 mm inboard to
    42.25, and the desktop went on overshooting the second arm by 54.5 mm while
    still looking perfectly reasonable from the front. Deriving it from the
    parts, every time, is what stops the next such change being silent.
    """
    plate = "008551-base-brackets-for-office-solution"
    arm = "008551-shelf-supports-for-office-solution"
    return (abs(snap_x_mm(folder, plate, ".mount"))
            + snap_x_mm(folder, plate, ".arm-650")
            + abs(snap_x_mm(folder, arm, ".bolt-flat")))


def plug_offset_mm(folder, part_id):
    """How far from its own centre a hang part's rung plug sits, read off the GLB.

    Generalised out of the cabinet case because the office arm needs exactly the
    same thing, and its offset is 15.0 where the cabinet bracket's is 15.1. A
    tenth of a millimetre, and precisely the difference this project has already
    been caught by once - so the desktop reads its own bracket rather than
    borrowing the cabinet's number.
    """
    import trimesh

    glb = folder / f"{part_id}.glb"
    if not glb.exists():
        raise SystemExit(
            f"{glb.name} is not there. The timber is sized from the brackets that "
            f"carry it, so those have to be snapped first: npm run youk:snap"
        )

    scene = trimesh.load(str(glb), force="scene")
    for name in scene.graph.nodes_geometry:
        if name.endswith(".mount"):
            transform = scene.graph.get(name)[0]
            return abs(float(transform[0, 3]) * 1000.0)
    raise SystemExit(f"{glb.name} has no .mount snap - re-run npm run youk:snap")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("folder", nargs="?", default="youk")
    args = ap.parse_args()

    folder = Path(args.folder)
    folder.mkdir(parents=True, exist_ok=True)

    made = []
    for depth in (320, 200):
        for nominal, length in SHELF_LENGTH_MM.items():
            part_id = f"pws-timber-shelf-{nominal}mm-for-ladder-depth-{depth}mm"
            mesh = dressed(board(length, BOARD_THICKNESS_MM, SHELF_DEPTH_MM[depth]))
            out = folder / f"{part_id}.converted.glb"
            write(mesh, out)
            dims = [round(float(v) * 1000, 1) for v in mesh.extents]
            made.append({
                "id": part_id,
                "description": (
                    f"Timber shelf {nominal} mm for ladder depth {depth} mm, "
                    f"{BOARD_THICKNESS_MM:.0f} mm"
                ),
                "dims_mm": dims,
                "triangles": len(mesh.faces),
            })
            print(f'  {part_id:<52} {dims[0]:>7.1f} x {dims[1]:>5.1f} x {dims[2]:>6.1f} mm  '
                  f'{len(mesh.faces):>3} tris')

    print()
    for depth in (320, 200):
        offset = bracket_plug_offset_mm(folder, depth)
        for nominal, shelf_length in SHELF_LENGTH_MM.items():
            # The bay's ladder spacing is what the shelf sets: its overall length
            # less the frame thickness, half of it swallowed at each end. Then
            # the two brackets sit `offset` inboard of each ladder centre.
            ladder_spacing = shelf_length - FRAME_THICKNESS_MM
            width = round(ladder_spacing - 2 * offset, 4)
            for height in CABINET_HEIGHTS_MM:
                part_id = (f"pws-timber-cabinet-{nominal}mm-h{height}mm"
                           f"-for-ladder-depth-{depth}mm")
                mesh = dressed(cabinet(width, float(height), float(depth)))
                out = folder / f"{part_id}.converted.glb"
                write(mesh, out)
                dims = [round(float(v) * 1000, 1) for v in mesh.extents]
                made.append({
                    "id": part_id,
                    "description": (
                        f"Timber cabinet {nominal} mm, {height} mm high, for "
                        f"ladder depth {depth} mm, {BOARD_THICKNESS_MM:.0f} mm"
                    ),
                    "dims_mm": dims,
                    "triangles": len(mesh.faces),
                })
                print(f'  {part_id:<52} {dims[0]:>7.1f} x {dims[1]:>5.1f} x '
                      f'{dims[2]:>6.1f} mm  {len(mesh.faces):>3} tris')

    # The office desktop. Same shape as a shelf and the same joint as a carcase:
    # laid on the office arms and screwed up from below (`Office solution` step
    # 5), so it needs the vertical joint rather than the span family. Its own
    # arm's offset, not the cabinet bracket's - see plug_offset_mm.
    print()
    depth = DESKTOP_LADDER_DEPTH_MM
    offset = office_arm_inset_mm(folder)
    print(f"  office arm sits {offset:.2f} mm to one side of its ladder "
          f"(plate rung plug + plate bolt face + arm bolt face)")
    for nominal, shelf_length in SHELF_LENGTH_MM.items():
        # THE TWO ARMS ARE THE LADDER SPACING APART, not that less two insets.
        #
        # The arm is a handed part - only one of its ends carries the slots the
        # clamping angle bolts through, and that end has to be the WALL end on
        # both ladders. A mirrored pair cannot do that: mirroring a handed part
        # puts one stop at the wall and the other at the front. So both plates
        # are fitted the same way round, exactly as `Office solution` step 1
        # draws them, and both arms end up offset in the SAME direction - which
        # cancels, leaving the arm centres one ladder spacing apart.
        #
        # It also means the desk is not centred on its bay: it overhangs one
        # ladder by the inset and stops short of the other. Kesseboehmer's own
        # photograph of the desk (YouK_Schreibtisch201.jpg) shows exactly that,
        # overhanging on the left and flush on the right.
        #
        # This used to subtract two insets, from the assumption that the plates
        # mirror - which was read off which markers a probe happened to click.
        width = round(shelf_length - FRAME_THICKNESS_MM, 4)
        for board_depth in DESKTOP_DEPTHS_MM:
            part_id = f"pws-timber-desktop-{nominal}mm-d{board_depth}mm"
            mesh = dressed(board(width, BOARD_THICKNESS_MM, float(board_depth)))
            out = folder / f"{part_id}.converted.glb"
            write(mesh, out)
            dims = [round(float(v) * 1000, 1) for v in mesh.extents]
            made.append({
                "id": part_id,
                "description": (
                    f"Timber office desktop {nominal} mm, {board_depth} mm deep, "
                    f"{BOARD_THICKNESS_MM:.0f} mm"
                ),
                "dims_mm": dims,
                "triangles": len(mesh.faces),
            })
            print(f'  {part_id:<52} {dims[0]:>7.1f} x {dims[1]:>5.1f} x '
                  f'{dims[2]:>6.1f} mm  {len(mesh.faces):>3} tris')

    # A manifest, so make-catalogue has a source for parts that have no STEP and
    # therefore no entry in convert-report.json.
    (folder / "timber-manifest.json").write_text(
        json.dumps({
            "_": [
                "Parts PWS makes, not Kesseboehmer. Generated by tools/make-timber.py.",
                "Kesseboehmer's brochure says the wooden shelves are made by a carpenter",
                "and are not in the YouK range, so there is no supplier CAD to convert.",
            ],
            "parts": made,
        }, indent=2) + "\n",
        encoding="utf8",
    )

    print()
    print(f"{len(made)} timber parts -> {folder}")
    print("Next: npm run youk:snap, then npm run declare youk")
    return 0


if __name__ == "__main__":
    sys.exit(main())
