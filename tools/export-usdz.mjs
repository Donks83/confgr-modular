// The other half of the AR path: a GLB in, a USDZ out, for iPhones.
//
//   node tools/export-usdz.mjs product.glb --out product.usdz
//   node tools/export-usdz.mjs --demo --out demo.usdz
//
// Android takes the GLB that tools/export-glb.mjs already writes. iOS does not:
// Quick Look reads USDZ and nothing else, and Quick Look is not a viewer you
// can talk someone through installing - it is what happens when Safari meets an
// <a rel="ar"> link. So without this, half the phones in the world cannot see
// the product at all, and that half is most of the ones Kesseböhmer's customers
// are holding.
//
// THIS STEP IS NOT RENDERER-FREE, and that is a deliberate exception to the
// rule §5.19 established. It loads the GLB into three.js and runs three's own
// `USDZExporter`. The alternative was to author USD directly from the glTF, and
// that is a bad trade: USDZ is not "USD in a zip" - it is USD in a zip with
// rules (stored not deflated, every file's data 64-byte aligned, the model file
// first) that Quick Look enforces silently by showing nothing. three's exporter
// already gets those right, is what model-viewer uses, and is maintained by
// people who test against real devices. Writing a second implementation of it
// would be inventing a way to be wrong.
//
// The engine stays headless. This is a tool, not the engine, and it is the
// LAST step in the chain - everything upstream of it still runs in Node with no
// DOM at all.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { isProduct } from './export-glb.mjs';

/** The zip constraints Quick Look enforces. See `verifyUsdz`. */
export const USDZ_ALIGNMENT = 64;
const ZIP_LOCAL_HEADER = 0x04034b50;
const STORED = 0;

/**
 * Load a GLB into a three.js scene, in Node.
 *
 * Imported lazily so that a caller who only wants `verifyUsdz` - which is pure
 * byte-reading and is what the tests lean on - does not pay for three.js.
 */
async function sceneFromGlb(bytes) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  return gltf.scene;
}

/**
 * Give every mesh FLAT normals, in memory. OFF by default — see below.
 *
 * The whole YouK range ships with no NORMAL attribute (the long note in
 * `export-glb.mjs` has the measurement). glTF requires a viewer to compute flat
 * normals when they are missing, so Scene Viewer and the editor both cope, and
 * three's USDZ exporter warns "Normals missing" and writes the mesh without
 * them — which is what makes this look like a bug to fix.
 *
 * IT PROBABLY IS NOT ONE. three's exporter also writes
 * `uniform token subdivisionScheme = "none"` on every mesh, and for an
 * unsubdivided USD mesh with no authored normals the renderer computes face
 * normals — the same flat shading glTF mandates. Both paths should therefore
 * agree without this.
 *
 * And it is expensive. Measured on the demo bay:
 *
 *     without           1,248 kB    4 archive entries
 *     with, naive       8,216 kB    6 archive entries
 *     with, cached      4,576 kB    4 archive entries
 *
 * Two compounding costs: `toNonIndexed()` triples the vertices, and `.usda` is
 * ASCII, so every float costs ~11 bytes instead of 4.
 *
 * The middle row is the trap. Converting per NODE gives the bay's two identical
 * ladders a geometry each, silently undoing the `dedup` the GLB export went to
 * the trouble of doing — 6 entries where there should be 4, and 3.6 MB of it.
 * The `converted` cache below keys on the SOURCE geometry so they stay shared.
 * Worth knowing that `GLTFLoader` already hands back one shared
 * `BufferGeometry` for a mesh several nodes point at; it was this function that
 * broke the sharing, not the loader.
 *
 * So it is a flag, not a default, and it is a flag rather than nothing because
 * only a real iPhone can settle it. If Quick Look turns out to render an
 * un-normaled mesh badly, `--normals` is the fix and the cost is known.
 *
 * FLAT, not smooth, and the order of the two calls is the point.
 * `computeVertexNormals()` on INDEXED geometry averages the faces meeting at
 * each vertex, which rounds off every hard edge — on pressed steel that turns a
 * 90-degree fold into a soft gradient. `toNonIndexed()` first gives every
 * triangle its own vertices, so each gets its own face normal and the folds
 * stay sharp.
 */
function addFlatNormals(scene) {
  const converted = new Map();
  let fixed = 0;

  scene.traverse((node) => {
    const geometry = node.geometry;
    if (!geometry || geometry.getAttribute('normal')) return;

    // Keyed on the SOURCE geometry, so a bay's two identical ladders still
    // share one mesh in the archive. Without this the unweld quietly undoes
    // the `dedup` that the GLB export went to the trouble of doing.
    let flat = converted.get(geometry.uuid);
    if (!flat) {
      flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      flat.computeVertexNormals();
      converted.set(geometry.uuid, flat);
    }
    node.geometry = flat;
    fixed += 1;
  });

  return fixed;
}

/**
 * Take the editor's scaffolding back out.
 *
 * `export-glb.mjs` already strips `md-snap`, `md-grid`, `col-` and `dim`, so a
 * GLB that came from there is clean. But this tool converts ANY GLB, and a raw
 * component file straight out of the pipeline is full of them — the first USDZ
 * this project ever produced had `mdsnapcarcasssideleft`, `colbody` and `dim`
 * prims in it, complete with their translucent debug materials, which is also
 * where the exporter's "USDZ does not support double sided materials" warnings
 * were coming from.
 *
 * The name test is IMPORTED from `export-glb.mjs` rather than restated. Three
 * separate times now this project has had the same list in two places and lost
 * something to it (§8 risk 3); a fourth would be nobody's fault but mine.
 *
 * The names have been through three.js by this point, which strips the
 * characters it reserves — `md-snap.x.y` arrives as `mdsnapxy` — so the test is
 * applied to both spellings.
 */
function stripScaffolding(scene) {
  const doomed = [];

  scene.traverse((node) => {
    const name = node.name || '';
    const restored = name.replace(/^mdsnap/, 'md-snap').replace(/^mdgrid/, 'md-grid');
    if (!isProduct(name) || !isProduct(restored)) doomed.push(node);
  });

  for (const node of doomed) node.parent?.remove(node);
  return doomed.length;
}

/**
 * One GLB, converted.
 *
 * `vertical` is not cosmetic and not a default: it is written into the USDZ as
 * the plane-anchoring alignment, and it is what tells Quick Look whether to
 * hunt for a floor or a wall. A shoe rack that screws to the wall and a bay
 * that stands on the floor are different products to an AR session, and
 * `arReadiness().placement.vertical` has known which is which since before
 * there was anything to export.
 */
export async function glbToUsdz(bytes, {
  vertical = false, quickLookCompatible = true, flatNormals = false,
} = {}) {
  const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');
  const scene = await sceneFromGlb(bytes);
  const stripped = stripScaffolding(scene);
  const normalsAdded = flatNormals ? addFlatNormals(scene) : 0;

  const exporter = new USDZExporter();
  const out = await exporter.parseAsync(scene, {
    ar: {
      anchoring: { type: 'plane' },
      planeAnchoring: { alignment: vertical ? 'vertical' : 'horizontal' },
    },
    includeAnchoringProperties: true,
    // Restricts the material output to what Quick Look actually renders rather
    // than to what USD permits. Off by default in three; on here, because the
    // only reason this file exists is Quick Look.
    quickLookCompatible,
  });

  return Object.assign(new Uint8Array(out), { normalsAdded, stripped });
}

/**
 * Is this a USDZ that Quick Look will open, or only a file with the extension?
 *
 * USDZ is a zip archive with three rules on top of the format, and Quick Look
 * enforces all three by displaying NOTHING rather than by complaining:
 *
 *   1. every entry is STORED, never deflated - the runtime memory-maps them
 *   2. every entry's DATA starts on a 64-byte boundary
 *   3. the first entry is the model file (.usd / .usda / .usdc)
 *
 * So "the exporter returned bytes" is not evidence that anything works. This
 * walks the local file headers and checks all three, which is a test that can
 * fail for a real reason - a three.js upgrade that changed the padding, say.
 */
export function verifyUsdz(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  const problems = [];
  let offset = 0;

  while (offset + 30 <= view.byteLength) {
    if (view.getUint32(offset, true) !== ZIP_LOCAL_HEADER) break;

    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataAt = offset + 30 + nameLength + extraLength;
    const name = new TextDecoder().decode(
      new Uint8Array(bytes.buffer, bytes.byteOffset + offset + 30, nameLength),
    );

    entries.push({ name, method, dataAt, size: compressedSize });

    if (method !== STORED) {
      problems.push(`${name} is compressed (method ${method}); USDZ requires stored.`);
    }
    if (dataAt % USDZ_ALIGNMENT !== 0) {
      problems.push(
        `${name} data starts at ${dataAt}, which is not a multiple of ${USDZ_ALIGNMENT}.`,
      );
    }

    offset = dataAt + compressedSize;
  }

  if (!entries.length) {
    problems.push('No zip entries at all - this is not an archive.');
  } else if (!/\.usd[ac]?$/.test(entries[0].name)) {
    problems.push(`First entry is "${entries[0].name}"; the model file must come first.`);
  }

  return { ok: problems.length === 0, entries, problems };
}

/**
 * One entry's text out of the archive.
 *
 * A USDZ from three is not one file: `model.usda` holds the scene graph, the
 * anchoring tokens and the materials, and each mesh lives in its own
 * `geometries/Geometry_N.usda` that the model file references. So "is
 * subdivision off?" and "where does this anchor?" are questions about
 * DIFFERENT files, which is worth knowing before writing an assertion — the
 * first test of it looked in `model.usda` and failed for that reason alone.
 *
 * With no `name`, returns the model file.
 */
export function usdaFrom(bytes, name = null) {
  const { entries } = verifyUsdz(bytes);
  const entry = name
    ? entries.find((e) => e.name === name)
    : entries.find((e) => /\.usda?$/.test(e.name));
  if (!entry) return null;
  return new TextDecoder().decode(
    new Uint8Array(bytes.buffer, bytes.byteOffset + entry.dataAt, entry.size),
  );
}

/** Every entry's text, joined - for asking a question of the whole archive. */
export function usdaAll(bytes) {
  return verifyUsdz(bytes).entries
    .map((e) => usdaFrom(bytes, e.name))
    .join('\n');
}

async function main(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };

  let glbPath = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
  let vertical = argv.includes('--vertical');

  // --demo builds the bay through the real chain rather than shipping a fixture:
  // configuration id -> resolve -> GLB -> USDZ, with no editor at any step.
  if (!glbPath && argv.includes('--demo')) {
    const { loadFolder, demoConfiguration, exportConfiguration } = await import('./export-glb.mjs');
    const folder = at('--folder') || 'youk';
    const { components } = loadFolder(folder);
    const id = demoConfiguration(components);
    glbPath = at('--glb') || 'demo.glb';
    const r = await exportConfiguration(id, folder, glbPath);
    vertical = vertical || r.ready.placement.vertical;
    console.log(`demo configuration ${r.resolved.digest} -> ${glbPath} `
      + `(${(r.bytes / 1024).toFixed(1)} kB)`);
  }

  if (!glbPath) {
    console.error('Give me a .glb, or --demo to build one.');
    return 1;
  }

  const outPath = at('--out') || glbPath.replace(/\.glb$/, '.usdz');

  try {
    const glb = new Uint8Array(readFileSync(glbPath));
    const usdz = await glbToUsdz(glb, { vertical, flatNormals: argv.includes('--normals') });
    writeFileSync(outPath, Buffer.from(usdz));

    const check = verifyUsdz(usdz);
    console.log(`\n  wrote   ${outPath}  ${(usdz.byteLength / 1024).toFixed(1)} kB `
      + `from ${(glb.byteLength / 1024).toFixed(1)} kB of GLB`);
    if (usdz.stripped) {
      console.log(`  stripped ${usdz.stripped} editor node`
        + `${usdz.stripped === 1 ? '' : 's'} (snap planes, collision proxies, dim)`);
    }
    console.log(usdz.normalsAdded
      ? `  flat normals added to ${usdz.normalsAdded} mesh`
        + `${usdz.normalsAdded === 1 ? '' : 'es'} the GLB did not carry`
      : '  no normals written - USD computes flat ones for an unsubdivided '
        + 'mesh (--normals to force them, at ~6x the size)');
    console.log(`  anchors on ${vertical ? 'a WALL (vertical)' : 'the FLOOR (horizontal)'}`);
    console.log(`  archive ${check.entries.length} entr${check.entries.length === 1 ? 'y' : 'ies'}: `
      + check.entries.map((e) => e.name).join(', '));
    console.log(`  ${check.ok ? 'valid USDZ - stored, aligned, model first'
      : 'NOT A VALID USDZ:'}`);
    for (const p of check.problems) console.log(`    ${p}`);
    return check.ok ? 0 : 1;
  } catch (err) {
    console.error(`\nrefused: ${err.message}`);
    return 1;
  }
}

// See the note in export-glb.mjs: `process.argv[1]` is undefined under
// `node -e`, and a Windows file URL is not `file://` plus a path.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry && import.meta.url === entry) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
