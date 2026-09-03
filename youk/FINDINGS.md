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

## Rung positions — RESOLVED, from Kesseböhmer's own drawings

The folder contains **ten mounting-instruction PDFs** alongside the STEP files.
I missed them: my first command filtered to `*.stp` and I never listed the
folder again. They answer every open question, and page 5 of the general
instructions (`MA 405462 0000`) carries a dimensioned rung chain for both
depths.

Before finding them, four geometry measurements were tried and none was
trustworthy. Recorded because three failed the same way — a metric that cannot
distinguish the two cases:

| method | result | why it failed |
|---|---|---|
| triangle area per height band, >35% of max | 2 rungs per frame, at exactly 1/3 and 2/3 of every height | the rails run the full height and dominate the area, so a rung is a small bump on a high floor |
| same, >1.6× the median | 19–25 features per frame, irregular gaps | picks up every hole, bend and weld |
| rasterise triangle centroids, count runs across the depth | nothing at all | one centroid per triangle leaves a large flat bar as a handful of cells; the grid was full of holes |
| exact cross-sections, span across depth | one band per frame, the whole height | span is max−min, which for two rails 320 mm apart is still 320 mm — blind by construction |
| exact cross-sections, count closed loops | 4–184 loops per section | the tessellation is not watertight, so sections come out as dozens of open fragments |

The drawing's chain for depth 320, bottom to top:

```
15 | 80 | 5 | 350 | 5 | 350 | 5 | 590 | 5 | 350 | 5 | 350 | 5 | 80 | 15  =  2210
```

The `5`s are rung members; the rest are clear gaps. **Verified against the
meshes** by listing the heights at which vertices cluster — a tessellated CAD
solid puts vertices on feature boundaries and almost nowhere else, which is the
measurement that finally worked. Drawing and geometry agree to 0.1 mm:

### Depth 320 — rung members, height above base

| | 550 | 905 | 1500 | 2210 |
|---|---|---|---|---|
| rung 1 | 95.1–100.0 | 95.1–100.0 | 95.1–100.0 | 95.1–100.0 |
| rung 2 | 450.1–455.0 | 450.1–455.0 | 450.1–455.0 | 450.1–455.0 |
| rung 3 | — | 805.1–810.0 | 805.1–810.0 | 805.1–810.0 |
| rung 4 | — | — | 1400.1–1405.0 | 1400.1–1405.0 |
| rung 5 | — | — | — | 1755.1–1760.0 |
| rung 6 | — | — | — | 2110.1–2115.0 |

**One pattern truncated at four heights.** Every frame shares the same absolute
rung heights measured from its base — the taller ones simply have more. Clear
gaps between members run 350, 350, 590, 350, 350, matching the drawing exactly.

### Depth 200 — pitch 236.5 mm

| | 668 | 905 |
|---|---|---|
| rung 1 | 95.1–100.0 | 95.1–100.0 |
| rung 2 | 331.6–336.5 | 331.6–336.5 |
| rung 3 | 568.1–573.0 | 568.1–573.0 |
| rung 4 | — | 804.6–809.5 |

The drawing says 232 for this family, which is the *clear gap*: 236.5 − 4.9 =
231.6. Consistent with the 350 and 590 also being clear gaps.

Both depths also carry a bottom member at 13–15 mm and a top member 15 mm below
the frame top. Those are the frame's own end caps, not attach points.

### The earlier guess was wrong, and by a lot

The area-based method had put the 2210 frame's rungs at 740 and 1470. The real
ones are at 95, 450, 805, 1400, 1755 and 2110. Not a near miss — a different
answer with a different count. Worth remembering that it was the *most
plausible-looking* of the failed attempts, because it produced a clean
symmetric result.

## How each family attaches

From the instruction sheets:

- **Shelf** (`MA 406215`) — spans two frames, dropped in from above; the end
  brackets hook over the frame profile. Fixed with one screw each side and a
  1.5 mm packer. Load by width: 450 → 30 kg, 600 → 25 kg, 900 → 20 kg,
  1200 → 17.5 kg.
- **Suspended elements** (`MA 406209`) — hook rail, tray, YouboXx bins,
  newspaper/towel rack. These hang on a **single** frame and cantilever off it,
  at any rung. Depth-specific: separate parts for 200 and 320.
- **Frame** (`MA 405462`) — wall-mounted, two wall brackets per frame, fixing
  holes 55 mm below the frame top. Customer supplies plugs and screws.
- Shelf usable depth is 169 mm on a 200 frame and 289 mm on a 320 frame — the
  289 matches the converted shelf's measured 287 mm depth.

So there are two joint kinds, and they want different masks:

| | connects to | mask |
|---|---|---|
| shelf, shoe rack, clothes rail, hook rail *by width* | two frames, chained | `youk-span-d200` / `youk-span-d320` |
| hook rail *by depth*, tray, YouboXx, newspaper rack | one frame | `youk-hang-d200` / `youk-hang-d320` |

Frames offer **sockets** at every rung on both faces; accessories present
**plugs**. A span accessory carries a plug at each end so a second frame can
attach to its far side — the frame → shelf → frame chain.

---

## Still open

1. **Which rungs may a span accessory use?** All of them, presumably — the rung
   heights are absolute, so two frames of any heights have aligned rungs.
2. **Can two accessories share a rung** — a shelf and a hook rail at the same
   level, one each side?
3. **Whether a frame needs the adjustable foot** (`237023`) to stand, or the
   floor-standing configuration is wall-fixed only. Page 1 of the general
   instructions shows a wall-mounted pair.

None of these blocks the first bay: frame + 900 shelf + frame is fully
specified now. All 45 parts convert cleanly, are declared, and report a single
remaining blocker — `NO_SNAPS`.
