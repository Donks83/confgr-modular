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
//   manifest.json      what the runtime reads to find the rest
//   catalogue.json     if there is one; its absence is not an error
//   Start Preview.bat  because a browser will not run ES modules off file://
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
  writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  buildManifest, partsNeededFor, MANIFEST_NAME, MODELS_DIR,
} from '../src/viewer/manifest.js';
import { configurationDigest } from '../src/engine/configuration.js';

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
 * Write the bundle.
 *
 * `dist` is separate from `folder` so a test can build the runtime once and
 * export several configurations from it — a vite build is seconds, and paying
 * it per test would make the offline check something nobody runs.
 */
export function writeBundle({
  configurationId, folder, dist, models: modelsDir, title = null, generated = null,
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

  const manifest = buildManifest({
    configuration: configurationId,
    models: needed.map((id) => `${id}.glb`),
    catalogue: hasCatalogue ? 'catalogue.json' : null,
    title,
    generated,
  });
  writeFileSync(join(folder, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(folder, 'Start Preview.bat'), startPreviewBat());

  return { folder, manifest, models: needed, bytes };
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

    const r = writeBundle({
      configurationId: id, folder, dist, models: modelsDir, title: at('--title'),
    });

    console.log(`\n  wrote   ${r.folder}  ${(r.bytes / 1024).toFixed(1)} kB`);
    console.log(`  models  ${r.models.length} of the ${
      readdirSync(modelsDir).filter((f) => f.endsWith('.glb') && !f.endsWith('.converted.glb')).length
    } available, because that is all this configuration references:`);
    for (const m of r.models) console.log(`            ${m}`);
    console.log(`  prices  ${r.manifest.catalogue ? 'catalogue.json included' : 'none on file'}`);
    console.log('\n  Open "Start Preview.bat", or put the folder on any web server.');
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
