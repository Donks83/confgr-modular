"""Find the bolt holes in a sheet-metal face, so a bolted joint can be measured.

The office solution needs a joint nothing else in the range has: a part bolted
to another part's FACE rather than hooked over a rung. `Office solution` step 3
bolts the arm's web flat against the plate with 4 x M4, and which pair of holes
you use is what sets the desktop's 9 degree tilt.

That means the joint is defined by hole positions, and hole positions have to be
measured. This prints them.

METHOD. A hole in a flat sheet is a ring of vertices lying ON the face plane and
enclosing nothing. So: take every vertex within a tolerance of the named face
plane, cluster them in the two in-plane axes by proximity, and report each
cluster's centre and diameter. A cluster whose extent is small and roughly
circular is a hole; anything large is the sheet's own outline.

Deliberately a reporting tool, not an authoring one. It says what is there; the
decision about which hole means what stays in youk/snap-spec.json, where a
person can check it against the drawing.

    npm run holes youk/008551-shelf-supports-for-office-solution.glb --axis x --face max
"""

import argparse
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
        size = pts.max(axis=0) - pts.min(axis=0)
        centre = (pts.max(axis=0) + pts.min(axis=0)) / 2.0
        if max(size) > args.max_size:
            continue
        found.append((centre, size, len(group)))

    axis_names = "".join(k for k, i in AXES.items() if i in others)
    found.sort(key=lambda f: (round(f[0][1], 1), round(f[0][0], 1)))
    print(f"  {len(found)} holes, sorted by {axis_names[1]} then {axis_names[0]}:")
    for centre, size, count in found:
        print(f"    {axis_names[0]} {centre[0]:8.2f}   {axis_names[1]} {centre[1]:8.2f}"
              f"   dia {max(size):5.2f} x {min(size):5.2f} mm   {count:>3} verts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
