// One configuration, one folder somebody can send.
//
//   npm run youk:bundle -- --demo --out dist-bundle
//   npm run youk:bundle -- --id <configuration-id> --out ./for-kesseboehmer
//
// This is the deliverable half of the AR decision (§4.1a): the bundle is what
// gets handed to a client, dropped on their own server, and demonstrated on a
// laptop with the wifi off. The hosted route is a separate, smaller thing that
// only AR needs.
//
// WHAT COMES OUT:
//
//   index.html         the runtime, no editor in it at all
//   assets/*.js|css    vite's build, vendored — three.js included
//   models/*.glb       ONLY the parts this configuration references
//   ar/product.glb     the whole product as one file, for Scene Viewer
//   ar/product.usdz    the same product for AR Quick Look, because iOS reads
//                      nothing else
//   manifest.json      what the runtime reads to find the rest
//   catalogue.json     if there is one; its absence is not an error
//   Start Preview.bat  because a browser will not run ES modules off file://
//
// THE AR PAIR IS NOT THE SAME FILES AS models/. `models/` holds the PARTS, as
// the runtime needs them: separate, with their snap planes stripped but their
// identities intact, so the viewer can place them itself. `ar/` holds ONE
// product, merged, floored and de-duplicated (§5.19) — because neither Quick
// Look nor Scene Viewer will assemble anything, and both take exactly one file.
// Two representations of the same configuration, and the exporter writing both
// from the same id is what keeps them the same product.
//
// NO NETWORK DEPENDENCY. Not "probably none" — `tests/bundle.test.js` reads
// every file in the folder and fails on any absolute http(s) URL, and on any
// relative one that does not resolve to a file that was actually written.
// That test is copied from Studio along with the exporter, deliberately: the
// exporter is the easy half.
//
// ONLY WHAT IS REFERENCED. A bay needs four models out of eighty. Shipping the
// whole range would be a 20 MB folder instead of a 400 kB one, and the parts a
// customer cannot choose are the parts most likely to be commercially
// sensitive.

import {
  writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  buildManifest, partsNeededFor, MANIFEST_NAME, MODELS_DIR,
} from '../src/viewer/manifest.js';
import { AR_DIR, arBlock } from '../src/viewer/ar-link.js';
import { configurationDigest } from '../src/engine/configuration.js';
import { MOUNTING } from '../src/engine/ar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A browser will not load ES modules from a `file://` URL, so double-clicking
 * index.html shows a blank page and a console error about CORS — which reads
 * as "your deliverable is broken" rather than "this needs a web server".
 *
 * Copied from Studio's exporter, including the order it tries things in:
 * python first because it is on more machines than node, npx last because it
 * may want to download.
 */
function startPreviewBat() {
  return [
    '@echo off',
    'cd /d "%~dp0"',
    'echo Starting a local preview server...',
    'start "" http://localhost:8080/index.html',
    'where python >nul 2>nul && (python -m http.server 8080 & goto :eof)',
    'where py >nul 2>nul && (py -m http.server 8080 & goto :eof)',
    'where node >nul 2>nul && (npx --yes serve -l 8080 . & goto :eof)',
    'echo.',
    'echo Could not find Python or Node to serve this folder.',
    'echo Install either one, or upload this folder to any web host.',
    'pause',
  ].join('\r\n');
}

/**
 * Vite's build of the RUNTIME, on its own.
 *
 * `vite.viewer.config.js`, not the main config — the main one builds the app,
 * which imports the editor, which would then ship inside a client's folder. The
 * first bundle this project produced did exactly that; see the note in
 * `src/viewer/main.jsx`.
 *
 * The entry is `viewer.html` and it is renamed to `index.html` on the way out,
 * because a folder somebody double-clicks into should open at its index.
 */
export function buildRuntime({ quiet = true } = {}) {
  execFileSync('npx', ['vite', 'build', '--config', 'vite.viewer.config.js'], {
    cwd: ROOT,
    stdio: quiet ? 'ignore' : 'inherit',
    shell: process.platform === 'win32',
    // FORCED, not inherited. Vite only defaults NODE_ENV to production when
    // nothing has set it, and two things here do: this machine sets
    // NODE_ENV=production globally, and the test runner sets it to `test` so
    // that React ships its development build to @testing-library. Inheriting
    // the second one silently builds a client deliverable out of development
    // React — bigger, slower, and carrying the dev build's own URLs, which is
    // how `tests/bundle.test.js` caught it: the offline check went from clean
    // to 58 external URLs without a line of the exporter changing.
    //
    // A deliverable is a production build by definition, so it says so here
    // rather than depending on the shell it was started from.
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const dist = join(ROOT, 'dist-viewer');
  if (!existsSync(join(dist, 'viewer.html'))) {
    throw new Error('the viewer build produced no dist-viewer/viewer.html.');
  }
  return dist;
}

/** Every file under a folder, as paths relative to it. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(full.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}

/**
 * The two AR files, written into `folder/ar/`.
 *
 * Both come out of the same configuration id, through the same two tools the
 * command line already uses — `exportConfiguration` for the merged, floored,
 * de-duplicated GLB and `glbToUsdz` for the iOS copy. Nothing here re-decides
 * what a product is or where its floor goes; if it did, the AR file and the
 * on-screen product would be free to drift apart, which is the failure this
 * project has now hit three times.
 *
 * THE USDZ IS VERIFIED BEFORE IT SHIPS. `verifyUsdz` checks the zip-level rules
 * Quick Look enforces by showing nothing at all — every entry STORED rather
 * than deflated, each entry's data 64-byte aligned, the model file first — and
 * a bundle is precisely the situation where nobody will be watching when it
 * fails. An unverifiable USDZ is refused here rather than mailed to a client.
 *
 * NORMALS ARE WRITTEN INTO THE USDZ, and only there. The range has none (see
 * the long note in `export-glb.mjs`): glTF requires a viewer to compute flat
 * normals when NORMAL is absent, so the GLB is left alone, but three's USD
 * exporter simply omits them and warns. iOS is therefore the one consumer that
 * has to be handed what everyone else infers — and the cost is measured, on the
 * demo bay, not estimated:
 *
 *     flatNormals false   1,278,120 bytes
 *     flatNormals true    4,686,173 bytes
 *
 * 3.67x, for 3.4 MB. That is a real price for a file somebody emails, and it is
 * paid by DEFAULT because a product that renders wrong is worse than a product
 * that downloads slowly. It is a default rather than a rule because nobody has
 * yet held an iPhone next to it: if Quick Look turns out to shade an
 * un-normalled mesh correctly, `arNormals: false` takes 3.4 MB straight back
 * out, and that question is on the list for the five minutes with a real phone.
 */
export async function writeArAssets({
  configurationId, folder, models: modelsDir, title = null, arNormals = true,
}) {
  const { exportConfiguration } = await import('./export-glb.mjs');
  const { glbToUsdz, verifyUsdz } = await import('./export-usdz.mjs');

  mkdirSync(join(folder, AR_DIR), { recursive: true });
  const glbPath = join(folder, AR_DIR, 'product.glb');
  const usdzPath = join(folder, AR_DIR, 'product.usdz');

  const exported = await exportConfiguration(configurationId, modelsDir, glbPath);
  const vertical = exported.resolved.mounting === MOUNTING.WALL;

  const usdz = await glbToUsdz(readFileSync(glbPath), {
    vertical,
    quickLookCompatible: true,
    flatNormals: arNormals,
  });
  const check = verifyUsdz(usdz);
  if (!check.ok) {
    throw new Error(
      `the USDZ this bundle would ship is not one Quick Look will open: ${
        check.problems.join('; ')}.`,
    );
  }
  writeFileSync(usdzPath, Buffer.from(usdz));

  return {
    ar: arBlock({
      glb: 'product.glb',
      usdz: 'product.usdz',
      // The number that decides whether AR will be smooth, measured rather
      // than guessed, and written down so the person who RECEIVES the folder
      // can answer a question about it without re-exporting anything.
      triangles: exported.ready.triangles,
      vertical,
    }),
    title,
    // Reported separately as well as summed, because they are read by
    // different things: Scene Viewer downloads the GLB and has published
    // limits about it, Quick Look downloads the USDZ and has published none.
    glbBytes: statSync(glbPath).size,
    usdzBytes: statSync(usdzPath).size,
    bytes: statSync(glbPath).size + statSync(usdzPath).size,
    ready: exported.ready,
  };
}

/**
 * Write the bundle.
 *
 * `dist` is separate from `folder` so a test can build the runtime once and
 * export several configurations from it — a vite build is seconds, and paying
 * it per test would make the offline check something nobody runs.
 *
 * `ar` defaults to ON. A configurator whose whole pitch is "see it in your
 * room" should not need a flag to reach a room. On the demo bay it costs a few
 * seconds and 5.1 MB, of which 3.4 MB is the USDZ's normals — see
 * `writeArAssets` for both measurements and `--no-ar-normals` for the trade.
 * `--no-ar` exists for the case where the recipient only wants the page.
 */
export async function writeBundle({
  configurationId, folder, dist, models: modelsDir, title = null, generated = null,
  ar = true, arNormals = true,
}) {
  const needed = partsNeededFor(configurationId);

  const missing = needed.filter((id) => !existsSync(join(modelsDir, `${id}.glb`)));
  if (missing.length) {
    // Named, not skipped — the same rule `resolveConfiguration` follows. A
    // bundle short of a part is not a smaller bundle, it is a broken one.
    throw new Error(
      `This configuration needs ${missing.length} model`
      + `${missing.length === 1 ? '' : 's'} that are not in ${modelsDir}: `
      + `${missing.join(', ')}.`,
    );
  }

  rmSync(folder, { recursive: true, force: true });
  mkdirSync(join(folder, MODELS_DIR), { recursive: true });

  // The runtime, verbatim. Copied rather than rebuilt into the folder so that
  // what ships is exactly what `npm run build` produced and `npm test` ran
  // against.
  let bytes = 0;
  for (const rel of walk(dist)) {
    // `viewer.html` becomes `index.html`: a folder somebody opens should open
    // at its index, and every web server already knows that name.
    const dest = join(folder, rel === 'viewer.html' ? 'index.html' : rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(dist, rel), dest);
    bytes += statSync(dest).size;
  }

  for (const id of needed) {
    const file = `${id}.glb`;
    copyFileSync(join(modelsDir, file), join(folder, MODELS_DIR, file));
    bytes += statSync(join(folder, MODELS_DIR, file)).size;
  }

  // The catalogue is optional and its ABSENCE is meaningful: a bundle exported
  // before Kesseböhmer's prices arrive shows the bill of materials with no
  // total, which is what the quote module does everywhere else. Shipping an
  // invented price would be worse than shipping none.
  const cataloguePath = join(modelsDir, 'catalogue.json');
  const hasCatalogue = existsSync(cataloguePath);
  if (hasCatalogue) {
    copyFileSync(cataloguePath, join(folder, 'catalogue.json'));
    bytes += statSync(join(folder, 'catalogue.json')).size;
  }

  // The AR pair goes in BEFORE the manifest, because the manifest has to be
  // able to say honestly whether the files are there. A manifest written first
  // and patched afterwards would be a manifest that is briefly wrong, and the
  // runtime reads it as gospel.
  let arResult = null;
  if (ar) {
    arResult = await writeArAssets({
      configurationId, folder, models: modelsDir, title, arNormals,
    });
    bytes += arResult.bytes;
  }

  const manifest = buildManifest({
    configuration: configurationId,
    models: needed.map((id) => `${id}.glb`),
    catalogue: hasCatalogue ? 'catalogue.json' : null,
    title,
    generated,
    ar: arResult?.ar || null,
  });
  writeFileSync(join(folder, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(folder, 'Start Preview.bat'), startPreviewBat());

  return {
    folder, manifest, models: needed, bytes,
    ar: arResult?.ar || null,
    ready: arResult?.ready || null,
    arBytes: arResult ? { glb: arResult.glbBytes, usdz: arResult.usdzBytes } : null,
  };
}

async function main(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };

  const modelsDir = at('--models') || 'youk';
  let id = at('--id');

  if (!id && argv.includes('--demo')) {
    const { loadFolder, demoConfiguration } = await import('./export-glb.mjs');
    const { components } = loadFolder(modelsDir);
    id = demoConfiguration(components);
    console.log('demo configuration');
  }
  if (!id) {
    console.error('Give me --id <configuration-id>, or --demo for a bay on feet.');
    return 1;
  }

  const folder = at('--out') || `bundle-${configurationDigest(id)}`;

  try {
    console.log('building the runtime…');
    const dist = buildRuntime({ quiet: !argv.includes('--verbose') });

    const wantsAr = !argv.includes('--no-ar');
    if (wantsAr) console.log('exporting the AR pair…');

    const r = await writeBundle({
      configurationId: id, folder, dist, models: modelsDir, title: at('--title'), ar: wantsAr,
      arNormals: !argv.includes('--no-ar-normals'),
    });

    console.log(`\n  wrote   ${r.folder}  ${(r.bytes / 1024).toFixed(1)} kB`);
    console.log(`  models  ${r.models.length} of the ${
      readdirSync(modelsDir).filter((f) => f.endsWith('.glb') && !f.endsWith('.converted.glb')).length
    } available, because that is all this configuration references:`);
    for (const m of r.models) console.log(`            ${m}`);
    console.log(`  prices  ${r.manifest.catalogue ? 'catalogue.json included' : 'none on file'}`);
    if (r.ar) {
      console.log(`  AR      ${r.ar.triangles.toLocaleString()} triangles, ${
        r.ar.vertical ? 'wall' : 'floor'} placement`);
      // Named per platform rather than summed. A person deciding whether the
      // folder is too big to email needs to know that almost all of it is one
      // file, and which one.
      console.log(`            ar/product.glb   ${
        (r.arBytes.glb / 1024).toFixed(1)} kB  (Android, Scene Viewer)`);
      console.log(`            ar/product.usdz  ${
        (r.arBytes.usdz / 1024).toFixed(1)} kB  (iOS, Quick Look)`);
      // The budget is REPORTED even when it is exceeded, and the bundle is
      // still written. `arReadiness` knows the published Scene Viewer limits;
      // it does not know how much of them this particular phone will tolerate,
      // and refusing to export would be a guess dressed as a rule. The wall
      // warning is not a fault at all, which is why every warning prints and
      // none of them stops the export.
      for (const w of r.ready.warnings || []) console.log(`            note: ${w.message}`);
    } else {
      console.log('  AR      skipped (--no-ar)');
    }
    console.log('\n  Open "Start Preview.bat", or put the folder on any web server.');
    if (r.ar) {
      console.log('  AR needs the folder on a REAL host: a phone cannot open a');
      console.log('  laptop\'s localhost, and Scene Viewer fetches the model itself.');
    }
    return 0;
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
