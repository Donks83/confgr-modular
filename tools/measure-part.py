#!/usr/bin/env python
"""Locate the features of a converted component, so snaps can be authored.

    python tools/measure-part.py youk/008543-rack-for-ladder-depth-320mm.glb
    python tools/measure-part.py youk/*.glb --axis x --slab 20

Reports extents and then, per axis, the bands of Y/X/Z at which vertices
cluster. That clustering IS the measurement: a tessellated CAD solid puts
vertices on feature boundaries and almost nowhere else, so a band is a real
edge, fold or face and a gap is real void.

Two consequences of that, both learned the hard way on this range and both
worth stating before someone reaches for the obvious tool instead:

  * A planar face carries vertices only on its PERIMETER. A bar spanning the
    depth therefore has vertices at its two ends and none between, so slicing
    the part at mid-depth returns nothing at all. Do not section these solids.
  * Area, triangle-count and loop-count metrics all failed to find the ladder
    rungs. Vertex clustering found them to 0.1mm against Kesseboehmer's own
    dimensioned drawing.

--slab restricts the report to material near one end of an axis, which is how
to look at a mounting bracket rather than the whole part.
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import trimesh

AXES = {"x": 0, "y": 1, "z": 2}


def body(path):
    """The part itself. A snapped GLB also carries snap planes; skip those."""
    scene = trimesh.load(str(path), force="scene")
    named = list(scene.graph.nodes_geometry)
    for n in named:
        if n == "body":
            return scene.geometry[scene.graph[n][1]].copy().apply_transform(scene.graph[n][0])
    # Not been through add-snaps.py yet: merge whatever meshes are present.
    parts = [
        scene.geometry[scene.graph[n][1]].copy().apply_transform(scene.graph[n][0])
        for n in named
        if isinstance(scene.geometry[scene.graph[n][1]], trimesh.Trimesh)
    ]
    if not parts:
        raise RuntimeError("no mesh geometry")
    return trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0]


def bands(values, gap):
    """Contiguous runs of sorted values, split wherever the step exceeds gap."""
    vals = np.sort(values)
    out, start = [], 0
    for i in range(1, len(vals) + 1):
        if i == len(vals) or vals[i] - vals[i - 1] > gap:
            out.append((float(vals[start]), float(vals[i - 1]), i - start))
            start = i
    return out


def report(path, args):
    mesh = body(path)
    v = mesh.vertices * 1000.0
    ext = mesh.extents * 1000.0

    print(f"\n{Path(path).stem}")
    print(f"  {len(mesh.faces)} triangles, {len(v)} vertices")
    print(f"  extents  x {ext[0]:8.1f}   y {ext[1]:8.1f}   z {ext[2]:8.1f}  mm")
    print(f"  bounds   x {v[:,0].min():8.1f}..{v[:,0].max():7.1f}"
          f"   y {v[:,1].min():8.1f}..{v[:,1].max():7.1f}"
          f"   z {v[:,2].min():8.1f}..{v[:,2].max():7.1f}")

    sel, label = v, "whole part"
    if args.window:
        i = AXES[args.axis]
        lo, hi = (float(s) for s in args.window.split(":"))
        sel = v[(v[:, i] >= lo) & (v[:, i] <= hi)]
        print(f"  window [{lo} <= {args.axis} <= {hi}]: {len(sel)} vertices")
        if not len(sel):
            return
    elif args.slab:
        i = AXES[args.axis]
        if args.end == "max":
            keep = v[:, i] > v[:, i].max() - args.slab
            label = f"{args.axis} > max - {args.slab}"
        else:
            keep = v[:, i] < v[:, i].min() + args.slab
            label = f"{args.axis} < min + {args.slab}"
        sel = v[keep]
        print(f"  slab [{label}]: {len(sel)} vertices")
        if not len(sel):
            return

    if args.plot:
        # Bands answer "where is there material"; a scatter answers "what shape
        # is it", and some questions only yield to the second. Vertices only -
        # the same reason the bands work, and it costs no mesh handling.
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        h, v = (AXES[c] for c in args.plane)
        fig, ax = plt.subplots(figsize=(9, 9))
        ax.scatter(sel[:, h], sel[:, v], s=8, c="#3a9ec4")
        ax.set_aspect("equal", adjustable="box")
        ax.set_xlabel(f"{args.plane[0]} mm")
        ax.set_ylabel(f"{args.plane[1]} mm")
        ax.set_title(f"{Path(path).stem}  [{label}]  {len(sel)} verts")
        ax.grid(alpha=0.3)
        fig.tight_layout()
        fig.savefig(args.plot, dpi=140)
        print(f"  wrote {args.plot}")

    for name, i in AXES.items():
        bs = bands(sel[:, i], args.gap)
        head = f"  {name} bands ({len(bs)})"
        if len(bs) > args.max_bands:
            print(f"{head}: too many to be features - "
                  f"{bs[0][0]:.1f}..{bs[-1][1]:.1f}, listing the {args.max_bands} biggest")
            bs = sorted(bs, key=lambda b: -b[2])[:args.max_bands]
            bs.sort()
        else:
            print(f"{head}:")
        for lo, hi, n in bs:
            print(f"      {lo:9.1f} .. {hi:9.1f}   ({n} verts)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--gap", type=float, default=1.0,
                    help="mm step that separates one band from the next (default 1)")
    ap.add_argument("--slab", type=float, default=0.0,
                    help="restrict to material within this many mm of one end of --axis")
    ap.add_argument("--window", default="",
                    help="restrict to lo:hi mm along --axis, e.g. 90:115 for one rung")
    ap.add_argument("--axis", choices=list(AXES), default="x")
    ap.add_argument("--end", choices=["min", "max"], default="min")
    ap.add_argument("--max-bands", type=int, default=12)
    ap.add_argument("--plot", default="", help="write a scatter of the selection to this png")
    ap.add_argument("--plane", default="xy", choices=["xy", "xz", "zy", "yz", "yx", "zx"],
                    help="which two axes the scatter uses (default xy)")
    args = ap.parse_args()

    failures = 0
    for path in args.paths:
        try:
            report(path, args)
        except Exception as err:  # noqa: BLE001
            failures += 1
            print(f"\n{Path(path).stem}\n  FAILED: {err}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
