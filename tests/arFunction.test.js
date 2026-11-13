// The AR route as it will run on Netlify, exercised here rather than there.
//
// A function you first test by deploying it is a function you debug through a
// log viewer, one two-minute upload at a time. Netlify's handler is an ordinary
// async function of a `Request` returning a `Response`, so nothing stops it
// being called directly - and everything it does that could break is in this
// file's reach: which format the URL asks for, where the models are, what a bad
// id does, and whether the bytes that come back are the right kind of file.
//
// The MODEL BUILD itself is not re-tested here. `exportConfiguration` and
// `glbToUsdz` have their own suites (§5.19, §5.20), and this is the plumbing
// around them.

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The SOURCE, not the bundle in netlify/functions - that one is generated at
// deploy time (with sharp aliased out) and is gitignored.
import handler, { config, findModels } from '../netlify/build/ar.src.mjs';

const MODELS = 'youk';
const has = existsSync(join(MODELS, 'guided.json')) && existsSync(MODELS);

// Deployed, the function finds the models inside the publish folder. Here there
// is no publish folder, and exporting a 9 MB bundle to run a test would make
// this the suite nobody runs - so it is pointed at the source models instead,
// through the same escape hatch `netlify dev` uses.
process.env.CONFGR_MODELS = MODELS;

// A three-bay product, so the thing being asked for is one no pre-baked file
// could have covered. Built the same way the page builds it.
let threeBay = null;
beforeAll(async () => {
  if (!has) return;
  const { parseGuided, defaultChoices, buildGuided } = await import('../src/engine/guided.js');
  const { loadFolder } = await import('../tools/export-glb.mjs');
  const { readFileSync } = await import('node:fs');
  const guided = parseGuided(JSON.parse(readFileSync(join(MODELS, 'guided.json'), 'utf8')));
  const { components } = loadFolder(MODELS);
  threeBay = buildGuided(guided, { ...defaultChoices(guided), bays: 3 }, components).configurationId;
});

const ask = (path, query = '') => new Request(`https://example.netlify.app${path}${query}`);

describe('which URLs it claims', () => {
  it('claims both AR files by their real paths, not a redirect', () => {
    // The format is read from the path, and a rewrite would leave the function
    // looking at the rewritten one. Claiming the routes keeps `request.url` the
    // URL the phone actually asked for.
    expect(config.path).toContain('/ar/build/product.glb');
    expect(config.path).toContain('/ar/build/product.usdz');
  });

  it('claims exactly the paths `arRouteUrl` builds', async () => {
    const { arRouteUrl, AR_ROUTE } = await import('../src/viewer/ar-link.js');
    for (const format of ['glb', 'usdz']) {
      const built = new URL(arRouteUrl(AR_ROUTE, {
        configurationId: 'x', format, pageHref: 'https://example.netlify.app/',
      }));
      // The two ends of the handoff agree about the path, which is the one
      // thing no test on either side alone can check.
      expect(config.path).toContain(built.pathname);
    }
  });
});

describe('finding the models', () => {
  it('looks inside the publish folder, where included_files puts them', () => {
    const override = process.env.CONFGR_MODELS;
    delete process.env.CONFGR_MODELS;
    const fake = join(tmpdir(), `confgr-find-${Date.now()}`);
    try {
      mkdirSync(join(fake, 'bundle-netlify', 'models'), { recursive: true });
      writeFileSync(join(fake, 'bundle-netlify', 'models', 'x.glb'), 'not a glb');
      expect(findModels(fake)).toBe(join(fake, 'bundle-netlify', 'models'));
    } finally {
      rmSync(fake, { recursive: true, force: true });
      process.env.CONFGR_MODELS = override;
    }
  });

  it('finds them beside the function, whatever folder the package was rooted at', () => {
    // 13 Nov 2026: deployed from D:Claudeconfgr-modular, Netlify's zip held
    // "Claude/confgr-modular/bundle-netlify/models" next to
    // "Claude/confgr-modular/netlify/functions/ar.mjs", and every AR request
    // answered 500 because no path the search tried existed.
    const override = process.env.CONFGR_MODELS;
    delete process.env.CONFGR_MODELS;
    const task = join(tmpdir(), `confgr-task-${Date.now()}`);
    const site = join(task, 'Claude', 'confgr-modular');
    try {
      mkdirSync(join(site, 'bundle-netlify', 'models'), { recursive: true });
      mkdirSync(join(site, 'netlify', 'functions'), { recursive: true });
      writeFileSync(join(site, 'bundle-netlify', 'models', 'x.glb'), 'not a glb');
      const found = findModels(task, task, join(site, 'netlify', 'functions'));
      expect(found).toBe(join(site, 'netlify', 'functions', '..', '..', 'bundle-netlify', 'models'));
      expect(existsSync(found)).toBe(true);
    } finally {
      rmSync(task, { recursive: true, force: true });
      process.env.CONFGR_MODELS = override;
    }
  });

  it('prefers an explicit answer over the search', () => {
    // The escape hatch itself, asserted rather than assumed: `netlify dev` and
    // this suite both rely on it, and a silent fallback to the wrong folder
    // would build the wrong product from parts that happened to be there.
    expect(findModels('/nowhere', null)).toBe(MODELS);
  });

  it('answers null rather than guessing when they are not there', () => {
    // Which is what turns a deployment fault into a sentence about the
    // deployment, instead of one about the customer's configuration.
    const override = process.env.CONFGR_MODELS;
    delete process.env.CONFGR_MODELS;
    try {
      expect(findModels(join(tmpdir(), `confgr-none-${Date.now()}`), null, null)).toBe(null);
    } finally {
      process.env.CONFGR_MODELS = override;
    }
  });
});

describe('answering', () => {
  it('refuses a request with no configuration', async () => {
    const res = await handler(ask('/ar/build/product.glb'));
    expect(res.status).toBe(400);
  });

  it('names a configuration it cannot read, rather than failing blankly', async () => {
    const res = await handler(ask('/ar/build/product.glb', '?c=nonsense'));
    expect(res.status).toBe(422);
    expect(await res.text()).toMatch(/cannot be turned into a model/);
  });

  it.runIf(has)('builds a GLB for a product no bundle was baked for', async () => {
    const res = await handler(ask('/ar/build/product.glb', `?c=${encodeURIComponent(threeBay)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // "glTF" as a magic number, so this is a real GLB rather than an error
    // page with a hopeful content type on it.
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('glTF');
  }, 60000);

  it.runIf(has)('builds a USDZ for the same product', async () => {
    const res = await handler(ask('/ar/build/product.usdz', `?c=${encodeURIComponent(threeBay)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/vnd.usdz+zip');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // "PK" - a USDZ is a zip, and Quick Look enforces the rest of its rules by
    // showing nothing at all.
    expect(String.fromCharCode(...bytes.slice(0, 2))).toBe('PK');
  }, 60000);

  it.runIf(has)('caches hard, because an id names one product for ever', async () => {
    const res = await handler(ask('/ar/build/product.glb', `?c=${encodeURIComponent(threeBay)}`));
    expect(res.headers.get('cache-control')).toMatch(/immutable/);
  }, 60000);
});
