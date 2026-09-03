# confgr Modular

Modular 3D product configurator authoring tool. Separate application from
confgr Studio — see `confgr-modular-plan.md` in the confgr-studio repo for the
full reasoning, data model and roadmap.

Short version: confgr Studio is scene-shaped (project → scenes → layers →
options). This is product-shaped (product → components → snaps → rules → BOM →
price). Different nouns, different editor, different runtime. The shell is a
copy of confgr Studio's, not a shared package — see plan section 3.2.

## Status: Phase 0

Proving the snap system. Nothing else is built yet.

```
npm install
npm test              # engine tests, no browser needed
npm run electron:dev  # the spike
```

## What is here

```
src/engine/      Pure snap engine. No three.js, no React. Runs in vitest.
  vec.js         Vector and quaternion maths
  component.js   glTF description -> validated component (enforces the AR-safe rules)
  snapMatch.js   Two-stage matching: logical (masks) then geometric (position, facing)
  assembly.js    Connection graph -> world transforms
src/three/       The only bridge to three.js. Swap this file to change renderer.
src/spike/       Throwaway Phase 0 UI.
tests/           Engine tests + the test-asset generator.
test-assets/     Generated GLB components with md-snap planes.
```

The engine has no renderer dependency on purpose. If Phase 0 concludes we should
be on Babylon.js instead, `src/three/loadGlb.js` is rewritten and everything in
`src/engine` survives untouched.

## Conventions this repo enforces

Plan section 7.6 — the decisions that keep AR cheap to add later. These are
checked at import and will refuse a model:

| Rule | Enforced by |
|---|---|
| Real dimensions declared in mm, matching geometry in metres | `extractComponent` — `SCALE_MISMATCH` |
| Origin at base centre, Y-up | `ORIGIN_NOT_AT_BASE`, `ORIGIN_NOT_CENTRED` |
| Snaps are flat 4-vertex quads | `SNAP_NOT_QUAD`, `SNAP_NOT_FLAT` |
| Snap facings horizontal | `SNAP_FACING_VERTICAL` |
| Mesh names recorded so detail levels can be compared | `component.meshNames` |

### Blender / 3ds Max naming

| Name | Meaning |
|---|---|
| `body` | The visible geometry. Required. |
| `md-snap.<mask>.<label>` | A connection point. Flat quad, 4 verts. Local +Z is the facing. |
| `col-<name>` | Collision box. Cubic. |
| `dim` | Dimension box. Cubic. Snaps sit on its edges. |

Scene extras must carry `confgr: { widthMm, heightMm, depthMm }`.

Regenerate the test components with `npm run test:assets`. That script
(`tests/make-test-glb.mjs`) is also the reference for the Blender validator.

## Not built yet, and deliberately not blocked

AR ("View in your room") and the PDF tear sheet are Phase 2. The nine
constraints in plan section 7.6 exist so neither becomes a rewrite. Review that
list before Phase 1 closes.
