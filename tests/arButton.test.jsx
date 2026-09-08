// @vitest-environment jsdom
//
// The first component test in the project, and it exists for one assertion.
//
// AR Quick Look honours `rel="ar"` only when the anchor's single CHILD ELEMENT
// is an <img> or a <picture>. Break that and iOS downloads the USDZ as a file
// instead of opening AR — silently: no error, no console message, a valid model
// that appears not to work. Nothing else this project checks would notice. The
// build compiles, the URL is correct, the USDZ verifies, and the feature is
// dead.
//
// It is not a rule anybody would remember six months from now while adding a
// price label next to the button, which is precisely why it is a test that
// counts children rather than a comment asking politely.
//
// `ArButton` was split out of `Viewer` to make this possible: the viewer builds
// a WebGL context, which jsdom does not have, and a rule that cannot be tested
// is folklore.

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import ArButton, { AR_GLYPH } from '../src/viewer/ArButton.jsx';
import { AR_MODE } from '../src/viewer/ar-link.js';

afterEach(cleanup);

const QUICK_LOOK = {
  mode: AR_MODE.QUICK_LOOK, url: 'https://example.com/ar/product.usdz', reason: null,
};
const SCENE_VIEWER = {
  mode: AR_MODE.SCENE_VIEWER, url: 'intent://arvr.google.com/scene-viewer/1.0?file=x#Intent;end;',
  reason: null,
};

describe('the iOS link', () => {
  it('has exactly one child element, and it is an img', () => {
    // THE assertion. Everything else in this file is context for it.
    const { container } = render(<ArButton availability={QUICK_LOOK} />);
    const anchor = container.querySelector('a[rel="ar"]');

    expect(anchor).not.toBeNull();
    expect(anchor.children.length).toBe(1);
    expect(anchor.children[0].tagName).toBe('IMG');
  });

  it('carries rel="ar" and the usdz, not the glb', () => {
    render(<ArButton availability={QUICK_LOOK} />);
    const anchor = screen.getByRole('link');
    expect(anchor.getAttribute('rel')).toBe('ar');
    expect(anchor.getAttribute('href')).toMatch(/\.usdz$/);
  });

  it('says what the link does, since the label is a pseudo-element', () => {
    // The visible text comes from CSS `::after`, which no assistive technology
    // reads. So the <img> alt is the only name this control has, and an empty
    // one would leave a screen reader announcing "link".
    render(<ArButton availability={QUICK_LOOK} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('alt')).toMatch(/your room/i);
    expect(img.getAttribute('src')).toBe(AR_GLYPH);
  });
});

describe('the Android link', () => {
  it('may have real text, because Scene Viewer has no child rule', () => {
    render(<ArButton availability={SCENE_VIEWER} />);
    const anchor = screen.getByRole('link');
    expect(anchor.getAttribute('rel')).toBe(null);
    expect(anchor.textContent).toMatch(/view in your room/i);
  });

  it('hides the decorative glyph from assistive technology', () => {
    // Here the text is the name, so the icon repeating it would be noise.
    const { container } = render(<ArButton availability={SCENE_VIEWER} />);
    expect(container.querySelector('img').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('when there is no AR', () => {
  it('explains itself rather than offering a dead control', () => {
    render(<ArButton
      availability={{ mode: AR_MODE.NONE, url: null, reason: 'AR needs a phone or tablet.' }}
    />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/needs a phone/i)).toBeTruthy();
  });

  it('never renders a disabled button', () => {
    // A greyed-out control invites tapping and explains nothing.
    const { container } = render(<ArButton
      availability={{ mode: AR_MODE.NONE, url: null, reason: 'Nope.' }}
    />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[disabled]')).toBeNull();
  });

  it('stays silent when the bundle has no AR files at all', () => {
    // Different case, deliberately. "Open this on a phone" is an instruction
    // somebody can act on; "this folder was built without AR" is not, and
    // telling a customer about a missing feature they cannot enable is noise.
    const { container } = render(<ArButton
      availability={{ mode: AR_MODE.NONE, url: null, reason: 'exported without AR files.' }}
      hasAr={false}
    />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing at all without an availability', () => {
    const { container } = render(<ArButton availability={null} />);
    expect(container.textContent).toBe('');
  });
});
