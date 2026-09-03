# Kesseböhmer YouK — what the models actually contain

Source: 45 STEP files, `C:\Claude\YouK models`, 46.3 MB, exported from Creo
Parametric 2020184 by Kesseböhmer, schema AP214, dated 2021-04-06.

Converted with `tools/step-to-glb.py`. Everything below was measured from the
geometry, not read off a datasheet — so anything marked **unresolved** needs
confirming against Kesseböhmer's drawings before it is built on.

---

## The range

| Family | Parts | Sizes |
|---|---|---|
| Ladder frames (`Leiterregal`) | 6 | depth 200: 668, 905 tall · depth 320: 550, 905, 1500, 2210 tall |
| Shelves | 4 | 450, 600, 900, 1200 — for ladder depth 320 only |
| Shoe racks | 4 | 450, 600, 900, 1200 |
| Clothes rails | 5 | 600, 900 (×2), 1200, + 2 extensions |
| Hook strips, by ladder **width** | 4 | 450, 600, 900, 1200 |
| Hook strips, by ladder **depth** | 2 | 200, 320 |
| Racks/trays, by ladder depth | 2 | 200, 320 |
| Cabinet brackets (`Korpushalterung`) | 4 | inner and outer × depth 200, 320 |
| Office solution | 3 | base brackets, clamping angles, shelf supports |
| YouboXx sets | 4 | sets 2–5 |
| Umbrella stand | 2 | upper holder, lower tray |
| Newspaper/towel rack | 2 | rack + divider |
| Top panel bracket | 1 | |
| Adjustable foot | 1 | 100 mm |

**Two compatibility axes**, and they are the mask structure:

- **Ladder depth** — 200 or 320. An accessory named "for ladder depth 320" fits
  only a 320 frame. Only depth 320 has shelves.
- **Ladder width** — 450 / 600 / 900 / 1200. This is the *spacing between two
  frames*, not a dimension of any single part. Shelves, shoe racks, clothes
  rails and wide hook strips all span it.

## Orientation: the ladder frames need a 90° turn about Y

**Established by measurement, not inference.** The 900 shelf's underside has
four clusters of material along X:

```
x = -475.1 .. -445.6 mm   (1866 triangles)   <- 29.5 mm wide
x = -151.5 .. -148.5 mm   (76 triangles)
x =  148.5 ..  151.5 mm   (78 triangles)
x =  445.6 ..  475.1 mm   (1864 triangles)   <- 29.5 mm wide
```

The two end features are **29.5 mm** wide and sit at the extreme ends of the
950 mm shelf. A ladder frame is **30 mm** thick. Those brackets straddle a
frame: two frames on 920 mm centres carry a 950 mm shelf.

So the frame's 30 mm thickness must lie along the shelf's width axis, and its
320 mm depth perpendicular to it. As converted, every frame has its 320 mm
along X — the same axis as the shelf's width — which cannot be right. The six
frames, and the "for ladder depth" accessories, need rotating 90° about Y:

| | as converted | wanted |
|---|---|---|
| frame depth (320) | X | Z |
| frame thickness (30) | Z | X |

Shelves, shoe racks, clothes rails and the width-family hook strips are already
correct: width along X, depth along Z.

The small tabs at x = ±150 are 3 mm features 300 mm apart — most likely
locating points for the newspaper-rack divider (`008549`), unconfirmed.

## A bay is a chain, not a multi-point constraint

A shelf spanning two frames looks like it needs connecting to both, which the
engine cannot express — `resolveTransforms` takes the first path through a cycle
and says so. It does not need to. The bay resolves as a chain:

```
frame  ──socket──plug──  shelf  ──plug──socket──  frame
```

The shelf's width then *sets* the frame spacing, which is exactly how the range
is sold ("shelf 900 mm for ladder depth 320"). This is the same shape as the
synthetic racking test built earlier — that test turns out to have been a model
of this product without knowing it.

## Triangle cost

641,014 triangles across 45 parts at `--angular 0.3` (17° per facet), averaging
14,245. The distribution is very uneven:

- 41 parts are 500–9,100 triangles. Fine.
- The four YouboXx sets are 72k, 127k, 138k, 133k. These are the moulded bins,
  and they alone are 470k of the 641k.

The YouboXx sets want decimating before they go anywhere near AR. Everything
else is comfortable as-is.

## Conversion notes worth keeping

- **cascadio already normalises units and axes.** These files declare
  `SI_UNIT(.MILLI.,.METRE.)`, and the output is in metres, Y-up. No 1000×
  scale is needed — the assumption that one would be is wrong.
- **OpenCASCADE cannot open a path with non-ASCII characters** on Windows, and
  30 of the 45 filenames have umlauts. It fails by printing to stdout and
  returning normally, so the converter checks the output file exists.
- **Every file carries construction geometry.** Six of seven sampled had a
  `Path3D` (sketch curves) or `PointCloud` (datum points) alongside the solid.
  These are dropped.
- **Several files are assemblies**: 2 parts for a frame, 5 for the adjustable
  foot, 7 for the 600 clothes rail. Merged into one `body`.
- **Article numbers are not unique.** `008549`, `008551` and `008565` each cover
  2–3 distinct parts, so ids include the description.
- **`236748` is named "ladder depth 2000 mm"** and measures 200 deep × 904.5
  tall. A typo in Kesseböhmer's filename.

---

## Unresolved — needed before snaps can be authored

**Where does a shelf actually engage the frame?** This is the one thing the
geometry would not give up. Four different measurements were tried on the frames
and none was trustworthy:

| method | result | why it failed |
|---|---|---|
| triangle area per height band, >35% of max | 2 rungs per frame, at exactly 1/3 and 2/3 of every height | the rails run the full height and dominate the area, so a rung is a small bump on a high floor |
| same, >1.6× the median | 19–25 features per frame, irregular gaps | picks up every hole, bend and weld |
| rasterise triangle centroids, count runs across the depth | nothing at all | one centroid per triangle leaves a large flat bar as a handful of cells; the grid was full of holes |
| exact cross-sections, span across depth | one band per frame, the whole height | span is max−min, which for two rails 320 mm apart is still 320 mm — blind by construction |
| exact cross-sections, count closed loops | 4–184 loops per section | the tessellation is not watertight, so sections come out as dozens of open fragments |

The consistent 1/3 and 2/3 answer from the first method is suspicious rather
than reassuring: it is what you would get from *any* symmetric frame, because
the metric is dominated by the rails.

This is feature recognition on a fragmented triangle soup, which is the wrong
tool. The right sources are Kesseböhmer's technical drawing, the physical
product, or the named features inside the STEP file itself (Creo exports datum
planes with names — `A_RECHTS`, `A_OBEN` appear in the headers).

Specifically needed:

1. **Rung or hole positions** on each frame height, as dimensions.
2. **How each accessory family attaches** — hooks over a rung, clamps to a rail,
   or bolts through a hole pattern. This decides where the snap plane sits and
   which way it faces.
3. **Whether the depth-200 and depth-320 frames share a rung pitch**, or each
   height has its own.

Everything else is ready: all 45 parts convert cleanly, are declared, and report
a single remaining blocker — `NO_SNAPS`.
