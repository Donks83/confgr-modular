# confgr Modular — Project Documentation

**Last updated:** 5 September 2026, end of session 5. State verified against the
code at commit `ed6d689`, not from memory. Session 5 ran in five parts: findings
(§5.1's correction, §5.2a, §5.2b, §5.2c, §5.3's second half), then fixing what
Matt hit while using it, then twelve more parts of the range, then the timber —
the first parts in the product that are ours rather than a supplier's — and then
**vertical joints** (§5.6), which was an engine change the cabinets forced.

**Code:** `C:\Claude\confgr-modular` — git, 38 commits, **local only, no remote.**
**Tests:** 243 passing (`npm test`).
**Components:** 66 — **34 of the 45 YouK parts, plus 32 timber parts generated
rather than converted** (§5.5): 8 shelves and 24 cabinets. The remaining 11
supplier parts convert cleanly and have no snaps authored — see §4.2 for what
that costs.

**Still to author:** office solution (008551 ×3, 008552), clothes-rail extensions
(008533/34/35), umbrella stand (008565 ×2), newspaper-rack divider (008549), the
adjustable foot (237023). The office desktop is the last timber piece, and it is
**no longer blocked on the engine** — vertical joints went in for the cabinets
and the desktop uses the same one — only on those four metal parts.

**Related documents**

| File | What it is |
|---|---|
| `C:\Claude\confgr-studio\confgr-modular-plan.md` | The research and build plan, 3 Sep 2026. Still the strategy. **This file is the state** — where the plan and reality disagree, this file wins. |
| `C:\Claude\confgr-studio\configurator-studio-project.md` | confgr Studio V2 — the sibling product this borrows from, and the thing it must reach parity with on export. |
| `youk/FINDINGS.md` | Everything measured from Kesseböhmer's YouK range. The most detailed document in the project. |
| `tools/AUTHORING.md` | How a supplier's CAD file becomes a component. |

---

## 0. How to run it

```
cd C:\Claude\confgr-modular
npm install          # first time only
npm run electron:dev
```

That is the app. It opens a window with the palette on the left, the 3D view in
the middle, the mounting and view controls on the right and the bill of materials
in a sticky footer. Click a part in the palette, then click a marker in the view
to attach it.

**Why it needs two processes.** `electron:dev` is
`concurrently -k "vite" "wait-on tcp:5174 && electron ."`. `electron/main.js`
loads `localhost:5174` whenever the app is unpackaged, so Vite has to be up
first — that is what `wait-on` is for. If it fails with **port 5174 already in
use**, a Vite from an earlier run is still alive; kill it (`Get-Process node`) or
run `npm run youk:bay`, which kills a stale one for you.

**Other useful entry points**

| Command | What it does |
|---|---|
| `npm test` | 243 unit tests, ~4 s. Run this before believing anything. |
| `npm run youk:bay` | Scripted probe: launches the app, builds a real YouK bay, screenshots it, prints the layout and the quote. The fastest way to see whether something is broken. |
| `npm run inspect youk` | What still blocks each of the 45 YouK parts from being a component. |
| `npm run joints` | Re-derives every authored joint from the GLBs, independently of the engine. |

The probe takes a `-Scenario`, and each one exists because something went wrong
without it:

```
tools/probe-bay.ps1 -Scenario bay        a full 7-part bay, the general regression
                              run        three bays, checks the chain does not drift
                              stagger    the rung-height chooser
                              shared     a shelf and an accessory on ONE rung
                              hooks      a width hook strip spanning a bay
                              wallfixed  the shoe rack, which joins nothing
                              cabinets   carcase brackets on both frames
                              timber     a timber shelf and a metal one in one bay
                              carcase    a cabinet laid on two brackets (§5.6)
                              mount      floor / floating / feet, read from the scene
                              palette    what every palette entry actually says
```

There is also `-Steps '<click string>'`, which runs an ad-hoc sequence instead of
a named scenario and captures to `youk/steps.png`. Marker indices shift as the
scene grows, so working out what marker 3 refers to is a question for the running
app, not for the spec file. Nothing found this way should be committed as a
scenario until it says something.

**Adding parts is a pipeline, not an edit.** `youk/snap-spec.json` holds the
decisions; everything else is mechanics:

```
npm run youk:timber      generate the parts that have no supplier CAD (§5.5)
npm run youk:snap        author the snap planes from the spec
npm run declare youk     write size and roles into the GLBs
npm run inspect youk     what still blocks each part
npm run joints           does the metal actually fit
npm run youk:catalogue   regenerate the commercial catalogue
```

**Prices are deliberately blank.** `youk/catalogue.json` ships with every price
`null` and the app shows `Net (PARTIAL)` rather than a total. To see the quote
panel with numbers in it, `npm run youk:prices:example` generates a **fictional**
price list (gitignored, never committed) and the app picks it up. Do not quote
anyone from it.

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

The **benchmark project** is **Kesseböhmer's YouK shelving range** — 45 supplier
CAD files, of which 34 are now configurable components, plus 32 timber parts that
have no supplier CAD and never will (§5.5). It is the development
driver, not the deliverable: it is what proves the application can take a real
range from supplier CAD to a priced configurator. Kesseböhmer is a partnership
prospect, not a PWS channel. See §2.

## 2. End Goals

**The product is the application.** confgr Modular is a tool for building
modular 3D product configurators — one we use on many client projects, the same
way confgr Studio is used. **YouK is the benchmark project, not the goal.**
Kesseböhmer's range is here because it is a real, awkward, 45-file product range
that forces the application to be genuinely capable — exactly the role Threadworks
played for confgr Studio. Everything YouK teaches gets generalised into the
application. Nothing gets hard-coded for Kesseböhmer.

The test of every feature is therefore: *does this work for the next client's
product, or only for this one?*

**The goals, in order:**

1. **Author a configurator without touching a command line.** Import models,
   mark the attach points, set the rules, price it. Usable by somebody who is not
   the developer. This is the application.
2. **Export a self-contained configurator** the client hosts themselves —
   embeddable in their own website, and correct when there is **more than one on
   a page** (see below).
3. **A quote out of the far end** — parts list, article numbers, tier pricing, PDF.
4. **"View in your room"** — AR on a phone, QR handoff from desktop, and the whole
   thing usable on a phone in the first place (§4.5).
5. **Parity with confgr Studio V2 on the export path**, so a modular project is
   delivered to a client the same way a Studio project is.
6. **A YouK demo good enough to put in front of Kesseböhmer** — the proof, and the
   thing that pays for the rest.

### What "more than one on a page" means

Two independent configurators embedded on the same web page — say a 200mm-deep
range and a 320mm-deep range side by side on one product page, each with its own
state, its own basket, its own camera. Click a shelf in one and nothing happens in
the other.

It sounds trivial and is not: it is only true if the exported viewer keeps **all**
its state per instance. The moment anything lives in a module-level variable, a
global, a fixed DOM id, a shared canvas, or `window.__something`, the second
instance either fights the first or silently drives it. **Mimeeq cannot do this** —
their embed's state is global — which is why it is worth writing down. It is a
quality bar on how the export is built, not a feature bullet, and it has to be
designed in from the first line of the viewer rather than fixed afterwards.

Note the implication for the harness: `window.__cfgQuote` / `window.__cfgLayout`
in the spike are exactly the pattern the exported viewer must not use. They are
fine in the editor, which is one instance by definition. They do not go into the
viewer bundle.

## 3. Where We Are — Current State (verified against code, 5 September 2026)

Read this section as: **the engine is real, the product around it is not.** That
was truer yesterday than it is today — the editor now behaves the way somebody
using it expects — but there is still no export, no runtime and no AR.

### 3.1 The attach engine — built and tested

`src/engine/` — 8 modules, no UI dependencies, 227 tests across the project.

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
- **Both ends of a joint are chosen, not one** (`placementsAt`,
  `distinctPlacements`). A joint has two ends and the matrix always knew both;
  the UI used to take the first row it found. Placing and moving now offer every
  way a part can sit at a point — **filtered to the ones that look different**,
  by comparing the space the part would occupy rather than how it is wired. That
  is what makes a second frame's rung heights reachable, and it is what stopped
  parts silently flipping 180° (§5.2a).
- **A socket holds one part above it and one below** (`snapBearingSide`). A rung
  carries a shelf resting on it *and* an accessory hooked over it, which
  Kesseböhmer document. Which side a part fills is read off its geometry, so
  nothing had to be declared on 45 models.
- **A part may be laid on another rather than meet it edge-on** (§5.6). Vertical
  joints, added for the carcase and needed again by the office desktop. Yaw is
  undetermined by such a joint, so it comes from the product rather than from the
  parent — and unlike a horizontal joint, the solver refuses a bad pairing
  instead of turning the part around.
- **A part may declare it joins nothing** (`mounting: "wall"`). The shoe rack
  screws to the wall and touches no ladder; it goes in as a second anchor at a
  derived position. The assembly always allowed more than one root — this is the
  first use of it (§5.4).
- **Bounded camera pan** — a leash sized to the product, so you can look along a
  four-metre run without losing it off screen.

### 3.2 The supplier model pipeline — built, but command-line only

Five tools, all documented, all with real supplier files through them — and one
that generates parts no supplier will ever send.

| Tool | Does |
|---|---|
| `tools/step-to-glb.py` | STEP → GLB via OpenCASCADE. Normalises units and axes, drops construction geometry, merges assemblies, origin to base centre, and **re-tessellates from the CAD** when a part busts `--max-tris`. |
| `tools/add-snaps.py` | Generates the snap planes from `youk/snap-spec.json`. The decisions live in the spec; the script holds only mechanics. |
| `tools/declare.mjs` | Writes the real-world size and the snap roles into the GLB's scene extras (Blender cannot write these). |
| `tools/inspect-model.mjs` | Says what a model is and what stands between it and being a component. Reports every fault at once, ordered by fix precedence. Modifies nothing. |
| `tools/measure-part.py`, `tools/check-joint.py` | Find a part's features; place two parts together and report whether the metal actually fits. |
| `tools/make-timber.py` | Generates the parts that have no supplier CAD. It writes `<id>.converted.glb` — the suffix `add-snaps.py` reads — so a part we invented enters the pipeline at the same door as a supplier part rather than taking a private route nothing checks. §5.5. |

**Result on the YouK range:** 45/45 convert, none over 40,000 triangles (down
from a 138,000-triangle worst case), **34 load as components with no blocker**,
and 32 generated timber parts make **66 components in the palette.**

The spec now has five families: `frames`, `span`, `hang`, `carcase` and `wall` —
the last for parts that join nothing at all. What is authored per part stays
tiny, which is the point: an id, a depth, and one decision.

| Family | What is decided | Where the plug comes from |
|---|---|---|
| `frames` | depth, whether it needs turning | a socket at every rung, both faces |
| `span` | depth, `bearing` base or top | `y = 0`, or `maxY − topSheetMm` |
| `hang` | depth, turning, and whether it `carries` | **measured**, from the mounting slot |
| `carcase` | depth | two plugs facing **down**, at the part's own ends (§5.6) |
| `wall` | nothing — it joins nothing | no plug; declares `mounting: "wall"` |

`carries` on a `hang` part adds a second snap: a flat socket on the face the
carried part rests on, its height **measured** off the plate top plus the 1.5 mm
packer. It has its own mask, so a cabinet can only ever meet a bracket — sharing
the rung mask would let a carcase hang straight off a ladder with nothing under
it. **Any array in the spec whose rows carry an `id` is a family**, so adding one
takes no edit anywhere else; the tools used to name the families and that list
went stale twice (§5.6).

Worth reading alongside the open 1.00 mm question (`youk/FINDINGS.md`): every
family whose plug is **measured** seats clean, and only `span` with `bearing:
"top"`, whose plug is **computed**, is out by exactly a millimetre.

### 3.3 The commercial layer — built

- `youk/catalogue.json` — article number, supplier description, measured size and
  price for each configurable part. **Every price is `null`, awaiting Kesseböhmer's
  list.** Three tiers: retailer, trade, retail.
- `src/engine/quote.js` — bill of materials and quote. Built around one rule: **a
  missing price is not zero.** Unpriced lines report `null` and are counted; when
  nothing prices there is no total at all. Money in whole pence internally.
- A bill-of-materials panel stuck to the bottom of the sidebar, with a tier
  selector, VAT and margin. 24 tests on the pricing module alone.

### 3.4 AR readiness and mounting — the engine half is built, the AR itself is not

`src/engine/ar.js`, 11 tests. What exists:

- **`MOUNTING = { FLOOR, WALL }`** — the whole mounting model, per Matt's
  simplification. Floor standing or floating. **No height anywhere**, because the
  real height is chosen in AR by the person holding the phone (§5.1).
- **`placementFor(mounting)`** — turns that into what each platform needs:
  horizontal or vertical placement, and Android Scene Viewer's
  `enable_vertical_placement` flag.
- **`arReadiness(assembly, components, { mounting, bytes })`** — asks one
  question: could this configuration go into AR as it stands? Checked at
  **assembly level, not per part**, which is the point: every one of the 45 YouK
  parts is under 40,000 triangles and a plausible three-YouboXx configuration
  still clears Scene Viewer's 100,000 maximum. A per-part budget cannot see that.
  `ready` is false only on a hard maximum; over the *ideal* is a warning, because
  a warning that fires on everything gets ignored.
- **The viewer hides the floor grid and the shadow catcher when mounting is
  `WALL`** — a floating unit standing on a drawn floor contradicts the one thing
  the view exists to show.

What does **not** exist: any actual AR. No USDZ, no GLB export of a
configuration, no QR handoff, no landing route. §4.5 is the plan.

### 3.5 The verification harness — built, and load-bearing

The thing that has caught the most mistakes. `CONFGR_CLICK` drives real pointer
events through the same raycast path a hand takes, then the app reports on
itself, in text a probe can assert on rather than pixels nobody checks.

| Step | Reports |
|---|---|
| `dump` | the status line and the part / joint / open-point counts |
| `layout` | every part's resolved world position |
| `quote` | the bill of materials and the totals |
| `palette[:N]` | what the palette actually **says** — id ⇒ label |
| `choices` / `choose:N` | the "how should it sit" options, and taking one |
| `mount:floor\|wall\|feet` | drives the real dropdown |
| `ground` | grid, shadow catcher, clearance and AR state read **out of three.js**, not out of React |
| `marker`, `part`, `drag`, `pan` | the interactions themselves |

Scenarios in `tools/probe-bay.ps1`: `bay`, `run`, `mount`, `palette`, `stagger`,
`shared`, `hooks`, `wallfixed`, `cabinets`. Plus `tools/check-joints.ps1`, which
re-derives every authored joint from the GLBs independently of the engine.

The design rule: **it must not be able to report success without having done the
thing.** An earlier version pressed a part's centre, hit a marker on that ray,
*added* a part and reported "dragged". A later one reported `clicked part X`
whether or not a button existed or was enabled — fixed the day the palette labels
changed, and it immediately caught the shoe racks missing from the copy step.

Three things it caught in one session, which is the argument for it existing:
the `bay` script **stalling at 5 parts** when placing started asking a question
(the script encoded the old silent behaviour); `no palette entry for 008555` when
two hand-maintained lists forgot the new `wall` family; and a **wrong label**
being invisible in both a screenshot and the status line until `palette` existed
to print it.

### 3.6 What is NOT built — plainly

This is the honest half of the document.

| | Status |
|---|---|
| **Export a configurator for a client** | **Nothing.** No embed, no bundle, no web component, no runtime. See §4.1. |
| **Import a model through the UI** | **Nothing.** CLI only. See §4.2. |
| **A snap editor** | Nothing. Snaps come from a hand-authored spec file plus a Python script. |
| **Branding / theming** | Nothing. Studio's `accentColor` / `logo` / `font` are not ported. |
| **Save and load a project** | IPC handlers exist; no UI calls them (§3.7). |
| **A shareable configuration ID** | Nothing — and the plan says build this in week one. |
| **PDF / tear sheet** | Nothing. |
| **AR / "view in your room" / QR** | **Readiness checks only** (§3.4). No USDZ, no GLB export of a configuration, no QR, no landing route. The nine AR-safe rules are honoured in the asset pipeline, which was the point. |
| **Mobile / touch** | Nothing. Desktop Electron, mouse-driven, fixed sidebar. See §4.5. |
| **Rules and conditions engine** | Nothing. Masks and roles only. No "if X then Y", no auto-inserted connector parts. Every snap carries `condition: null` and nothing reads it — **and there is now a real case for it**: the office-solution desktop is legal at rung 3 and forbidden at rungs 1–2 (`youk/FINDINGS.md`). |
| **Options beyond finish** | A `finish` swatch per instance works. No option tree, no dependent options, no per-option pricing. |
| **Collision / overlap refusal** | Nothing. Every part reports `NO_COLLISION_BOX`. Two parts can occupy the same space. |
| **Derived BOM lines** | Nothing. Feet, screws and the 1.5 mm packers are all quantities the *configuration* implies rather than parts somebody clicked, and none of them reaches the quote. Build the mechanism once for all three. |
| **Wall mounting** | **Built, as far as this range needs.** Floor / floating / on feet drives the view and the AR flags; a wall-fixed part goes in as a second anchor (§3.4, §5.1, §5.4). No wall bracket geometry, and no wall *entity* — which turned out not to be needed. |
| **Timber parts** | **Shelves and cabinets done** — 8 + 24, generated rather than converted, unpriced (§5.5, §5.6). Only the office desktop is left, and it waits on four metal parts rather than on the engine. |
| **Required-part rules** | Nothing, and there is now a concrete case: a carcase can be dropped on ONE bracket and left cantilevering. Nothing says a second is needed. Same shape of gap as collision refusal, below. |
| **Cabinets in a multi-bay run** | **Unproven.** The extension bracket (008559/60) puts its socket on its own centreline, which on a middle ladder is the ladder centre rather than 15.1 mm inboard, so a carcase sized for outer brackets will not meet it. Outer brackets — a single bay — are verified (§5.6). |
| **Multi-user, login, hosting** | Nothing, and not wanted yet. |

There is also **no git remote.** Thirty-eight commits of work exist on one
machine. That is the single cheapest risk on this list to retire.

### 3.7 Plumbing wired in main, with no UI

`electron/main.js` and `preload.cjs` expose these; nothing in the renderer calls
them: `projects.list/load/save/delete`, `dialog.openModels`, `dialog.openFolder`,
`shellUtil.showInFolder`. They were copied from Studio's shell. Worth knowing
they are there — the project-save half of §4.2 is partly plumbed already.

The renderer uses exactly three: `app.testAssetsDir`, `fs.listModels`,
`app.catalogue`.

---

## 4. The Questions, Answered Plainly

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

#### 4.2a On future projects: is it "mark it up in Blender, save it to a library folder"?

**Yes — that is the intended route, and most of it already exists.** The
distinction that matters is **who authored the model**:

**Models we author (Blender, or a modeller we brief).** The convention *is* the
import format. Nothing extra to learn beyond three naming rules:

| Add in Blender | Named | Means |
|---|---|---|
| A flat 4-vertex plane | `md-snap.<mask>.<label>` | An attach point. Local **+Z is the facing** — the direction the joint faces. Masks must match exactly for two snaps to join, so a mask is a compatibility family: `youk-d320`, `pals-webbing`. |
| A cube | `col-<name>` | Collision volume. Not yet consumed by anything, but author it now — the alternative is going back through every model later. |
| A cube | `dim` | The part's real-world extent, for the size check. |

Then export GLB and drop it in the library folder. The app scans a folder for
`.glb` at startup, loads what it can, and lists what it refused with the reason —
`inspect-model` produces that list and it is genuinely good. **That is the whole
loop, and it works today.**

**The one gap, precisely.** Three things live in the glTF **scene extras**, not in
node names, and Blender's exporter will not write them: the real-world size
(`component.js` throws `NO_DECLARED_SIZE` without it), `confgrRoles` (the
socket/plug map) and `confgrSpans` (multi-cell grid snaps). Hence
`tools/declare.mjs`. Two ways to close it:

- **Move roles into the snap name** — `md-snap.youk-d320.socket-rung3` — and
  derive the size from the `dim` cube. Then a plain Blender export is a complete
  component and `declare` disappears entirely. This is the right answer, it is a
  small change to `component.js`, and it should happen before the next range.
  Spans can stay in extras: they are a number pair and only grids use them.
- Or keep `declare` and give it a UI. Worse — a second step somebody will forget,
  and the failure is silent until import refuses the file.

**Models a supplier sends (STEP/IGES, like YouK).** These arrive with no snaps,
no collision boxes, wrong units, wrong axes and 138,000 triangles. There is no
convention to follow because nobody followed one. That is the case the **snap
editor** exists for, and it is why §4.2 calls it the whole of Phase 1. On YouK
the conversion was mechanical and repeatable; *deciding where two parts join* took
most of two sessions and a set of mounting instructions.

**So the library folder answer, properly stated:** the folder is how a component
gets *into* the app, and it works. Blender markup is how a model we control
declares its joints, and it works. What is missing is (a) removing the `declare`
step, and (b) the snap editor for models that arrive without markup — plus the
library folder becoming a real, organised, multi-project asset store rather than
one flat `test-assets/` directory. That last part is **Studio's Asset Vault**
(SHA-256 content-addressed, `vault:<id>` references, import once and reuse
anywhere) extended to GLB, which is already on the Phase 1 list.

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
| 972 unit tests, 306 Playwright e2e | 201 unit tests, no e2e — but a real click-driven harness |

**The one place confgr Modular is ahead:** money. Studio's settings drawer had
`pdfExport` and `pngExport` as placebo keys that were deleted. confgr Modular has
a real bill of materials, real tier pricing and 24 tests on it — the plan put
that in Phase 3, 2027 H2.

### 4.5 AR, mobile, and "a responsive web app *and* a mobile app?"

Three separate questions that get bundled together. Taking them apart:

#### The platform facts, checked rather than recalled

| | Apple — AR Quick Look | Android — Scene Viewer |
|---|---|---|
| Format | USDZ | glTF 2.0 / GLB |
| Wall (vertical) placement | **Supported since iOS 13.** WWDC19 session 612 announced it explicitly. | **Opt-in**: `enable_vertical_placement`, which **defaults to false**. Reports of it being unreliable in practice. |
| Size | Practical rather than published | **10 MB recommended, 15 MB hard limit** |
| Triangles | — | **30–50k ideal, 100k recommended maximum** |
| Materials / textures | — | 10 materials, 2048×2048 |
| How it launches | `<a rel="ar">` around an `<img>` | `intent://` or `https://arvr.google.com/scene-viewer/…` |

**WebXR is not the route.** It is Android-Chrome only; on iOS it does not exist.
The native viewers are what actually reaches customers, which means **two model
formats per configuration**, generated on demand, from the same headless resolve
function as the PDF and the quote (§4.1 item 4 — this is the concrete reason that
function has to exist).

The consequence for the asset pipeline is already being honoured: every YouK part
is under 40,000 triangles because of these numbers, not by accident.

#### Mounting: floor standing or floating. No height.

Matt's call, and it is the right one: *"it doesn't matter what height it is in the
app — once you turn AR mode on you can put it at whatever height you want."*

So the model is two values, `MOUNTING.FLOOR` and `MOUNTING.WALL`, and **no height
control anywhere** — in the configurator or in the export. A height field would be
a number nobody uses and everybody has to fill in, and it would be *wrong* the
moment the customer holds the phone up to their actual wall. Built (§3.4).

This also kills the "mount height on the anchor" design that was in §5.1 before
this session. Good — it was more machinery for a worse answer.

Wall mounting has one real cost, and it is Android's: because
`enable_vertical_placement` defaults to false and is flaky, a floating
configuration on Android may land on the floor. `arReadiness` raises
`VERTICAL_PLACEMENT_REQUIRED` so that is a stated caveat rather than a surprise.
The honest mitigation is copy — "hold your phone up to the wall" — plus letting
the customer fall back to floor placement.

#### "Responsive web app **and** a mobile app?" — Two answers, and only one is worth doing

**The responsive web app: yes, and it is not optional.** AR *only* exists on a
phone. A configurator that a customer builds on desktop and then views in AR is a
handoff (QR code, shareable ID); a configurator a customer builds *on their phone
in the room* is the actual use case. Both need the runtime to work on a phone.
That means, concretely:

- Touch: one-finger orbit, two-finger pinch/pan, tap to attach. The current
  interaction is a raycast from a pointer event, which is already the right shape
   — a tap is a pointer event. The harness drives it that way.
- A layout that is not a fixed sidebar: parts palette as a bottom sheet, the bill
  of materials collapsed to a total, the view getting the rest.
- The performance budget is the same one AR imposes, so it is already being met.
- Exit gate, already in the plan: **works on a mid-range Android phone.**

**A native mobile app: no. Not now, probably not ever.** It buys almost nothing
and costs a great deal:

- AR is reached through the OS viewers from a *web page*. A native wrapper does
  not unlock better AR; it just wraps the same handoff.
- The deliverable is an **embed on the client's own website** (§2 goal 2).
  Kesseböhmer's customers arrive from their product pages. Nobody installs an app
  to buy a shelf.
- Two app store review processes, two codebases or a React Native rewrite, and a
  release cycle measured in days rather than minutes — against a client who wants
  a URL.

The version worth keeping in reserve is a **PWA**: the responsive web app plus a
manifest and a service worker, so it is installable to a home screen and works
offline. That is a day's work on top of the responsive runtime, needs no store,
and is the honest answer to "can we have an app?" if a client ever asks. It is
**not** a substitute for the responsive runtime — it is a thin layer over it, so
the order is: responsive first, PWA if asked, native never unless somebody pays
for it specifically.

#### What AR actually requires, in order

1. **The headless resolve function** — configuration ID → resolved assembly,
   without the editor. Everything below depends on it. Already the plan's
   week-one item and already late.
2. **GLB export of a configuration** — merge the placed parts into one GLB.
   `arReadiness` already says whether the result will be accepted.
3. **USDZ conversion** — the open question is whether glTF **material variants
   survive the conversion at all**. Test it early with one real gloss and one real
   glazed material, as the plan says. If they do not, finishes need baking per
   variant and the file count multiplies.
4. **A hosted landing route** — `/ar?c=<id>` that sniffs the platform and serves
   the right link with the right placement flag. This is the tension in §4.1:
   the configurator can stay a static offline bundle, but AR needs one small
   hosted route. **Decide it before building the exporter, not after.**
5. **The QR handoff** on desktop, pointing at that route.

---

## 5. What the YouK Range Taught Us About the Product

Two of these came from Matt looking at Kesseböhmer's own photography, and both
change the roadmap.

### 5.1 Some YouK parts hang on the wall and never touch the floor — solved, and simpler than planned

**In reality every YouK frame is wall mounted:** `MA 405462` fixes each one with
two brackets, holes 55 mm below the frame top. Whether it also reaches the floor
is a styling choice, not a structural one.

The engine assumed otherwise: the anchor sits at `y = 0`, so every assembly stood
on the ground plane. The plan's position — *"an attach point carries its own
height. Parts never choose one, and there is no height control anywhere in the
UI"* — is sound for a part hanging off a product but says nothing about the root
of the assembly being wall-mounted.

**My first design was a "mount height on the anchor": one number, derived from the
bracket position, lifting the whole assembly. Matt replaced it with something
better:** two options — **floor standing or floating** — and *no height at all*,
because the real height is chosen in AR by the person holding the phone against
their own wall. Any number the configurator invented would be both unused and
wrong.

That is what is built (§3.4): `MOUNTING = { FLOOR, WALL }`, driving the AR
placement flags and hiding the floor grid and shadow when floating. No wall
entity, no mount height, no height control — less machinery and a better answer.

The lesson worth keeping: **a modelling problem that looks like it needs a number
sometimes needs an enum.** I was about to add a dimension to the data model to
represent something the customer decides later, in a different medium.

Still open: a tray hung on rung 1 drops 158.5 mm and can end up below the floor.
Floor standing still has a floor, so that rule is still needed — it just does not
apply when floating.

#### Correction, session 5: there is a THIRD state, and it is not a third fixing

The brochure says you can *"hang your YouK on the wall, stand it on the floor or
mount it on optional feet"* — three options where the enum has two. I was about to
add `FEET` as a third peer of `FLOOR` and `WALL`. Matt pointed at two photographs
and that turns out to be wrong in an instructive way.

`YouK_-_Bedroom__Home_Images_02.jpg`, enlarged at the base, shows it plainly:
**each ladder is fixed to the wall at the back and carried by a single foot at the
front**, and the frame's bottom rail stops in mid-air over the skirting board,
which runs behind undisturbed. `mounting instructions Foot.pdf` agrees — one foot
per ladder, screwed to the underside of the bottom rail at the end, **100 or
150 mm, ±10 mm** on the levelling nut, 2× M4. And `YouK_Zwischen-Tradition-und-
Moderne-Diele-4.jpg` is the same system with no feet at all, on a tiled floor
with no skirting.

So feet are **not an alternative to wall mounting — they go with it.** Everything
is wall-fixed; that was Matt's point from the start and it stays true. What varies
is only what happens at the **bottom**:

| State | What it means | Why you would pick it |
|---|---|---|
| `FLOOR` | The bottom rail rests on the floor | No skirting board in the way |
| `WALL` | Nothing below; the unit floats | Wall-hung look; also every bathroom scene |
| `FEET` | One foot per ladder at the front, 100 or 150 mm | **A skirting board is in the way** |

That keeps it a single three-value enum with still no height field, and it adds
one priced part per ladder plus a known ground clearance. The `FEET` case is not
exotic here either: **almost every UK room has a skirting board**, so for PWS's
market feet are likely the common case rather than the exception.

Worth naming the near-miss: I had "three mounting options" from the brochure and
was one edit away from writing a third fixing method into the data model. Two
photographs said it was one fixing method with three ground conditions.

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

### 5.2a A joint has TWO ends, and the engine only ever let you choose one

**The most important finding of session 5, and Matt found it.** He reported two
separate complaints: he could not choose which rung a second ladder attached at,
and *"the lighting needs to be rotated 180 degrees — it seems to be the back of
the YouK items that are being illuminated."*

The lighting was not wrong. The key light sits at +X/+Y/+Z and the camera at
+X/+Y/+Z, the same side — rotating it 180° would have put the light behind the
product and made it worse. I checked before touching it, which is the only reason
a session was not spent fixing a light that was already correct.

Matt then diagnosed it himself: *"when I move a shelf from one snap point to a
snap point on the other side of the ladder it only connects when moving on one
snap point, so the shelf flips 180 degrees for the snap to happen."*

That is exactly what the engine does, and it is written down in §3.1 as a feature:
**the solver always succeeds on facing, by yawing the child 180°.** Roles stop two
sockets joining; nothing stops the *wrong end* of a part being chosen. So dragging
a shelf to the far side of a ladder picks whichever of its two plugs comes first
and spins the whole part round to suit. The result is geometrically valid and
visually reversed. On a symmetrical shelf nobody notices. On a hook strip, a rack
or a YouboXx the hooks and the open face end up pointing backwards — which reads,
convincingly, as bad lighting.

**Two user-visible bugs, one cause: the interaction only ever names one end of the
joint.** `drag:instanceId:N` says where to land, never which of the moving part's
snaps to land on. The attach matrix already enumerates both ends — every
(point × part × snap) triple — so the information exists and the UI throws it away.

Matt's model, which is better than the one in §5.2 and supersedes it:

- **Placing** a new part: show every valid rung as its own marker, so the level is
  chosen rather than silently taken.
- **Moving** a part already in the scene: two clicks, not one. Choose **which of
  the part's own snaps** you are grabbing, then **which target snap** it goes to.

My earlier answer — explode the markers — fixes only the target end and would have
left the flip in place. The lesson: **when one cause produces two complaints that
sound unrelated, the second complaint is the better clue.** "The lighting is
backwards" is what a 180° yaw looks like from the outside.

### 5.2b What Kesseböhmer's own marketing says that the CAD does not

From the brochure and ~30 lifestyle images Matt supplied in session 5.

- **The timber is deliberately not theirs.** Brochure page 3: the wooden shelves
  *"are made individually by a carpenter (or woodworker) and are therefore not
  included in the YouK range."* Every desktop, cabinet and most shelves in their
  photography are outside the range they sell. That is a gap in their offer and a
  commercial opening for PWS — and it means the configurator cannot show a
  convincing YouK without parts that have no CAD and no article number.
- **Kesseböhmer already ship an AR tool** (brochure pages 4–10), one QR code per
  room example. It places a *fixed* scene. Ours configures first and then places.
  So AR is table stakes with them, not a differentiator; **configure-then-AR is.**
- **Ten real configurations with exact item lists exist online.** The brochure QR
  codes resolve through `kbgo.to/ukl1…ukl10` to `.xls` shopping lists on
  `kesseboehmer.world`. That is a free validation set: if the configurator cannot
  build those ten, it cannot build what they market. Binary `.xls`, so they need
  downloading rather than fetching.
- **The hook strip's real joint is to the shelf, not the rung.**
  `mounting instructions hook rail.pdf`: step 1 hooks it into the ladders
  lengthways; step 2 bolts it to the **underside of a shelf** with 2× M4; step 3
  inserts the **1.5 mm packers** between strip and shelf. So "hook rails sit under
  shelves" is not a collision exception to permit — it is an accessory-to-span
  joint the engine has never done, the same class as the clothes-rail extensions.
  Widths 450/600/900/1200 mm, max 18 kg.
- **Two hook-strip families, and only one was in the app.** 008536/008537 are "for
  ladder *depth* 200/320" and mount depthways on one ladder. 008538–008541 are
  "for ladder *width* 450/600/900/1200" and span lengthways between two ladders.
  Only the depth ones were snapped, which is why the app's hooks looked wrong to
  Matt. **The width pair is now in** — same bay widths as the shelves to 0.0 mm,
  so one bay carries either (`youk/FINDINGS.md`).

### 5.2c A part that joins nothing, and why that needed saying out loud

The shoe rack (008553–56) is the first part in the range with no attachment to
the product at all. Kesseböhmer's sheet is a spirit level, a pencil, a drill and
wall plugs; no ladder appears in it.

The engine refused it, and was right to. No snaps is almost always a missing
authoring step, and a shelf that lost its snaps should fail loudly rather than
load as furniture nobody can attach. So the exception is **declared** rather than
inferred: a component says `mounting: "wall"`, and only then is the absence
legal. An unrecognised value is refused instead of being read as "joins nothing",
because a typo quietly turning a real mistake into an unattachable part is the
worse failure.

**Then the interesting part: nothing new was needed in the data model.** A
wall-fixed part goes in as a **second anchor** — an instance with a real position
and `freeMove`. The assembly always allowed that and `resolveTransforms` always
walked from every root; it had simply never been used for anything but the first
part. Position is derived (centred on the product, back face flush, 150 mm up)
rather than dragged, because free 3D placement is the thing this interaction
removed along with four bugs.

The app's own counters are the proof: adding one takes the bay from **3 parts,
2 joints** to **4 parts, 2 joints.** The part count goes up and the joint count
does not.

**This is also the answer to "does the configurator need a wall entity?"** — a
question this file has carried as open since the instruction sheets were read. It
does not, for this range. Revisit it only when something needs to attach to the
wall *at a chosen place*, which nothing here does.

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

**And the same data error made the palette unreadable.** Matt's report in session 5
was *"I'm not sure all the ladders are there"*. All six are — but the palette
labelled each part with its **model id**, which is the filename stem, and the
English half of Kesseböhmer's filenames drops the height for **four** of them. So
236750, 236754, 236758 and 236762 all read "…-ladder-depth-320mm" and the 550,
905, 1500 and 2210 frames looked like the same part four times.

**A missing part and an indistinguishable part look the same from the outside.**

*Correction, and a smaller claim than the one first written here:* the buttons
were not literally identical — the article number prefix differed and the
measured `w × h × d` line underneath was correct on all four. What was identical
was the **descriptive** half of the label, which is the part anyone actually
reads. So this was a bad label rather than missing information, and saying "the
height is the one thing not shown" was wrong: it was shown, just not where the
eye goes.

**Fixed in session 5.** The palette now labels a part with the catalogue
description rather than the model id, so the two overridden filename errors
(§5.3 above) reach the customer-facing label as well as the quote. Verified with
a new `palette` harness step rather than a screenshot, because a wrong label is
invisible in a picture and invisible in the status line — which is how this
survived a whole session.

### 5.5 The first parts that are ours, and the door they had to come in through

Almost every shelf in Kesseböhmer's own photography is timber, and **none of it
is theirs.** The brochure says so in their words (page 3): the wooden shelves
*"are made individually by a carpenter (or woodworker) and are therefore not
included in the YouK range"*. There is no STEP file coming for these, ever. A
configurator that waits for one shows a steel frame where the customer expects
furniture, and the range's most photographed component is missing.

So `tools/make-timber.py` generates them: **8 shelves — 4 lengths × 2 ladder
depths, 25 mm boards with a 1.5 mm chamfer**, to Matt's spec of 5 September.

**The design decision worth keeping is where they enter the pipeline.** The
script writes `<id>.converted.glb` — a finished component would have been fewer
steps — because that suffix is what `add-snaps.py` reads. A part we invented
therefore goes through snap authoring from the spec, `declare`, `inspect`,
`check-joint` and the catalogue exactly as a supplier part does. *A part we made
up is the last thing that should skip the checks*, and it earned that twice in
one session:

- **A tenth of a millimetre.** The first run read the 900's overall length off
  its own geometry as 950.2 mm, where the pipeline reports 950.1 for the
  equivalent metal shelf. That would have set timber frames 920.2 mm apart
  against metal's 920.1 — invisible, and completely wrong, because the whole
  claim is that **a bay carries either**. Two parts asking for bays a tenth of a
  millimetre apart do not. Lengths now come from what `add-snaps` *reports* for
  the metal shelf, not from a second measurement of the same file.
- **The first render came out grey.** An untextured board takes the viewer's
  default material, so the timber shelf looked like a second metal one and the
  only reason for building these parts was lost. They now carry an **indicative
  light-oak PBR material** — deliberately not a named decor, because there is no
  decor range yet and inventing one is the same mistake as inventing a price.

**Prices stay null,** as agreed: shown, not priced. `make-catalogue` reads
`youk/timber-manifest.json` for parts with no STEP source and marks them
`supplier: "PWS", article: null`. The catalogue is 66 items with money on none.

The `timber` probe scenario is the proof rather than the claim: build a bay with
a **timber** 900, then hang a **metal** 900 on the rung above. Frames at 0 and
920.1; both shelves at x 460.1.

**The cabinets followed** — and the engine-shaped job they needed turned out to
be bigger and more useful than "give the bracket a socket". §5.6.

### 5.6 A part laid on another, and the rule that had to be rewritten to allow it

Every joint in the range until this point met **edge-on**: a plug on one part's
end face against a socket on a rung's side face, and the solver turns the child
about the vertical until the two oppose. Two of Kesseböhmer's assemblies do not
work that way, and they say so in the same words. `Carcass holder` step 3: the
carcase **sits on** the brackets, screwed up from below. `Office solution` step
5: the desktop is **laid on** its supports, screwed up from below. Neither meets
anything edge-on. Their only mating face points down.

The engine refused that outright. `component.js` threw `SNAP_FACING_VERTICAL`
before a solve was even attempted — *"a floor-standing assembly cannot connect
through a ceiling"* — which was a reasonable thing to believe and wrong about
this range. **Two of the remaining parts were unbuildable because of a rule
written to prevent a mistake nobody was making.**

**Three things change once a joint can lie flat**, and each one is a test in
`tests/verticalJoint.test.js`:

1. **Yaw stops being determined by the joint.** Spinning a part about the
   vertical leaves two vertical facings opposed, so the joint says nothing about
   which way round the part goes. It has to come from somewhere else — and it
   must **not** come from the parent. The two cabinet brackets in a bay hook
   opposite faces of their ladders, so they sit 180° apart; a carcase inheriting
   its parent's yaw would face into the room from one bracket and into the wall
   from the other, decided by nothing but which bracket got clicked. It comes
   from the product: yaw zero. The consequence, stated so nobody trips over it
   later: **a part whose orientation must follow its parent cannot use a vertical
   joint.** Everything that sits on top of something is fine.
2. **The solver can no longer rescue a mismatch.** On a horizontal joint it
   always succeeds — given two same-facing snaps it yaws the child 180° — which
   is the whole reason roles exist (§3.1). Two upward faces stay two upward faces
   however far you spin them, so `FACING_SAME_VERTICAL` and
   `FACING_AXIS_MISMATCH` are real refusals rather than silent flips. The two
   halves of the solver are deliberately asymmetric now, and that is asserted
   rather than left to be rediscovered.
3. **The chooser had to learn to describe them.** It labels each option by how
   far up the part its own joint sits, which is exactly right edge-on and useless
   here: a carcase has both plugs on its underside, so the panel offered *"0 mm
   up the part"* twice and asked which. **That is Matt's original complaint
   (§5.2a) arriving through a different door** — an affordance that exists to
   remove ambiguity, presenting two identical options. `mountLabel()` now says
   *"running to the right"* / *"running to the left"* for a flat mount.

**The parts.** 24 cabinets: 4 widths × 3 heights × 2 ladder depths, six-piece
boxes to Matt's spec — 25 mm panels, two sides, base, top, back, and a
full-overlay door. Every panel is turned so its chamfered face looks outward, so
the chamfers meet as a shadow gap between panels; that is what makes six slabs
read as furniture rather than a block. 450 mm is Kesseböhmer's stated maximum
height, not a round number we liked.

**The width is the number that matters, and it is read rather than typed.**
`make-timber.py` opens the snapped bracket GLB and takes the bracket's own plug
offset — 15.1 mm on the 320 outer — so a 900 bay whose ladders sit 920.1 mm apart
gives brackets 889.9 mm apart and a carcase exactly that wide. Same lesson as the
0.1 mm that nearly shipped in the shelf lengths, applied before it could bite:
take the number from what the pipeline produced, and re-authoring the brackets
carries the cabinets with it.

**Verified in the app rather than asserted.** `-Scenario carcase` builds a bay,
hangs two brackets on rung 3 and lands a 900 box at **x 460.1** — dead centre
between brackets at 15.1 and 905.0 — and **y 813.0**, the bracket plus its 9.5 mm
socket. 6 parts, **5 joints**: the box added a joint, so it is carried rather than
parked in space.

**And a list that had gone stale twice.** `make-catalogue` and `probe-bay` both
enumerated `frames + span + hang + wall`. That spelling dropped the shoe rack
once; this time it silently left **24 cabinets out of the catalogue and out of
the palette**, and the app booted without them saying nothing. Both now find
every family in the spec rather than naming them: any array whose rows carry an
`id` is a family. Worth stating as a rule, because it has now cost twice: **a
hand-maintained list of things that already exist somewhere else is a bug with a
delay on it.** The spec is the list; nothing else should hold a copy.

**Not fixed here, and worth knowing:** the extension bracket (008559/60) puts its
socket on its own centreline, which on a middle ladder is the ladder centre
rather than 15.1 mm inboard, so a carcase sized for outer brackets will not meet
it — cabinets in a multi-bay run are unproven. And a carcase can be dropped on
one bracket and left cantilevering, because there is still no required-part rule.

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
- ~~Add a mount-height / wall-mounting concept~~ — **done, and smaller than
  planned.** Floor / floating, no height (§5.1, §3.4).
- **Move snap roles into the snap name and derive size from the `dim` cube**, so a
  plain Blender export is a complete component and `tools/declare.mjs` goes away
  (§4.2a). Small, and it should happen before the next range rather than after.
- ~~Two-ended snap picking~~ — **done** (§5.2a). Both flows now ask *how* a part
  should sit when there is more than one answer, instead of taking the first
  silently. A second 1500 frame at a shelf's free end offers **100 / 455 / 810 /
  1405 mm** — Kesseböhmer's own rung heights, reached from the geometry — and
  choosing 1405 puts the frame's base at −1305 mm, which is 100 − 1405 exactly.
  **The part that was not obvious:** the first version asked a question on nearly
  every click, because a symmetric shelf mating by its far plug is a second legal
  placement and an identical picture. `distinctPlacements` now compares the space
  a part would occupy rather than how it is wired, so eight placements on a frame
  collapse to the four heights that actually differ. A chooser that fires when
  there is nothing to choose trains people to click through it.
  **And it is not a free choice of level, though not for the reason I first gave.**
  I claimed the office-solution sheet set an alignment rule — tops for wall-hung,
  bottoms for floor-standing. That was a misreading and Matt corrected it; the
  correction is recorded in `youk/FINDINGS.md`. What the sheet actually marks is
  **which rungs the desktop may be fitted at**: rung 3 only, 810 mm above the base,
  with rungs 1 and 2 explicitly forbidden.
  That is a better finding than the one it replaces, because it is the first
  **conditional attach point** in the range — geometrically identical sockets, only
  some of them legal for a given part. Masks and roles cannot express it (a mask
  says what kind of thing fits, a role says which way round), so the level chooser
  has to filter on a condition, not just enumerate rungs. Every snap already
  carries an unused `condition: null` for exactly this.
- ~~Palette entries must show the measured size~~ — **done.** The label now comes
  from the catalogue description rather than the model id, so the corrected
  heights reach the palette and not just the quote (§5.3).
- ~~`MOUNTING` gains a third state, `FEET`~~ — **done.** Floor / floating / on
  feet, 100 or 150 mm, still no height field: choosing a foot is choosing one of
  two SKUs, not typing a number. `isGrounded()` now decides whether the view
  draws a floor, so feet keep the grid and only floating loses it (§5.1
  correction). **Still to do:** one foot per ladder on the *quote*. That waits
  for derived BOM lines, which feet, screws and the 1.5 mm packers all need, and
  which should be built once rather than three times.
- **An accessory-to-span joint**: hook strip bolted under a shelf with 1.5 mm
  packers. The packer is a **system-wide constant** — four separate instruction
  sheets put the same 1.5 mm shim between a bracket and the panel above it — so
  it belongs in the snap geometry, not in per-part measurements.
- ~~A wall entity, and it is no longer optional~~ — **answered without building
  one.** The shoe rack (008553–56) screws only to the wall and touches no ladder.
  It now goes in as a **second anchor**: a component may declare
  `mounting: "wall"`, which makes having no snaps a fact rather than a missing
  authoring step, and the app places it at a derived position — centred on the
  product, back face flush, 150 mm up. The assembly model needed nothing new; it
  always allowed more than one root.
  A wall *entity* — a thing with its own attach points — is still not built, and
  now does not have to be for this range. Revisit it only if something needs to
  attach to the wall *at a chosen place*.
- ~~Sockets must stop being exclusive~~ — **done.** Occupancy is no longer a
  boolean: a snap records which **sides** of it are taken, and a socket is full
  only when something rests on it *and* something hangs from it. Which side a
  part fills is read straight off its geometry — body centre against its own
  snap, yaw-invariant — so nothing had to be declared on 45 models.
  Verified with real parts: a 900 shelf on rung 1 lands at **+100 mm** and a rack
  aimed at the same rung lands at **−58.5 mm**, which is 100 − 158.5, the drop
  measured in session 3. The app's own count goes from 8 open points to 9 when
  the shelf is fitted, because the rung it sits on is still half free.
  Plugs stay exclusive: a shelf's end plug holds one frame. Grid cells too — a
  covered cell is covered.
- ~~**Timber parts as unpriced components**~~ — **shelves and cabinets done**
  (§5.5, §5.6): 32 of them, generated rather than converted, shown and snapped
  with no price. Matt's call; the quote module already reports partial totals
  rather than inventing a number, so it degrades honestly.
- ~~**Vertical joints**~~ — **done** (§5.6), and not planned for. A part laid on
  another rather than meeting it edge-on. The cabinets forced it and the office
  desktop needs the same thing, so it was paid for twice.
- **A required-part rule.** New on this list and it has a concrete case now: a
  carcase can be dropped on one bracket and left cantilevering, because nothing
  says a second bracket is needed. Closely related to collision refusal below —
  both are "this configuration cannot exist" rather than "these two do not fit".
- **Collision boxes and overlap refusal** belong here, but the rule is subtler
  than "nothing overlaps". Every part already reports `NO_COLLISION_BOX`, and
  there is a concrete case: a tray on a middle frame's inner face cantilevers
  straight through a shelf and the app allows it. That one is wrong; a hook rail
  1.5 mm under a shelf is right. The test cannot be proximity alone.

### Phase 2 — The runtime, the embed, mobile and AR — **NOT STARTED**

The most commercially important phase, and where AR and mobile live. In dependency
order rather than wish order:

1. **The headless resolve function** — configuration ID → resolved assembly with
   no editor. The PDF, the AR export and any server render all call it. The plan
   says week one; it is late; everything below waits on it.
2. **A viewer split out of the editor**, built on `src/engine/*` (already UI-free,
   which was the hard part) with **no editing affordances**.
3. **Responsive and touch from the start**, not as a later pass — one-finger
   orbit, pinch zoom, tap to attach, palette as a bottom sheet (§4.5). AR only
   exists on a phone, so a desktop-only runtime cannot reach the AR goal at all.
4. **The web component `<confgr-modular>`** with **all state per instance** so
   more than one sits on a page (§2). True from the first line or not at all.
5. **The folder bundle export**, copying Studio's `exportProject.js` shape —
   *and* its offline-guarantee test, which blocks every outbound request and
   drives the tour. Copy the test, not just the exporter.
6. **AR:** GLB export of a configuration → USDZ conversion (test material
   variants early) → the hosted `/ar?c=<id>` landing route → the QR handoff
   (§4.5). `arReadiness` already gates whether a configuration will be accepted.
7. **Save / reload, shareable URL state, tear-sheet PDF.**
8. **PWA wrapper** — manifest and service worker — *only if a client asks for "an
   app"*. **No native app** (§4.5).

Exit gate: live on one real site, two independent configurators on one page, AR
working on both iOS and Android, and the whole thing usable on a mid-range
Android phone.

**The decision that blocks item 5 and cannot be deferred past it:** a static
offline bundle versus the hosted route AR needs (§4.1). Settle it before writing
the exporter.

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

1. **A git remote.** Thirty-eight commits on one machine.
2. **Their price list**, in whatever format they have it. Everything commercial
   is blocked on data, not code. The ten `.xls` scene lists behind their brochure
   QR codes are a free validation set while we wait.
3. ~~The "which level?" affordance~~ — **done** (§5.2a). Two-ended snap picking,
   which unlocked the staggered layouts their own photography shows.
4. ~~A wall-mount height~~ — **done**, and it turned out to be an enum rather
   than a number (§5.1).
5. ~~The timber **shelves and cabinets**~~ — **done** (§5.5, §5.6). 32 parts
   generated rather than converted, so they needed nothing from Kesseböhmer.
   This is what makes a demo look like their photography instead of a metal
   frame. **The office desktop is the last one**, and it now waits only on the
   four office-solution metal parts — the engine half went in with the cabinets.
6. **The shareable configuration ID / headless resolve** — the plan says week
   one, and it is already late. Cheap now, painful later, and AR cannot start
   without it.
7. **Decide static bundle vs hosted AR route** (§4.1). A decision, not work, and
   it changes what the exporter is.
8. **A viewer split out of the editor** — responsive and touch from the start —
   then the bundle export. This is the big one and everything client-facing waits
   on it.
9. **Collision refusal**, before a customer builds something that cannot exist.

Items 1–7 are days. Item 8 is the project.

### And the critical path for the *application*, which is not the same list

§2 says the product is the tool, not the YouK demo. The items that make the
application reusable on the next client's range, rather than better at this one:

1. **Snap roles in the snap name** — kills the `declare` step (§4.2a). Hours.
2. **The library folder becoming a real asset store** — Studio's Asset Vault
   extended to GLB. Import once, reuse across projects.
3. **The snap editor** — the difference between a new range costing developer
   sessions and costing product-manager hours (§4.2). This is the single highest-
   leverage thing in the whole project for the *application*, and it is invisible
   to Kesseböhmer.
4. **Grids with multi-cell spans on a real product** — the one part of the attach
   model that has never met a real range.
5. **Branding / theming**, so a deliverable can look like the client rather than
   like us — and not one control before the runtime consumes it.

---

## 7. Session Log

### Session 5 — 5 September 2026

Matt drove a real bay by hand and reported what was wrong with it. Almost all of
this session's value came from that, not from me.

- **He found the 180° flip and I would not have** (§5.2a). He reported it as a
  lighting fault. Checking before fixing is the only reason a session was not
  spent rotating a light that was already correct — and his own follow-up
  diagnosis was the right one. His two-ended snap model supersedes my
  "explode the markers" answer, which fixed the wrong half of the joint.
- **He corrected the mounting model a second time** (§5.1). I had "three
  mounting options" from the brochure and was one edit from writing a third
  fixing method into the data model. Two of his photographs showed it is one
  fixing method with three ground conditions, and that the reason feet exist is
  the skirting board.
- **A missing part and an indistinguishable part look the same from outside**
  (§5.3). He thought ladders were missing. All six were there; four render as the
  same palette label because Kesseböhmer's English filenames drop the height.
- **The brochure says the timber is not theirs** (§5.2b) — in their own words —
  and that they already ship an AR tool. Both change the commercial picture.
- **The hook strip bolts to a shelf, not a rung**, with the 1.5 mm packers Matt
  half-remembered. Reading the instructions first is now two-for-two on saving
  a wrong implementation.

Decisions taken: timber parts shown but unpriced; all four remaining part
families in scope; feet as a third ground state; two-ended snap picking next.

**Then Matt named nine instruction sheets and the exact steps to read.** That one
message closed more open questions than any session so far — all of it is written
up in `youk/FINDINGS.md`. The four that change the build:

- **The 1.5 mm packer is a system constant**, not a quirk of the hook rail. Four
  separate sheets specify the same shim between a bracket and the panel above it.
- **A shelf and a hanging accessory share a rung by design**, so sockets must stop
  being exclusive. The current refusal would block an assembly Kesseböhmer
  document.
- **The shoe rack screws only to the wall.** The first part with no attachment to
  the assembly, which turns "does the configurator need a wall?" from a question
  into a requirement. It also corrects `FINDINGS.md`, which had listed the shoe
  rack as a span accessory.
- ~~Wall-hung runs align by their tops, floor-standing runs by their bottoms~~ —
  **wrong, and Matt caught it.** I misread the office-solution tick-and-cross as
  an alignment rule. It marks **which rungs the desktop may be fitted at**: rung 3
  (810 mm) permitted, rungs 1 and 2 forbidden. All four ladders in that drawing
  share one floor line, so their bottoms *are* aligned — the diagram disproves
  what I said about it. Correction and the measurement in `youk/FINDINGS.md`.
  The real finding is better: it is the range's first **conditional attach point**,
  and the first use for the `condition` field that has sat unused on every snap.
  A knock-on worth knowing: **the 550 mm frame has only rungs 1 and 2, both
  forbidden, so it cannot carry a desk at all.**

Also: the clothes-rail extension turned out to be a **coupler bracket**, not an
accessory-to-accessory joint, which retires an open engine risk. And Matt's 25 mm
timber thickness is Kesseböhmer's own figure, printed five times on the
office-solution sheet — specified independently before either of us read it.

**Then built, once Matt chose depth over breadth** — fix the 22 parts rather than
add more. Commits `a6b07a1` → `7a6bef5`:

- **Palette labels from the catalogue**, so the corrected heights reach the
  customer-facing name and not just the quote.
- **Feet as a third ground condition**, with `isGrounded()` deciding whether the
  view draws a floor.
- **Two-ended snap picking**, which fixes the unreachable rung heights and the
  180° flip together — and then `distinctPlacements` to stop it asking a question
  on every click.
- **Shared rungs**, so a shelf and a hanging accessory can use one rung the way
  the instructions show.

Three things worth keeping from how that went. **A test caught me comparing the
wrong thing** — poses rather than occupied space — in the exact case the code was
written for. **A second test then failed the other way**, because I asserted eight
options would survive and four did, and four was right. And **the palette bug was
smaller than I had written it up as**: the buttons were never identical, only
their descriptive halves were. Three assertions made without opening the file,
in one session.

**Then the range, 22 → 34 components.** Commits `06be53c` → `af8f7f1`, 227 tests.

- **Width hook strips** (008538–41). Span parts, not hang parts — which is the
  whole of Matt's "the hooks look wrong". Bearing measured off the vertex profile
  rather than reasoned.
- **Shoe racks** (008553–56). The first part that joins nothing, and a new `wall`
  family in the spec to say so (§5.2c).
- **Cabinet brackets** (008557–60). Hang parts, confirmed by the slot search
  finding what it expects rather than by me deciding. The geometry reproduced the
  outer/extension distinction on its own: outer plugs offset at x −15.1, middle
  ones centred at 0.0.

The pattern across all three: **the pipeline decided, not the author.** Each time
the guess was tested by whether the measured feature turned up where the family
requires, and each time the result was a number that could be checked against the
instruction sheet afterwards.

**Then the timber, 34 → 42 components.** Commit `b34234b`, still 227 tests. Eight
shelves that no supplier will ever send, put through the supplier pipeline anyway
(§5.5). The pipeline promptly caught a 0.1 mm length error that would have made
timber and metal disagree about bay width, and the app's own render caught the
second one: an untextured board looks like metal, which defeated the point of
building them. Both are the same lesson as the paragraph above — **the guess was
tested rather than trusted** — and this time the part being checked was ours.

**Then Matt looked at the render and said the normals were flipped.** They were,
on all twenty faces of every board. Commit `b25783b`. The reason it survived
every check is the interesting part: it was wrong **consistently**. trimesh
reported the mesh watertight and the winding consistent, both true; snaps come
from the spec and joints from vertex positions, so nothing downstream reads a
normal. The part measured right, placed right, and lit wrong. **Consistency is
not correctness**, and the cheap test that separates them — a signed volume — now
runs before any board is exported.

**Then vertical joints and the cabinets, 42 → 66 components.** Commit `ed6d689`,
243 tests. Asked for the cabinets, and found that they could not be built at all:
a carcase is laid on its brackets and its only mating face points down, which the
engine refused by design (§5.6). Rewriting that rule also unblocks the office
desktop, which needs exactly the same joint — so the answer to "cabinets or
desktop first?" turned out to be that they were one question.

Two things worth carrying forward. **A refusal written to prevent a mistake can
be the thing standing in the way** — `SNAP_FACING_VERTICAL` was reasonable and
wrong. And **the chooser met Matt's original complaint from a new direction**: a
carcase has both plugs at the same height, so an affordance built to remove
ambiguity offered two identical labels. Both halves of that came out of building
the parts, not out of reasoning about the engine.

### Session 4 — 4 September 2026

The doc, then AR and mounting. Commits `78296e7` → `b154c39`.

- **`tests/stagger.test.js`** — proved that a shelf spanning two frames at
  different heights needs **no engine change**, rather than assuming it. Four
  tests. The finding is that the *UI* is silently choosing among eight valid
  placements (§5.2).
- **`src/engine/ar.js`** and the mounting choice. Two decisions worth recording:
  - **The budget belongs to the assembly, not the part.** The plan's rule 9
    records a triangle budget per component. Every one of the 45 YouK parts is
    under 40,000 and a three-YouboXx configuration still clears Scene Viewer's
    100,000 maximum — so a per-part budget passes everything and catches nothing.
    The test that matters is literally named *"catches an assembly over budget
    whose PARTS are all under it."*
  - **Matt's floor-or-floating simplification beat my design.** I had a mount
    height on the anchor; he pointed out that height is chosen in AR by whoever
    is holding the phone. An enum, not a number, and one less field in the data
    model (§5.1).
- **The End Goals section was wrong and Matt corrected it.** It read as though the
  goal were a configurator on Kesseböhmer's website. The goal is the
  **application**; YouK is the benchmark, the way Threadworks was for confgr
  Studio. §2 is rewritten, and there is now a second critical path — the one for
  the application rather than the demo (§6).
- **§0 exists because "how do I run it" was not written down anywhere.** It is now
  the first thing in the file.

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

1. **No git remote.** Thirty-eight commits, one machine. Cheapest thing on this
   list.
2. **Asset production is the permanent cost.** Every component needs modelling,
   snaps, collision boxes. The plan says this straight: *"it does not go away if
   you buy Mimeeq instead."* YouK took two sessions of developer time for 22
   parts. Without a snap editor, range two costs the same again. **Generated
   parts are the exception and worth noticing:** 32 of the 66 components came out
   of one script and cost minutes each, because their geometry is describable
   rather than drawn. Where a client's range has that property, the permanent
   cost is much lower than this risk implies.
3. **A hand-maintained list of things that already exist somewhere else.** Twice
   now — `frames + span + hang + wall` spelled out in two tools — a new family
   has been silently dropped, once losing 24 parts from the palette with no
   error. Both are fixed (§5.6), but the pattern is the risk: anywhere a second
   copy of a list exists, it will go stale and say nothing.
4. **The connection graph is a tree.** A shelf added to an existing bay lands
   perfectly against the far frame but is connected only to the near one, so
   deleting the middle frame would leave shelves floating. Geometry and bill of
   materials are both right; the graph is not. **A carcase makes this visible:**
   it is carried by two brackets and joined to one, so deleting the other leaves
   it hanging in mid-air looking supported.
5. **Nothing stops an impossible configuration.** No collision, no required-part
   validation before checkout, no rules engine. A cabinet on a single bracket is
   the newest example and the easiest to build by accident.
6. **The static-export vs hosted-AR tension** (§4.1) is undecided.

### Open questions

**Product**

- ~~How does a frame actually mount to a wall~~ — answered: floor, floating or on
  feet, no height (§5.1).
- ~~Whether the configurator needs a wall~~ — **it does, and a part forces it.**
  The shoe rack screws only to the wall and never touches a ladder. Whether the
  wall is *drawn* is still a choice; whether it exists as a thing to attach to is
  no longer one.
- The clothes rail's 1.00 mm of bracket inside the rung, reported by `check-joint`
  on all three sizes, is now the **only** joint question the instruction sheets do
  not settle. Everything else Matt listed is answered in `youk/FINDINGS.md`.
- Should a span accessory record **both** of its ends?
- Should the app refuse a part that would hang below the floor — still needed for
  floor standing, and it does not apply when floating.
- **Does wall placement on Android work well enough to promise?**
  `enable_vertical_placement` defaults to false and is reported to be unreliable.
  Needs testing on a real mid-range Android device before it goes in a client
  demo, not after.
- How the clothes rail's bracket engages the rung: `check-joint` reports 1.00 mm
  of it inside the rung on all three sizes, and the drawings admit two readings.
  A question for Kesseböhmer, not for more measuring.
- ~~The clothes rail extensions need an **accessory-to-accessory** joint~~ —
  **answered, and cheaper than feared.** `Coat rail` step 1b: two rails do not
  join to each other, they both bolt into a **third bracket** on the middle
  ladder. That is an ordinary coupler component — socket to the ladder, a plug
  each side — so the engine needs no new capability. One fewer open risk.

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
