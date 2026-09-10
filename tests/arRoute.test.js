// AR that follows the customer's own choices.
//
// THE FAULT THIS CLOSES. A bundle carries one pre-baked AR pair, of the product
// it opens on. Matt asked three times in one session - "so i can't configure a
// product and view it in my room?" - and until now the answer was no: the
// moment somebody added a bay, the handoff was withheld with a sentence asking
// them to put the options back. For a configurator whose whole pitch is seeing
// it in your room, that is close to useless.
//
// The parts to fix it all existed and had never been put behind a URL. A
// configuration is a VALUE (§5.18); that value becomes a GLB with no editor
// running (§5.19) and a Quick Look-valid USDZ (§5.20). So a host that can run
// those two functions can answer for EVERY configuration, and the runtime only
// needs to know where to ask.
//
// WHAT IS TESTED HERE is the "where to ask", because it is the part that can be
// wrong silently: a URL Quick Look declines, a route that only works at a
// host's root, a bundle that stops withholding when it should not. The actual
// generating is `exportConfiguration` and `glbToUsdz`, both already covered.

import { describe, it, expect } from 'vitest';
import {
  arRouteUrl, arHandoff, arAvailability, arBlock, AR_MODE, AR_ROUTE,
} from '../src/viewer/ar-link.js';
import { parseManifest } from '../src/viewer/manifest.js';
import { routeRequest, cacheKey } from '../tools/serve-ar.mjs';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15'
  + ' (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const PAGE = 'https://example.trycloudflare.com/index.html';
const SUBDIR = 'https://example.com/quotes/47/index.html';

// Two different products, and nothing about either matters here except that
// they are different strings.
const OPENED_ON = 'v1:feet:008563@0';
const ON_SCREEN = 'v1:feet:008563@0,008543@6';

const ROUTED = arBlock({
  glb: 'product.glb', usdz: 'product.usdz', triangles: 34106, route: AR_ROUTE,
});
const STATIC = arBlock({ glb: 'product.glb', usdz: 'product.usdz', triangles: 34106 });

describe('arRouteUrl', () => {
  it('puts the extension in the path and the configuration in the query', () => {
    // Not cosmetic. Quick Look is handed the URL by WebKit and reads the path,
    // so `.../product.usdz?c=...` is a materially safer thing to hand it than
    // `.../ar?c=...&f=usdz`, and spelling it the safe way costs nothing.
    expect(arRouteUrl(AR_ROUTE, { configurationId: ON_SCREEN, format: 'usdz', pageHref: PAGE }))
      .toBe(`https://example.trycloudflare.com/ar/build/product.usdz?c=${
        encodeURIComponent(ON_SCREEN)}`);
  });

  it('defaults to the GLB, which is what Scene Viewer reads', () => {
    expect(arRouteUrl(AR_ROUTE, { configurationId: ON_SCREEN, pageHref: PAGE }))
      .toContain('/product.glb?c=');
  });

  it('resolves against the page, so a bundle in a subdirectory still works', () => {
    // A client's IT department will put the folder somewhere and not tell us.
    // An absolute route would 404 there, and the symptom would be a button
    // that does nothing on a phone we cannot see.
    expect(arRouteUrl(AR_ROUTE, { configurationId: OPENED_ON, pageHref: SUBDIR }))
      .toBe(`https://example.com/quotes/47/ar/build/product.glb?c=${
        encodeURIComponent(OPENED_ON)}`);
  });

  it('is null with no configuration to ask about', () => {
    // A link with no `c=` is a request the host cannot answer, so it is not a
    // link. The page falls back to the shipped pair, which is the same product.
    expect(arRouteUrl(AR_ROUTE, { configurationId: null, pageHref: PAGE })).toBe(null);
  });

  it('is null with no route, which is every bundle exported before today', () => {
    expect(arRouteUrl(null, { configurationId: ON_SCREEN, pageHref: PAGE })).toBe(null);
  });

  it('does not double the separator when the route is given with one', () => {
    expect(arRouteUrl('ar/build/', { configurationId: OPENED_ON, pageHref: PAGE }))
      .toContain('/ar/build/product.glb?c=');
  });
});

describe('arHandoff', () => {
  it('withholds a static bundle the moment the product on screen changes', () => {
    const { ar, withheld } = arHandoff({
      ar: STATIC, arConfigurationId: OPENED_ON, configurationId: ON_SCREEN,
    });
    // Showing the wrong product in somebody's room is worse than showing none.
    expect(ar).toBe(null);
    expect(withheld).toMatch(/starting product/);
  });

  it('offers a static bundle while the product on screen IS the one it shipped', () => {
    const { ar, withheld } = arHandoff({
      ar: STATIC, arConfigurationId: OPENED_ON, configurationId: OPENED_ON,
    });
    expect(ar).toBe(STATIC);
    expect(withheld).toBe(null);
  });

  it('never withholds a routed bundle, whatever is on screen', () => {
    // The whole point. There is nothing to withhold, because the host will
    // build whichever product the customer has arrived at.
    const { ar, withheld } = arHandoff({
      ar: ROUTED, arConfigurationId: OPENED_ON, configurationId: ON_SCREEN,
    });
    expect(ar).toBe(ROUTED);
    expect(withheld).toBe(null);
  });

  it('has nothing to say about a bundle exported with --no-ar', () => {
    // No files, no route, and no sentence either: `arAvailability` already
    // explains that case, and two explanations would be one too many.
    expect(arHandoff({ ar: null, configurationId: ON_SCREEN }))
      .toEqual({ ar: null, withheld: null });
  });
});

describe('arAvailability, with a route', () => {
  it('sends iOS to the route for the product on screen', () => {
    const r = arAvailability({
      ar: ROUTED, pageHref: PAGE, userAgent: IPHONE, configurationId: ON_SCREEN,
    });
    expect(r.mode).toBe(AR_MODE.QUICK_LOOK);
    expect(r.url).toContain('/ar/build/product.usdz?c=');
    expect(r.url).toContain(encodeURIComponent(ON_SCREEN));
  });

  it('sends Android to Scene Viewer with the route as the absolute file', () => {
    const r = arAvailability({
      ar: ROUTED, pageHref: PAGE, userAgent: ANDROID, configurationId: ON_SCREEN,
    });
    expect(r.mode).toBe(AR_MODE.SCENE_VIEWER);
    // Scene Viewer fetches the model in its own process, so the URL inside the
    // intent has to be absolute and http(s). A route that produced a relative
    // one would fail silently, which is the failure this whole file guards.
    expect(r.url).toContain(encodeURIComponent(
      `https://example.trycloudflare.com/ar/build/product.glb?c=${
        encodeURIComponent(ON_SCREEN)}`,
    ));
  });

  it('prefers the route over the shipped file, because the file is one product', () => {
    const r = arAvailability({
      ar: ROUTED, pageHref: PAGE, userAgent: IPHONE, configurationId: ON_SCREEN,
    });
    expect(r.url).not.toContain('/ar/product.usdz');
  });

  it('falls back to the shipped file when there is no id yet', () => {
    // Same product, so the shipped file is right - and a page mid-load should
    // not lose its AR button for a moment.
    const r = arAvailability({ ar: ROUTED, pageHref: PAGE, userAgent: IPHONE });
    expect(r.mode).toBe(AR_MODE.QUICK_LOOK);
    expect(r.url).toBe('https://example.trycloudflare.com/ar/product.usdz');
  });

  it('offers a route-only bundle, which ships no files at all', () => {
    const routeOnly = arBlock({ glb: null, usdz: null, route: AR_ROUTE });
    const r = arAvailability({
      ar: routeOnly, pageHref: PAGE, userAgent: IPHONE, configurationId: ON_SCREEN,
    });
    expect(r.mode).toBe(AR_MODE.QUICK_LOOK);
  });

  it('still refuses a laptop, route or no route', () => {
    // The route changes which products AR covers, not which devices have AR.
    const r = arAvailability({
      ar: ROUTED, pageHref: PAGE, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      configurationId: ON_SCREEN,
    });
    expect(r.mode).toBe(AR_MODE.NONE);
    expect(r.reason).toMatch(/phone or tablet/);
  });
});

// The two decisions composed, which is the fault as Matt met it: a phone, a
// product he had configured, and no button. `arHandoff` decides whether there
// is anything to hand over and `arAvailability` decides whether this device can
// take it; the button appears only when both say yes, and the bug was that the
// first always said no.
describe('a configured product on a real phone', () => {
  const buttonFor = ({ ar, on: configurationId, userAgent }) => {
    const handoff = arHandoff({ ar, arConfigurationId: OPENED_ON, configurationId });
    const availability = arAvailability({
      ar: handoff.ar, pageHref: PAGE, userAgent, maxTouchPoints: 5, configurationId,
    });
    // The rule Viewer.jsx applies: a link is an action and goes on the stage.
    return !handoff.withheld && availability.mode !== AR_MODE.NONE;
  };

  it('gets a button on a routed bundle', () => {
    expect(buttonFor({ ar: ROUTED, on: ON_SCREEN, userAgent: ANDROID })).toBe(true);
    expect(buttonFor({ ar: ROUTED, on: ON_SCREEN, userAgent: IPHONE })).toBe(true);
  });

  it('gets a sentence on a static bundle, which is the old behaviour kept', () => {
    expect(buttonFor({ ar: STATIC, on: ON_SCREEN, userAgent: ANDROID })).toBe(false);
  });

  it('gets a button on either bundle before anything is changed', () => {
    expect(buttonFor({ ar: STATIC, on: OPENED_ON, userAgent: ANDROID })).toBe(true);
    expect(buttonFor({ ar: ROUTED, on: OPENED_ON, userAgent: ANDROID })).toBe(true);
  });
});

describe('the manifest', () => {
  const base = {
    version: 1, configuration: OPENED_ON, models: ['008563.glb'],
  };

  it('accepts a route with no files, which is not the lie it looks like', () => {
    expect(() => parseManifest({
      ...base, ar: { glb: null, usdz: null, route: AR_ROUTE },
    })).not.toThrow();
  });

  it('still refuses an AR block that names nothing at all', () => {
    expect(() => parseManifest({ ...base, ar: { glb: null, usdz: null, route: null } }))
      .toThrow(/names no AR file/);
  });
});

describe('the host, answering', () => {
  it('recognises both formats on the route', () => {
    expect(routeRequest('/ar/build/product.glb')).toBe('glb');
    expect(routeRequest('/ar/build/product.usdz')).toBe('usdz');
  });

  it('recognises the route under a subdirectory, because the route is relative', () => {
    // The mirror of the `arRouteUrl` subdirectory case. If only one end of
    // this pair understood subdirectories, AR would work on a laptop and fail
    // wherever the bundle was actually put.
    expect(routeRequest('/quotes/47/ar/build/product.usdz')).toBe('usdz');
  });

  it('leaves the SHIPPED pair alone', () => {
    // `ar/product.glb` is a real file in the folder and has to stay reachable:
    // it is the fallback for a page with no id and for a dumb static host.
    expect(routeRequest('/ar/product.glb')).toBe(null);
    expect(routeRequest('/ar/product.usdz')).toBe(null);
  });

  it('is not fooled by the page, the manifest or a model', () => {
    expect(routeRequest('/index.html')).toBe(null);
    expect(routeRequest('/manifest.json')).toBe(null);
    expect(routeRequest('/models/008563.glb')).toBe(null);
  });
});

// THE FAULT THIS FILE ALMOST SHIPPED. The disk cache keyed on the first 120
// characters of the id's base64, to stay inside a file name limit. A
// configuration id lists its COMPONENTS before its INSTANCES, so a one-bay and
// a two-bay product of the same range are byte-identical for hundreds of
// characters: the real pair below, straight out of the YouK schema, agrees for
// its first 505. The two shared one cache file, and whichever was asked for
// second was served the other's model - the wrong product in somebody's room,
// with nothing about it looking wrong.
describe('the cache key', () => {
  // Truncated to the length of the real prefix they share, which is what makes
  // this a measurement rather than an example.
  const ONE_BAY = 'eyJ2IjoxLCJtIjoiZmVldCIsImYiOjEwMCwiYyI6WyIyMzY3NTgtbGFkZGVyIl0s'
    + 'ImkiOlt7ImMiOjAsInAiOlswLDAsMF19XSwibiI6W1swLDAsMSwxXV19';
  const TWO_BAY = 'eyJ2IjoxLCJtIjoiZmVldCIsImYiOjEwMCwiYyI6WyIyMzY3NTgtbGFkZGVyIl0s'
    + 'ImkiOlt7ImMiOjAsInAiOlswLDAsMF19LHsiYyI6MH1dLCJuIjpbWzAsMCwxLDFdLFsyLDAsMywxXV19';

  it('tells two products apart even when their ids agree for 60 characters', () => {
    expect(ONE_BAY.slice(0, 60)).toBe(TWO_BAY.slice(0, 60));
    expect(cacheKey(ONE_BAY)).not.toBe(cacheKey(TWO_BAY));
  });

  it('reads the WHOLE id, not a prefix of it', () => {
    // The direct statement of the bug: a key that ignores the tail cannot
    // distinguish two ids that differ only in their tail.
    expect(cacheKey(`${ONE_BAY}x`)).not.toBe(cacheKey(ONE_BAY));
  });

  it('is stable, which is the only reason caching is safe at all', () => {
    // The same id always names the same product (§5.18), so a file once built
    // never needs building again - and that holds only if the key is a
    // function of the id and nothing else.
    expect(cacheKey(ONE_BAY)).toBe(cacheKey(ONE_BAY));
  });

  it('is a legal file name whatever the id contains', () => {
    // Ids are base64 of JSON and can carry `/` and `+`; a key spliced into a
    // path has to survive that. Hex cannot fail to.
    expect(cacheKey('a/b+c==')).toMatch(/^[0-9a-f]{64}$/);
  });
});
