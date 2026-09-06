// USDZ is a zip with rules, and Quick Look enforces them by showing nothing.
//
// "The exporter returned some bytes" is not evidence that an iPhone will open
// the file. USDZ adds three constraints on top of the zip format and breaking
// any of them produces a file that looks fine to every tool except the one that
// matters:
//
//   1. every entry STORED, never deflated
//   2. every entry's DATA on a 64-byte boundary
//   3. the model file first in the archive
//
// `verifyUsdz` reads the local file headers and checks all three, so these
// tests can fail for a real reason — a three.js upgrade that changes the
// padding would be caught here rather than on somebody's phone.
//
// The conversion tests are slower than the rest of the suite because they load
// three.js and a real GLB. They earn it: this is the only path in the project
// that leaves the engine's world entirely.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  glbToUsdz, verifyUsdz, usdaFrom, usdaAll, USDZ_ALIGNMENT,
} from '../tools/export-usdz.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets');

// A committed synthetic asset, so this does not depend on the gitignored
// supplier geometry being present. It carries its own normals, which makes it
// the right part to prove the no-normals path is a CHOICE rather than a
// limitation.
const SOURCE = 'unit-900.glb';

describe('verifyUsdz', () => {
  it('rejects something that is not an archive at all', () => {
    const check = verifyUsdz(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/not an archive/);
  });

  it('rejects an empty buffer rather than calling it valid', () => {
    expect(verifyUsdz(new Uint8Array(0)).ok).toBe(false);
  });
});

describe('glbToUsdz', () => {
  let usdz;

  beforeAll(async () => {
    usdz = await glbToUsdz(new Uint8Array(readFileSync(join(ASSETS, SOURCE))));
  }, 60_000);

  it('produces an archive Quick Look will accept', () => {
    const check = verifyUsdz(usdz);
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('puts the model file first', () => {
    expect(verifyUsdz(usdz).entries[0].name).toMatch(/\.usda?$/);
  });

  it('stores every entry rather than deflating it', () => {
    for (const entry of verifyUsdz(usdz).entries) {
      expect(entry.method).toBe(0);
    }
  });

  it('aligns every entry to 64 bytes', () => {
    for (const entry of verifyUsdz(usdz).entries) {
      expect(entry.dataAt % USDZ_ALIGNMENT).toBe(0);
    }
  });

  it('writes real USD, not an empty shell', () => {
    const usda = usdaFrom(usdz);
    expect(usda).toMatch(/#usda 1\.0/);
    expect(usda).toMatch(/def Xform "Root"/);
    // metersPerUnit is the one that would silently ruin everything: the whole
    // project works in metres, and a product that arrives 100x too big is a
    // more embarrassing failure than one that does not arrive.
    expect(usda).toMatch(/metersPerUnit = 1/);
  });

  it('tells every mesh not to subdivide', () => {
    // Without this, USD's default is Catmull-Clark and a pressed-steel shelf
    // arrives with every fold rounded off. It is also the reason omitting
    // normals is safe - see the note in export-usdz.mjs.
    //
    // It lives in the GEOMETRY files, not model.usda - the first version of
    // this test looked in the wrong one and failed for that reason alone.
    for (const entry of verifyUsdz(usdz).entries) {
      if (!entry.name.startsWith('geometries/')) continue;
      expect(usdaFrom(usdz, entry.name)).toMatch(/subdivisionScheme = "none"/);
    }
  });

  it('leaves no editor scaffolding in the archive', () => {
    // THE ONE THAT CAUGHT A REAL BUG. `unit-900.glb` is a raw component file,
    // so it carries snap planes, a col- proxy and a dim cube - and the first
    // USDZ this project ever produced had all of them in it, translucent debug
    // materials and all. `export-glb.mjs` strips them; this tool has to as
    // well, because it will convert any GLB it is handed, not only one that
    // came from there.
    //
    // Matched against the SANITISED spellings, because three.js has already
    // removed the dots by the time these names reach USD.
    const everything = usdaAll(usdz);
    expect(everything).not.toMatch(/mdsnap/i);
    expect(everything).not.toMatch(/mdgrid/i);
    expect(everything).not.toMatch(/col-/);
    expect(everything).not.toMatch(/def Xform "dim"/);
  });

  it('still contains the product itself', () => {
    // The other half of the test above: stripping that took the body with it
    // would pass every assertion in it and ship an empty room.
    expect(usdaFrom(usdz)).toMatch(/def Xform "body"/);
    expect(verifyUsdz(usdz).entries.length).toBeGreaterThan(1);
  });
});

describe('anchoring follows the product, not a default', () => {
  // The one option in the conversion that is a decision rather than plumbing.
  // A shoe rack screws to a wall and a bay stands on the floor; Quick Look
  // hunts for a different surface for each, and gets it from these tokens.
  let bytes;

  beforeAll(() => {
    bytes = new Uint8Array(readFileSync(join(ASSETS, SOURCE)));
  });

  it('anchors a floor-standing product horizontally', async () => {
    const usda = usdaFrom(await glbToUsdz(bytes, { vertical: false }));
    expect(usda).toMatch(/planeAnchoring:alignment = "horizontal"/);
  }, 60_000);

  it('anchors a wall-fixed product vertically', async () => {
    const usda = usdaFrom(await glbToUsdz(bytes, { vertical: true }));
    expect(usda).toMatch(/planeAnchoring:alignment = "vertical"/);
  }, 60_000);
});

describe('flat normals are opt-in, and cost what the comment says', () => {
  // The measurement that decided the default. If a three.js change ever makes
  // the two the same size, the reasoning in export-usdz.mjs stops applying and
  // somebody should know.
  it('adds nothing to a model that already has normals', async () => {
    const bytes = new Uint8Array(readFileSync(join(ASSETS, SOURCE)));
    const withFlag = await glbToUsdz(bytes, { flatNormals: true });
    expect(withFlag.normalsAdded).toBe(0);
    expect(verifyUsdz(withFlag).ok).toBe(true);
  }, 60_000);
});
