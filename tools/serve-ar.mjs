// A static host for a bundle, plus the one route that makes AR mean anything.
//
//   node tools/serve-ar.mjs <bundle folder> [port] [--models <folder>]
//
// The route is `ar/build/product.glb?c=<id>` and `…/product.usdz?c=<id>`,
// spelled by `AR_ROUTE` in ar-link.js rather than here - the runtime builds
// those URLs from the manifest's `ar.route`, so the two ends cannot disagree
// about the path. The extension is in the PATH and the configuration is in the
// QUERY because Quick Look reads the path.
//
// WHY THIS EXISTS. Matt, three times in one session: "so i can't configure a
// product and view it in my room?" No - not until now. A bundle carries ONE
// pre-baked AR pair, of the product it opens on, so the moment a customer adds
// a bay the handoff is withheld with a sentence. For a configurator that is
// close to useless, and saying "reset the options" is not an answer.
//
// The chain to fix it already existed and had never been put behind a URL:
// §5.18 made a configuration a VALUE, §5.19 turned that value into a GLB with
// no editor running, §5.20 turned the GLB into a Quick Look-valid USDZ. This is
// forty lines of plumbing on top of three sessions of work - a `.glb` request
// calls `exportConfiguration`, a `.usdz` one pipes it through `glbToUsdz`, and
// both come back with the content type the platform expects.
//
// CACHED BY ID, on disk, because a configuration id IS the cache key: the same
// id always describes the same product, so a file once generated never needs
// generating again. That is a property of the id rather than a trick, and it is
// the reason this can be a free endpoint on a laptop rather than something that
// needs a queue.
//
// NOT A PRODUCTION SERVER. No range requests, no compression, no limits on how
// much work one caller can ask for. It is for a phone on a tunnel and for
// whatever host this later moves to, where the same two functions get wrapped
// in that platform's handler instead.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { AR_ROUTE, AR_ROUTE_FILES } from '../src/viewer/ar-link.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  // The registered type. Quick Look is handed the file by WebKit and goes by
  // the extension, but serving it as octet-stream is one more thing that can go
  // wrong on a device test.
  '.usdz': 'model/vnd.usdz+zip',
  '.png': 'image/png',
  '.bat': 'text/plain; charset=utf-8',
};

/** Where generated files live between requests. */
const cacheDir = join(tmpdir(), 'confgr-ar-cache');

/**
 * The cache file name for one configuration id.
 *
 * SHA-256, and this is the second attempt. The first took the id's own base64
 * and truncated it to 120 characters to stay inside a file name limit - and
 * the ids of a ONE-bay and a TWO-bay product are byte-identical for their
 * first 505 characters, because the id lists the components before it lists
 * the instances. So the two products shared a cache file, and the second one
 * asked for would have been served the first one's model: the wrong product in
 * somebody's room, with nothing about it looking wrong. Measured, not
 * imagined - the two ids from `defaultChoices` and `{...,bays:2}`.
 *
 * `configurationDigest` is NOT used here even though it exists. It is FNV-1a
 * in 32 bits, and its own comment says it is a label rather than a security
 * boundary: eight hex characters is a coin-flip collision at about 77,000
 * products, and a collision here means the same silent wrong answer. A label
 * on a quote header and a key that decides which model a phone downloads are
 * different jobs.
 */
export const cacheKey = (id) => createHash('sha256').update(id).digest('hex');

/**
 * One configuration id, one AR file.
 *
 * The GLB is generated first in every case, because the USDZ is made FROM it -
 * so asking for the USDZ warms the GLB too, and a phone that asks for both
 * (iOS asks for one, Android the other, and a QR shared between them asks for
 * each) pays the cost once.
 */
async function arFile(id, format, models) {
  await mkdir(cacheDir, { recursive: true });
  const safe = cacheKey(id);
  const glbPath = join(cacheDir, `${safe}.glb`);
  const usdzPath = join(cacheDir, `${safe}.usdz`);
  const wanted = format === 'usdz' ? usdzPath : glbPath;

  if (existsSync(wanted)) return { path: wanted, cached: true };

  const { exportConfiguration } = await import('./export-glb.mjs');
  if (!existsSync(glbPath)) {
    // Floor-rebased, centred in plan, snap planes stripped - every decision
    // §5.19 documented, and none of them repeated here.
    await exportConfiguration(id, models, glbPath);
  }
  if (format !== 'usdz') return { path: glbPath, cached: false };

  const { glbToUsdz } = await import('./export-usdz.mjs');
  const glb = await readFile(glbPath);
  // `flatNormals` is the open question from §5.23 - whether Quick Look wants
  // authored normals - and it is left OFF here. It triples the file (1.3 MB to
  // 4.6 MB on the demo bay) and nobody has yet looked at a phone to find out
  // whether it is needed. A 1.3 MB file that might shade oddly beats a 4.6 MB
  // one over a tunnel, and the answer is one device test away.
  const usdz = await glbToUsdz(glb, { flatNormals: false });
  await writeFile(usdzPath, Buffer.from(usdz.bytes ?? usdz));
  return { path: usdzPath, cached: false };
}

/**
 * Is this request for the build route, and if so in which format?
 *
 * Matched against the END of the path rather than against `/${AR_ROUTE}/…`,
 * because the manifest's route is RELATIVE - a bundle served from a
 * subdirectory asks for `/quotes/47/ar/build/product.glb`, and refusing that
 * would make the route work only at a host's root.
 */
export function routeRequest(path, route = AR_ROUTE) {
  for (const [format, file] of Object.entries(AR_ROUTE_FILES)) {
    const tail = `/${route.replace(/^\/+|\/+$/g, '')}/${file}`;
    if (path === tail || path.endsWith(tail)) return format;
  }
  return null;
}

export function createArServer({ bundle, models, route = AR_ROUTE }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);

    const format = routeRequest(path, route);
    if (format) {
      const id = url.searchParams.get('c');
      if (!id) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(`Ask for ${route}/product.glb?c=<configuration id>`);
        return;
      }
      try {
        const started = Date.now();
        const { path: file, cached } = await arFile(id, format, models);
        const data = await readFile(file);
        res.writeHead(200, {
          'content-type': TYPES[`.${format}`],
          // A configuration id names one product for ever, so this really can
          // be cached hard - by the phone, and by anything in front of it.
          'cache-control': 'public, max-age=31536000, immutable',
          'content-length': data.length,
        });
        res.end(data);
        console.log(`ar ${format} ${cached ? 'cached' : `built in ${Date.now() - started}ms`}`
          + ` ${(data.length / 1024).toFixed(1)} kB`);
      } catch (err) {
        // NAMED, not swallowed. The likely failure is a configuration naming a
        // part this folder does not have, and that is worth reading.
        res.writeHead(422, { 'content-type': 'text/plain' });
        res.end(`That configuration cannot be turned into a model: ${err.message}`);
        console.error(`ar failed: ${err.message}`);
      }
      return;
    }

    const file = join(bundle, normalize(path === '/' ? '/index.html' : path).replace(/^([/\\])+/, ''));
    if (!resolve(file).startsWith(resolve(bundle))) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('no');
      return;
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] || 'application/octet-stream',
        // The opposite of the AR route: index.html carries hashed asset names,
        // so a phone holding an old copy asks for a bundle that is gone.
        'cache-control': 'no-store, must-revalidate',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const bundle = resolve(args[0] || './bundle');
  const port = Number(args.find((a) => /^\d+$/.test(a)) || 8124);
  const modelsAt = args.indexOf('--models');
  const models = resolve(modelsAt >= 0 ? args[modelsAt + 1] : join(bundle, 'models'));

  createArServer({ bundle, models }).listen(port, () => {
    console.log(`bundle   ${bundle}`);
    console.log(`models   ${models}`);
    console.log(`serving  http://localhost:${port}`);
    console.log(`AR       http://localhost:${port}/${AR_ROUTE}/product.glb?c=<id>`);
    console.log(`         http://localhost:${port}/${AR_ROUTE}/product.usdz?c=<id>`);
  });
}
