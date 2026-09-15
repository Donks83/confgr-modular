// Give the parts a material, because the CAD gives them none.
//
//   node tools/add-materials.mjs youk [--check]
//
// WHY THIS EXISTS. Every Kesseboehmer part converted from STEP has zero
// materials: `POSITION` and nothing else, no material, no UVs. A glTF primitive
// with no material takes the format's DEFAULT - white, metallic 1.0, rough 1.0 -
// so the whole range rendered as white chrome. In the app that looks pale and
// flat. In AR it is worse, because Scene Viewer and Quick Look light the scene
// with their own bright environment and a fully metallic white surface has
// nothing to do but blow out. Matt saw it immediately on a phone.
//
// So this walks the folder and assigns one material per part, from
// youk/material-spec.json. It runs AFTER conversion and BEFORE snaps, and like
// every other step in that pipeline it regenerates from the repo: the spec is
// committed, the GLBs are not.
//
// ONE MATERIAL PER PART, not per primitive. The ladder has 11 primitives and
// they are all the same steel; giving each its own material would be 11 copies
// of one fact and 11 chances for them to drift.
//
// WHY BOTH ENDS GET IT FOR FREE: the app loads these GLBs and `export-glb.mjs`
// merges these same GLBs into the AR model. Writing the material into the file
// is the only place that fixes the viewer and the phone at once.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';

/**
 * sRGB 0-255 to the LINEAR value glTF stores.
 *
 * Not a nicety. `baseColorFactor` is linear, and 27/255 written straight in is
 * 0.106 where it should be 0.0111 - nearly ten times too bright, which for a
 * colour chosen precisely because the range was too bright would be a comic
 * failure. The transfer function is the sRGB standard one, not a gamma of 2.2.
 */
export function srgbToLinear(v255) {
  const c = v255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Which class a part belongs to, by the id it was given. */
export function classOf(id, spec) {
  for (const [prefix, cls] of Object.entries(spec.byPrefix || {})) {
    if (id.startsWith(prefix)) return cls;
  }
  return spec.default;
}

export async function addMaterials(folder, { check = false } = {}) {
  const spec = JSON.parse(readFileSync(join(folder, 'material-spec.json'), 'utf8'));
  const io = new NodeIO();

  const files = readdirSync(folder)
    .filter((f) => f.endsWith('.glb') && !f.endsWith('.converted.glb'))
    .sort();

  const done = [];
  for (const file of files) {
    const id = basename(file, '.glb');
    const cls = classOf(id, spec);
    const m = spec.classes[cls];
    if (!m) throw new Error(`${id} maps to class "${cls}", which material-spec.json does not define.`);

    const path = join(folder, file);
    const doc = await io.read(path);
    const root = doc.getRoot();

    const before = root.listMaterials().length;
    const prims = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());

    if (check) {
      const missing = prims.filter((p) => !p.getMaterial()).length;
      done.push({ id, cls, prims: prims.length, missing, bytes: statSync(path).size });
      continue;
    }

    // Reuse a material the part already has ONLY if it is the one we wrote:
    // the timber boards arrive with their own, and rewriting it with the same
    // numbers is harmless, while leaving a stale one is not.
    const material = doc.createMaterial(`confgr-${cls}`)
      .setBaseColorFactor([...m.srgb.map(srgbToLinear), 1])
      .setMetallicFactor(m.metallic)
      .setRoughnessFactor(m.roughness);

    for (const p of prims) p.setMaterial(material);

    // Anything that was on the file before is now unreferenced. Left behind it
    // would ship in every bundle and every AR model for ever.
    for (const old of root.listMaterials()) {
      if (old !== material) old.dispose();
    }

    await io.write(path, doc);
    done.push({ id, cls, prims: prims.length, before, bytes: statSync(path).size });
  }

  return { spec, parts: done };
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry && import.meta.url === entry) {
  const folder = process.argv[2] || 'youk';
  const check = process.argv.includes('--check');
  const { spec, parts } = await addMaterials(folder, { check });

  const byClass = {};
  for (const p of parts) byClass[p.cls] = (byClass[p.cls] || 0) + 1;

  console.log(`${check ? 'would assign' : 'assigned'} materials to ${parts.length} parts in ${folder}`);
  for (const [cls, n] of Object.entries(byClass)) {
    const m = spec.classes[cls];
    console.log(`  ${String(n).padStart(3)}  ${cls.padEnd(8)} rgb(${m.srgb.join(',')})`
      + `  metallic ${m.metallic}  roughness ${m.roughness}  - ${m.label}`);
  }
  if (check) {
    const bare = parts.filter((p) => p.missing > 0);
    console.log(`\n${bare.length} of ${parts.length} parts have primitives with NO material`
      + ' (those take glTF\'s white, fully metallic default)');
  }
}
