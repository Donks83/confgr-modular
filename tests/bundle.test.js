// A deliverable is a promise about a folder, and this is what keeps it.
//
// Studio's lesson, copied along with the exporter rather than after it: the
// exporter is the easy half. What makes a bundle worth sending is the
// guarantee that it works with the wifi off, on somebody else's server, in a
// subdirectory nobody mentioned — and none of that is visible in a build that
// compiles clean.
//
// So this builds a REAL bundle with the real exporter and then reads every
// file in it. Four claims, three of which have already been false once:
//
//   1. NOTHING REACHES OUTSIDE. No absolute http(s) URL anywhere, and every
//      relative reference resolves to a file that was actually written.
//   2. THE EDITOR IS NOT IN IT. The first bundle this project produced had the
//      editor's own status line in the JavaScript, because App.jsx statically
//      imports Configurator.
//   3. ONLY WHAT IS REFERENCED SHIPS. A bay needs three models out of eighty.
//   4. THE AR PAIR IS REALLY THERE AND REALLY VALID. A USDZ that breaks the
//      zip rules shows NOTHING in Quick Look, with no error, so the only
//      moment it can be caught is before the folder is sent.
//
// It builds from `test-assets`, not `youk`, because the supplier geometry is
// gitignored and a test may not depend on it being present.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  readFileSync, existsSync, readdirSync, statSync, rmSync, mkdtempSync,
} from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildRuntime, writeBundle } from '../tools/export-bundle.mjs';
import {
  buildManifest, parseManifest, partsNeededFor, ManifestError, MANIFEST_VERSION, modelUrl,
} from '../src/viewer/manifest.js';
import { encodeConfiguration } from '../src/engine/configuration.js';
import { MOUNTING } from '../src/engine/ar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'test-assets');

/** A product made only of committed synthetic parts. */
const assembly = (componentId = 'unit-900') => ({
  instances: [{
    instanceId: 'a', componentId, selections: {},
    position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
  }],
  connections: [],
});

/** Every file in a folder, relative and slash-separated. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(full.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}

describe('partsNeededFor', () => {
  it('lists the parts a configuration actually names', () => {
    const id = encodeConfiguration(assembly(), { mounting: MOUNTING.FLOOR });
    expect(partsNeededFor(id)).toEqual(['unit-900']);
  });

  it('adds the foot when — and only when — the product stands on feet', () => {
    // The distinction that made the first version of this wrong. The palette
    // filters on `impliedComponentIds()`, which is every part the engine MAY
    // add; a bundle needs the ones this configuration actually implies. Using
    // the first list would put a foot in every deliverable and would make an
    // export fail wherever the foot's model is not present — which is here.
    const floor = encodeConfiguration(assembly(), { mounting: MOUNTING.FLOOR });
    const feet = encodeConfiguration(assembly(), { mounting: MOUNTING.FEET, footHeightMm: 100 });

    expect(partsNeededFor(floor)).not.toContain('237023-adjustable-foot-100mm');
    expect(partsNeededFor(feet)).toContain('237023-adjustable-foot-100mm');
  });

  it('is sorted, so two exports of one configuration produce identical manifests', () => {
    const id = encodeConfiguration({
      instances: [
        { instanceId: 'a', componentId: 'unit-900', selections: {}, position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true },
        { instanceId: 'b', componentId: 'unit-600', selections: {} },
      ],
      connections: [],
    }, { mounting: MOUNTING.FLOOR });
    expect(partsNeededFor(id)).toEqual(['unit-600', 'unit-900']);
  });

  it('names a part once even when the product uses it twice', () => {
    const id = encodeConfiguration({
      instances: [
        { instanceId: 'a', componentId: 'unit-900', selections: {}, position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true },
        { instanceId: 'b', componentId: 'unit-900', selections: {} },
      ],
      connections: [],
    }, { mounting: MOUNTING.FLOOR });
    expect(partsNeededFor(id)).toEqual(['unit-900']);
  });
});

describe('the manifest refuses what it cannot honestly read', () => {
  it('round-trips a manifest it wrote', () => {
    const m = buildManifest({ configuration: 'abc', models: ['a.glb'] });
    expect(parseManifest(m)).toBe(m);
    expect(m.version).toBe(MANIFEST_VERSION);
  });

  it('refuses a version it does not know, by name', () => {
    // Same discipline as the configuration id (§5.18). A bundle may be opened
    // years later, and "this needs a newer viewer" is a better failure than a
    // product with pieces missing.
    expect(() => parseManifest({ version: 99, configuration: 'x', models: ['a.glb'] }))
      .toThrow(/version 99/);
  });

  it('refuses a manifest naming no configuration', () => {
    expect(() => parseManifest({ version: MANIFEST_VERSION, models: ['a.glb'] }))
      .toThrow(ManifestError);
  });

  it('refuses a manifest listing no models', () => {
    expect(() => parseManifest({ version: MANIFEST_VERSION, configuration: 'x', models: [] }))
      .toThrow(/no models/);
  });

  it('will not build a manifest with nothing in it', () => {
    expect(() => buildManifest({ configuration: 'x', models: [] })).toThrow(ManifestError);
    expect(() => buildManifest({ configuration: '', models: ['a.glb'] })).toThrow(ManifestError);
  });

  it('builds a model url that works from a subdirectory', () => {
    expect(modelUrl('http://host/somewhere/', 'a.glb')).toBe('http://host/somewhere/models/a.glb');
  });
});

describe('a real exported bundle', () => {
  let folder;
  let files;
  let configurationId;
  let result;

  beforeAll(async () => {
    configurationId = encodeConfiguration(assembly(), { mounting: MOUNTING.FLOOR });
    folder = mkdtempSync(join(tmpdir(), 'confgr-bundle-'));
    result = await writeBundle({
      configurationId,
      folder,
      dist: buildRuntime(),
      models: ASSETS,
      title: 'A test product',
      // Fixed, so the manifest is byte-stable across runs.
      generated: '2026-09-06T00:00:00.000Z',
      // The default, stated. This is the bundle a client receives, and AR is
      // in it, so the offline and only-what-is-referenced claims are being
      // made about the folder that actually goes out.
      ar: true,
    });
    files = walk(folder);
  }, 180_000);

  it('opens at index.html', () => {
    // `viewer.html` is the vite entry; a folder somebody double-clicks into has
    // to open at the name every web server already knows.
    expect(files).toContain('index.html');
    expect(files).not.toContain('viewer.html');
  });

  it('ships the runtime, the models, the manifest and a way to preview it', () => {
    expect(files).toContain('manifest.json');
    expect(files).toContain('Start Preview.bat');
    expect(files.some((f) => f.startsWith('models/') && f.endsWith('.glb'))).toBe(true);
    expect(files.some((f) => f.endsWith('.js'))).toBe(true);
  });

  it('ships ONLY the models the configuration references', () => {
    const shipped = files.filter((f) => f.startsWith('models/'));
    const available = readdirSync(ASSETS).filter((f) => f.endsWith('.glb'));
    expect(shipped).toEqual(['models/unit-900.glb']);
    // The point of the manifest, in one assertion: a bundle is not the range.
    expect(available.length).toBeGreaterThan(shipped.length * 5);
  });

  it('does not contain the editor', () => {
    // THE ONE THAT CAUGHT A REAL BUG. `App.jsx` statically imports
    // `Configurator`, so building the app puts the whole authoring tool — the
    // palette, the attach flows, the drag handling, the harness globals — into
    // a client's folder. The runtime now has its own entry and its own vite
    // config, and nothing reachable from it can reach `src/spike`.
    const scripts = files.filter((f) => extname(f) === '.js');
    expect(scripts.length).toBeGreaterThan(0);
    for (const file of scripts) {
      const text = readFileSync(join(folder, file), 'utf8');
      expect(text).not.toContain('Click a marker to add a part');
      expect(text).not.toContain('cfg-palette');
      expect(text).not.toContain('__cfgDragToMarker');
    }
  });

  it('names in its manifest exactly the files it wrote', () => {
    const manifest = parseManifest(JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')));
    expect(manifest.configuration).toBe(configurationId);
    expect(manifest.title).toBe('A test product');
    for (const model of manifest.models) {
      expect(existsSync(join(folder, 'models', model))).toBe(true);
    }
    if (manifest.catalogue) expect(existsSync(join(folder, manifest.catalogue))).toBe(true);
  });

  it('says there are no prices rather than inventing any', () => {
    // `test-assets` has no catalogue.json, and its absence has to travel as a
    // fact rather than as a missing file the runtime trips over.
    const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
    expect(manifest.catalogue).toBeNull();
    expect(files).not.toContain('catalogue.json');
  });

  // ------------------------------------------------------ the offline guarantee

  const TEXT = new Set(['.html', '.js', '.css', '.json', '.bat', '.map']);
  const textFiles = () => files.filter((f) => TEXT.has(extname(f)));

  it('asks for nothing outside the folder', () => {
    // THE GUARANTEE, and the reason this test exists at all. One CDN font, one
    // analytics beacon, one absolute asset path, and the deliverable stops
    // being offline — silently, on the one machine that matters, in front of
    // the client.
    //
    // Verified once by hand, in a real browser, against a real static server:
    // the bundle's whole network log was manifest.json, three .glb files and
    // catalogue.json, all local, with no console errors. This test is what
    // keeps that true without opening a browser every time.
    //
    // WHY AN ALLOWLIST RATHER THAN A LOOSER PATTERN. Every entry below is a
    // string that a browser never dereferences, and each one is named
    // individually on purpose: a rule like "documentation links are fine"
    // would wave through a genuine CDN reference that happened to look like
    // one. Anything NEW fails, and a person has to say why it is safe.
    const NEVER_FETCHED = [
      // XML namespace URIs. Identifiers by specification — `createElementNS`
      // compares them as strings and never requests them. React and three.js
      // both carry the full set for SVG and MathML.
      'http://www.w3.org/1999/xhtml',
      'http://www.w3.org/2000/svg',
      'http://www.w3.org/1998/Math/MathML',
      'http://www.w3.org/1999/xlink',
      'http://www.w3.org/XML/1998/namespace',
      // React's minified-error explainer, concatenated into a thrown Error's
      // message. Printed for a developer to paste, never fetched by the page.
      'https://reactjs.org/docs/error-decoder.html',
      // A paper citation that survives minification inside three.js.
      'https://jcgt.org/published/0007/04/01/',
      // The preview server the .bat starts, which is this folder.
      'http://localhost',
      'http://127.0.0.1',
    ];

    const offenders = [];
    const seen = new Set();
    for (const file of textFiles()) {
      const text = readFileSync(join(folder, file), 'utf8');
      for (const match of text.matchAll(/https?:\/\/[^\s"'`)\\]+/g)) {
        const url = match[0];
        const allowed = NEVER_FETCHED.find((prefix) => url.startsWith(prefix));
        if (allowed) { seen.add(allowed); continue; }
        offenders.push(`${file}: ${url}`);
      }
    }

    expect(offenders).toEqual([]);

    // And the allowlist has to stay honest in the other direction too: an entry
    // nobody hits any more is a licence sitting there for the next thing that
    // happens to match it.
    const stale = NEVER_FETCHED.filter((u) => !seen.has(u) && !u.includes('local') && !u.includes('127.'));
    expect(stale).toEqual([]);
  });

  it('references only files it actually wrote', () => {
    // The other half of offline: a relative URL that resolves to nothing is a
    // 404 on the client's server, which looks identical to a network problem
    // and gets blamed on their IT.
    const html = readFileSync(join(folder, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('/')).toBe(false); // absolute path breaks in a subfolder
      const rel = ref.replace(/^\.\//, '').split('?')[0];
      expect(existsSync(join(folder, rel))).toBe(true);
    }
  });

  it('is small enough to send someone', () => {
    // Not a style point. This folder goes in an email or on a phone over
    // cellular, and the whole reason only-what-is-referenced exists is that
    // shipping the range would make it twenty times this.
    const total = files.reduce((sum, f) => sum + statSync(join(folder, f)).size, 0);
    expect(total).toBeLessThan(4 * 1024 * 1024);
  });

  it('refuses to write a bundle whose models are missing, rather than a broken one', async () => {
    const id = encodeConfiguration(assembly('a-part-that-does-not-exist'), {
      mounting: MOUNTING.FLOOR,
    });
    const doomed = mkdtempSync(join(tmpdir(), 'confgr-bundle-bad-'));
    try {
      await expect(writeBundle({
        configurationId: id, folder: doomed, dist: join(ROOT, 'dist-viewer'), models: ASSETS,
      })).rejects.toThrow(/a-part-that-does-not-exist/);
    } finally {
      rmSync(doomed, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------- the AR pair

  it('ships one merged product for each phone platform', () => {
    expect(files).toContain('ar/product.glb');
    expect(files).toContain('ar/product.usdz');
    // ONE file each, not the parts again. Neither AR viewer will assemble
    // anything, so a folder of components would be a folder of components.
    expect(files.filter((f) => f.startsWith('ar/')).length).toBe(2);
  });

  it('says so in the manifest, with the number that decides whether AR is smooth', () => {
    const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
    expect(manifest.ar).toEqual({
      glb: 'product.glb',
      usdz: 'product.usdz',
      triangles: expect.any(Number),
      vertical: false,
    });
    expect(manifest.ar.triangles).toBeGreaterThan(0);
    // The manifest's figure is the exporter's own measurement, not a second
    // count taken somewhere else — which is the mistake the app's AR budget
    // made for weeks (§5.19), reading 19,010 for a product with 34,106.
    expect(manifest.ar.triangles).toBe(result.ready.triangles);
  });

  it('ships a USDZ that Quick Look will actually open', async () => {
    // The one check that cannot be made by looking. Quick Look enforces the
    // zip rules by displaying nothing at all, so a broken USDZ and a missing
    // one are indistinguishable on the phone.
    const { verifyUsdz } = await import('../tools/export-usdz.mjs');
    const check = verifyUsdz(new Uint8Array(readFileSync(join(folder, 'ar/product.usdz'))));
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.entries[0].name).toMatch(/\.usd[ac]?$/);
  });

  it('leaves the AR pair out when asked, and says nothing untrue in the manifest', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'confgr-bundle-noar-'));
    try {
      const r = await writeBundle({
        configurationId, folder: plain, dist: join(ROOT, 'dist-viewer'), models: ASSETS, ar: false,
      });
      expect(r.ar).toBe(null);
      expect(walk(plain).some((f) => f.startsWith('ar/'))).toBe(false);
      // Null rather than absent or an empty object: `arAvailability` reads this
      // and a bundle without AR must say so, so that the viewer explains
      // itself instead of offering a link to a file nobody wrote.
      expect(JSON.parse(readFileSync(join(plain, 'manifest.json'), 'utf8')).ar).toBe(null);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  }, 120_000);
});
