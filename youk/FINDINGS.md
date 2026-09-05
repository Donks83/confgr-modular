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
2 parts, 1 joint,   9 open points     <- + 900 shelf
2 parts, 1 joint,   1 open point      <- a frame fits in exactly one place
3 parts, 2 joints, 16 open points     <- + second frame
```

**These counts changed on 5 September, and the change is the point.** They used
to read 8 and 14. A rung that carries a shelf now stays open *underneath*,
because a hook rail or a suspended element hooks over the same rung and hangs
beneath it — so fitting the shelf costs the frame nothing and adds the shelf's
own free plug, taking 8 to 9 rather than leaving it at 8.

Still worth keeping as an invariant, just a different one: it comes out right
only if the chain resolved as intended *and* shared occupancy is working. If it
reads 8 and 14 again, sockets have gone back to being exclusive.

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

## A multi-bay run needs no new engine work

A real YouK installation is several bays side by side, and that was the next
thing I expected to have to build. It already works: the chain that makes one
bay makes three, because each frame after the first arrives through the shelf
that precedes it.

`npm run youk:bay -- -Scenario run` builds `frame → shelf → frame → shelf →
frame` plus two more shelves, and the app's own layout dump gives:

```
i1 frame  @    0.0,    0.0, 0.0
i2 shelf  @  460.1,  100.0, 0.0
i3 frame  @  920.1,    0.0, 0.0
i4 shelf  @ 1380.2,  100.0, 0.0
i5 frame  @ 1840.2,    0.0, 0.0
i6 shelf  @  460.1,  810.0, 0.0
i7 shelf  @  460.1, 1405.0, 0.0
```

1840.2 is exactly 2 × 920.1, every part is on `y = 0`'s plane and `z = 0`. **No
drift.** That is the thing worth checking about a chain — a resolve that is
slightly wrong compounds along the run rather than looking obviously broken, and
one perspective screenshot cannot tell you either way. It was a screenshot that
made this run look uneven when it was not.

`window.__cfgLayout()` and the harness's `layout` step exist for that reason:
they report where every part actually ended up, from the scene graph, after
`updateMatrixWorld`. Cheaper and far more conclusive than looking.

### One thing the run exposes

Shelves `i6` and `i7` are connected to the first frame only. Their far ends land
at 920.1, exactly where the second frame is, so they *look* joined — but the
connection graph is a tree and the second attachment is not recorded. The bill
of materials is right and so is the geometry; what is wrong is that deleting the
middle frame would leave two shelves floating. That is the documented
first-path-wins behaviour of `resolveTransforms`, not a new bug, and it is worth
deciding about before this is in front of a customer.

---

## The commercial layer, and two supplier description errors

`youk/catalogue.json` carries the article number, the supplier's own English
description and the measured size for each of the 22 configurable parts, plus
three price tiers — retailer, trade, retail. **Every price is `null`, and null
means unknown, not free.** `src/engine/quote.js` refuses to treat a missing
price as zero: the line reports `null`, the total says how much of the product
it could price, and when *nothing* prices there is no total at all.

That last rule came from running it. A seven-part bill of materials against the
real (priceless) catalogue printed `Net (PARTIAL): GBP 0.00` — the exact failure
the module exists to prevent, wearing a label. A zero is a price; the absence of
every price is not, however carefully the heading is worded.

Descriptions are derived from the STEP filenames rather than retyped, because
retyping 22 article numbers into a document somebody quotes from is 22 chances
to transpose a digit. Doing so surfaced two errors in Kesseböhmer's own
filenames, both now overridden in the catalogue (`descriptionOverride`, which
survives regeneration):

| Article | Filename says | Actually |
|---|---|---|
| `236748` | "ladder depth **2000** mm" | 200 mm deep, 904.5 tall — and the German half agrees |
| `236762` | English half: "height **1500** mm" | **2210 mm** — the German half says 2210 and so does the geometry |

The second one matters commercially. `236758` and `236762` are different frames
at different prices, and without the override **both appear on a quote as "YouK
ladder depth 320 mm, height 1500 mm"**. Worth raising with Kesseböhmer: if their
filenames feed anything downstream, that error is not confined to us.

Splitting the filename at the first comma also silently dropped the frames'
heights — four frames of different heights sharing one description — because
some filenames carry two English segments before the German begins. Fixed, and
the reason is in the code.

### What is not modelled yet

- **Consumables.** The instructions have the customer supply plugs and screws,
  and the shelf and hook rail each want a 1.5 mm packer. None of that is a
  configurable part, so none of it is in the bill of materials — a real quote
  needs a line for it.
- **A price list format.** The catalogue takes either an explicit
  `priceEach: { tier: value }` — a real list, loaded verbatim — or `costEach`
  plus the tier's markup. Explicit wins, because a markup is a stand-in for the
  price list and stops being an authority the moment the real number arrives.
- **Discounts, carriage, lead times, minimum order.** All quote-shaped concerns
  that need somebody's commercial policy, not more code.

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
7. **Should a span accessory record BOTH of its ends?** See the run above: a
   shelf added to an existing bay lands perfectly against the far frame but is
   connected only to the near one. Recording both would make the graph a cycle,
   which `resolveTransforms` deliberately does not do.

None of these blocks what is built. All 45 parts convert cleanly and none exceeds
40,000 triangles; 22 of them — six frames, four shelves, three clothes rails and
nine hang accessories — carry snap planes, are declared, and load as components
with no blocker and one optional warning (`NO_COLLISION_BOX`). The remaining 23
sit as `.converted.glb` inputs waiting for a row in the spec, or, in the shoe
racks' case, waiting for a product the configurator does not model.

---

# Every remaining joint, from the instruction sheets — 5 September 2026

Matt named the sheets and the specific steps. This section is what they say, and
it settles most of the open joint questions in one pass. Read together, they also
reveal a pattern the individual sheets do not: **the 1.5 mm packer is a
system-wide constant.**

## The 1.5 mm packer appears in four separate sheets

`hook rail` step 3, `Suspension elements` step 2, `Carcass holder` step 5,
`Office solution` step 7 — every one of them puts a 1.5 mm shim between a metal
bracket and the underside of the board or panel it is screwed up into, and every
one ships it as a bag of four.

So it is not a quirk of one part. **The rule is: whenever a YouK metal element is
fixed up into a panel above it, there is a 1.5 mm gap.** That is a modelling
constant, not a per-part measurement, and it means the snap between any accessory
and any board must sit 1.5 mm below the board's underside rather than flush.

Worth noting the collision consequence: a hook rail and a shelf **share a rung**
by design. The shelf sits on the rung, the accessory hooks over the same rung and
hangs below it, and then the two are bolted together through the packer. So a
rung socket must **not** be exclusive — the current "already occupied" refusal
would block a configuration Kesseböhmer's own instructions show being built.

## Correction: the shoe rack does not touch the ladders at all

The table above lists the shoe rack as a span accessory with a plug at each end.
**That is wrong.** `mounting instructions Shoe rack.pdf` steps 1 and 2 show it
marked out with a spirit level against a bare wall, drilled, plugged and screwed
**directly to the wall**. There is no ladder anywhere in the sheet.

| | |
|---|---|
| Lengths | 448 / 598 / 898 / 1198 mm (nominal 450/600/900/1200 less 2) |
| Height | 48.5 mm |
| Fixings | 3 × Ø6.5 mm holes, first 50 mm from the end, rest equally spaced |
| Supplied | Nothing — plugs and screws are the customer's |

In the photography it lines up with the ladders and looks like part of the bay.
It is not. **This is the first part in the range whose only attachment is the
wall**, and it forces the open question in the project doc — does the
configurator need a wall entity? — to have an answer rather than a shrug.

## Hook rail and clothes rail: two modes, and the mode changes the fixing

Both sheets show the same two-mode pattern, and Matt flagged it before I read
them.

**Without a shelf** — the rail's end brackets hook onto the ladders and are
**bolted**: M4 screw plus M4 nut through the bracket.

**With a shelf above** — the rail is **screwed up into the shelf from below**,
through the 1.5 mm packer, and the screws are not supplied (`= shopping cart`).

`hook rail`: widths 450 / 600 / 900 / 1200 mm, **max 18 kg**, 1 rail + 2 × M4
screw + 2 × M4 nut + 1 bag of packers.

`Coat rail` step 1a/1b is the more interesting one, because it answers the
accessory-to-accessory question the engine has been dodging:

| | parts |
|---|---|
| **1a — one bay** | 1 rail, 1 left end bracket, 1 right end bracket, 4 × M4 |
| **1b — two bays** | 2 rails, 1 left, 1 right, **1 middle joining bracket**, 8 × M4 |

So a clothes-rail extension does **not** join rail to rail. A third bracket sits
on the middle ladder and both rails bolt into it. **That is a coupler part, not a
new joint class** — it is an ordinary component with a socket to the ladder and a
plug at each side. The engine needs no new capability for it, which is a better
answer than the "accessory-to-accessory joint" the project doc has been carrying
as an open risk.

## Top panel bracket 008552 — how a board sits on top of the ladders

`Cover shelf holder`, 2 pages, and the simplest joint in the range.

- **2 × brackets**, one per ladder. A small L that drops down over the **top end
  of the ladder stile** (the sheet's green arrow points straight down onto it).
- The ledge is **30 mm** across and stands **15 mm** proud, so the panel's
  underside sits 15 mm above the stile top.
- The panel is then screwed down into the bracket. Screws not supplied.

This is the third distinct way a board attaches, and it is the one that produces
the flush top seen in most of the marketing photography. The other two are: on a
rung like the metal shelf, and on the office-solution arms.

## Carcase bracket 008557–008560 — how a cabinet hangs

`Carcass holder`, 5 pages. Two bracket types and they are not interchangeable.

| Step | What |
|---|---|
| 1a | **Outer** bracket (008557/8) — **2 ×** — drops down over the ladder stile |
| 1b | **Extension** bracket (008559/60) — **1 ×** — the middle ladder, rotated into place |
| 2 | Bolted: 4 × M4 screw + 4 × M4 nut |
| 3 | Carcase sits on the brackets, screwed **up from below**; screws not supplied |
| 4 | 2 × dowels, Ø5 drill, **19 mm** in from the edge, **≈50 mm** back, **9 mm** deep |
| 5 | The 1.5 mm packers again, bracket to carcase underside |

**The cabinet's own limits, stated by Kesseböhmer:**

- Width **≤ 1200 mm**
- Height **≤ 450 mm**
- Depth **≥ the ladder depth** — so ≥ 200 mm or ≥ 320 mm

Those are real constraints for a rules engine to enforce later, and the first
numeric limits in the range that a customer could violate by choosing badly.

## Office solution 008551 — the desktop, and one rule nothing else states

`Office solution`, 6 pages. Three separate 008551 parts fitted in sequence:

| Step | Part | Count | Fixing |
|---|---|---|---|
| 1–2 | Shelf support (*Grundhalterung*) | 2 × | 4 × M4 + 4 nuts |
| 3 | Base bracket (*Bodenträger*), the long arm | 2 × | 4 × M4 + 4 nuts |
| 4 | Clamping angle (*Klemmwinkel*) | 2 × | 2 × M4 × 6 |
| 5 | Desktop laid on, screwed **up from below**; screws not supplied |
| 6 | Rear edge must sit **against** the bracket upstand — the sheet draws a tick and a cross |
| 7 | 1.5 mm packers, bracket to desktop underside |

**The desktop geometry, and Kesseböhmer annotate the thickness themselves:**

- Thickness **25 mm**, printed five times on page 4. Matt specified 25 mm before
  I opened the sheet; it is their number too.
- Heights **650** or **750 mm**; a third variant is 750 mm with **100 mm** of
  clearance beneath — which is the frame on feet.
- Depths **600** or **700 mm**.
- An angled option at **9°**, dropping the front edge to 560/540 (from 650) or
  660/640 (from 750).

**And the rule that appears nowhere else in the range.** Page 3 opens with a tick
and cross diagram over four ladders of different heights: the green dashed line
runs across their **tops**, the red dashed lines across their bottoms. For an
office solution the ladders are hung so their **top edges align**, and their
bottoms do not.

That is the opposite of a floor-standing run, where the bottoms align because
they are all on the floor. So "staggered frames" is not one behaviour with a free
choice of level — **it is two alignment rules, and which one applies depends on
how the run is mounted.** Worth building the level chooser knowing that.

## The foot 237023, restated from the sheet

- **100 or 150 mm**, ±10 mm on the levelling nut. Only the 100 has CAD.
- **One per ladder**, screwed to the underside of the bottom rail at the end,
  2 × M4.
- Page 1's isometric puts it at the **front** corner. The bedroom photograph
  confirms it: wall-fixed at the back, one foot at the front, skirting board
  running behind untouched.

## The shelf is screwed up into the frame too

`mounting instructions.pdf` step 4, which I had not read: after the shelf is
dropped in, it is **screwed upward into the frame from below**, screws not
supplied. The accompanying note repeats the bearing widths — **169 mm on a 200
frame, 289 mm on a 320** — which the converted geometry already agreed with.

Page 5 of the same sheet is the rung-position master drawing for all six frames.
It is the page that would have saved most of two sessions, and it agrees with the
measured heights above to 0.1 mm.

---

# The timber parts — Matt's specification, 5 September 2026

None of this is Kesseböhmer's. Their brochure (page 3) says the wooden shelves
*"are made individually by a carpenter (or woodworker) and are therefore not
included in the YouK range"*, so there is no CAD, no article number and no price
list. These are ours to model and, for now, **shown but not priced** — they quote
as POA and the bill of materials reports a partial total rather than inventing a
number.

| | |
|---|---|
| **Shelves and desktops** | **25 mm** thick, always |
| **Lengths** | 450 / 600 / 900 / 1200 mm — the standard YouK bay widths |
| **Cabinets** | Six-piece box construction, small chamfer, no internal detail |

Three notes on why these are the right numbers rather than round ones:

1. **25 mm is Kesseböhmer's own figure**, annotated five times on page 4 of the
   office-solution sheet. Matt specified it independently before I read the
   sheet. So the timber matches the system rather than merely fitting it.
2. **The lengths are the bay widths**, which is what makes a timber shelf a drop-in
   alternative to 008561–008564 rather than a special order.
3. **The cabinets have a ceiling, not just a size.** The carcase bracket sheet caps
   them at 1200 × 450 and requires depth ≥ the ladder depth. A six-piece box is
   therefore parameterised by width from the standard list, height ≤ 450 and
   depth 200 or 320 to match its brackets.

A cabinet modelled as six panels is also the right level of detail for AR: the
triangle budget is assembly-wide (`src/engine/ar.js`), and a drawer front with
real hardware would spend it on something nobody inspects on a phone.

---

# CORRECTION — the office-solution tick-and-cross is not an alignment rule

**What I wrote earlier in this file and in the project doc was wrong.** I claimed
page 3 of `mounting instructions Office solution.pdf` showed that wall-hung runs
align by their ladder **tops** while floor-standing runs align by their bottoms,
and that "staggering is two rules, not one". Matt corrected it: the green and red
lines mark **the only levels at which the office-solution desktop assembly may be
fitted** — nothing to do with alignment.

He is right, and the drawing says the opposite of my claim: **all four ladders in
it stand on one common floor line.** Their bottoms are aligned. I had described a
diagram that shows aligned bottoms as evidence for aligning tops.

## What it actually says, measured

Rendered at 6× and measured rather than eyeballed. Four ladders, four different
heights, all sharing a base line; three horizontal dashed lines cross all four.

Horizontal members found on the tallest ladder (pixel y, top of page downward):

```
595/603  top cap
650   856   1061   1404   1609   1814        <- six rungs
1862/1870  bottom cap
1958  ground line drawn below the frames
```

Taking the bottom cap as the frame base, the six rungs sit at these fractions of
the frame height: 0.041, 0.202, 0.363, 0.633, 0.795, 0.957. The known rung
heights for the 2210 frame — 100, 455, 810, 1405, 1760, 2115 — give 0.045, 0.206,
0.367, 0.636, 0.796, 0.957. **Every rung matches to within 0.004 of frame height,
about 9 mm.** So the tallest ladder is the 2210 and the rungs are the usual set.

The rung counts identify the rest, and they match the table earlier in this file
exactly: 6 rungs = 2210, 4 = 1500, 3 = 905, 2 = 550.

| Line | Pixel y | Rung | Height above base | Meaning |
|---|---|---|---|---|
| **green** | 1394 (rung at 1404) | 3 | **810 mm** | permitted |
| red | 1609 | 2 | 455 mm | forbidden |
| red | 1814 | 1 | 100 mm | forbidden |

## The rule, and its consequence

**The office-solution shelf support (008551) may be fitted at rung 3, 810 mm above
the frame base. Rungs 1 and 2 are explicitly forbidden.** Rungs 4–6 are not
marked either way, so I am not claiming anything about them.

The consequence is visible in the drawing and worth stating on its own:

> **The 550 mm frame has only rungs 1 and 2 — both red. It cannot take a desk at
> all.** The 905 frame's top rung *is* the green one, so it only just qualifies.

That also explains the red **"?"** on the same page: the plate shown against a
ladder, asking "may it go here?", answered by the green and red lines.

## Why this matters more than the rule it replaces

This is **the first part in the range whose attach points are conditional** — the
rungs exist and are geometrically identical, but only some of them are legal for
this part. Every snap in `component.js` already carries `condition: null`,
reserved for Phase 1 and never used. This is the concrete case that needs it, and
it arrives with a rule simple enough to be the first test: *rung index ≥ 3*.

Roles and masks cannot express it. A mask says *what kind* of thing fits; a role
says *which way round*; neither says *which of the identical sockets*.

## How I got it wrong

I read a low-resolution page render, saw one green line high and two red lines
low across ladders of descending height, and constructed a rule that sounded
plausible. I did not check whether the bottoms were aligned — they were, which
alone disproves it — and I did not measure where the lines fell.

**Same failure as the "locating lugs" earlier in this file:** a confident reading
of a pattern at insufficient resolution, written up as fact. The measurement that
settles it took one script. The rule I invented was more interesting than the real
one, which should itself have been the warning.

---

# The width hook strips are in — 5 September 2026

008538 / 008539 / 008540 / 008541, "hook strip for ladder width 450 / 600 / 900 /
1200 mm". They belong to the **span** family, not the hang family: they run
lengthways between two frames exactly as a shelf does. 008536 and 008537, sold by
ladder *depth*, are the ones that mount depthways on a single frame — and with
only those loaded, the app's hooks looked wrong, which is what Matt reported.

**Widths, measured off the converted geometry, against the shelves:**

| Nominal | Hook strip | Shelf |
|---|---|---|
| 450 | 500.2 | 500.1 |
| 600 | 649.6 | — |
| 900 | **950.2** | **950.2** |
| 1200 | 1250.2 | — |

The 900s agree to 0.0 mm, so one bay carries either. Snapping derives plugs at
x = ±460.05, giving frames 920.1 mm apart — the same spacing the 900 shelf sets,
which is the check that matters.

**Bearing is "top", and measured rather than reasoned.** Counting vertices in
1 mm bands down from the top gives the hook strip the same profile as the clothes
rail — dense at 0–2 mm, tailing to 3 mm, then nothing until 5 mm — which is the
top sheet plus its bend radius. The rail is already verified at "top", so a strip
presenting the identical sheet settles it without a separate measurement.

Placed in the app: bay of two 1500 frames at 0 and 920.1, then a 900 strip on
rung 3. It lands at **x 460.1, y 761.5** — centred in the bay like the shelf, and
810 − 48.5, which is the rung's top face less the plug offset. It asks no
question when placed, because there is only one distinct outcome.

## The 1.00 mm is now narrowed, and it is not random

The clothes rail's unexplained 1.00 mm of bracket inside the rung — logged in
session 3 as "two readings possible, a question for Kesseböhmer" — appears on the
hook strips too, at **exactly 1.00 mm**, on all three sizes checked.

Sorting every checked joint by what its plug is derived from:

| Family | Plug derived from | Deepest inside the member |
|---|---|---|
| Shelves (span, bearing `base`) | `y = 0`, the part's own base | **0 verts** |
| Clothes rails (span, bearing `top`) | `maxY − topSheetMm` | **1.00 mm** ×3 |
| Width hook strips (span, bearing `top`) | `maxY − topSheetMm` | **1.00 mm** ×3 |
| Hang family (tray, YouboXx, depth strips) | the measured slot | 0.00–0.13 mm |

**The 1.00 mm tracks one thing: span parts whose plug is computed as
`maxY − topSheetMm`.** Everything whose plug is *measured* — the shelves off
their own base, the hang family off the slot — is clean. Two independent product
families landing on precisely the same 1.00 mm is not a coincidence in the metal.

That does not yet say what the right number is. The obvious suspects — a bearing
face 2.5 mm below the top rather than 1.5, or the ±15 mm inset being wrong for a
bracket that wraps the stile — predict different corrections, and the depth hook
strip has the *same* 50 mm height and the *same* 48.5 mm plug yet seats cleanly,
which argues against a simple height error. So it stays open.

What has changed is that it is a **better-specified question**: not "why is the
clothes rail 1 mm out" but "why is a plug derived from the top sheet 1 mm out
when a plug derived from the slot is not". The next move is to derive the span
`top` plug from the slot as the hang family already does, and see whether the
1.00 mm disappears. That is a one-line change to `span_snaps` and a re-run of
`npm run joints`.

## One thing not explained

`check-joint` reports the 450 strip's lowest material near the joint at 10.00 mm
below the socket, where the 900 and 1200 both read 46.00 mm. All three report the
identical 174 vertices at the identical 1.00 mm inside the member, so the bracket
geometry is the same and the joint is the same; the difference is in a diagnostic
window, most likely the nearest hook to the end sitting further inboard on the
short one. Recorded rather than explained, because it is not the acceptance
number and guessing at it would be the same mistake as the locating lugs.

### One hypothesis tested and ruled out, same day

The obvious reading of the table above is that `topSheetMm: 1.5` is simply the
wrong number — that the bearing face sits 2.5 mm below the part's top, which
would put every computed plug 1 mm high and produce exactly the 1.00 mm seen.

**It does not survive a look at the geometry.** Sampling vertices within 25 mm of
the plug's own x on the 900 rail and the 900 strip gives, from the top down:

```
rail   75, 74.9, 74.8, 74.6, 74.4, 74.1, 73.9, 73.5
strip  50, 49.9, 49.8, 49.6, 49.4, 49.2, 49.1, 48.9
shelf  68.5, 68.4, 68.3, 68.1, 68, 67.8, 67.6, 67.4
```

That is a smooth ramp, not a sheet with a flat underside at some discrete depth.
The edge is rolled or formed, so there is no "underside of the top sheet" level
to read off at 1.5 mm or at 2.5 mm — the number was always an approximation of a
curve, and picking a different approximation would be guessing with extra steps.

Worth noting what this also implies: the 1.00 mm may not be a Y error at all. A
span part's end bracket wraps the frame, so material counted "inside the member"
could be a return leg passing beside the rung in X or Z, in which case no change
to the plug height would touch it.

So the question stays open and stays with Kesseböhmer, but two readings are now
gone: it is not a per-part quirk (two families, identical number), and it is not
a mis-stated sheet thickness (there is no flat sheet to mis-state).
