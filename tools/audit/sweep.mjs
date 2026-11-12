#!/usr/bin/env node
// The A1 audit: every product the guided options can reach, checked against
// invariants written HERE rather than borrowed from the code under test.
//
//   node tools/audit/sweep.mjs [--models youk] [--out docs/audit/sweep.json] [--quick]
//
// Why a second set of eyes rather than the engine's own verdicts. The engine
// already has validateAssembly, snapSupport and survey - and every one of the
// faults recorded in §5.24-§5.26 got past them, because each path asks its own
// question. So the oracles below ask the PHYSICAL questions directly (is any
// part under the floor, is a span held at both ends, does the id give back the
// same product) and reuse the engine only to BUILD, never to judge.
//
// It changes nothing. It reads the models, builds products in memory, and
// writes one JSON file of findings plus a summary on stdout.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFolder } from '../export-glb.mjs';
import {
  parseGuided, defaultChoices, normaliseChoices, buildGuided,
  moveOptions, moveCandidates, addPoints, addAvailability,
} from '../../src/engine/guided.js';
import { resolveTransforms, snapSupport, validateAssembly } from '../../src/engine/assembly.js';
import { overlaps, boxesFor } from '../../src/engine/collision.js';
import { resolveConfiguration } from '../../src/engine/configuration.js';
import { impliedParts } from '../../src/engine/implied.js';
import { isGrounded, MOUNTING } from '../../src/engine/ar.js';
import { removeSlot } from '../../src/viewer/Guided.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const QUICK = args.includes('--quick');
const MODELS = resolve(ROOT, opt('models', 'youk'));
const OUT = resolve(ROOT, opt('out', 'docs/audit/sweep.json'));

const TOL_M = 0.001;
const mm = (m) => Math.round(m * 1000 * 10) / 10;

// The same base64url the runtime writes to ?o=, so every finding is a link.
const encodeChoices = (c) => Buffer.from(JSON.stringify(c)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------------------------------------------------------------------------

const { components, failures } = loadFolder(MODELS);
if (failures.length) console.warn(`${failures.length} models failed to load:`, failures.map((f) => f.id).join(', '));
const schema = parseGuided(JSON.parse(readFileSync(join(MODELS, 'guided.json'), 'utf8')));
let catalogue = null;
try { catalogue = JSON.parse(readFileSync(join(MODELS, 'catalogue.json'), 'utf8')); } catch { /* quote optional */ }

const findings = [];
const counts = { builds: 0, moves: 0, dots: 0, adds: 0, removes: 0, stability: 0 };
const seen = new Map();   // dedupe key -> finding, with an occurrence count

function report(oracle, choices, detail, sample = {}) {
  const key = `${oracle}|${detail.key ?? detail.message}`;
  const prior = seen.get(key);
  if (prior) { prior.occurrences += 1; return; }
  const f = {
    oracle,
    message: detail.message,
    product: describe(choices),
    occurrences: 1,
    o: encodeChoices(choices),
    choices,
    ...sample,
  };
  seen.set(key, f);
  findings.push(f);
}

/** A product in words: "d320 · 2 bays w900/w600 · 1500/1500/905 · feet · metal-shelf×2". */
function describe(c) {
  const bays = c.bays || 1;
  const short = (id) => (id || '').replace(/^.*?(\d{3,4}(\.\d)?)mm.*$/, '$1').replace(/^(\d{6})-.*/, '$1');
  const frameAt = (i) => c.frames?.[i] || c.frameId;
  const widths = Array.from({ length: bays }, (_, i) => c.widths?.[i] || c.sizeId).join('/');
  const frames = Array.from({ length: bays + 1 }, (_, i) => {
    const v = schema.variants.find((x) => x.id === c.variantId);
    return v?.frames.find((f) => f.componentId === frameAt(i))?.heightMm ?? short(frameAt(i));
  }).join('/');
  const adds = Object.entries(c.adds || {}).filter(([, n]) => n).map(([k, n]) => `${k}×${n}`).join(' ');
  const at = Object.keys(c.at || {}).length ? ` · moved: ${Object.keys(c.at).join(',')}` : '';
  return `${c.variantId} · ${bays} bay${bays > 1 ? 's' : ''} ${widths} · frames ${frames} · ${c.mounting}${adds ? ` · ${adds}` : ''}${at}`;
}

/** Lowest world Y of any box a part occupies. */
function minY(component, transform) {
  let lo = Infinity;
  for (const b of boxesFor(component, transform)) {
    const ext = b.axes.reduce((s, ax, i) => s + Math.abs(ax[1]) * b.half[i], 0);
    lo = Math.min(lo, b.centre[1] - ext);
  }
  return lo;
}

const variantOfChoices = (c) => schema.variants.find((v) => v.id === c.variantId) || schema.variants[0];

/** Every component id that is a SPAN somewhere in this variant, and every spanning add. */
function spanningIds(variant) {
  const s = new Set();
  for (const size of variant.sizes) {
    if (size.span?.componentId) s.add(size.span.componentId);
    for (const a of size.adds || []) if (a.spans) s.add(a.componentId);
  }
  return s;
}
const frameIds = (variant) => new Set(variant.frames.map((f) => f.componentId));

// ---------------------------------------------------------------------------
// The oracles. Each one is a sentence about the physical product.

function checkProduct(built, choices, ctx = '') {
  const c = built.choices;
  const variant = variantOfChoices(c);
  const { assembly } = built;
  const { transforms } = resolveTransforms(assembly, components);
  const grounded = isGrounded(c.mounting);
  const anchor = assembly.instances[0];
  const floorY = transforms.get(anchor.instanceId)?.translation[1] ?? 0;
  const spans = spanningIds(variant);
  const frames = frameIds(variant);
  const where = (id) => {
    const t = transforms.get(id);
    return t ? t.translation.map(mm) : null;
  };
  const slotOf = (id) => built.slots?.[id] || '(no slot)';

  // O1 nothing below the floor when the product stands on it
  if (grounded) {
    for (const i of assembly.instances) {
      const y = minY(components.get(i.componentId), transforms.get(i.instanceId));
      if (y < floorY - TOL_M) {
        report('O1-below-floor', choices, {
          key: `${i.componentId}@${slotOf(i.instanceId).replace(/#\d+$/, '')}`,
          message: `${i.componentId} (${slotOf(i.instanceId)}) reaches ${mm(y - floorY)} mm below the floor on a ${c.mounting}-standing product`,
        }, { ctx, at: where(i.instanceId) });
      }
    }
  }

  // O2 every frame stands on the floor (no recorded heights in these builds)
  if (grounded && !Object.keys(c.at || {}).some((k) => k.startsWith('frame#'))) {
    for (const i of assembly.instances) {
      if (!frames.has(i.componentId)) continue;
      const y = transforms.get(i.instanceId).translation[1];
      if (Math.abs(y - floorY) > TOL_M) {
        report('O2-frame-off-floor', choices, {
          key: `${variant.id}|${i.componentId}`,
          message: `${i.componentId} (${slotOf(i.instanceId)}) stands at ${mm(y - floorY)} mm, not on the floor`,
        }, { ctx });
      }
    }
  }

  // O3 every spanning part is held at both ends
  for (const i of assembly.instances) {
    if (!spans.has(i.componentId)) continue;
    const s = snapSupport(assembly, components, transforms, i.instanceId);
    if (s.met < s.total) {
      report('O3-span-not-held', choices, {
        key: `${i.componentId}|${slotOf(i.instanceId).replace(/#\d+$/, '')}`,
        message: `${i.componentId} (${slotOf(i.instanceId)}) held at ${s.met} of ${s.total} ends`,
      }, { ctx, at: where(i.instanceId) });
    }
  }

  // O4 the engine's own validity (required snaps, back to front)
  const v = validateAssembly(assembly, components, transforms);
  if (!v.isValid) {
    report('O4-invalid', choices, {
      key: `${v.missingRequiredSnaps.map((s) => s.label).join(',')}|${v.backToFront.length}`,
      message: `validateAssembly: ${v.missingRequiredSnaps.length} required point(s) empty, ${v.backToFront.length} part(s) back to front`,
    }, { ctx, validity: v });
  }

  // O5 nothing passes through anything it is not joined to
  for (const o of overlaps(assembly, components, transforms)) {
    if (o.through && !o.joined) {
      report('O5-through', choices, {
        key: `${o.componentA}|${o.componentB}`,
        message: `${o.componentA} passes through ${o.componentB} (${o.depthMm} mm, thinner ${o.thinnerMm} mm)`,
      }, { ctx });
    }
  }

  // O11 two parts in the same place. Found by rendering, not by any oracle: a
  // metal and a timber shelf at the same rung of the same bay. Two coincident
  // boards measure as a LAP (escape depth == the thinner board), so O5 and the
  // engine's own survey both pass them. Compared by the space each occupies.
  // Frames are left out: a ladder's box is a hollow rectangle, and a hook strip
  // hung on a rung legitimately sits inside it.
  const placed = assembly.instances.filter((i) => !frames.has(i.componentId))
    .map((i) => ({ i, b: boxesFor(components.get(i.componentId), transforms.get(i.instanceId))[0] }))
    .filter((p) => p.b);
  for (let a = 0; a < placed.length; a += 1) {
    for (let b = a + 1; b < placed.length; b += 1) {
      const A = placed[a].b; const B = placed[b].b;
      // World AABB of each oriented box, then the shared volume as a share of the
      // smaller part. Parts here are only ever yawed, so the AABB is tight. Laps
      // at a joint share a sliver; two shelves on one rung share most of the board.
      const ext = (X) => [0, 1, 2].map((k) => X.axes.reduce((s, ax, i) => s + Math.abs(ax[k]) * X.half[i], 0));
      const ea = ext(A); const eb = ext(B);
      let shared = 1;
      for (let k = 0; k < 3; k += 1) {
        const lo = Math.max(A.centre[k] - ea[k], B.centre[k] - eb[k]);
        const hi = Math.min(A.centre[k] + ea[k], B.centre[k] + eb[k]);
        shared *= Math.max(0, hi - lo);
      }
      const vol = (e) => 8 * e[0] * e[1] * e[2];
      if (shared / Math.min(vol(ea), vol(eb)) > 0.5) {
        report('O11-two-parts-one-place', choices, {
          key: `${placed[a].i.componentId}|${placed[b].i.componentId}`,
          message: `${placed[a].i.componentId} (${slotOf(placed[a].i.instanceId)}) and ${placed[b].i.componentId} (${slotOf(placed[b].i.instanceId)}) occupy the same space at y ${mm(A.centre[1] - floorY)} mm — both on the bill of materials`,
        }, { ctx });
      }
    }
  }

  // O6 a choice that could not be honoured says so in words
  for (const r of built.refused || []) {
    report(r.reason ? 'O6-refused' : 'O6-refused-silently', choices, {
      key: `${variant.id}|${r.kind || r.componentId}|${r.reason}`,
      message: `asked for ${r.asked ?? 1} × ${r.kind || r.componentId}, placed ${r.placed ?? 0}: ${r.reason || '(no reason)'}`,
    }, { ctx });
  }
  for (const d of built.dropped || []) {
    report('O6-dropped', choices, {
      key: `${d.slot.replace(/#\d+$/, '')}|${d.reason}`,
      message: `recorded position for ${d.slot} dropped: ${d.reason || '(no reason)'}`,
    }, { ctx });
  }

  // O7 the configuration id gives back the same product
  try {
    const r = resolveConfiguration(built.configurationId, components, { catalogue });
    for (const [k, inst] of assembly.instances.entries()) {
      const a = transforms.get(inst.instanceId).translation;
      const b = r.transforms.get(r.assembly.instances[k]?.instanceId)?.translation;
      if (!b || Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > TOL_M) {
        report('O7-id-roundtrip', choices, { key: inst.componentId, message: `${inst.componentId} moves on id round trip` }, { ctx });
        break;
      }
    }
    // O8 an offered mounting is buildable, or refused in words where the customer sees it
    const imp = impliedParts(assembly, components, { mounting: c.mounting });
    for (const ref of imp.refusals || []) {
      report('O8-mounting-refused', choices, {
        key: `${variant.id}|${c.mounting}|${ref.code || ref.reason}`,
        message: `${c.mounting}: ${ref.reason || ref.message || JSON.stringify(ref)}`,
      }, { ctx });
    }
    // O9 a quote is produced for an invalid product (Matt: it must be a draft)
    if (r.quote && (!r.validity.isValid || (imp.refusals || []).length)) {
      report('O9-quote-while-invalid', choices, {
        key: `${variant.id}|${!r.validity.isValid}|${(imp.refusals || []).length > 0}`,
        message: 'a full quote is produced for a product the engine knows is invalid or unbuildable',
      }, { ctx });
    }
  } catch (err) {
    report('O7-id-roundtrip', choices, { key: err.code || err.message, message: `id does not resolve: ${err.message}` }, { ctx });
  }

  // O10 a control that is offered can be used
  const avail = addAvailability(built, components);
  for (const [kind, a] of Object.entries(avail)) {
    if (!a.ok && a.kind === 'never') {
      report('O10-dead-control', choices, {
        key: `${variant.id}|${c.sizeId}|${kind}`,
        message: `"${kind}" is offered by size ${c.sizeId} of ${variant.id} and can never be placed: ${a.reason}`,
      }, { ctx });
    }
  }
  return { transforms };
}

// ---------------------------------------------------------------------------
// Interactions, replayed exactly the way the runtime records them.

const build = (choices) => {
  counts.builds += 1;
  return buildGuided(schema, choices, components);
};
const instanceForSlot = (built, slot) => Object.entries(built.slots || {}).find(([, s]) => s === slot)?.[0];
const posOf = (built, slot) => {
  const id = instanceForSlot(built, slot);
  if (!id) return null;
  return resolveTransforms(built.assembly, components).transforms.get(id)?.translation || null;
};
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);

function sweepInteractions(built) {
  const base = built.choices;
  for (const [instanceId, slot] of Object.entries(built.slots || {})) {
    // MovePanel: an option carries mountSnapId
    const mo = moveOptions(built, components, instanceId);
    for (const option of mo.options || []) {
      if (option.current) continue;
      counts.moves += 1;
      const choices = { ...base, at: { ...base.at, [slot]: option.at } };
      const after = build(choices);
      const p = posOf(after, slot);
      if (after.dropped?.some((d) => d.slot === slot) || !p || Math.abs(mm(p[1]) - option.heightMm) > 1) {
        report('I1-panel-move-springs-back', choices, {
          key: `${mo.kind}|${slot.replace(/#\d+$/, '')}|${built.choices.variantId}`,
          message: `move panel offered ${slot} at ${option.heightMm} mm; after rebuild it is at ${p ? mm(p[1]) : 'nowhere'} mm${after.dropped?.length ? ` (dropped: ${after.dropped.map((d) => d.reason).join('; ')})` : ''}`,
        }, { before: encodeChoices(base) });
      }
      checkProduct(after, choices, `after panel move of ${slot}`);
    }

    // Dots and drag: Guided.moveTo records {instanceId, snapId} only, and the
    // ghost shown is the LAST candidate at that point (Map, last write wins).
    const mc = moveCandidates(built, components, instanceId);
    const ghostAt = new Map();
    for (const cand of mc.candidates || []) ghostAt.set(`${cand.point.instanceId}::${cand.point.snapId}`, cand);
    for (const [key, ghost] of ghostAt) {
      if (ghost.current) continue;
      counts.dots += 1;
      const at = { instanceId: ghost.point.instanceId, snapId: ghost.point.snapId };
      const choices = { ...base, at: { ...base.at, [slot]: at } };
      const after = build(choices);
      const p = posOf(after, slot);
      const shown = ghost.pose.translation;
      if (dist(p, shown) > TOL_M) {
        report('I2-drag-lands-elsewhere', choices, {
          key: `${mc.kind}|${slot.replace(/#\d+$/, '')}|${built.choices.variantId}`,
          message: `drag/dot preview showed ${slot} at y ${mm(shown[1])} mm; it landed at ${p ? `y ${mm(p[1])}` : 'nowhere'} mm${after.dropped?.some((d) => d.slot === slot) ? ' (record dropped - springs back)' : ''}`,
        }, { before: encodeChoices(base), point: key });
      }
    }
  }

  // Add by dot: Guided.placeAt
  for (const add of built.adds || []) {
    const kind = add.kind;
    // The runtime only enters "placing" from a + that is enabled, and + is
    // disabled at the schema's max. Asking past it measures the harness.
    if ((base.adds?.[kind] || 0) >= (add.max ?? 4)) continue;
    for (const point of addPoints(built, components, kind)) {
      counts.adds += 1;
      const index = base.adds?.[kind] || 0;
      const slot = `${kind}#${index}`;
      const choices = {
        ...base,
        adds: { ...base.adds, [kind]: index + 1 },
        at: { ...base.at, [slot]: { instanceId: point.instanceId, snapId: point.snapId } },
      };
      const after = build(choices);
      const landed = after.slotAt?.[slot];
      const refused = after.refused?.find((r) => r.kind === kind);
      if (refused || !landed || landed.instanceId !== point.instanceId || landed.snapId !== point.snapId) {
        report('I3-add-dot-lands-elsewhere', choices, {
          key: `${kind}|${built.choices.variantId}|${refused ? 'refused' : 'moved'}`,
          message: `tapped a dot for ${kind} at ${point.instanceId}::${point.snapId.replace(/^md-snap\.[^.]+\./, '')}; ${refused ? `refused: ${refused.reason}` : landed ? `placed at ${landed.instanceId}::${landed.snapId.replace(/^md-snap\.[^.]+\./, '')} instead` : 'not placed'}`,
        }, { before: encodeChoices(base) });
      } else {
        checkProduct(after, choices, `after add-dot ${kind}`);
      }
    }
  }
}

/** Remove each accessory in turn; nothing else should move. */
function sweepRemovals(built) {
  const base = built.choices;
  for (const [kind, n] of Object.entries(base.adds || {})) {
    for (let i = 0; i < n; i += 1) {
      counts.removes += 1;
      const choices = removeSlot(base, kind, i);
      const after = build(choices);
      checkProduct(after, choices, `after removing ${kind}#${i}`);
      // every OTHER add slot should keep its position (shifted index above the hole)
      for (const [k2, n2] of Object.entries(base.adds)) {
        for (let j = 0; j < n2; j += 1) {
          if (k2 === kind && j === i) continue;
          const before = posOf(built, `${k2}#${j}`);
          const nj = k2 === kind && j > i ? j - 1 : j;
          const afterPos = posOf(after, `${k2}#${nj}`);
          if (dist(before, afterPos) > TOL_M) {
            report('I4-remove-moves-others', choices, {
              key: `${kind}->${k2}|${base.variantId}`,
              message: `removing ${kind}#${i} moved ${k2}#${j} from (x ${before ? mm(before[0]) : '?'}, y ${before ? mm(before[1]) : '?'}) to (x ${afterPos ? mm(afterPos[0]) : '-'}, y ${afterPos ? mm(afterPos[1]) : 'gone'}) mm`,
            }, { before: encodeChoices(base) });
          }
        }
      }
    }
  }
}

/** A part the customer moved should stay put when an unrelated option changes. */
function sweepStability(built) {
  const base = built.choices;
  // move the first add slot that has a non-current option, then change other things
  for (const [instanceId, slot] of Object.entries(built.slots || {})) {
    if (slot.startsWith('frame#') || slot.startsWith('span#')) continue;
    const opt1 = (moveOptions(built, components, instanceId).options || []).find((o) => !o.current);
    if (!opt1) continue;
    const moved = { ...base, at: { ...base.at, [slot]: opt1.at } };
    const builtMoved = build(moved);
    const ref = posOf(builtMoved, slot);
    const changes = [];
    for (const add of builtMoved.adds || []) {
      changes.push([`+1 ${add.kind}`, { ...moved, adds: { ...moved.adds, [add.kind]: (moved.adds?.[add.kind] || 0) + 1 } }]);
    }
    const variant = variantOfChoices(base);
    if ((base.bays || 1) < (variant.maxBays || 3)) changes.push(['+1 bay', { ...moved, bays: (base.bays || 1) + 1 }]);
    for (const [label, choices] of changes) {
      counts.stability += 1;
      const after = build(choices);
      const p = posOf(after, slot);
      if (dist(ref, p) > TOL_M) {
        report('I5-moved-part-wanders', choices, {
          key: `${slot.replace(/#\d+$/, '')}|${label.replace(/\d+/, 'n')}|${base.variantId}`,
          message: `${slot} moved to y ${mm(ref[1])} mm; after "${label}" it is at ${p ? `y ${mm(p[1])}` : 'gone'} mm${after.dropped?.some((d) => d.slot === slot) ? ' (its record was dropped)' : ''}`,
        }, { before: encodeChoices(moved) });
      }
    }
    break; // one moved part per product is enough to show the pattern
  }
}

// ---------------------------------------------------------------------------
// The products.

function* structures() {
  for (const variant of schema.variants) {
    const frames = variant.frames.map((f) => f.componentId);
    const sizes = variant.sizes.map((s) => s.id);
    const maxBays = variant.maxBays || 3;
    const mountings = [MOUNTING.FLOOR, MOUNTING.FEET, MOUNTING.WALL];
    for (const mounting of mountings) {
      // one bay, exhaustive over the two frames and the width
      for (const f0 of frames) for (const f1 of frames) for (const s of sizes) {
        yield { variantId: variant.id, mounting, bays: 1, frameId: f0, frames: { 1: f1 }, sizeId: s };
      }
      // uniform runs of 2..max
      for (let bays = 2; bays <= maxBays; bays += 1) {
        for (const f of frames) for (const s of sizes) {
          yield { variantId: variant.id, mounting, bays, frameId: f, sizeId: s };
        }
      }
      if (QUICK) continue;
      // mixed runs: a deterministic walk so the sweep is repeatable
      let seed = 7;
      const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
      for (let k = 0; k < 24; k += 1) {
        const bays = 2 + rnd(maxBays - 1);
        const fr = {}; const wd = {};
        for (let i = 1; i <= bays; i += 1) fr[i] = frames[rnd(frames.length)];
        for (let i = 0; i < bays; i += 1) wd[i] = sizes[rnd(sizes.length)];
        yield { variantId: variant.id, mounting, bays, frameId: frames[rnd(frames.length)], frames: fr, widths: wd, sizeId: sizes[0] };
      }
    }
  }
}

const started = Date.now();
let n = 0;
const defaults = defaultChoices(schema);
for (const s of structures()) {
  n += 1;
  const choices = normaliseChoices(schema, { ...defaults, ...s, adds: {}, at: {} });
  let built;
  try { built = build(choices); } catch (err) {
    report('O0-build-throws', choices, { key: err.message, message: err.message });
    continue;
  }
  checkProduct(built, choices, 'bare structure');

  // Accessories: each kind alone at every count, then everything at max.
  const uniform = !s.frames && !s.widths;
  for (const add of built.adds || []) {
    const max = add.max ?? 4;
    for (let k = 1; k <= max; k += 1) {
      const c2 = normaliseChoices(schema, { ...choices, adds: { [add.kind]: k } });
      const b2 = build(c2);
      checkProduct(b2, c2, `${k} × ${add.kind}`);
    }
  }
  const full = {};
  for (const add of built.adds || []) full[add.kind] = add.max ?? 4;
  const cFull = normaliseChoices(schema, { ...choices, adds: full });
  const bFull = build(cFull);
  checkProduct(bFull, cFull, 'every accessory at max');

  // The interaction sweep is expensive; run it on uniform 1- and 2-bay runs,
  // with one of each accessory so there is something to move.
  if (uniform && s.bays <= 2 && !QUICK) {
    const one = {};
    for (const add of built.adds || []) one[add.kind] = 1;
    const cOne = normaliseChoices(schema, { ...choices, adds: one });
    const bOne = build(cOne);
    sweepInteractions(bOne);
    sweepRemovals(bOne);
    sweepStability(bOne);
  }
  if (n % 25 === 0) process.stderr.write(`  ${n} structures, ${counts.builds} builds, ${findings.length} distinct findings, ${Math.round((Date.now() - started) / 1000)} s\n`);
}

// ---------------------------------------------------------------------------

findings.sort((a, b) => a.oracle.localeCompare(b.oracle) || b.occurrences - a.occurrences);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  models: MODELS,
  structures: n,
  counts,
  seconds: Math.round((Date.now() - started) / 1000),
  findings,
}, null, 1));

const byOracle = {};
for (const f of findings) {
  byOracle[f.oracle] ??= { distinct: 0, occurrences: 0 };
  byOracle[f.oracle].distinct += 1;
  byOracle[f.oracle].occurrences += f.occurrences;
}
console.log(`\n${n} structures, ${JSON.stringify(counts)}, ${Math.round((Date.now() - started) / 1000)} s`);
console.table(byOracle);
for (const f of findings) console.log(`[${f.oracle}] ×${f.occurrences}  ${f.message}
      e.g. ${f.product}${f.ctx ? `  (${f.ctx})` : ''}`);
console.log(`\nwritten ${OUT}`);
