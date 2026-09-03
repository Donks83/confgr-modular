#!/usr/bin/env python
"""Render orthographic views of converted components, as a contact sheet.

WHY. Forty-five bounding boxes tell you the sizes and nothing about the shapes,
and the shapes are what decide the snap planes. "320 x 1500 x 30mm" could be a
ladder frame standing up or lying down, and getting that wrong means authoring
two hundred snap planes against the wrong axis.

    python tools/contact-sheet.py youk -o youk/contact-sheet.png
    python tools/contact-sheet.py youk -o one.png --only 236758 --large

Three orthographic views per part - front, side, top - with millimetre extents
labelled. Deliberately not a pretty render: flat shaded triangles, painter's
algorithm, no perspective, so a measurement can be read off it.
"""

import argparse
import math
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import trimesh
from matplotlib.collections import PolyCollection

# Enough faces to read the shape; a 138k-triangle YouboXx set renders the same
# silhouette at 20k and takes a twentieth of the time.
PREVIEW_FACE_BUDGET = 20000

# X-Y front, Z-Y side, X-Z top. Third entry is the axis pointing at the viewer,
# used for depth sorting and shading.
VIEWS = [
    ("front", 0, 1, 2, "width x height"),
    ("side", 2, 1, 0, "depth x height"),
    ("top", 0, 2, 1, "width x depth"),
]


def load_body(glb):
    scene = trimesh.load(str(glb), force="scene")
    parts = [
        scene.geometry[scene.graph[n][1]].copy().apply_transform(scene.graph[n][0])
        for n in scene.graph.nodes_geometry
        if isinstance(scene.geometry[scene.graph[n][1]], trimesh.Trimesh)
    ]
    if not parts:
        return None
    mesh = trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0]
    if len(mesh.faces) > PREVIEW_FACE_BUDGET:
        try:
            mesh = mesh.simplify_quadric_decimation(PREVIEW_FACE_BUDGET)
        except Exception:  # noqa: BLE001
            # Decimation needs optional deps; a slow correct render beats none.
            pass
    return mesh


def draw(ax, mesh, view):
    """Flat-shaded orthographic projection, back to front."""
    _, h, v, d, _ = view
    tris = mesh.triangles

    # Painter's algorithm: sort by mean depth along the viewing axis.
    order = np.argsort(tris[:, :, d].mean(axis=1))
    tris = tris[order]
    normals = mesh.face_normals[order]

    polys = tris[:, :, [h, v]] * 1000.0  # metres -> millimetres

    # Lambert against a light over the viewer's shoulder, plus ambient, so
    # curvature reads without any face going fully black.
    light = np.zeros(3)
    light[d] = 1.0
    light[v] = 0.55
    light[h] = -0.35
    light /= np.linalg.norm(light)
    shade = 0.32 + 0.68 * np.clip(np.abs(normals @ light), 0, 1)
    colours = np.column_stack([shade * 0.62, shade * 0.66, shade * 0.72])

    ax.add_collection(PolyCollection(
        polys, facecolors=colours, edgecolors="none", antialiased=False,
    ))

    lo = polys.reshape(-1, 2).min(axis=0)
    hi = polys.reshape(-1, 2).max(axis=0)
    pad = max(hi - lo) * 0.08 + 2
    ax.set_xlim(lo[0] - pad, hi[0] + pad)
    ax.set_ylim(lo[1] - pad, hi[1] + pad)
    ax.set_aspect("equal")
    ax.set_facecolor("#14120f")
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_xticks([])
    ax.set_yticks([])
    return hi - lo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--only", nargs="*", help="substrings; render just these")
    ap.add_argument("--large", action="store_true", help="one part per row, bigger")
    ap.add_argument("--cols", type=int, default=3, help="parts per row")
    args = ap.parse_args()

    files = sorted(Path(args.folder).glob("*.glb"))
    if args.only:
        files = [f for f in files if any(s.lower() in f.name.lower() for s in args.only)]
    if not files:
        print("no matching .glb files", file=sys.stderr)
        return 1

    per_row = 1 if args.large else args.cols
    rows = math.ceil(len(files) / per_row)
    scale = 3.4 if args.large else 2.0

    fig, axes = plt.subplots(
        rows, per_row * 3,
        figsize=(per_row * 3 * scale, rows * scale * 1.15),
        squeeze=False,
    )
    fig.patch.set_facecolor("#0d0c0a")

    for index, glb in enumerate(files):
        row, col = divmod(index, per_row)
        mesh = load_body(glb)
        label = glb.stem

        for v, view in enumerate(VIEWS):
            ax = axes[row][col * 3 + v]
            if mesh is None:
                ax.text(0.5, 0.5, "no mesh", ha="center", va="center",
                        color="#c0392b", transform=ax.transAxes)
                ax.set_facecolor("#14120f")
                ax.set_xticks([]); ax.set_yticks([])
                continue

            extent = draw(ax, mesh, view)
            name, _, _, _, axis_label = view
            if v == 0:
                ax.set_title(f"{label}\n{name}: {extent[0]:.0f} x {extent[1]:.0f} mm",
                             color="#e8e2d6", fontsize=7, loc="left", pad=4)
            else:
                ax.set_title(f"{name}: {extent[0]:.0f} x {extent[1]:.0f} mm",
                             color="#9a948a", fontsize=7, loc="left", pad=4)

        print(f"{index + 1}/{len(files)} {label}"
              + ("" if mesh is None else f"  {len(mesh.faces)} faces drawn"))

    # Blank any unused cells rather than leaving default axes.
    for index in range(len(files), rows * per_row):
        row, col = divmod(index, per_row)
        for v in range(3):
            axes[row][col * 3 + v].axis("off")

    fig.tight_layout(pad=0.8)
    fig.savefig(args.out, dpi=110, facecolor=fig.get_facecolor())
    print(f"\nWrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
