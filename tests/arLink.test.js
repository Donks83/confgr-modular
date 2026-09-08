// The platform decision, which is the one part of AR nobody can test by
// looking at their own machine.
//
// Neither handoff reports back. `rel="ar"` in a browser that does not know it
// is a download link; an `intent://` URL in a browser that does not know it is
// a dead string. So there is no feature to detect and nothing to catch — the
// decision is made from strings before the user taps, and if it is made wrongly
// the only symptom is a button that does nothing on a phone we do not own.
//
// Which is exactly why `arAvailability` is pure and this file exists. Every
// case below is a real device or a real mistake:
//
//   an iPhone, an iPad on iPadOS 13+ (which claims to be a Mac), an Android
//   phone, a laptop, a wall-mounted product, a bundle exported with --no-ar,
//   and somebody who double-clicked index.html instead of serving it.

import { describe, it, expect } from 'vitest';
import {
  platformOf, arAssetUrl, sceneViewerUrl, arAvailability, arBlock, AR_MODE, AR_DIR,
} from '../src/viewer/ar-link.js';
import { MOUNTING } from '../src/engine/ar.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15'
  + ' (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15'
  + ' (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1';
// iPadOS 13 and later report this ON PURPOSE, so that sites stop serving
// tablets a phone layout. It is indistinguishable from a desktop Safari UA.
const IPAD_NEW = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
  + ' (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const AR = { glb: 'product.glb', usdz: 'product.usdz', triangles: 34106, vertical: false };
const HOSTED = 'https://example.com/showroom/youk/index.html';

describe('platformOf', () => {
  it('knows a phone by name', () => {
    expect(platformOf({ userAgent: IPHONE })).toBe('ios');
    expect(platformOf({ userAgent: IPAD_OLD })).toBe('ios');
    expect(platformOf({ userAgent: ANDROID })).toBe('android');
  });

  it('catches the iPad that says it is a Mac', () => {
    // The whole reason `maxTouchPoints` is a parameter. A UA sniff alone hands
    // every modern iPad the desktop answer, which is no AR on the device most
    // likely to be handed round a meeting.
    expect(platformOf({ userAgent: IPAD_NEW, maxTouchPoints: 5 })).toBe('ios');
  });

  it('does not mistake a real Mac for one', () => {
    // A Mac with a touchscreen does not exist, so the touch count is the whole
    // of the difference — and getting this wrong the other way would put an
    // AR button on every desktop Safari.
    expect(platformOf({ userAgent: IPAD_NEW, maxTouchPoints: 0 })).toBe('other');
    expect(platformOf({ userAgent: WINDOWS })).toBe('other');
    expect(platformOf({})).toBe('other');
  });
});

describe('arAssetUrl', () => {
  it('resolves against the page, so a subdirectory works', () => {
    // Where a client's IT will actually put the folder, without telling us.
    expect(arAssetUrl('product.usdz', HOSTED))
      .toBe(`https://example.com/showroom/youk/${AR_DIR}/product.usdz`);
  });

  it('is null when there is nothing to point at', () => {
    expect(arAssetUrl(null, HOSTED)).toBe(null);
    expect(arAssetUrl('product.usdz', '')).toBe(null);
    expect(arAssetUrl('product.usdz', 'not a url')).toBe(null);
  });
});

describe('sceneViewerUrl', () => {
  const parse = (url) => {
    const query = url.slice(url.indexOf('?') + 1, url.indexOf('#'));
    return Object.fromEntries(new URLSearchParams(query));
  };

  it('carries an absolute model url, because Scene Viewer fetches it itself', () => {
    const glb = `https://example.com/showroom/youk/${AR_DIR}/product.glb`;
    const params = parse(sceneViewerUrl(glb, { pageHref: HOSTED, title: 'A bay' }));
    expect(params.file).toBe(glb);
    expect(params.title).toBe('A bay');
  });

  it('prefers AR but does not demand it', () => {
    // `ar_only` fails outright on a phone without ARCore; `ar_preferred` falls
    // back to Scene Viewer's own 3D view, which is worse than AR and very much
    // better than an error.
    const glb = 'https://example.com/ar/product.glb';
    expect(parse(sceneViewerUrl(glb, { pageHref: HOSTED })).mode).toBe('ar_preferred');
  });

  it('asks for vertical placement only for a wall-mounted product', () => {
    const glb = 'https://example.com/ar/product.glb';
    const floor = parse(sceneViewerUrl(glb, { pageHref: HOSTED, mounting: MOUNTING.FLOOR }));
    const wall = parse(sceneViewerUrl(glb, { pageHref: HOSTED, mounting: MOUNTING.WALL }));

    // Scene Viewer defaults to floors. A wall product placed on the floor looks
    // like a fault in our model rather than a missing flag, and the engine has
    // known which is which since long before there was a phone to tell.
    expect(floor.enable_vertical_placement).toBeUndefined();
    expect(wall.enable_vertical_placement).toBe('true');
  });

  it('falls back to the page rather than to an app store listing', () => {
    const url = sceneViewerUrl('https://example.com/ar/product.glb', { pageHref: HOSTED });
    expect(url).toContain(`S.browser_fallback_url=${encodeURIComponent(HOSTED)}`);
    expect(url).toContain(';end;');
    // Assembled by hand because an intent:// URL is not hierarchical; the
    // fragment's `;`-separated fields do not survive `new URL`.
    expect(url.startsWith('intent://')).toBe(true);
  });

  it('refuses a url Scene Viewer cannot fetch', () => {
    expect(sceneViewerUrl('ar/product.glb', { pageHref: HOSTED })).toBe(null);
    expect(sceneViewerUrl('file:///C:/bundle/ar/product.glb', {})).toBe(null);
    expect(sceneViewerUrl(null, {})).toBe(null);
  });
});

describe('arAvailability', () => {
  it('offers Quick Look on iOS', () => {
    const r = arAvailability({ ar: AR, pageHref: HOSTED, userAgent: IPHONE });
    expect(r.mode).toBe(AR_MODE.QUICK_LOOK);
    expect(r.url).toBe(`https://example.com/showroom/youk/${AR_DIR}/product.usdz`);
    expect(r.reason).toBe(null);
  });

  it('offers Quick Look even off a local file, unlike Android', () => {
    // Not an oversight and not symmetry for its own sake: WebKit hands the file
    // to Quick Look itself, so there is no second process that needs a URL.
    const r = arAvailability({
      ar: AR, pageHref: 'file:///C:/bundle/index.html', userAgent: IPHONE,
    });
    expect(r.mode).toBe(AR_MODE.QUICK_LOOK);
    expect(r.url).toBe('file:///C:/bundle/ar/product.usdz');
  });

  it('offers Scene Viewer on Android', () => {
    const r = arAvailability({
      ar: AR, pageHref: HOSTED, userAgent: ANDROID, mounting: MOUNTING.FLOOR, title: 'A bay',
    });
    expect(r.mode).toBe(AR_MODE.SCENE_VIEWER);
    expect(r.url).toContain(encodeURIComponent(
      `https://example.com/showroom/youk/${AR_DIR}/product.glb`,
    ));
  });

  it('tells an Android user who double-clicked the folder what is wrong', () => {
    const r = arAvailability({
      ar: AR, pageHref: 'file:///C:/bundle/index.html', userAgent: ANDROID,
    });
    expect(r.mode).toBe(AR_MODE.NONE);
    expect(r.url).toBe(null);
    expect(r.reason).toMatch(/web server/i);
  });

  it('tells a laptop to pick up a phone', () => {
    const r = arAvailability({ ar: AR, pageHref: HOSTED, userAgent: WINDOWS });
    expect(r.mode).toBe(AR_MODE.NONE);
    expect(r.reason).toMatch(/phone|tablet/i);
  });

  it('says a bundle has no AR rather than offering a link to nothing', () => {
    const r = arAvailability({ ar: null, pageHref: HOSTED, userAgent: IPHONE });
    expect(r.mode).toBe(AR_MODE.NONE);
    expect(r.reason).toMatch(/without AR/i);
  });

  it('names the missing format when only one of the pair was written', () => {
    const iosOnly = arAvailability({
      ar: { glb: null, usdz: 'product.usdz' }, pageHref: HOSTED, userAgent: ANDROID,
    });
    expect(iosOnly.mode).toBe(AR_MODE.NONE);
    expect(iosOnly.reason).toMatch(/GLB/);

    const androidOnly = arAvailability({
      ar: { glb: 'product.glb', usdz: null }, pageHref: HOSTED, userAgent: IPHONE,
    });
    expect(androidOnly.mode).toBe(AR_MODE.NONE);
    expect(androidOnly.reason).toMatch(/USDZ/);
  });
});

describe('arBlock', () => {
  it('is null when there is nothing to record', () => {
    expect(arBlock({ glb: null, usdz: null })).toBe(null);
  });

  it('records both files, the triangle count and the placement', () => {
    expect(arBlock({
      glb: 'product.glb', usdz: 'product.usdz', triangles: 34106, vertical: true,
    })).toEqual({
      glb: 'product.glb', usdz: 'product.usdz', triangles: 34106, vertical: true,
    });
  });

  it('does not invent a triangle count it was not given', () => {
    // The project's own rule: no number is written down unless it was measured.
    expect(arBlock({ glb: 'product.glb', usdz: 'product.usdz' }).triangles).toBe(null);
  });
});
