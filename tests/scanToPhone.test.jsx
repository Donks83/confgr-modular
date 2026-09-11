// @vitest-environment jsdom
//
// That the drawn code is a REAL code, which is not something looking at it will
// tell you.
//
// A QR renders as a grid of squares whether or not the squares mean anything,
// and the failure this guards against is a component that draws a plausible
// pattern of the wrong size, or an empty box, and looks fine in a screenshot.
// So this asserts on the matrix rather than the picture: how many modules, and
// whether they change when the product does.
//
// `qrPath` is exported for exactly this reason - the encoding is the testable
// part, and it has no React in it.

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScanToPhone, { qrPath, QUIET_ZONE } from '../src/viewer/ScanToPhone.jsx';

const SHORT = 'http://192.168.0.14:8124/';
// The length actually measured for a three-bay product's choices.
const REAL = `http://192.168.0.14:8124/index.html?o=${'A'.repeat(290)}`;

describe('the encoding', () => {
  it('picks the smallest grid that fits, rather than one fixed size', () => {
    // Version 0 means "choose", and it is what keeps a small product's code
    // easy to scan instead of padding it out to the worst case.
    const small = qrPath(SHORT);
    const big = qrPath(REAL);
    expect(small.count).toBeLessThan(big.count);
  });

  it('stays inside the band a phone reads comfortably', () => {
    // 77 modules is version 15, which is the worst case measured on this range
    // (three bays, six shelves and a rail). If a schema change pushes a real
    // URL past this, the code starts needing a steadier hand and this test is
    // where that shows up.
    expect(qrPath(REAL).count).toBeLessThanOrEqual(77);
  });

  it('leaves the quiet zone the spec requires', () => {
    const { count, size } = qrPath(SHORT);
    // Four modules of margin on each side. Without it many readers never see
    // the code at all, and it is the most commonly dropped part of a QR.
    expect(size).toBe(count + QUIET_ZONE * 2);
  });

  it('draws a different code for a different product', () => {
    // The test that would fail if the component ever drew a cached or
    // placeholder pattern: two products, two pictures.
    expect(qrPath(`${SHORT}?o=aaa`).d).not.toBe(qrPath(`${SHORT}?o=bbb`).d);
  });

  it('is stable for the same URL', () => {
    expect(qrPath(REAL).d).toBe(qrPath(REAL).d);
  });

  it('emits one path rather than a node per module', () => {
    // A version 15 code is 85 x 85 including its margin - over seven thousand
    // cells. As DOM nodes that is a picture the browser re-lays-out on every
    // option change; as one `d` string it is one node.
    const { d } = qrPath(REAL);
    expect(typeof d).toBe('string');
    expect(d.startsWith('M')).toBe(true);
  });
});

describe('the component', () => {
  it('renders the code as SVG with an accessible name', () => {
    render(<ScanToPhone url={SHORT} />);
    const svg = screen.getByRole('img', { name: /QR code/i });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    // The viewBox is the module grid, so the code is crisp at any pixel size -
    // and a blurred module edge is exactly what a camera has to guess about.
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${qrPath(SHORT).size} ${qrPath(SHORT).size}`);
  });

  it('paints the quiet zone white rather than leaving it transparent', () => {
    // Over a dark panel a transparent margin is no margin, and no margin is a
    // code many readers refuse.
    const { container } = render(<ScanToPhone url={SHORT} />);
    expect(container.querySelector('svg rect').getAttribute('fill')).toBe('#ffffff');
  });

  it('draws nothing at all without a URL', () => {
    // The localhost and file:// cases: `scanAvailability` has already refused,
    // and a code with nothing in it would be worse than the sentence it
    // replaced.
    const { container } = render(<ScanToPhone url={null} />);
    expect(container.querySelector('svg')).toBe(null);
  });

  it('can show the URL for somebody with no camera to hand', () => {
    render(<ScanToPhone url={SHORT} showUrl />);
    expect(screen.getByText(SHORT)).toBeTruthy();
  });
});
