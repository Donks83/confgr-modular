// @vitest-environment jsdom
//
// WHERE the AR control is, which turned out to matter as much as whether it
// renders at all.
//
// Matt: "how do i start the AR mode?" then "i dont see the view in your room
// anywhere". It was rendering perfectly, in the last place anybody would look:
// at the bottom of the viewer's sheet body, under a twenty-line bill of
// materials, inside a sheet that is COLLAPSED on a phone - and on a phone the
// guided options panel covers the lower 46vh at a higher z-index, so even
// expanded the button was behind it. The DOM said the link sat at y 724-796
// and the panel owned 439-812. Present, drawn, unreachable.
//
// `arButton.test.jsx` covers the DOM shape iOS enforces. This covers the
// decision one level up: a LINK is an action and goes on the stage, a SENTENCE
// is an explanation and stays with the numbers it qualifies. Neither should
// ever be in both places, and the link must never be in the sheet again.
//
// Viewer builds a WebGL context, which jsdom has not got, so this asserts on
// the rule as a pure function of the inputs rather than by rendering Viewer.
// The rule lives in one expression in Viewer.jsx and is repeated here; the test
// that would catch them diverging is the browser check in the commit message.

import { describe, it, expect } from 'vitest';
import { AR_MODE, arAvailability } from '../src/viewer/ar-link.js';

const AR = { glb: 'product.glb', usdz: 'product.usdz', triangles: 34106, vertical: false };
const PAGE = 'http://192.168.0.14:8124/index.html';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120';

/** The rule Viewer applies to decide the two placements. */
const isLink = (availability, withheld = null) => (
  !withheld && !!availability && availability.mode !== AR_MODE.NONE
);

const on = (userAgent, maxTouchPoints = 5) => arAvailability({
  ar: AR, pageHref: PAGE, userAgent, maxTouchPoints, mounting: 'feet', title: 'confgr product',
});

describe('whether AR is an action or an explanation', () => {
  it('is an action on an iPhone', () => {
    const a = on(IPHONE);
    expect(a.mode).toBe(AR_MODE.QUICK_LOOK);
    expect(isLink(a)).toBe(true);
  });

  it('is an action on Android', () => {
    const a = on(ANDROID);
    expect(a.mode).toBe(AR_MODE.SCENE_VIEWER);
    expect(isLink(a)).toBe(true);
  });

  // The case Matt was actually looking at when he could not find it. A desktop
  // gets a sentence, and a sentence in the sheet is right - it explains what to
  // do, and there is nothing to press.
  it('is an explanation on a desktop', () => {
    const a = on(WINDOWS, 0);
    expect(a.mode).toBe(AR_MODE.NONE);
    expect(a.reason).toMatch(/phone or tablet/i);
    expect(isLink(a)).toBe(false);
  });

  // Withholding wins over the platform. The guided flow withholds once the
  // product stops being the one the bundle's files were baked for, and a button
  // that opens a picture of a DIFFERENT product is worse than no button,
  // because nothing about it looks wrong.
  it('is an explanation when the product has been changed, even on a phone', () => {
    const a = on(ANDROID);
    expect(isLink(a, 'Reset the options to see it in AR.')).toBe(false);
  });

  it('is nothing at all when the bundle carries no AR files', () => {
    const a = arAvailability({ ar: null, pageHref: PAGE, userAgent: ANDROID, maxTouchPoints: 5 });
    expect(a.mode).toBe(AR_MODE.NONE);
    expect(isLink(a)).toBe(false);
  });

  // A LAN address is the whole point of testing on a phone at all: the bundle
  // is served off a laptop and the phone is on the same wifi. Scene Viewer
  // needs an absolute http(s) URL, and a LAN one qualifies.
  it('builds an absolute Scene Viewer URL from a LAN address', () => {
    const a = on(ANDROID);
    expect(a.url).toContain('file=http%3A%2F%2F192.168.0.14%3A8124%2Far%2Fproduct.glb');
    expect(a.url.startsWith('intent://')).toBe(true);
  });

  it('hands Quick Look the USDZ from the same origin as the page', () => {
    const a = on(IPHONE);
    expect(a.url).toBe('http://192.168.0.14:8124/ar/product.usdz');
  });
});
