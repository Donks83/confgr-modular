"""Find the bolt holes in a sheet-metal face, so a bolted joint can be measured.

The office solution needs a joint nothing else in the range has: a part bolted
to another part's FACE rather than hooked over a rung. `Office solution` step 3
bolts the arm's web flat against the plate with 4 x M4, and which pair of holes
you use is what sets the desktop's 9 degree tilt.

That means the joint is defined by hole positions, and hole positions have to be
measured. This prints them.

METHOD. A hole in a flat sheet is a ring of vertices lying ON the face plane and
enclosing nothing. So: take every vertex within a tolerance of the named face
plane, cluster them in the two in-plane axes by proximity, and FIT A CIRCLE to
each cluster. A cluster that fits a small circle tightly is a hole; anything
large, or anything the fit cannot follow, is the sheet's own outline.

The fit is the point. Reporting each cluster's bounding-box centre is only
right for a FULL ring, and a slot's end is a half arc whose bounding-box centre
sits a quarter of a diameter off the real one. That is not hypothetical: the
office arm's clamping slot was first written into the spec 1.25mm out at both
ends, from this tool's own output, and it verified anyway because 1.25mm is
inside the search tolerance. A tool that reports a plausible wrong number is
worse than one that reports nothing, so it now also says how much of each
circle it actually saw.

Deliberately a reporting tool, not an authoring one. It says what is there; the
decision about which hole means what stays in youk/snap-spec.json, where a
person can check it against the drawing.

    npm run holes youk/008551-shelf-supports-for-office-solution.glb --axis x --face max
"""

import argparse
import math
import sys
from pathlib import Path

AXES = {"x": 0, "y": 1, "z": 2}


def load_body(path):
    import trimesh

    scene = trimesh.load(str(path), force="scene")
    for name in scene.graph.nodes_geometry:
        if name == "body":
            transform, geom = scene.graph.get(name)
            mesh = scene.geometry[geom].copy()
            mesh.apply_transform(transform)
            return mesh
    raise SystemExit(f"{path.name} has no 'body' node")


def clusters(points, gap_mm):
    """Group 2D points so that any two closer than gap_mm end up together."""
    import numpy as np

    remaining = list(range(len(points)))
    out = []
    while remaining:
        seed = remaining.pop()
        group = [seed]
        changed = True
        while changed:
            changed = False
            for i in list(remaining):
                d = np.linalg.norm(points[group] - points[i], axis=1).min()
                if d <= gap_mm:
                    group.append(i)
                    remaining.remove(i)
                    changed = True
        out.append(group)
    return out


def fit_circle(pts):
    """Kasa algebraic circle fit. Returns centre, radius, worst error, arc degrees.

    A full ring and a half arc both have to give the SAME centre, which is the
    whole reason this is a fit and not a bounding box. `covered` is how much of
    the circle the vertices actually span - the largest gap between consecutive
    points, subtracted from 360 - so a half arc reports itself as one, and the
    reader knows they are looking at the end of a slot rather than a hole.
    """
    import numpy as np

    a = np.column_stack([2 * pts[:, 0], 2 * pts[:, 1], np.ones(len(pts))])
    b = (pts ** 2).sum(axis=1)
    try:
        (cx, cy, c) = np.linalg.lstsq(a, b, rcond=None)[0]
    except np.linalg.LinAlgError:
        return np.zeros(2), 0.0, float("inf"), 0.0
    radius = math.sqrt(max(c + cx * cx + cy * cy, 0.0))
    if radius <= 0:
        return np.array([cx, cy]), 0.0, float("inf"), 0.0

    offsets = pts - np.array([cx, cy])
    residual = float(np.abs(np.linalg.norm(offsets, axis=1) - radius).max())

    angles = np.sort(np.degrees(np.arctan2(offsets[:, 1], offsets[:, 0])) % 360.0)
    gaps = np.diff(np.append(angles, angles[0] + 360.0))
    covered = float(360.0 - gaps.max())
    return np.array([cx, cy]), radius, residual, covered


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("model")
    ap.add_argument("--axis", default="x", choices=list(AXES),
                    help="the face's normal axis")
    ap.add_argument("--face", default="max", choices=["min", "max"],
                    help="which end of that axis the face is at")
    ap.add_argument("--tol", type=float, default=0.6,
                    help="mm either side of the face plane to count as on it")
    ap.add_argument("--gap", type=float, default=3.0,
                    help="mm between vertices of one hole")
    ap.add_argument("--max-size", type=float, default=30.0,
                    help="mm across; anything bigger is the sheet outline, not a hole")
    ap.add_argument("--round", type=float, default=0.25,
                    help="mm a vertex may sit off the fitted circle before the "
                         "cluster is not a hole at all")
    args = ap.parse_args()

    import numpy as np

    mesh = load_body(Path(args.model))
    v = mesh.vertices * 1000.0
    n = AXES[args.axis]
    plane = v[:, n].max() if args.face == "max" else v[:, n].min()
    on = v[np.abs(v[:, n] - plane) <= args.tol]
    others = [i for i in (0, 1, 2) if i != n]
    flat = on[:, others]

    print(f"{Path(args.model).name}")
    print(f"  face: {args.axis} = {plane:.2f} mm   ({len(on)} of {len(v)} vertices on it)")
    if not len(on):
        return 1

    found = []
    for group in clusters(flat, args.gap):
        pts = flat[group]
        if len(pts) < 4 or max(pts.max(axis=0) - pts.min(axis=0)) > args.max_size:
            continue
        centre, radius, residual, covered = fit_circle(pts)
        if radius <= 0 or 2 * radius > args.max_size or residual > args.round:
            continue
        found.append((centre, 2 * radius, covered, residual, len(group)))

    axis_names = "".join(k for k, i in AXES.items() if i in others)
    found.sort(key=lambda f: (round(f[0][1], 1), round(f[0][0], 1)))
    print(f"  {len(found)} holes, sorted by {axis_names[1]} then {axis_names[0]}:")
    for centre, dia, covered, residual, count in found:
        part = "full ring" if covered > 340 else f"{covered:3.0f} deg arc"
        print(f"    {axis_names[0]} {centre[0]:8.2f}   {axis_names[1]} {centre[1]:8.2f}"
              f"   dia {dia:5.2f} mm   {part:>11}   fit {residual:4.2f} mm"
              f"   {count:>3} verts")
    if any(f[2] <= 340 for f in found):
        print("  An arc is a partial circle: one end of a SLOT, or a corner radius.")
        print("  Two arcs of equal diameter facing apart are a slot's two ends, and")
        print("  what runs between them is a line, not a hole.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
