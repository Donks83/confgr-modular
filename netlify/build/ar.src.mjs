// The AR route, as a Netlify function.
//
// Same job as `tools/serve-ar.mjs` and deliberately the same two calls:
// `exportConfiguration` turns a configuration id into a GLB, `glbToUsdz` turns
// that into a Quick Look-valid USDZ. Nothing about the product is decided here.
// This file is plumbing, and the measure of it is how little it knows.
//
// WHY A FUNCTION AT ALL. A quick tunnel died three times in four days, always
// with a different name, so it cannot be the link in an email. A static host
// would fix the address and lose the point: AR would go back to covering only
// the product the bundle opens on, because building a model for an arbitrary
// configuration needs something that can run code. This is the smallest thing
// that can.
//
// WHY NETLIFY. Cloudflare Pages is the better static host and cannot run this:
// its free functions get 10 ms of CPU per request and the model build takes
// about 120 ms of real work. Vercel's free tier forbids commercial use in
// terms, and this is PWS work. Netlify's free plan says commercial projects are
// fine, gives 125,000 invocations a month, and allows 10 seconds per call
// against the ~250 ms this needs.
//
// WHAT IS WORSE HERE THAN ON THE LAPTOP, said plainly: the disk cache lives in
// /tmp, which belongs to one function instance and evaporates. A configuration
// built once is NOT built once for ever any more, just usually. At demo volumes
// that is a few hundred milliseconds occasionally, and the alternative is a
// storage bucket and an account that costs money.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { AR_ROUTE, AR_ROUTE_FILES } from '../../src/viewer/ar-link.js';

const cacheDir = join(tmpdir(), 'confgr-ar-cache');

/**
 * The folder the bundle is exported into, and therefore the folder the models
 * arrive in. Kept in step with netlify.toml by hand, which is two places for
 * one fact - so `findModels` looks in several rather than trusting this one.
 */
const PUBLISH = 'bundle-netlify';

/**
 * The two URLs this function answers on, claimed directly rather than through a
 * redirect.
 *
 * A redirect would work and would cost the thing this depends on: after a
 * rewrite the function can see the REWRITTEN path, and the format is read from
 * the path. Claiming the routes means `request.url` is the URL the phone asked
 * for, which is the same URL `arRouteUrl` built, which is the point.
 *
 * LITERAL STRINGS, and they have to be. The obvious version of this built the
 * paths from AR_ROUTE and AR_ROUTE_FILES so there was one source of truth - and
 * Netlify's bundler READS this config statically, without running the module,
 * so an imported constant is not a value it can see. It refused the deploy
 * with "Must be a string or array of strings", which is a fault no local test
 * could have caught: in Node the template literals evaluate perfectly.
 *
 * So the paths are spelled out here and `tests/arFunction.test.js` asserts they
 * are exactly what `arRouteUrl` builds. The duplication is real; the test is
 * what stops it drifting.
 */
export const config = {
  path: ['/ar/build/product.glb', '/ar/build/product.usdz'],
};

/**
 * SHA-256 of the whole id, for the reason written up in serve-ar.mjs: a
 * one-bay and a two-bay configuration id are byte-identical for their first 505
 * characters, so any key built from a prefix serves one product's model for the
 * other. The wrong shelving in somebody's room, with nothing looking wrong.
 */
const cacheKey = (id) => createHash('sha256').update(id).digest('hex');

/**
 * Where the part models ended up in the deployed function.
 *
 * Netlify copies `included_files` relative to the site's base directory, and
 * which directory a function runs in has moved between their versions. Rather
 * than encode one answer, this tries the handful of places it can be. A models
 * folder that is not found is a DEPLOYMENT fault, and without this it would
 * report itself as "that configuration cannot be turned into a model", which
 * would send somebody looking at the engine.
 */
/** This file's own folder, deployed: <prefix>/netlify/functions. */
const HERE = (() => { try { return dirname(fileURLToPath(import.meta.url)); } catch { return null; } })();

export function findModels(cwd = process.cwd(), root = process.env.LAMBDA_TASK_ROOT, here = HERE) {
  const candidates = [
    // An explicit answer wins, and it is what makes this testable without
    // exporting a bundle first - `netlify dev` and the test suite both point it
    // at `youk`. Deployed, it is unset and the search below applies.
    process.env.CONFGR_MODELS || null,
    // Where `included_files` puts them: the path is kept relative to the site
    // root, so the publish folder's name survives into the function.
    join(cwd, PUBLISH, 'models'),
    root ? join(root, PUBLISH, 'models') : null,
    join(cwd, 'models'),
    root ? join(root, 'models') : null,
    // BESIDE THIS FILE, whatever folder the package was rooted at. Deployed from
    // D:Claudeconfgr-modular (13 Nov 2026) the zip held
    // "Claude/confgr-modular/bundle-netlify/models/..." next to
    // "Claude/confgr-modular/netlify/functions/ar.mjs" - rooted at the DRIVE -
    // so none of the paths above existed and every AR request answered 500.
    // Two folders up from the function is the site root in every layout.
    here ? join(here, '..', '..', PUBLISH, 'models') : null,
  ];
  for (const dir of candidates) {
    if (dir && existsSync(dir)) return dir;
  }
  return null;
}

async function arFile(id, format, models) {
  await mkdir(cacheDir, { recursive: true });
  const safe = cacheKey(id);
  const glbPath = join(cacheDir, `${safe}.glb`);
  const usdzPath = join(cacheDir, `${safe}.usdz`);
  const wanted = format === 'usdz' ? usdzPath : glbPath;

  if (existsSync(wanted)) return { path: wanted, cached: true };

  const { exportConfiguration } = await import('../../tools/export-glb.mjs');
  if (!existsSync(glbPath)) await exportConfiguration(id, models, glbPath);
  if (format !== 'usdz') return { path: glbPath, cached: false };

  const { glbToUsdz } = await import('../../tools/export-usdz.mjs');
  const usdz = await glbToUsdz(await readFile(glbPath), { flatNormals: false });
  await writeFile(usdzPath, Buffer.from(usdz.bytes ?? usdz));
  return { path: usdzPath, cached: false };
}

const TYPES = { glb: 'model/gltf-binary', usdz: 'model/vnd.usdz+zip' };

export default async function handler(request) {
  const url = new URL(request.url);
  const format = url.pathname.endsWith(AR_ROUTE_FILES.usdz) ? 'usdz' : 'glb';
  const id = url.searchParams.get('c');

  if (!id) {
    return new Response('Ask for product.glb?c=<configuration id>', {
      status: 400, headers: { 'content-type': 'text/plain' },
    });
  }

  const models = findModels();
  if (!models) {
    return new Response(
      'This deployment has no part models, so no model can be built. '
      + 'Check included_files in netlify.toml.',
      { status: 500, headers: { 'content-type': 'text/plain' } },
    );
  }

  try {
    const started = Date.now();
    const { path, cached } = await arFile(id, format, models);
    const data = await readFile(path);
    console.log(`ar ${format} ${cached ? 'cached' : `built in ${Date.now() - started}ms`}`
      + ` ${(data.length / 1024).toFixed(1)} kB`);
    return new Response(data, {
      headers: {
        'content-type': TYPES[format],
        // THE LENGTH, stated. Without it Netlify streamed the file chunked, with
        // no size at all - and on Matt's Android, Scene Viewer opened and closed
        // again at once (13 Nov 2026). The laptop server it worked from,
        // tools/serve-ar.mjs, always sent one.
        'content-length': String(data.length),
        // Scene Viewer and Quick Look fetch the file themselves; nothing here is
        // private, so any origin may.
        'access-control-allow-origin': '*',
        // A configuration id names one product for ever, so this is cached hard
        // by the phone AND by Netlify's own edge - which gets back most of what
        // the ephemeral /tmp cache gives up.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error(`ar failed: ${err.message}`);
    return new Response(`That configuration cannot be turned into a model: ${err.message}`, {
      status: 422, headers: { 'content-type': 'text/plain' },
    });
  }
}
