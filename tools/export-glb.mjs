// One configuration, one GLB. No editor.
//
//   node tools/export-glb.mjs youk --id <configuration-id> --out product.glb
//   node tools/export-glb.mjs youk --demo
//
// This is the first thing the project produces that a customer could hold, and
// it is the gate on the whole AR path: Scene Viewer and Quick Look both take a
// FILE, and until now a configuration only existed as state inside a running
// Electron window.
//
// It is a command-line tool on purpose. The point of the headless resolve
// (§5.18) was that a configuration is a value rather than a session, and the
// sharpest way to prove that is to turn an id into a file with the editor
// closed. Everything here runs in Node: `describe-glb.mjs` reads the parts,
// `extractComponent` validates them, `resolveConfiguration` places them, and
// gltf-transform writes the result. Three.js is not involved.
//
// WHAT THE FILE IS, and these are decisions rather than defaults:
//
//   * ONE FILE, world space. Every placed part, merged, at the position the
//     solver put it. Including the parts the configuration IMPLIES - a bay on
//     feet exports with its feet, because a bay on feet is what was priced.
//   * REBASED FOR A FLOOR. The product's own origin is the anchor frame's base
//     centre, which on feet is 99.8mm above the floor and on a wide run is
//     nowhere near the middle. An AR viewer drops a model onto a plane at its
//     own origin, so the export is translated to sit ON that plane and centred
//     in plan. Anything else arrives sunk into the carpet or off to one side.
//   * NO SNAP PLANES, NO COLLISION BOXES. `md-snap`, `md-grid`, `col-` and
//     `dim` are structure for the editor. They are stripped, along with their
//     meshes and accessors, because eighty invisible quads is eighty invisible
//     quads in somebody's living room.
//
// The AR budget is finally MEASURED rather than estimated: `arReadiness` has
// taken a `bytes` argument since it was written and nothing has ever had a real
// number to give it.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { mergeDocuments, prune, dedup, unpartition } from '@gltf-transform/functions';

import { describeGlb } from './describe-glb.mjs';
import { extractComponent } from '../src/engine/component.js';
import {
  encodeConfiguration, resolveConfiguration, configurationDigest,
} from '../src/engine/configuration.js';
import { attachAt } from '../src/engine/attach.js';
import { arReadiness, MOUNTING } from '../src/engine/ar.js';

/**
 * Editor structure, not product. Mirrors NON_VISIBLE_PREFIXES in component.js.
 *
 * EXPORTED, and that is the point rather than a convenience. `export-usdz.mjs`
 * needs the same answer, and when it had its own idea of it the first USDZ this
 * project ever produced contained `mdsnapcarcasssideleft`, `colbody` and `dim`
 * — a customer's living room, furnished with the editor's scaffolding. Two
 * copies of a list is the failure mode §8 risk 3 is about, and this is the
 * third time it has bitten.
 */
export const NOT_PRODUCT = ['md-snap', 'md-grid', 'col-'];
export const isProduct = (name) => name !== 'dim'
  && !NOT_PRODUCT.some((p) => name?.startsWith(p));

/** Every component in a folder, loaded and validated the way the app loads them. */
export function loadFolder(folder) {
  const components = new Map();
  const failures = [];
  for (const file of readdirSync(folder)) {
    if (!file.endsWith('.glb') || file.endsWith('.converted.glb')) continue;
    const id = basename(file, '.glb');
    try {
      components.set(id, extractComponent(describeGlb(join(folder, file))));
    } catch (err) {
      failures.push({ id, message: err.message });
    }
  }
  return { components, failures };
}

/**
 * Merge one part's GLB into the output document, under a node carrying its
 * world transform.
 *
 * gltf-transform's `merge` brings the source's whole graph across, scene and
 * all. What is wanted is the source's visible NODES, re-parented under one
 * placement node — so the extra scene is emptied and disposed, and everything
 * that is not product geometry goes with it.
 */
async function placePart(out, io, sourcePath, transform) {
  const source = await io.read(sourcePath);
  const before = new Set(out.getRoot().listScenes());
  mergeDocuments(out, source);

  const added = out.getRoot().listScenes().filter((s) => !before.has(s));
  const holder = out.createNode(basename(sourcePath, '.glb'))
    .setTranslation(transform.translation)
    .setRotation(transform.rotation);

  for (const scene of added) {
    for (const node of scene.listChildren()) {
      scene.removeChild(node);
      if (isProduct(node.getName())) {
        holder.addChild(node);
      } else {
        // Dispose the mesh as well as the node. A node on its own leaves the
        // geometry in the file - invisible, still paid for.
        const mesh = node.getMesh();
        if (mesh) {
          for (const primitive of mesh.listPrimitives()) {
            for (const semantic of primitive.listSemantics()) {
              primitive.getAttribute(semantic)?.dispose();
            }
            primitive.getIndices()?.dispose();
            primitive.dispose();
          }
          mesh.dispose();
        }
        node.dispose();
      }
    }
    scene.dispose();
  }

  return holder;
}

/**
 * Where the whole product sits, so it can be moved onto the floor and centred.
 *
 * Computed from the ENGINE's own body bounds rather than from the merged
 * document, because they are the same numbers the app has been drawing and
 * quoting from, and a second way of measuring the same thing is a second thing
 * that can disagree.
 */
export function productBounds(scene, components, transforms) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];

  for (const instance of scene.instances) {
    const body = components.get(instance.componentId)?.body;
    const t = transforms.get(instance.instanceId);
    if (!body || !t) continue;
    // Axis-aligned is right here: every part in this range is yawed about the
    // vertical or laid flat, so a body box stays a box. The office arm's
    // 9-degree roll is the exception and it moves the result by under a
    // millimetre on a 2-metre product.
    for (let a = 0; a < 3; a += 1) {
      lo[a] = Math.min(lo[a], body.min[a] + t.translation[a]);
      hi[a] = Math.max(hi[a], body.max[a] + t.translation[a]);
    }
  }
  return { min: lo, max: hi };
}

/** Onto the floor, centred in plan. See the note at the top of the file. */
export function floorOffset(bounds) {
  return [
    -(bounds.min[0] + bounds.max[0]) / 2,
    -bounds.min[1],
    -(bounds.min[2] + bounds.max[2]) / 2,
  ];
}

export async function exportConfiguration(id, folder, outPath, { raw = false } = {}) {
  const { components, failures } = loadFolder(folder);
  if (!components.size) {
    throw new Error(`No loadable components in ${folder}.`);
  }

  const catalogue = existsSync(join(folder, 'catalogue.json'))
    ? JSON.parse(readFileSync(join(folder, 'catalogue.json'), 'utf8'))
    : null;

  const resolved = resolveConfiguration(id, components, { catalogue });
  const bounds = productBounds(resolved.scene.assembly, components, resolved.scene.transforms);
  const offset = floorOffset(bounds);

  const out = new Document();
  const scene = out.createScene('product');
  const io = new NodeIO();

  for (const instance of resolved.scene.assembly.instances) {
    const t = resolved.scene.transforms.get(instance.instanceId);
    if (!t) continue;
    const holder = await placePart(out, io, join(folder, `${instance.componentId}.glb`), {
      translation: t.translation.map((v, a) => v + offset[a]),
      rotation: t.rotation,
    });
    scene.addChild(holder);
  }

  out.getRoot().setDefaultScene(scene);

  // Three transforms, in this order, and each one is load-bearing:
  //
  //   `dedup`       a bay uses the same ladder twice, and each placement was
  //                 read from its own file, so the merged document holds one
  //                 copy of the mesh per PLACEMENT. This collapses them back.
  //   `prune`       drops what stripping the snap planes left behind, and any
  //                 material or texture nothing points at any more.
  //   `unpartition` merges every source's buffer into one. NOT cosmetic: a GLB
  //                 is allowed 0 or 1 buffers, and merging four parts gives
  //                 four, so `writeBinary` refuses the document without it.
  //                 This is what "GLB must have 0-1 buffers" meant.
  //
  // The saving is measured, not assumed - `--raw` writes the document without
  // dedup and prune so the two files can be put side by side. On the demo bay
  // that is 786,948 bytes raw against 443,980 exported: 342,968 bytes, 44% off,
  // for a file whose triangle count does not change (34,106 either way). It is
  // the second copy of the ladder, and the snap planes' orphaned accessors.
  if (!raw) await out.transform(dedup(), prune());
  await out.transform(unpartition());

  // NORMALS ARE DELIBERATELY NOT WRITTEN HERE, and it took a measurement to
  // know that, because the range does not have any: all 80 YouK GLBs ship with
  // no NORMAL attribute at all (`step-to-glb.py` and `make-timber.py` never
  // wrote one; every synthetic test asset does).
  //
  // The obvious fix is `normals()` in this chain, and it is wrong. Measured on
  // one ladder:
  //
  //     before   7,466 vertices   7,495 triangles   182,984 bytes
  //     after   22,485 vertices   7,495 triangles   544,428 bytes
  //
  // 22,485 is 7,495 x 3 exactly - it UNWELDS, giving every triangle its own
  // three vertices, which is how you write FLAT normals. And flat normals are
  // precisely what the glTF spec already requires a viewer to compute when
  // NORMAL is absent. So it triples the file to hand Scene Viewer something it
  // would have worked out for itself, on a budget stated in megabytes.
  //
  // USDZ is the one consumer that does not fill them in - three's exporter
  // warns "Normals missing" and omits them - so that is where the work belongs,
  // in `export-usdz.mjs`, paid for once by the file that needs it.
  //
  // The pipeline should still write normals at source; `inspect-model.mjs` says
  // so on every part now.

  const bytes = await io.writeBinary(out);
  writeFileSync(outPath, Buffer.from(bytes));

  const ready = arReadiness(resolved.scene.assembly, components, {
    mounting: resolved.mounting,
    // The first real number this has ever been given.
    bytes: bytes.byteLength,
  });

  return { resolved, bytes: bytes.byteLength, bounds, offset, ready, failures };
}

/**
 * A bay, built with no editor at all.
 *
 * Not a fixture for a test — a demonstration that the seam is real. Every step
 * is the engine's own: `attachMatrix` is not needed because the joint is named
 * outright, and what comes out is an id that the app would also have produced.
 */
export function demoConfiguration(components) {
  const ladder = '236758-ladder-depth-320mm';
  const shelf = '008563-shelf-900mm-for-ladder-depth-320mm';
  const rung = 'md-snap.youk-d320.rung-1-right';

  let assembly = {
    instances: [{
      instanceId: 'a', componentId: ladder, selections: {},
      position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
    }],
    connections: [],
  };
  assembly = attachAt(assembly, {
    point: { instanceId: 'a', snapId: rung },
    componentId: shelf,
    mountSnapId: 'md-snap.youk-d320.mount-left',
  }, 'b');
  assembly = attachAt(assembly, {
    point: { instanceId: 'b', snapId: 'md-snap.youk-d320.mount-right' },
    componentId: ladder,
    mountSnapId: 'md-snap.youk-d320.rung-1-left',
  }, 'c');

  return encodeConfiguration(assembly, { mounting: MOUNTING.FEET, footHeightMm: 100 });
}

async function main(argv) {
  const folder = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'youk';
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };

  let id = at('--id');
  if (!id && argv.includes('--demo')) {
    const { components } = loadFolder(folder);
    id = demoConfiguration(components);
    console.log('demo configuration');
  }
  if (!id) {
    console.error('Give me --id <configuration-id>, or --demo for a bay on feet.');
    return 1;
  }

  const outPath = at('--out') || join(folder, `configuration-${configurationDigest(id)}.glb`);

  try {
    const r = await exportConfiguration(id, folder, outPath, { raw: argv.includes('--raw') });
    const mm = (v) => Math.round(v * 1000);

    console.log(`\n${r.resolved.digest}  ${r.resolved.assembly.instances.length} parts chosen, `
      + `${r.resolved.implied.connections.length} implied, mounting ${r.resolved.mounting}`);
    console.log(`  bounds  ${mm(r.bounds.min[0])}..${mm(r.bounds.max[0])} x  `
      + `${mm(r.bounds.min[1])}..${mm(r.bounds.max[1])} y  `
      + `${mm(r.bounds.min[2])}..${mm(r.bounds.max[2])} z  mm`);
    console.log(`  moved   ${r.offset.map(mm).join(', ')} mm to sit on the floor, centred`);
    console.log(`  wrote   ${outPath}  ${(r.bytes / 1024).toFixed(1)} kB, `
      + `${r.ready.triangles.toLocaleString()} triangles`);
    console.log(`  AR      ${r.ready.ready ? 'within budget' : 'OVER BUDGET'}, `
      + `goes on ${r.ready.placement.vertical ? 'a wall' : 'the floor'}`);
    for (const w of r.ready.warnings) console.log(`          ${w.code}: ${w.message}`);
    if (r.failures.length) {
      console.log(`\n  ${r.failures.length} component(s) would not load:`);
      for (const f of r.failures.slice(0, 5)) console.log(`    ${f.id}: ${f.message}`);
    }
    return 0;
  } catch (err) {
    console.error(`\nrefused: ${err.message}`);
    return 1;
  }
}

// Am I the script, or is something importing me?
//
// Two traps here, both hit for real. `file://` + a path is not the same string
// as a Windows file URL - the drive letter gets a third slash - so this asks
// Node for the conversion rather than guessing at it; the hand-rolled version
// silently did nothing at all and the tool exited 0 printing nothing.
//
// And `process.argv[1]` is UNDEFINED under `node -e`, which threw inside
// `pathToFileURL` before any importer could use a single export. A guard that
// crashes the module it is guarding is worse than no guard.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry && import.meta.url === entry) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
