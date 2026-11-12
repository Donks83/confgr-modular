#!/usr/bin/env node
// The A1 audit, editor half: what does deleting a part leave behind?
//
//   npx vite-node tools/audit/editor-delete.mjs
//
// The editor deletes with `detach` (attach.js), which removes a part and its
// SUBTREE in the connection graph. The graph is a tree, so a part carried at
// two ends is a child of only one of them. Deleting the OTHER one leaves it in
// place, held at one end, and this asks every check we have whether it notices.
//
// Products are built with the guided builder (so they are realistic), then
// every instance is deleted in turn the way the editor would.

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFolder } from '../export-glb.mjs';
import { parseGuided, normaliseChoices, buildGuided, defaultChoices } from '../../src/engine/guided.js';
import { detach } from '../../src/engine/attach.js';
import { resolveTransforms, snapSupport, validateAssembly } from '../../src/engine/assembly.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { components } = loadFolder(join(ROOT, 'youk'));
const schema = parseGuided(JSON.parse(readFileSync(join(ROOT, 'youk', 'guided.json'), 'utf8')));
const base = defaultChoices(schema);

const products = [
  ['2 bays w900, 1 extra metal shelf', { variantId: 'd320', sizeId: 'w900', bays: 2, mounting: 'floor', adds: { 'metal-shelf': 1 } }],
  ['3 bays w900, 2 extra metal shelves, 1 rail', { variantId: 'd320', sizeId: 'w900', bays: 3, mounting: 'floor', adds: { 'metal-shelf': 2, 'clothes-rail': 1 } }],
  ['2 bays w900 on the wall, timber + hook strip full', { variantId: 'd320', sizeId: 'w900', bays: 2, mounting: 'wall', adds: { 'timber-shelf': 1, 'hook-strip-full': 1 } }],
];

const rows = [];
for (const [label, partial] of products) {
  const built = buildGuided(schema, normaliseChoices(schema, { ...base, ...partial, at: {} }), components);
  const spanning = new Set(['008561', '008562', '008563', '008564', '008530', '008531', '008532', '008538', '008539', '008540', '008541', 'pws-timber-shelf']);
  const isSpan = (id) => [...spanning].some((p) => id.startsWith(p));
  for (const victim of built.assembly.instances) {
    if (victim.instanceId === built.assembly.instances[0].instanceId) continue;
    const after = detach(built.assembly, victim.instanceId);
    const { transforms } = resolveTransforms(after, components);
    const validity = validateAssembly(after, components, transforms);
    for (const i of after.instances) {
      if (!isSpan(i.componentId)) continue;
      const s = snapSupport(after, components, transforms, i.instanceId);
      if (s.met < s.total) {
        rows.push({
          product: label,
          deleted: `${victim.instanceId} ${victim.componentId}`,
          removedAlongside: after.removed.length - 1,
          leftHangingAtOneEnd: `${i.instanceId} ${i.componentId} (${s.met}/${s.total})`,
          engineSaysValid: validity.isValid,
        });
      }
    }
  }
}
console.table(rows);
console.log(`${rows.length} deletions leave a spanning part held at one end; engine says valid in ${rows.filter((r) => r.engineSaysValid).length}.`);
