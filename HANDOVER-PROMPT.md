# Master starter prompt — confgr Modular, next build phase

> Paste everything below the line into a fresh Claude Code session opened in
> `D:\Claude\confgr-modular`, on Opus 5.5 at **high** (or extra-high) effort.
> Recommended: start the session in **plan mode** so the audit and plan come
> back for approval before any code changes.

---

You are taking over the build of **confgr Modular**, a desktop + web application
for building and delivering **modular 3D product configurators** — products made
of parts that click together (shelving, racking, furniture), where the customer
chooses the parts *and* the arrangement. The benchmark range is
**Kesseböhmer's YouK shelving system**. I'm Matt, the product owner. I am not
the developer; I test on my own desktop, iPhone and Android phone and tell you
what I see.

The project has 9 sessions of work behind it, 835 passing tests and a live
deployment at `confgr-youk.netlify.app`. It works, but it does not yet feel like
professional software, and the rules that connect YouK parts together are not
fully right. Your job is to turn it into a **professional, intuitive, reliable
product that keeps and builds on every existing feature**.

## 1. Read before you touch anything

In this order. Do not skim the first one — it is the memory of the project.

1. `confgr-modular-project.md` — the state of the project, verified against code.
   §0 (how to run), §2 (goals), §3 (what's built), §5.24–§5.27 (the most recent
   work and Matt's feedback), §6 (roadmap and critical path), §8 (risks and
   open questions). Where this file and the README disagree, this file wins.
   The README is out of date (it still says "Phase 0").
2. `youk/FINDINGS.md` — everything measured from Kesseböhmer's CAD, including
   four description errors in their data. Measurement beats names, always.
3. `tools/AUTHORING.md` — how a supplier CAD file becomes a component.
4. `youk/snap-spec.json`, `youk/guided.json`, `youk/material-spec.json`,
   `youk/catalogue.json` — the decisions, as data.
5. `src/engine/*` (the headless engine), `src/viewer/*` (the customer runtime),
   `src/spike/Configurator.jsx` (the editor), and `tests/`.
6. `git log` — commit messages here are written as explanations; read the last
   ~40.

Then run `npm test` and confirm 835 pass before changing anything.

## 2. Environment facts — several of these have cost whole sessions

- **The project lives at `D:\Claude\confgr-modular`** (moved from `C:\Claude\`
  in November 2026). Paths in the doc, `package.json` and the tools have been
  repointed; if you meet a stray `C:\Claude\` anywhere, it is stale — fix it.
- **Supplier files: `youk\step files\`** — the 45 Kesseböhmer STEP models, plus
  their brochures (EN/DE/FR/ES), the mounting-instruction PDFs for every
  family, and their room photography. The instruction PDFs are the authority on
  how parts really connect — **read them for workstream A**, and use the
  photography as the reference for what correct configurations look like.
  The folder is **gitignored and must stay that way**: the repo is pushed to
  GitHub and these files are Kesseböhmer's.
- The Python venv `tools\.venv-step` has been **rebuilt on Python 3.13**
  (the old one pointed at a Python 3.14 that no longer exists; it is kept as
  `tools\.venv-step.broken-py314` and can be deleted). Verified: converting
  008563 from STEP reproduces the existing `.converted.glb` byte-for-byte in size.
- **confgr Studio V2 is `D:\Claude\confgr-studio`** — the git repo with
  `src/export/exportProject.js`, the plan (`confgr-modular-plan.md`) and
  `configurator-studio-project.md`. Its export path is the parity target.
  `D:\Claude\configurator-studio` is an older, unversioned predecessor; don't
  take patterns from it unless I say so.
- **Blender 5.3** is running with an MCP add-on listening on
  **`localhost:9876`** (blender-mcp socket protocol: JSON
  `{"type": ..., "params": ...}`). If you have no Blender tools in your session,
  register the MCP server for Claude Code first (e.g. the `blender-mcp`
  package), or talk to the socket directly. At handover it accepted connections
  but answered "Client timed out", which usually means Blender's UI was busy or
  had a dialog open — ask me to check Blender before debugging the socket.
  Headless is always available as a fallback:
  `"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" -b --python script.py`.
  Use Blender for model work — UV generation (the converted meshes have none),
  cleanup, inspection, comparison renders. **Never edit supplier geometry by
  hand:** every model change must be a script the pipeline can rerun from the
  STEP source.
- `NODE_ENV=production` is set globally; `.npmrc` pins `include=dev`. Don't
  remove it.
- Vite runs on **5174**, not 5173. A stale Vite holds the port and serves stale
  code — see README "Dev gotchas".
- Shell is Windows. In PowerShell, `"$f?c="` interpolates a variable called
  `f?c` — this has already produced a false 404 diagnosis once.
- Model regeneration order: **convert → snap → declare → normals → materials**.
  Skipping `declare` after `snap` turns ~60 tests red with nothing obviously wrong.

You have full access to the machine. Use the in-app browser for localhost and the
deployed site; ask before deploying, pushing, or emailing anything.

## 3. The three workstreams

### A. Rewrite the connection rules for YouK — do this first

"Not fully working" must become a precise list before it becomes a rewrite.

**Step A1 — Audit and reproduce.** Build every realistic YouK configuration the
guided options and the editor can reach and record what is wrong. Write it down
as a failure table (configuration, expected, actual, screenshot/probe output)
before writing any fix. Use the probe (`tools/probe-bay.ps1`, every scenario),
`npm run joints`, and the collision survey. Then **show me the table and ask me
which failures I've seen** — I will have examples you won't find on your own.

Known weak points from the project doc, to check first:
- The connection graph is a **tree**; a shelf or cabinet carried by two ladders
  is joined to one. **Deletion is never re-validated**, so removing a part can
  leave things floating that looked supported (§8 risk 4).
- Spans record only one end (open question in §8).
- **Cabinets in a multi-bay run are unproven**: the extension bracket
  (008559/60) puts its socket on its centreline, which a carcase sized for
  outer brackets will not meet (§3.6).
- Parts that "spring back" after a move because the move list and the rebuild
  disagree about what is legal (§5.26).
- Levelling / auto-attach across mixed ladder types placed parts underground
  once already (§5.25).
- Nothing refuses a part hanging below the floor when floor-standing.
- The clothes rail's 1.00 mm engagement into the rung (`check-joint`).
- Invalid configurations still produce a quote nobody is stopped from sending.

**Step A2 — Design the new rule model, and show it to me before building it.**
My expectations, which you may argue with:
- Connections expressed as **declarative, data-driven rules per family**
  (frames, span, hang, carcase, bolted, wall …) — readable by a non-developer
  and validated on load — not as special cases scattered through the engine.
  This is also what the future snap editor will edit.
- A part supported at two ends is **connected at both ends**. Validity, support
  and deletion are answered from the real structure, not a spanning tree.
- **One source of truth for "is this legal"** used by placing, moving, the
  guided builder, validation and the quote. The move list must never offer
  something the rebuild will refuse.
- Every refusal comes with a human sentence (the existing "greyed, with the
  reason" behaviour stays).
- Nothing hard-coded for Kesseböhmer: the test is always *"does this work for
  the next client's range?"* (§2).

**Step A3 — Prove it.** Generate a test matrix from the catalogue itself (every
socket × every part that could plausibly meet it) so coverage cannot silently
lag the range. Existing configuration ids and shared URLs must still open —
write a migration, and a test that opens the old ids.

### B. A professional, intuitive UI and UX

Both surfaces matter, in this priority:
1. **The customer runtime** (`src/viewer`, what's deployed and bundled) — this
   is what Kesseböhmer and their customers see.
2. **The authoring app** (`src/spike/Configurator.jsx`, Electron) — currently a
   spike. It should become a real application shell, ready for Phase 1
   (import, snap editor, asset store).

**Brand direction — a nod to Kesseböhmer, not a copy.** Study
https://www.kesseboehmer.com/en and the YouK pages: typography, palette,
spacing, photography style, tone. Derive a design system that would sit
comfortably next to their site — calm, precise, premium German engineering —
but do **not** use their logo, trademarks or copied assets, and do not make it
look like an official Kesseböhmer product. They are a partnership prospect, not
a client yet. Build it as **themeable design tokens** (CSS custom properties) so
"YouK / Kesseböhmer-flavoured" is one theme and a neutral confgr theme is
another. Branding/theming per client is on the roadmap anyway (§3.6, §6).

UX requirements:
- Configuring should feel **direct and obvious**: tap a snap dot to add, drag to
  move, tap the line between ladders to set bay width — keep all of these, make
  them discoverable, with clear hover/selected/disabled states and undo/redo.
- Clear structure: product view as the hero; options grouped logically
  (size → bays → shelves/storage → accessories → finish); a live bill of
  materials and price that are always findable; a clear validity state.
- Mobile is first-class: bottom sheet that behaves, thumb-sized targets, no
  view resets, AR button on the stage (rule from §5.25: *a link is an action
  and belongs on the stage; an explanation belongs with the numbers it
  qualifies*).
- Light, high-quality 3D presentation: the light build space (`#efece7`),
  correct materials (steel rgb(45,45,45), plastic rgb(50,50,50) — Matt chose
  these; do not change them without asking), soft shadows, good default camera.
- Accessibility: keyboard operable, visible focus, contrast AA, reduced motion.
- **Before building the UI, show me 2–3 visual directions** (rendered mockups or
  a clickable prototype) and let me pick.

### C. Professional hardening

- Keep everything that exists working: the engine, guided options, per-bay
  widths and ladder types, kinds, movable parts and the starter shelf, spacing
  lines, implied parts (feet), required parts, collision, configuration ids and
  URLs, the quote (tiers, VAT, margin, "a missing price is not zero"), GLB/USDZ
  export, the bundle and its offline guarantee, the AR route and handoff, QR
  scan-to-phone, Netlify deploy, the probe harness. Section 3 of the project doc
  is the checklist.
- Multi-instance safety stays a hard rule for the exported viewer: no globals,
  no fixed DOM ids, no `window.__anything` (§2).
- Error states, loading states, empty states — no blank canvases.
- Performance budget on a mid-range phone; measure, don't assume.
- Update the README and the project doc as you go (see "How to keep this file
  current" at the end of it), and correct the stale paths.

## 4. How to work

- **Plan, then build in small, verifiable steps.** Each step ends with tests
  green, the probe run, and — for anything visual — a look in a real browser.
  For anything touching AR or touch, say plainly that it needs my phone and give
  me exactly what to test.
- **Look, don't reason.** This project's history is full of confident notes that
  turned out wrong (§5.27 is the clearest). A screenshot, a probe dump or a
  measurement beats an argument. Where the BOM and the dimensions disagree, one
  of them is lying — find which.
- **Measure, trust no name.** Kesseböhmer's data has known errors; don't
  "correct" them silently, and don't author the five unresolved parts (008533,
  008534, 008535, 008549, 008552) without their answers.
- **No second copies of lists.** Derive from the source data; stale duplicate
  lists have dropped whole families before.
- Tests for every rule change. Don't weaken an existing test to make it pass —
  if a test encodes a decision of mine (colours, behaviour), ask.
- Commit in coherent steps on a branch (not straight to `main`), with messages
  that explain *why*, in the style of the existing log. Don't push, deploy or
  merge without asking.
- Prices stay `null` in the real catalogue; the example price list is fictional
  and never committed.

## 5. Checkpoints where you stop and ask me

1. After the audit: the failure table, and which failures I recognise.
2. The new connection-rule model, before implementation.
3. 2–3 UI directions, before building the UI.
4. Before any deploy to Netlify, any `git push`, or anything sent outside this
   machine.
5. Any change to a decision recorded as mine in the project doc.

## 6. First response I expect from you

Don't write code yet. Come back with:
1. A short confirmation of what you understood the project to be, and anything
   in the docs that contradicts the code.
2. Environment check results (tests, venv, Blender, app launch, paths).
3. The audit plan for workstream A, and the order you propose for A → B → C,
   with rough sizing.
4. Your questions for me.
