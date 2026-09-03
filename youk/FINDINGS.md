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

## The bay is built, and the seating is exact

`tools/probe-bay.ps1` builds frame → 900 shelf → frame through real clicks and
captures it (`youk/bay.png`). The app's own report:

```
1 part,  0 joints,  8 open points     <- anchored 1500 frame, 4 rungs x 2 faces
2 parts, 1 joint,   8 open points     <- + 900 shelf
2 parts, 1 joint,   1 open point      <- a frame fits in exactly one place
3 parts, 2 joints, 14 open points     <- + second frame
```

That last count is worth keeping as an invariant: 7 unused sockets on each
frame plus the shelf's two plugs, both taken. It comes out right only if the
chain resolved as intended.

### Bracket against rung, measured

The seating choice — shelf `y=0` at the rung's **top** face, 100.0 mm — was an
engineering reading of `MA 406215` ("dropped in from above"), not a measurement.
It is now measured. Putting both parts in the frame's coordinates via the joint
(`shelf (x,y,z) → frame (x+460.05, y+100, z)`) and taking the shelf material
that shares the frame's 30 mm X slab — i.e. the end bracket:

```
bracket y  100.0 .. 168.5 mm      lowest material at exactly 100.0
rung 1      95.0 .. 100.0 mm      top face at exactly 100.0
```

**Flush, to the tessellation's resolution, with nothing below 100.0.** Zero
clearance and zero interpenetration is the signature of a designed bearing
surface; a wrong seating would have produced an arbitrary offset, not 100.0.

### Two things the measurement turned up

**The rungs are hollow sections.** Rung 1's end profile has vertices in two
bands, 95.0–96.5 and 98.5–100.0 — a 1.5 mm wall, so these are rolled tube, not
solid bar. They are also **15 mm wide, not 30**: `x −7.5..7.5`, centred in the
frame's 30 mm thickness. The 30 mm belongs to the stiles.

> **Correction.** This section first claimed the rungs carried "two upstanding
> locating lugs 190 mm apart". They do not. That reading came from a `85 < y <
> 115` window that swept up a *different* feature: a single 6 mm pin on the back
> stile at `y ≈ 107.5`, `z ≈ −145`. Windowing rung 2 the same way shows nothing
> above the rung at all. The window was wide enough to include a neighbour and I
> attributed the neighbour's geometry to the rung — the same failure mode as the
> area-based rung guess, and worth the same wariness: a clean-looking result
> from a loose selection.
>
> What the rungs *do* carry is better news for the configurator: **two 5×5 mm
> holes in the top wall**, at `z = ±95` on a 320 frame and `z = ±35` on a 200.
> Every hang accessory has a 9×6 mm obround slot over each of them, at the same
> spacing — which is how the joint is pinned down without guessing (below).

**Section slabs are useless on these solids.** Slicing either part at `z = 0`
returns zero vertices, and this is not a fault: a planar face carries vertices
only on its perimeter, so a bar spanning the depth has them at its ends and
nowhere between. The 900 shelf's deck likewise has no vertex with `|x| < 300`.
Anything measured here has to be read as feature boundaries — which is also why
the rung heights only fell out to vertex clustering. One more method for the
list of things that fail on CAD tessellations.

---

## The hang family, and how its joint was pinned down

Hook strip, tray and newspaper rack all lie *across* one frame's depth and
cantilever off it. They come out of CAD with their length along X, like the
frames, and want the same 90° turn.

They share one pressed bracket, and the vertex counts say so before any
measuring does: the tray's mounting fold and the newspaper rack's are byte-for-byte
the same shape, 27.3 mm across in five bands at identical offsets, 1428 vertices
each. The hook strip's is the same bracket with two bands absent.

The joint has three degrees of freedom and each is settled by a measurement
rather than a judgement:

| | how it is fixed |
|---|---|
| **height** | the 1.5 mm top sheet's underside bears on the rung's top face, so the plug sits at `maxY − 1.5` |
| **along the rung** | the accessory's slots are at `±95` (320) / `±35` (200) and the rung's holes at the same numbers, so the part is centred: plug `z = 0` |
| **across the rung** | the plug sits at the *centre of the slot*, which puts the slot over the hole |

The last one is the interesting one, because it was the one I could not read off
a drawing. `add-snaps.py` finds the slot in each part by looking in the top sheet
at the known hole spacing and takes its centre — so the number is measured from
every part rather than typed in per part, and a part that does not use this
bracket fails loudly instead of being placed by a stale constant.

**It is right, and two independent things say so.** `tools/check-joint.py` places
each accessory on a rung and reports:

```
shelf 900        lowest material y 100.00, socket y 100.00   flush, 0 sunk
tray 320/200     hangs 16.50mm past the face, 0 verts inside the rung's x span
newspaper 200    hangs 41.50mm past the face, 0 verts inside the rung's x span
hook strip 200   hangs 46.00mm past the face, 0 verts inside the rung's x span
hook strip 320   hangs 45.93mm past the face, 8 verts inside, deepest 0.33mm
```

Every descending leg lands *outside* the rung's `x −7.5..7.5`, which is what a
hook wrapping a member looks like. The hook strip's 8 vertices at 0.33 mm are
tessellation noise on a leg designed flush to the face — the 200 mm version of
the same part, whose plug differs by 0.15 mm, reports zero. The tool prints the
depth rather than just the count precisely so that tenths and millimetres cannot
be mistaken for each other.

The accessories' ends also clear the stiles, which is not obvious: they are
315 mm long inside a 320 mm frame, so their ends sit right over the stiles at
`z ±145..160`. At those `z` the only accessory material is at `x ≥ 15.75` —
outside the frame's `x −15..15` — and the mounting fold itself stops at `±143.5`,
1.5 mm short of the stiles' inner faces. The same clearance the shelf uses.

### One mask per depth

`youk-d200` / `youk-d320`, shared by both families, replacing the earlier
`youk-span-d<n>`. Both families bolt through the same hole in the same rung
face, so they have to compete for it. Separate masks would have put two snaps at
the same point on the frame and filling one would not have filled the other — a
shelf and a tray could then occupy the same rung face. That also answers open
question 2: two accessories *can* share a rung, one on each face, because the
faces are separate sockets.

### The converter's output is now `<id>.converted.glb`

Snapping rotates, so it is not idempotent — and it used to read and write the
same `<id>.glb`. Running it twice turned every frame 90° a second time and
produced a model that assembled confidently in the wrong orientation. The
converter now writes `<id>.converted.glb`, `add-snaps.py` reads that and writes
`<id>.glb`, and it refuses outright if its input already carries snap nodes.
`declare.mjs` and `inspect-model.mjs` skip `.converted.glb` in a folder sweep,
since those are inputs rather than candidate components.

---

## Shoe racks are not part of this system

`MA 406213` screws them **straight to a wall**, with plugs and screws and a
spirit level. No ladder frame appears anywhere in the drawing. Their widths give
it away too: 448 / 598 / 898 / 1198 — the catalogue size *minus two*, where every
span accessory is the catalogue size *plus fifty*. The Ø6.5 mm holes 50 mm in
from each end are in the mesh exactly where the sheet dimensions them.

So they stay out. Forcing four parts into a bay because their names look like
the shelves' would have produced a configurator that offers a product
Kesseböhmer does not sell.

## Clothes rails: same bay, opposite bearing face — and one unresolved millimetre

The three symmetric rails (600, 900, 1200) are span parts. Their widths are
649.5 / 949.5 / 1249.5 against the shelves' 650.1 / 950.1 / 1250.1, so under the
same rule they ask for frames 0.6 mm apart from where a shelf does — the same
bay, which they must be, or a bay could not carry both.

What differs is **which face bears**. A shelf is dropped in from above and its
bracket's underside is the part's own base. A rail *hangs*: its 1.5 mm top sheet
bears on the same rung face, so the plug sits at `maxY − 1.5`, not at `y = 0`.
That is now a `bearing` field in the spec, because getting it wrong puts a part
a whole part-height out of position and nothing about the model would look
obviously broken.

**The one thing I could not resolve.** `check-joint` reports 1.00 mm of the
rail's bracket inside the rung, identically on all three sizes — systematic, not
noise. Two readings, and the drawings do not settle it:

- the plug's x is right (the flange's outer edge lands at 15.05 mm from the frame
  centre, against an outer face at 15.00 — the flush signature every other
  bracket in this range shows), and the bend where the web meets the flange
  genuinely passes through the rung's hollow interior, meaning I have the
  bracket's engagement wrong somewhere;
- or the plug's x is out by a few millimetres, and the flange is meant to centre
  on the rung — but that implies frames 930 mm apart for a 900 rail against
  920 mm for a 900 shelf, and the two cannot both be right.

1 mm on a 950 mm part is invisible and does not affect what the configurator is
for, so the rails are authored and the discrepancy is written down rather than
smoothed over. It is a question for Kesseböhmer, not a bug to guess at.

## Triangle budget: re-tessellate, do not decimate

The four YouboXx sets were 72k–138k triangles and made up 470k of the range's
641k. The converter now takes `--max-tris` and, when a part busts it, goes back
to the **CAD** and tessellates again coarser. Decimating the mesh afterwards
would approximate an approximation; re-tessellating keeps a true surface.

The first attempt relaxed only the angular tolerance and stalled — three of the
four sat at ~60k however coarse the angle got, because past about a radian the
angular tolerance stops constraining anything and their triangle count is driven
by the linear tolerance and the sheer number of small features. Relaxing both,
with the angle capped at 1 radian:

```
                         before      after
008545 youboxx set 2     72,254     36,316
008546 youboxx set 3    127,162     33,354
008547 youboxx set 4    138,184     33,216
008548 youboxx set 5    133,482     33,064
range total             641,014    305,876    (average 6,797 per part)
```

Every part is now inside a 40,000-triangle budget, and nothing else in the range
was touched, because nothing else was over it.

## The mounting slot, not the top face

Adding the YouboXx sets broke the hang rule and improved it. Two of the four
have a moulded lid standing a few millimetres proud of the bracket, so "the top
1.5 mm" was lid rather than sheet and the slot search found nothing — a clean
failure rather than a silent mis-placement, which is what deriving the plug from
a real feature buys.

The fix takes **both** the plug's x and its y from the slot itself: its lower
ring is the face that bears on the rung, so nothing has to be assumed about what
sits above it. All nine hang parts then report a 1.5 mm sheet — the same pressed
bracket, measured on each rather than trusted to match.

The YouboXx sets also need no rotation: alone among the hang family they come out
of CAD with their length already along Z.

---

## Still open

1. **Which rungs may a span accessory use?** All of them, presumably — the rung
   heights are absolute, so two frames of any heights have aligned rungs.
2. ~~Can two accessories share a rung?~~ **Answered by the shared mask**: one
   per rung *face*, so yes, one on each side, and no, not two on the same side.
3. **Whether a frame needs the adjustable foot** (`237023`) to stand, or the
   floor-standing configuration is wall-fixed only. Page 1 of the general
   instructions shows a wall-mounted pair.
4. **Should the app stop an accessory hanging below the floor?** A tray on
   rung 1 drops 158.5 mm and ends up through the ground plane. That is the
   geometry behaving correctly and the product being used wrongly, which is
   exactly the kind of thing a configurator should refuse — but refusing it
   needs a rule about what the ground is, which does not exist yet.
5. **How the clothes rail's bracket really engages the rung** — the unresolved
   millimetre above. Worth asking Kesseböhmer directly rather than measuring
   harder; the geometry admits two readings and only they know which.
6. **The clothes rail extensions** (`008533`, `008534`, `008535`). `MA 406208`
   builds a two-bay run from two tubes sharing a middle bracket, and these parts
   carry a bracket at one end only. That is an accessory-to-accessory joint —
   a pattern the engine has not been asked for yet, not just another spec row.

None of these blocks what is built. All 45 parts convert cleanly and none exceeds
40,000 triangles; 22 of them — six frames, four shelves, three clothes rails and
nine hang accessories — carry snap planes, are declared, and load as components
with no blocker and one optional warning (`NO_COLLISION_BOX`). The remaining 23
sit as `.converted.glb` inputs waiting for a row in the spec, or, in the shoe
racks' case, waiting for a product the configurator does not model.
