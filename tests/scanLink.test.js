// Getting the product from a desk to a phone.
//
// AR needs a phone and the person configuring is at a desk, so the desktop case
// has always ended in a sentence - "AR needs a phone or tablet. Open this page
// on one." - which is honest and leaves them to retype four hundred characters
// of base64. A QR code is the fix, and every way it fails is silent:
//
//   A code of a `localhost` URL scans PERFECTLY and opens the phone's own
//   localhost. Nothing about the code, the scan or the phone is broken; the URL
//   was never portable. The same for a `file://` page somebody double-clicked.
//
//   A code carrying too much is a code a camera hunts for. That one is a
//   measurement rather than a judgement, and it is the reason the URL is
//   trimmed at all - see `scanUrlLength` below.
//
// Which is why the decision is a pure function with no React and no QR library
// in it: the drawing is somebody else's solved problem, and the deciding is
// ours.

import { describe, it, expect } from 'vitest';
import { scanAvailability } from '../src/viewer/scan-link.js';

// A real pair from the YouK schema: the id is what the URL carries today, the
// choices are what it could carry instead.
const CHOICES = 'eyJ2YXJpYW50SWQiOiJkMzIwIiwic2l6ZUlkIjoidzkwMCIsImZyYW1lSWQiOiIyMzY3NTgtbGFkZGVy'
  + 'LWRlcHRoLTMyMG1tIiwiZnJhbWVzIjp7fSwiYmF5cyI6MywiYWRkcyI6e30sImF0Ijp7fSwibW91bnRpbmciOiJmZWV0'
  + 'IiwiZm9vdEhlaWdodE1tIjoxMDB9';
const ID = 'eyJ2IjoxLCJtIjoiZmVldCIsImYiOjEwMCwiYyI6WyIyMzY3NTgtbGFkZGVyLWRlcHRoLTMyMG1tIl19';

const WIFI = 'http://192.168.0.14:8124/index.html';

describe('what the code carries', () => {
  it('carries the choices, not the configuration id', () => {
    // The runtime rebuilds `c` from `o` on arrival, so carrying both would
    // double the code for a parameter that is thrown away.
    const r = scanAvailability({ pageHref: WIFI, choices: CHOICES, configurationId: ID });
    expect(r.ok).toBe(true);
    expect(r.url).toContain(`o=${CHOICES}`);
    expect(r.url).not.toContain('c=');
  });

  it('drops whatever was already in the address bar', () => {
    // The page's own URL carries both parameters and possibly a fragment. A
    // code built by appending to it would be the long one by accident.
    const r = scanAvailability({
      pageHref: `${WIFI}?c=${ID}&o=old#somewhere`, choices: CHOICES,
    });
    expect(r.url).toBe(`http://192.168.0.14:8124/index.html?o=${CHOICES}`);
  });

  it('falls back to the id when there are no choices to carry', () => {
    // A bundle with no option schema shows one product and has no choices. The
    // id is the only description of it there is - longer, and unavoidable.
    const r = scanAvailability({ pageHref: WIFI, configurationId: ID });
    expect(r.ok).toBe(true);
    expect(r.url).toContain(`c=${ID}`);
  });

  it('still offers the bare page when it has neither', () => {
    const r = scanAvailability({ pageHref: WIFI });
    expect(r.ok).toBe(true);
    expect(r.url).toBe('http://192.168.0.14:8124/index.html');
  });

  it('keeps the subdirectory a bundle was put in', () => {
    // A client's IT department will put the folder somewhere and not tell us,
    // and a code that dropped the path would send a phone to the site's root.
    const r = scanAvailability({ pageHref: 'https://example.com/quotes/47/index.html', choices: CHOICES });
    expect(r.url).toBe(`https://example.com/quotes/47/index.html?o=${CHOICES}`);
  });
});

describe('when there is no URL worth drawing', () => {
  it('refuses localhost, and says why', () => {
    // THE ONE THAT LOOKS LIKE IT WORKS. The code scans, the phone opens its own
    // localhost, and nothing anywhere reports a fault.
    const r = scanAvailability({ pageHref: 'http://localhost:8124/', choices: CHOICES });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/localhost/);
    expect(r.reason).toMatch(/network address/);
    expect(r.url).toBe(null);
  });

  it('refuses every spelling of this machine', () => {
    for (const host of ['http://127.0.0.1:8124/', 'http://0.0.0.0:8124/', 'http://[::1]:8124/']) {
      expect(scanAvailability({ pageHref: host, choices: CHOICES }).ok).toBe(false);
    }
  });

  it('refuses a double-clicked file, and names the fix', () => {
    const r = scanAvailability({ pageHref: 'file:///C:/bundle/index.html', choices: CHOICES });
    expect(r.ok).toBe(false);
    // The same failure `ar-link` already explains for Scene Viewer, so the
    // remedy named is the same one: the little .bat next to index.html.
    expect(r.reason).toMatch(/Start Preview/);
  });

  it('says nothing at all when there is no page', () => {
    // Server-side, or a test harness. A missing window is not a fault to report.
    expect(scanAvailability({}).reason).toBe(null);
    expect(scanAvailability({ pageHref: 'not a url' }).reason).toBe(null);
  });

  it('is silent about a scheme it has no opinion on', () => {
    const r = scanAvailability({ pageHref: 'data:text/html,<p>hi', choices: CHOICES });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(null);
  });
});

// The measurement the whole design rests on. Numbers taken from the YouK
// schema on 11 September: a one-bay product's full URL is 647 characters and
// its choices are 228, and the worst case measured - three bays, six shelves
// and a rail - is 1,091 against 328.
describe('why the id is dropped', () => {
  const full = (choices, id) => `${WIFI}?c=${id}&o=${choices}`;

  it('is roughly half the characters, which is a whole QR version band', () => {
    const short = scanAvailability({ pageHref: WIFI, choices: CHOICES, configurationId: ID }).url;
    expect(short.length).toBeLessThan(full(CHOICES, ID).length * 0.75);
  });

  it('does not grow when the product does', () => {
    // The state model paying off: choices are COUNTS, so one bay and three bays
    // encode to the same length. A QR that got harder to scan as somebody added
    // bays would fail exactly when the configurator was working.
    const oneBay = CHOICES.replace('ImJheXMiOjM', 'ImJheXMiOjE');
    const a = scanAvailability({ pageHref: WIFI, choices: CHOICES }).url.length;
    const b = scanAvailability({ pageHref: WIFI, choices: oneBay }).url.length;
    expect(Math.abs(a - b)).toBeLessThan(8);
  });
});
