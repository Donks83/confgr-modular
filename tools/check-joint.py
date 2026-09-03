#!/usr/bin/env python
"""Place one snapped component on another and report whether they actually fit.

    python tools/check-joint.py youk/236758-ladder-depth-320mm.glb \
                                youk/008543-rack-for-ladder-depth-320mm.glb \
                                --socket rung-1-right

The app will happily assemble a joint whose numbers are wrong: the solver puts
the snap centres together and asks no questions about the metal. This asks the
questions. It is the acceptance test for a joint that add-snaps.py has authored,
and it is deliberately independent of the engine - it re-derives the placement
from the GLBs so that agreement means the DATA is right, not that two copies of
the same code agree.

WHAT IT REPORTS

  contact   the smallest gap between the child's material and the parent's, and
            where. A designed bearing surface shows 0.0 - the shelf's bracket
            lands on the rung's top face to the tessellation's resolution, and
            anything else is a seating that was guessed rather than measured.
  overlap   parent vertices strictly inside the child's solid, and vice versa.
            Non-zero means the parts interpenetrate.
  reach     where the child ends up, so a cantilever can be sanity-checked
            against the catalogue.

Vertices, not meshes: these tessellations are not watertight (a section returns
stray loops) but their vertices sit on feature boundaries, which is what makes
the numbers meaningful. See tools/measure-part.py.
"""

import argparse
import sys

import numpy as np
import trimesh

SNAP_PREFIX = "md-snap"


def load(path):
    """The body mesh in millimetres, plus every snap node's placement."""
    scene = trimesh.load(str(path), force="scene")
    body, snaps = None, {}
    for name in scene.graph.nodes_geometry:
        matrix, geom_name = scene.graph[name]
        geom = scene.geometry[geom_name]
        if name.startswith(SNAP_PREFIX):
            # +Z is the facing; the node's rotation is what points it.
            facing = matrix[:3, :3] @ np.array([0.0, 0.0, 1.0])
            snaps[name] = (matrix[:3, 3] * 1000.0, facing)
        elif name == "body":
            body = geom.copy().apply_transform(matrix)
    if body is None:
        raise RuntimeError(f'{path}: no "body" node')
    return body.vertices * 1000.0, snaps


def pick(snaps, wanted, role):
    matches = [n for n in snaps if wanted in n] if wanted else list(snaps)
    if len(matches) != 1:
        raise SystemExit(
            f"{role}: {'no' if not matches else len(matches)} snaps match "
            f"{wanted!r}. Available: {', '.join(sorted(snaps))}"
        )
    return matches[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("parent")
    ap.add_argument("child")
    ap.add_argument("--socket", default="", help="substring of the parent's snap name")
    ap.add_argument("--plug", default="", help="substring of the child's snap name")
    ap.add_argument("--near", type=float, default=6.0,
                    help="mm: how close counts as contact when reporting (default 6)")
    args = ap.parse_args()

    pv, psnaps = load(args.parent)
    cv, csnaps = load(args.child)
    sname = pick(psnaps, args.socket, "socket")
    cname = pick(csnaps, args.plug, "plug")
    spos, sface = psnaps[sname]
    cpos, cface = csnaps[cname]

    # Only the axis-aligned, already-opposed case is handled, which is every
    # joint in this range. Anything else needs the full rotation the engine
    # applies, and silently mis-placing it here would be worse than refusing.
    if np.dot(sface, cface) > -0.99:
        raise SystemExit(
            f"facings are not opposed ({sface.round(2)} vs {cface.round(2)}). "
            "The engine would yaw the child to fix this; this check does not "
            "model that, so it would report on a placement the app never makes."
        )

    offset = spos - cpos
    cv = cv + offset

    print(f"parent {args.parent}")
    print(f"  socket {sname}  at {spos.round(2)}  facing {sface.round(2)}")
    print(f"child  {args.child}")
    print(f"  plug   {cname}  at {cpos.round(2)}  facing {cface.round(2)}")
    print(f"  placed by translating {offset.round(2)} mm\n")

    print(f"  parent occupies  x {pv[:,0].min():8.1f}..{pv[:,0].max():7.1f}"
          f"   y {pv[:,1].min():8.1f}..{pv[:,1].max():7.1f}"
          f"   z {pv[:,2].min():8.1f}..{pv[:,2].max():7.1f}")
    print(f"  child  occupies  x {cv[:,0].min():8.1f}..{cv[:,0].max():7.1f}"
          f"   y {cv[:,1].min():8.1f}..{cv[:,1].max():7.1f}"
          f"   z {cv[:,2].min():8.1f}..{cv[:,2].max():7.1f}")

    # Contact and overlap are judged locally, or a whole-part nearest-neighbour
    # would be dominated by geometry a metre away. The window is X and Y only:
    # every member here is a prism running along Z and so carries vertices at
    # its ENDS and nowhere between, which means a Z window centred on the joint
    # selects nothing at all. Same reason sectioning these parts fails.
    box = args.near + 40.0
    local = pv[(np.abs(pv[:, 0] - spos[0]) < box) & (np.abs(pv[:, 1] - spos[1]) < box)]
    near = cv[(np.abs(cv[:, 0] - spos[0]) < box) & (np.abs(cv[:, 1] - spos[1]) < box)]
    print(f"\n  around the joint (x,y within {box:.0f}mm, all z): "
          f"{len(local)} parent verts, {len(near)} child verts")

    if not len(local) or not len(near):
        print("  nothing to compare - widen --near, or the joint is nowhere "
              "near either part's material, which is itself the finding")
        return 1

    # SEATING. The socket is authored AT the bearing face, so the claim under
    # test is exactly "the child's lowest material here sits at the socket's y".
    # That is the statistic to trust - NOT a nearest vertex pair, because these
    # surfaces carry vertices only on their perimeters and two faces flat
    # against each other can still be millimetres apart vertex-to-vertex.
    floor = float(spos[1])
    lowest = float(near[:, 1].min())
    delta = lowest - floor
    verdict = ("flush" if abs(delta) < 0.05
               else f"{abs(delta):.2f}mm {'above' if delta > 0 else 'BELOW'}")
    print(f"\n  seating: child's lowest material near the joint is y {lowest:.2f}, "
          f"socket is y {floor:.2f}  ->  {verdict}")

    sunk = near[near[:, 1] < floor - 0.05]
    print(f"  sunk into the parent: {len(sunk)} child verts below the socket face")
    if len(sunk):
        print(f"     y {sunk[:,1].min():.2f}..{sunk[:,1].max():.2f}   "
              f"x {sunk[:,0].min():.1f}..{sunk[:,0].max():.1f}")
        print("     Some of this is legitimate - a hook's leg descends past the "
              "member it wraps. Check the x range clears the member's faces.")

    # Where the child's descending metal sits relative to the parent's, in x.
    # A hook that grips shows a leg just outside the member; a leg that lands
    # inside the member's own x range is metal through metal.
    member = local[np.abs(local[:, 1] - floor) < 8.0]
    if len(member):
        print(f"  the member at this face spans x {member[:,0].min():.2f}"
              f"..{member[:,0].max():.2f}")
        if len(sunk):
            lo, hi = float(member[:, 0].min()), float(member[:, 0].max())
            clash = sunk[(sunk[:, 0] > lo) & (sunk[:, 0] < hi)]
            print(f"  child material both below the face AND inside that span: "
                  f"{len(clash)} verts")
            if len(clash):
                # How far in matters more than how many. A leg designed to hug
                # the member's face lands ON it, and a tessellated face is only
                # accurate to a few tenths - so tenths are the mesh, and
                # millimetres are a wrong number in the spec.
                depth = float(np.minimum(clash[:, 0] - lo, hi - clash[:, 0]).max())
                print(f"     deepest {depth:.2f} mm past the face at x {lo:.2f}/{hi:.2f}"
                      + ("  - tessellation noise on a flush leg"
                         if depth < 0.5 else "  - INTERPENETRATION, check the spec"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
