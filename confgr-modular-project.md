# confgr Modular — Project Documentation

**Last updated:** 4 September 2026, end of session 3. State verified against the
code at commit `e066c08`, not from memory.

**Code:** `C:\Claude\confgr-modular` — git, 15 commits, **local only, no remote.**
**Tests:** 190 passing (`npm test`).

**Related documents**

| File | What it is |
|---|---|
| `C:\Claude\confgr-studio\confgr-modular-plan.md` | The research and build plan, 3 Sep 2026. Still the strategy. **This file is the state** — where the plan and reality disagree, this file wins. |
| `C:\Claude\confgr-studio\configurator-studio-project.md` | confgr Studio V2 — the sibling product this borrows from, and the thing it must reach parity with on export. |
| `youk/FINDINGS.md` | Everything measured from Kesseböhmer's YouK range. The most detailed document in the project. |
| `tools/AUTHORING.md` | How a supplier's CAD file becomes a component. |

---

## 1. What This Is

A separate Electron + React + three.js desktop application for building **modular
3D product configurators** — products assembled from parts that click together,
where the customer chooses the parts and the arrangement rather than just a
finish. Shelving, racking, furniture, office pods, modular bags, camera cases.
Explicitly *not* a room designer: the product is anchored at the centre of the
view and parts are added to it at attach points.

It is deliberately a different application from confgr Studio, not a mode inside
it. Studio composites rendered images; this renders real geometry. The line, and
what gets copied rather than shared, is set out in §3.2 of the plan.

The first real product in it is **Kesseböhmer's YouK shelving range** — 45
supplier CAD files, of which 22 are now configurable components. Kesseböhmer is a
partnership prospect, not a PWS channel.

## 2. End Goals

1. A configurator a customer can use on **Kesseböhmer's own website**, embedded,
   with more than one on a page.
2. A **quote** out of the far end — parts list, article numbers, tier pricing,
   PDF.
3. **"View in your room"** — AR on a phone, QR handoff from desktop.
4. The authoring side usable by **somebody who is not the developer**: import a
   model, mark the attach points, set the rules, without a command line.
5. Enough of a demo to put in front of Kesseböhmer.

## 3. Where We Are — Current State (verified against code, 4 September 2026)

Read this section as: **the engine is real, the product around it is not.**

### 3.1 The attach engine — built and tested

`src/engine/` — 6 modules, no UI dependencies, 190 tests across the project.

- **Snap planes and masks** (`component.js`, `snapMatch.js`). A part carries flat
  4-vertex quads named `md-snap.<mask>.<label>`; local +Z is the facing. Two
  snaps join only if the masks match exactly and the roles are compatible.
- **Socket / plug roles.** Sockets offer a place, plugs take one, two of a kind
  never join. This exists because a facing check does not work: the solver
  *always* succeeds on facing, by yawing the child 180°. Without roles an
  upright attached to another upright and passed straight through a shelf.
- **Derived transforms** (`assembly.js`). Connected parts store `position: null`;
  every transform is recomputed by walking the connection graph. Move the anchor
  and everything follows. The graph is a **tree** — first path wins through a
  cycle, deliberately (see §8).
- **The attach matrix** (`attach.js`) — the one query the whole interaction rests
  on. Enumerates every (attach point × candidate part × candidate snap) triple
  and why each is allowed or refused. Point-first and part-first are both
  filters over it.
- **Attach grids** (`grid.js`) — a field of generated attach points with spans,
  for MOLLE/PALS webbing and camera-case dividers. Cell ids
  `<gridNode>#c<col>r<row>`.
- **Move a part to a different attach point** by dragging it. It can only land
  on another marker, never in open space.
- **Bounded camera pan** — a leash sized to the product, so you can look along a
  four-metre run without losing it off screen.

### 3.2 The supplier model pipeline — built, but command-line only

Five tools, all documented, all with real supplier files through them.

| Tool | Does |
|---|---|
| `tools/step-to-glb.py` | STEP → GLB via OpenCASCADE. Normalises units and axes, drops construction geometry, merges assemblies, origin to base centre, and **re-tessellates from the CAD** when a part busts `--max-tris`. |
| `tools/add-snaps.py` | Generates the snap planes from `youk/snap-spec.json`. The decisions live in the spec; the script holds only mechanics. |
| `tools/declare.mjs` | Writes the real-world size and the snap roles into the GLB's scene extras (Blender cannot write these). |
| `tools/inspect-model.mjs` | Says what a model is and what stands between it and being a component. Reports every fault at once, ordered by fix precedence. Modifies nothing. |
| `tools/measure-part.py`, `tools/check-joint.py` | Find a part's features; place two parts together and report whether the metal actually fits. |

**Result on the YouK range:** 45/45 convert, none over 40,000 triangles (down
from a 138,000-triangle worst case), 22 load as components with no blocker.

### 3.3 The commercial layer — built

- `youk/catalogue.json` — article number, supplier description, measured size and
  price for each configurable part. **Every price is `null`, awaiting Kesseböhmer's
  list.** Three tiers: retailer, trade, retail.
- `src/engine/quote.js` — bill of materials and quote. Built around one rule: **a
  missing price is not zero.** Unpriced lines report `null` and are counted; when
  nothing prices there is no total at all. Money in whole pence internally.
- A bill-of-materials panel stuck to the bottom of the sidebar, with a tier
  selector, VAT and margin. 24 tests on the pricing module alone.

### 3.4 The verification harness — built, and load-bearing

The thing that has caught the most mistakes. `CONFGR_CLICK` drives real pointer
events through the same raycast path a hand takes, then the app reports on
itself: `dump` (status line), `layout` (every part's resolved world position),
`quote` (the bill of materials as text), `pan`, `drag`. Plus `tools/probe-bay.ps1`
(`-Scenario bay|run`) and `tools/check-joints.ps1`.

The design rule: **it must not be able to report success without having done the
thing.** An earlier version pressed a part's centre, hit a marker on that ray,
*added* a part and reported "dragged".

### 3.5 What is NOT built — plainly

This is the honest half of the document.

| | Status |
|---|---|
| **Export a configurator for a client** | **Nothing.** No embed, no bundle, no web component, no runtime. See §4.1. |
| **Import a model through the UI** | **Nothing.** CLI only. See §4.2. |
| **A snap editor** | Nothing. Snaps come from a hand-authored spec file plus a Python script. |
| **Branding / theming** | Nothing. Studio's `accentColor` / `logo` / `font` are not ported. |
| **Save and load a project** | IPC handlers exist; no UI calls them (§3.6). |
| **A shareable configuration ID** | Nothing — and the plan says build this in week one. |
| **PDF / tear sheet** | Nothing. |
| **AR / "view in your room" / QR** | Nothing. The nine AR-safe rules are being *honoured* in the asset pipeline, which was the point, but no AR exists. |
| **Rules and conditions engine** | Nothing. Masks and roles only. No "if X then Y", no auto-inserted connector parts. |
| **Options beyond finish** | A `finish` swatch per instance works. No option tree, no dependent options, no per-option pricing. |
| **Collision / overlap refusal** | Nothing. Every part reports `NO_COLLISION_BOX`. Two parts can occupy the same space. |
| **Wall mounting / mount height** | Nothing. The anchor sits on the floor at y=0. See §5.1. |
| **Multi-user, login, hosting** | Nothing, and not wanted yet. |

There is also **no git remote.** Fifteen commits of work exist on one machine.
That is the single cheapest risk on this list to retire.

### 3.6 Plumbing wired in main, with no UI

`electron/main.js` and `preload.cjs` expose these; nothing in the renderer calls
them: `projects.list/load/save/delete`, `dialog.openModels`, `dialog.openFolder`,
`shellUtil.showInFolder`. They were copied from Studio's shell. Worth knowing
they are there — the project-save half of §4.2 is partly plumbed already.

The renderer uses exactly three: `app.testAssetsDir`, `fs.listModels`,
`app.catalogue`.

---

## 4. The Four Questions, Answered Plainly

### 4.1 Can it export a configurator to send to a client, such as Kesseböhmer?

**No. Not yet, and not close.** What exists is one Electron app that is
simultaneously the authoring tool and the viewer. There is no separation between
"the thing Matt builds in" and "the thing a customer uses", which is the whole
of the export problem.

To send something to Kesseböhmer today, the options are: a screen recording, a
render, or Matt driving the app on a call. That is enough for a first
conversation and not enough for a pilot.

**What export actually requires** (plan Phase 2, and it is a real body of work):

1. **Split the runtime out of the editor.** The engine (`src/engine/*`) is
   already UI-free and portable — that part is done and it is the hard part. What
   does not exist is a viewer built on it that has no editing affordances.
2. **A bundle export.** Studio already does the equivalent well and it is the
   thing to copy: `exportProject.js` writes a self-contained folder — `index.html`,
   `images/`, vendored three.js, a `Start Preview.bat` — with **no network
   dependency**, and it took a 382 MB source set down to a 33.6 MB deliverable.
   Studio's guarantee is asserted by a test that blocks every outbound request
   and drives the tour. Copy the shape and the test.
3. **A web component, `<confgr-modular>`,** with an iframe fallback for strict
   corporate sites, and **all state scoped per instance** so more than one can
   sit on a page. Mimeeq cannot do this — their own docs say the observer system
   is not instance-bound — so it is a genuine differentiator, and it has to be
   true from the first line rather than retrofitted.
4. **A shareable configuration ID** that fully determines the visual state and
   **resolves without the editor**, via a headless function. AR generation, the
   PDF and any server-side render all call that same function. The plan is
   emphatic that retrofitting this later is painful.

**One unresolved tension worth naming now:** Studio's deliverable is a static
offline folder whose selling point is zero infrastructure. But the AR/QR flow
needs a hosted landing URL (`https://…/ar-landing?shortcode=`), and an embed on
Kesseböhmer's site is hosted by definition. The plan never reconciles these. The
likely answer is that the *configurator* stays static and embeddable while AR
needs one small hosted route — but it is a decision, not an oversight to leave.

### 4.2 How do I import new models into the builder?

**Today: you do not — I do, at a command line.** The route is:

```
supplier CAD  →  npm run youk:convert     (STEP → GLB, units, axes, budget)
              →  edit youk/snap-spec.json (WHERE parts join — the real work)
              →  npm run youk:snap        (generates the snap planes)
              →  npm run declare youk     (writes size + roles into the GLB)
              →  npm run inspect youk     (what still blocks each part)
              →  copy into test-assets/   (the app loads whatever .glb is there)
```

The app has no import button. It lists `.glb` files in one folder at startup and
loads them. Anything it refuses appears under "Rejected on import" with the
reason — that part is good and should survive into the real importer.

**The honest problem is not the import button.** It is that **deciding where two
parts join cannot currently be done without measuring geometry.** On YouK that
took most of two sessions: five failed methods for finding the rung positions,
and the joint was finally pinned down by noticing that the rung's holes and the
accessory's slots share a spacing. A tool that reads a CAD file cannot know that
a bracket's underside is a bearing surface.

So the missing piece is a **snap editor**: load a GLB, see it, click a face or a
node, say "this is a socket, mask `youk-d320`, this is the bearing face", and
have the app write the snap. The plan lists it as one Phase 1 bullet. It is more
than one bullet — and until it exists, every new range costs developer sessions
rather than product-manager hours.

What makes that tractable is that the hard parts are already built: `measure-part`
and `check-joint` are the analysis a snap editor would wrap in a UI, and
`inspect-model` already produces exactly the error list an importer needs to
show.

### 4.3 Can I change the user interface of the exported deliverable?

**Not applicable yet — nothing is exported.** When it is, the answer should be
"yes, within a defined envelope", and the envelope should be Studio's:

- **Built in Studio and reusable as-is:** accent colour, logo (its own asset
  type, kept lossless on export because a client will inspect it at 400%),
  typeface (device stack / Google font / the client's own font file), panel side,
  currency. The plan says "reuse as-is" and that is right — none of it is ported
  into confgr Modular yet.
- **Not built anywhere:** templates and true white-label theming. It is on
  Studio's P3 roadmap with the note that `font`/`logo` are already in the model
  but unused.
- **A warning from Studio worth carrying over:** five settings keys were exposed
  in Studio's UI and read by nothing, and were deleted with the note *"a control
  with no effect is worse than a missing feature."* Do not add a theming panel to
  confgr Modular before the runtime consumes it.

Two structural decisions to honour before the runtime exists, both from the
plan's AR-safe list: the runtime's action bar must be **a list of registered
actions**, not fixed markup, and the bundle must support **more than one entry
page** (the QR flow needs a landing route that is not the configurator).

### 4.4 Parity with confgr Studio V2

Studio is four tiers on one engine, all built, and its output is a static folder
the client owns outright. confgr Modular is one tier's worth of engine with no
output at all. The gap, feature for feature:

| Studio V2 has | confgr Modular |
|---|---|
| Folder export, self-contained, offline, vendored three.js | **Nothing** |
| Asset Vault — SHA-256 content-addressed, 8 asset types, `vault:<id>` references, import once reuse anywhere | **Nothing.** Needs extending to GLB/KTX2 anyway |
| Importers that explain themselves (sequence detection by pixels not filenames, CSV column mapping, "reported rather than silently dropped") | **Nothing** in the UI; the CLI tools do report well |
| Branding: accent, logo, typeface, panel side | **Nothing** |
| Pre-flight validation before export | `inspect-model` is the equivalent, and is better than Studio's |
| WCAG 2.1 AA runtime contract, tested | **Nothing** — no runtime to hold the contract |
| Shareable URL state | **Nothing** |
| Analytics + lead capture (the only two network calls in an export) | **Nothing** |
| 972 unit tests, 306 Playwright e2e | 190 unit tests, no e2e — but a real click-driven harness |

**The one place confgr Modular is ahead:** money. Studio's settings drawer had
`pdfExport` and `pngExport` as placebo keys that were deleted. confgr Modular has
a real bill of materials, real tier pricing and 24 tests on it — the plan put
that in Phase 3, 2027 H2.

---

## 5. What the YouK Range Taught Us About the Product

Two of these came from Matt looking at Kesseböhmer's own photography, and both
change the roadmap.

### 5.1 Some YouK parts hang on the wall and never touch the floor

**Not supported today.** The anchor instance sits at `y = 0` and everything
derives from it, so every assembly stands on the ground plane.

The plan's position is *"an attach point carries its own height. Parts never
choose one, and there is no height control anywhere in the UI"* — and *"this is
why a wall cabinet is never on the floor: it does not decide to be at 1400 mm, it
attaches to a point that already is."* That reasoning is sound for a part hanging
off a product. It does not cover **the root of the assembly itself being
wall-mounted**, which is what YouK does: `MA 405462` wall-mounts every frame with
two brackets, fixing holes 55 mm below the frame top.

The smallest honest change is a **mount height on the anchor** — one number,
derived from a wall bracket's position rather than typed by a customer, that
lifts the whole assembly. It is not a height control in the UI; it is a property
of how that product mounts. The larger version is a wall entity with its own
attach points, which is the same shape as the floor plane AR needs.

Also relevant, and already logged: a tray hung on rung 1 drops 158.5 mm and ends
up through the floor. Once the assembly can float, "below the floor" stops being
obviously wrong and needs a rule.

### 5.2 Frames of different sizes, staggered, with shelves still spanning them

**This already works, and I verified it rather than assuming.** `tests/stagger.test.js`,
four tests:

- The attach matrix offers **every level of the incoming frame** at the shelf's
  free end — eight placements at one attach point, differing only in which
  socket the frame uses (four levels × two faces).
- Each choice puts the second frame at a **different height**, and the arithmetic
  is exactly `shelf height − how far up the incoming frame its own socket sits`.
- The shelf **stays level and does not move** while the frames end up staggered.

So a shelf spanning two frames at different heights needs **no engine work at
all** — it falls out of the chain. What is missing is a way to *ask* for it: the
UI collapses those eight placements to one marker and silently takes the first.
The fix is a "which level?" affordance on the incoming part, not a solver change.

That is a good outcome. It also means the current UI is quietly deciding
something a customer should decide, which is worth fixing early.

### 5.3 Two errors in Kesseböhmer's own data, one commercially dangerous

Found by deriving descriptions from their filenames rather than retyping.

| Article | Their filename says | Actually |
|---|---|---|
| `236748` | "ladder depth **2000** mm" | 200 mm deep — their German half agrees |
| `236762` | English half: "height **1500** mm" | **2210 mm** — their German half and the geometry both agree |

`236758` and `236762` are different frames at different prices. Without an
override **both appear on a quote as "height 1500 mm"**. Worth raising with
Kesseböhmer: if those filenames feed anything else downstream, the error is not
confined to us. Both are overridden in the catalogue, and the override survives
regeneration.

---

## 6. Roadmap

The plan's phases, corrected against what actually happened. We are **past
Phase 0 and into a bit of Phase 3, with none of Phase 1 or 2.**

### Phase 0 — Prove the snap system — **DONE, and overshot**

Planned as two weeks of synthetic parts. Delivered that, then went further: a
real 45-part supplier range through a repeatable pipeline, a joint-verification
tool, and a commercial layer. The one Phase 0 item **not** proven is grids with
parts spanning several cells — `grid.js` and its 34 tests exist, but no real
gridded product (MOLLE, camera case) has been through it.

### Phase 1 — The editor — **NOT STARTED**

The plan's scope: define a product, import components, set up snaps, write
rules, preview. Asset Vault extended to GLB/KTX2 with thumbnails. A snap editor.
Rules authored in a table, not code.

Corrections from experience:

- **The snap editor is the whole phase, not a bullet.** §4.2 explains why.
- **Add a mount-height / wall-mounting concept** (§5.1).
- **Add the "which level?" choice** so staggering is reachable (§5.2).
- **Collision boxes and overlap refusal** belong here. Every part already reports
  `NO_COLLISION_BOX`, and there is a concrete case: a tray on a middle frame's
  inner face cantilevers straight through a shelf and the app allows it.

### Phase 2 — The runtime and the embed — **NOT STARTED**

Unchanged from the plan and the most commercially important phase: web component
with instance-scoped state, folder bundle export, shareable ID, save/reload, AR,
tear-sheet PDF. Exit gate: live on one real site, two configurators on a page,
working on a mid-range Android phone.

One addition: **the offline-guarantee test.** Studio asserts it by blocking every
outbound request and driving the tour. Copy that test, not just the exporter.

### Phase 3 — Money — **PARTLY DONE, ahead of schedule**

Done: bill of materials, article numbers, tier pricing, VAT, margin, and the
missing-price discipline. Still to do: a price-list importer for whatever format
Kesseböhmer supply, consumables (plugs, screws, the 1.5 mm packers the
instructions require — none is a configurable part so none is on the list),
discounts and carriage, and the quote PDF.

### Phase 4 — Parametric — not wanted yet

Unchanged. Real resizing of parts, only if asked for.

### The critical path to something Kesseböhmer can use

Not the same as the phase order, and worth stating separately:

1. **A git remote.** Fifteen commits on one machine.
2. **Their price list**, in whatever format they have it. Everything commercial
   is blocked on data, not code.
3. **The "which level?" affordance** — small, and it unlocks the staggered
   layouts their own marketing photography shows.
4. **A wall-mount height** — small, and without it half their range is
   misrepresented.
5. **The shareable configuration ID** — the plan says week one, and it is
   already late. Cheap now, painful later.
6. **A viewer split out of the editor**, then the bundle export. This is the big
   one and everything client-facing waits on it.
7. **Collision refusal**, before a customer builds something that cannot exist.

Items 1–5 are days. Item 6 is the project.

---

## 7. Session Log

### Session 3 — 4 September 2026

Snap planes for the whole YouK 320 family and a first verified bay; then the
hang family; then clothes rails, YouboXx and a triangle budget; then multi-bay
runs; then the commercial layer. Commits `af70e9b` → `e066c08`.

Things worth remembering:

- **The rung positions were in the box all along.** Five measurement methods
  failed before Matt asked whether I had read the mounting instructions in the
  folder. I had filtered to `*.stp` on my first command and never listed the
  folder again. Ten dimensioned PDFs answered every open question.
- **A loose measurement window produced a confident wrong answer, twice.** An
  `85 < y < 115` window meant to isolate a rung swept in a pin on a neighbouring
  member; I wrote up the neighbour's geometry as "locating lugs on the rung" in
  FINDINGS. The same mistake then appeared in `check-joint`, where a symmetric
  window inflated the member's box by 10 mm and made correctly seated parts look
  buried. Both corrections are recorded where they happened rather than quietly
  fixed.
- **Snapping was not idempotent and wrote over its own input.** Running it twice
  rotated every frame a second time and produced a model that assembled
  confidently in the wrong orientation. The converter now writes
  `<id>.converted.glb` and snapping refuses an input that already has snaps.
- **"Net (PARTIAL): GBP 0.00"** — a real seven-part bill of materials against the
  priceless catalogue printed the exact failure the pricing module exists to
  prevent, wearing a label. Now there is no total at all when nothing prices.
- **A screenshot made a correct multi-bay run look wrong.** Perspective, nothing
  more. `window.__cfgLayout()` exists because of it: frames at 0, 920.1 and
  1840.2 mm, exactly 2 × 920.1, no drift.

### Sessions 1–2 — 3 September 2026

Mimeeq research and the plan; the repo scaffold; the snap spike; the anchored
product model; roles as the fix for parts passing through each other; bounded
pan; drag-to-another-point; the STEP conversion of the YouK range. See
`confgr-modular-plan.md` §2A for the decisions made in those sessions.

---

## 8. Risks and Open Questions

### Risks

1. **No git remote.** Everything is on one machine. Cheapest thing on this list.
2. **Asset production is the permanent cost.** Every component needs modelling,
   snaps, collision boxes. The plan says this straight: *"it does not go away if
   you buy Mimeeq instead."* YouK took two sessions of developer time for 22
   parts. Without a snap editor, range two costs the same again.
3. **The connection graph is a tree.** A shelf added to an existing bay lands
   perfectly against the far frame but is connected only to the near one, so
   deleting the middle frame would leave shelves floating. Geometry and bill of
   materials are both right; the graph is not.
4. **Nothing stops an impossible configuration.** No collision, no required-part
   validation before checkout, no rules engine.
5. **The static-export vs hosted-AR tension** (§4.1) is undecided.

### Open questions

**Product**

- How does a frame actually mount to a wall, and does the configurator need to
  show the wall?
- Should a span accessory record **both** of its ends?
- Should the app refuse a part that would hang below the floor — and what is the
  floor once assemblies can be wall-hung?
- How the clothes rail's bracket engages the rung: `check-joint` reports 1.00 mm
  of it inside the rung on all three sizes, and the drawings admit two readings.
  A question for Kesseböhmer, not for more measuring.
- The clothes rail extensions need an **accessory-to-accessory** joint, which
  nothing in the engine does yet.

**Commercial**

- What format is Kesseböhmer's price list in?
- Do consumables get quoted, and by whom?
- Is the configurator public-facing on their site, or a sales tool, or both? It
  changes which tier a visitor sees.

**Technical**

- Grids with multi-cell spans on a real product — the one unproven piece of the
  attach model.
- Do glTF material variants survive conversion to USDZ at all? The plan flags
  testing this early with one real gloss and one real glazed material.
- Why was Studio's PDF-quote control removed on 11 August 2026? The plan says
  find out before rebuilding it.

---

## How to keep this file current

Update it at the end of a working session, and only from the code — the point of
"verified against code" is that it is not a summary of intentions. When the plan
and this file disagree, this file is the state and the plan is the strategy;
where experience has overturned the plan, say so here rather than quietly
diverging.
