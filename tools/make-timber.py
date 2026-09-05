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
    # UVs the material does not use, but glTF export drops the material without
    # a TextureVisuals to hang it on.
    mesh.visual = trimesh.visual.TextureVisuals(
        uv=np.zeros((len(verts), 2), dtype=float),
        material=timber_material(),
    )
    return mesh


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
            mesh = board(length, BOARD_THICKNESS_MM, SHELF_DEPTH_MM[depth])
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
