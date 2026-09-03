#!/usr/bin/env python
"""Convert supplier STEP files into glTF the confgr pipeline can read.

Run it on the folder, not one file at a time: these are 45 parts of one modular
range and the conversion has to be identical for all of them. Same tessellation
tolerance, same origin rule, same node name. A GUI does it 45 times slightly
differently and nobody can tell afterwards which run produced which file.

    python tools/step-to-glb.py "C:/Claude/YouK models" -o converted
    python tools/step-to-glb.py "C:/Claude/YouK models" -o converted --angular 0.2

WHAT IT DOES, AND WHY EACH STEP IS THERE. Every one of these was found by
looking at the real Kesseboehmer files rather than reasoned about in advance.

  1. Copies the source to an ASCII temp path first.
     OpenCASCADE cannot open a path containing non-ASCII characters on Windows,
     and 30 of the 45 YouK filenames have umlauts (Hoehe, fuer, Verlaengerung).
     Worse, it prints "Cannot open input file" to stdout and RETURNS NORMALLY,
     so a run that converted nothing looks like a run that worked. Hence the
     existence check on every output.

  2. Tessellates with OpenCASCADE. CAD is boundary-representation - exact
     surfaces, no triangles - so something has to choose how finely to
     approximate a curve. Measured on the 1500mm ladder frame:

         tol_angular   deg/facet   triangles
             0.5          29          5,418
             0.3          17          7,475     <- default
             0.2          11         10,195
             0.1           6         19,757
             0.05          3         60,896

     The ANGULAR tolerance is the cost driver, not the linear one: linear
     barely moves the count until it drops below 0.01mm. 0.3 keeps the whole
     range near 5k triangles a part, so a twenty-part bay is about 100k, which
     is comfortable on a phone in AR as well as on a desktop. Use --angular 0.2
     or 0.1 for a hero render where only one part is on screen.

     Both tolerances are in the FILE's units - millimetres here - not in the
     metres cascadio outputs.

  3. Drops everything that is not a mesh. Six of the seven parts sampled carry
     a Path3D or a PointCloud alongside the solid: construction curves and
     datum points from the Creo sketch. Concatenating them either crashes or
     welds sketch lines into the product.

  4. Merges the remaining parts into ONE mesh. Several of these are assemblies
     - the shelf is 1 solid, the adjustable foot is 5 - but each file is one
     SKU, and the pipeline wants one node.

  5. Moves the origin to base centre in plan. CAD puts the origin wherever the
     designer started; the ladder frame arrived centred on its own middle, 750mm
     below where it needs to be.

  6. Names the geometry `body`, because the pipeline refuses to guess which node
     is the product.

WHAT IT DOES NOT DO. No snap planes, no roles, no masks. Those are decisions
about how the range assembles, not properties of a mesh, and a wrong guess
produces a model that connects incorrectly and silently. See tools/AUTHORING.md,
then tools/declare.mjs.

cascadio already handles two things worth not re-doing: it reads the STEP unit
declaration and outputs metres, and it converts CAD's Z-up to glTF's Y-up. Both
were verified against the declared SI_UNIT(.MILLI.,.METRE.) in these files.
"""

import argparse
import json
import re
import shutil
import sys
import tempfile
import unicodedata
from pathlib import Path

# Tessellation defaults, in the source file's units (millimetres for these).
# See the table above for how the angular figure was chosen.
DEFAULT_TOL_LINEAR = 0.05
DEFAULT_TOL_ANGULAR = 0.3

BODY_NODE = "body"


def slug(name):
    """A short, safe, stable id from a supplier filename.

    The YouK names carry the article number, an English description and a German
    one: "008563 - YouK shelf 900 mm for ladder depth 320 mm, Regalboden 900 mm
    fuer Leitertiefe 320 mm.stp". The article number and the English half are
    what identify the part; the German duplicate is dropped.
    """
    stem = Path(name).stem
    # Keep everything up to the first comma: article number + English name.
    english = stem.split(",")[0]
    # Strip accents rather than deleting the letters, so Hoehe survives as Hohe
    # rather than Hhe.
    flat = unicodedata.normalize("NFKD", english).encode("ascii", "ignore").decode()
    flat = flat.replace("YouK", "").replace(" mm", "mm")
    flat = re.sub(r"[^A-Za-z0-9]+", "-", flat).strip("-").lower()
    return re.sub(r"-+", "-", flat)


def convert_one(step_path, out_path, tol_linear, tol_angular):
    """Tessellate one STEP file. Returns the raw cascadio output path."""
    import cascadio

    # Point 1 above: ASCII-only path, and never trust the return.
    staged = Path(tempfile.mkdtemp(prefix="confgr-step-")) / "part.stp"
    shutil.copy2(step_path, staged)
    try:
        cascadio.step_to_glb(
            str(staged), str(out_path),
            tol_linear=tol_linear, tol_angular=tol_angular,
        )
    finally:
        shutil.rmtree(staged.parent, ignore_errors=True)

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(
            "OpenCASCADE wrote no output. It reports this by printing to stdout "
            "and returning normally, so the file check is the only signal. "
            "Usually a path it cannot open, or a STEP file with no solids."
        )
    return out_path


def merge_and_normalise(glb_path, out_path):
    """One mesh, named `body`, base at y=0, centred in plan.

    Returns a dict describing what was found and what moved, because a
    conversion you cannot audit afterwards is not much better than a manual one.
    """
    import numpy as np
    import trimesh

    scene = trimesh.load(str(glb_path), force="scene")

    meshes, dropped = [], []
    for node in scene.graph.nodes_geometry:
        transform, geom_name = scene.graph[node]
        geom = scene.geometry[geom_name]
        if isinstance(geom, trimesh.Trimesh):
            meshes.append(geom.copy().apply_transform(transform))
        else:
            # Point 3: construction curves and datum points.
            dropped.append({"node": node, "kind": type(geom).__name__})

    if not meshes:
        raise RuntimeError(
            f"No mesh geometry - only {[d['kind'] for d in dropped]}. "
            "The STEP file may contain surfaces or wireframe but no solids."
        )

    merged = trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]

    lo, hi = merged.bounds
    # Point 5: base to y=0, centred in X and Z.
    shift = np.array([
        -(lo[0] + hi[0]) / 2.0,
        -lo[1],
        -(lo[2] + hi[2]) / 2.0,
    ])
    merged.apply_translation(shift)

    out_scene = trimesh.Scene()
    out_scene.add_geometry(merged, node_name=BODY_NODE, geom_name=BODY_NODE)
    out_path.write_bytes(trimesh.exchange.gltf.export_glb(out_scene))

    size = merged.extents
    return {
        "parts_merged": len(meshes),
        "dropped": dropped,
        "triangles": int(len(merged.faces)),
        "vertices": int(len(merged.vertices)),
        "dims_mm": [round(float(v) * 1000, 1) for v in size],
        "origin_shift_mm": [round(float(v) * 1000, 1) for v in shift],
        "watertight": bool(merged.is_watertight),
    }


def verify(glb_path):
    """Confirm the output is what the pipeline needs: one node called `body`."""
    import trimesh

    scene = trimesh.load(str(glb_path), force="scene")
    names = list(scene.graph.nodes_geometry)
    if BODY_NODE not in names:
        raise RuntimeError(
            f'Output has no "{BODY_NODE}" node - got {names}. trimesh renamed it '
            "on export, so the node naming needs revisiting before this is trusted."
        )
    return names


# How many times to re-tessellate a part that busts the triangle budget before
# giving up and saying so. Each retry doubles the angular tolerance, so three
# retries covers an 8x reduction - enough for the heaviest part in this range
# and few enough that a runaway is reported rather than ground through.
MAX_TESSELLATIONS = 4


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("source", help="a .stp/.step file, or a folder of them")
    ap.add_argument("-o", "--out", required=True, help="output folder for the GLBs")
    ap.add_argument("--linear", type=float, default=DEFAULT_TOL_LINEAR,
                    help=f"linear tolerance in file units (default {DEFAULT_TOL_LINEAR})")
    ap.add_argument("--angular", type=float, default=DEFAULT_TOL_ANGULAR,
                    help=f"angular tolerance in radians (default {DEFAULT_TOL_ANGULAR})")
    ap.add_argument("--max-tris", type=int, default=0,
                    help="triangle budget per part; a part over it is re-tessellated "
                         "coarser until it fits (0 = no budget)")
    ap.add_argument("--report", help="write a JSON report here")
    ap.add_argument("--limit", type=int, help="convert only the first N (for a trial run)")
    args = ap.parse_args()

    source = Path(args.source)
    sources = sorted(
        [source] if source.is_file()
        else [p for p in source.iterdir() if p.suffix.lower() in (".stp", ".step")]
    )
    if args.limit:
        sources = sources[:args.limit]
    if not sources:
        print(f"No STEP files in {source}", file=sys.stderr)
        return 1

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = Path(tempfile.mkdtemp(prefix="confgr-raw-"))

    results = []
    failures = 0

    for i, step in enumerate(sources, 1):
        name = slug(step.name)
        # ".converted" keeps the converter's output distinct from the component
        # add-snaps.py builds from it. They used to share <id>.glb, so snapping
        # wrote over its own input - and a second run rotated every frame a
        # second time and produced a confidently wrong model. Pristine input,
        # derived output, no state.
        target = out_dir / f"{name}.converted.glb"
        record = {"source": step.name, "id": name, "out": target.name}

        try:
            # Tessellate, and if the part blows the triangle budget, tessellate
            # it AGAIN coarser rather than decimating the mesh afterwards. Going
            # back to the CAD keeps a true surface; decimating approximates an
            # approximation. The four YouboXx bins are 72k-138k triangles at the
            # default tolerance and account for most of this range's total, so
            # without this the budget is a number nobody acts on.
            linear, angular = args.linear, args.angular
            for attempt in range(1, MAX_TESSELLATIONS + 1):
                raw = convert_one(step, raw_dir / f"{name}-raw.glb", linear, angular)
                record.update(merge_and_normalise(raw, target))
                if not args.max_tris or record["triangles"] <= args.max_tris:
                    break
                if attempt == MAX_TESSELLATIONS:
                    record["over_budget"] = True
                    break
                # Relax BOTH. Doubling only the angular tolerance stalls: past
                # about 1 radian it no longer constrains anything, and the
                # YouboXx bins sat at 60k triangles however coarse the angle got
                # because their count is driven by the linear tolerance and the
                # sheer number of small features. Angular is capped for the same
                # reason - beyond a radian it is a no-op, not a lever.
                linear *= 2.0
                angular = min(angular * 1.5, 1.0)
                record["retessellated"] = [round(linear, 4), round(angular, 3)]
            record["nodes"] = verify(target)
            record["bytes"] = target.stat().st_size
            record["ok"] = True
            print(f"[{i:>2}/{len(sources)}] {name:<44} "
                  f"{record['dims_mm'][0]:>7.1f} x {record['dims_mm'][1]:>7.1f} x "
                  f"{record['dims_mm'][2]:>6.1f} mm  "
                  f"{record['triangles']:>7} tris"
                  + (f"  ({record['parts_merged']} parts merged)" if record["parts_merged"] > 1 else "")
                  + (f"  [dropped {len(record['dropped'])}]" if record["dropped"] else "")
                  + (f"  [re-tessellated at linear {record['retessellated'][0]}, "
                     f"angular {record['retessellated'][1]}]"
                     if record.get("retessellated") else "")
                  + ("  [STILL OVER BUDGET]" if record.get("over_budget") else ""))
        except Exception as err:  # noqa: BLE001
            failures += 1
            record["ok"] = False
            record["error"] = str(err)
            print(f"[{i:>2}/{len(sources)}] {name:<44} FAILED: {err}")

        results.append(record)

    shutil.rmtree(raw_dir, ignore_errors=True)

    good = [r for r in results if r.get("ok")]
    print()
    print(f"{len(good)}/{len(results)} converted into {out_dir}")
    if good:
        total = sum(r["triangles"] for r in good)
        print(f"{total:,} triangles total, {round(total / len(good)):,} average per part")
        heavy = sorted(good, key=lambda r: -r["triangles"])[:3]
        print("heaviest: " + ", ".join(f"{r['id']} ({r['triangles']:,})" for r in heavy))
    if failures:
        print(f"{failures} failed - see the report")

    print()
    print("Next: these have no snap planes, so the pipeline will refuse them until")
    print("they do. Run  npm run inspect <folder>  to see exactly what each needs.")

    if args.report:
        Path(args.report).write_text(json.dumps({
            "tolerances": {"linear": args.linear, "angular": args.angular},
            "converted": len(good), "failed": failures,
            "parts": results,
        }, indent=2) + "\n", encoding="utf8")
        print(f"Report: {args.report}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
