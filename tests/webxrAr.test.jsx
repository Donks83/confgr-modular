// @vitest-environment jsdom
//
// AR inside Chrome, with Scene Viewer as the fallback (Matt, 13 Nov 2026: "the
// augmented reality feature isn't working"). Current Google app builds close
// Scene Viewer as soon as it opens - Google's own sample model too, on his new
// phone and his Pixel tablet - so Android now asks Chrome first.
//
// A real AR session needs a phone. What can be pinned here is everything around
// it: the button asks Chrome first and only where Chrome says yes, it starts
// the session from the tap with the features placement needs, it hands over to
// Scene Viewer when it cannot, and the product is turned to face the person.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

import ArButton from '../src/viewer/ArButton.jsx';
import { AR_MODE, arAvailability } from '../src/viewer/ar-link.js';
import { yawToFace, webxrArSupported, startWebXrAr, SAY } from '../src/viewer/webxr-ar.js';

const ANDROID = {
  mode: AR_MODE.SCENE_VIEWER,
  url: 'intent://arvr.google.com/scene-viewer/1.0?file=x#Intent;end;',
  reason: null,
  glb: 'https://shop.test/ar/build/product.glb?c=abc',
  title: 'YouK shelving',
};

const withXr = (xr) => Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
afterEach(() => {
  cleanup();
  delete navigator.xr;
  document.body.innerHTML = '';
});

describe('the product faces the person', () => {
  // The room side of a product is -z (§5.13). Turned by θ, -z points along
  // (-sin θ, 0, -cos θ) - which must be the way to the camera.
  const front = (θ) => [-Math.sin(θ), -Math.cos(θ)];
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

  it('needs no turn when the person is already in front', () => {
    expect(yawToFace({ x: 0, z: 0 }, { x: 0, z: -2 })).toBeCloseTo(0);
  });

  it('turns to whichever side the person is standing', () => {
    for (const [x, z] of [[2, 0], [-2, 0], [0, 2], [1.5, -1.5], [-0.3, 4]]) {
      const len = Math.hypot(x, z);
      expect(close(front(yawToFace({ x: 0, z: 0 }, { x, z })), [x / len, z / len]), `${x},${z}`).toBe(true);
    }
  });
});

describe('asking Chrome', () => {
  it('says yes only when Chrome says it can start AR', async () => {
    expect(await webxrArSupported({ isSessionSupported: async (m) => m === 'immersive-ar' })).toBe(true);
    expect(await webxrArSupported({ isSessionSupported: async () => false })).toBe(false);
    expect(await webxrArSupported({ isSessionSupported: async () => { throw new Error('no'); } })).toBe(false);
    expect(await webxrArSupported(undefined)).toBe(false);
  });
});

describe('starting a session', () => {
  it('asks for it straight from the tap, with floor finding and the overlay', () => {
    const requestSession = vi.fn(() => new Promise(() => {}));
    startWebXrAr({ glbUrl: ANDROID.glb, title: 'Shelf', xr: { requestSession } });
    // Synchronously: Chrome only starts a session inside the gesture.
    expect(requestSession).toHaveBeenCalledTimes(1);
    const [mode, opts] = requestSession.mock.calls[0];
    expect(mode).toBe('immersive-ar');
    expect(opts.requiredFeatures).toEqual(['hit-test']);
    expect(opts.optionalFeatures).toContain('dom-overlay');
    expect(opts.domOverlay.root.isConnected).toBe(true);
    expect(opts.domOverlay.root.textContent).toContain(SAY.loading);
    expect(opts.domOverlay.root.querySelector('.cfgx-close').textContent).toBe('Close');
    // No ids: two configurators on one page must not collide.
    expect(opts.domOverlay.root.querySelector('[id]')).toBeNull();
  });

  it('wears the theme of the configurator it was opened from', () => {
    const requestSession = vi.fn(() => new Promise(() => {}));
    startWebXrAr({ glbUrl: ANDROID.glb, theme: 'youk', xr: { requestSession } });
    const root = requestSession.mock.calls[0][1].domOverlay.root;
    expect(root.classList.contains('cfg-theme')).toBe(true);
    expect(root.dataset.cfgTheme).toBe('youk');
  });

  it('takes its overlay away again when Chrome refuses', async () => {
    const xr = { requestSession: () => Promise.reject(new Error('NotSupportedError')) };
    await expect(startWebXrAr({ glbUrl: ANDROID.glb, xr })).rejects.toThrow('NotSupportedError');
    expect(document.querySelector('.cfgx')).toBeNull();
  });

  it('does not treat a tap on Close as a tap on the floor', () => {
    const requestSession = vi.fn(() => new Promise(() => {}));
    startWebXrAr({ glbUrl: ANDROID.glb, xr: { requestSession } });
    const bar = document.querySelector('.cfgx-bar');
    const e = new Event('beforexrselect', { cancelable: true });
    bar.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('the Android button', () => {
  const fakeXr = (supported, start = vi.fn(() => Promise.resolve())) => ({
    module: { webxrArSupported: async () => supported, startWebXrAr: start },
    start,
  });

  it('opens AR in Chrome when Chrome can, with the same file Scene Viewer would get', async () => {
    withXr({});
    const { module, start } = fakeXr(true);
    const { container } = render(<ArButton availability={ANDROID} loadXr={async () => module} />);
    const link = container.querySelector('a.cfgv-ar');
    await waitFor(() => {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
    });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ glbUrl: ANDROID.glb, title: 'YouK shelving' }));
  });

  it('leaves the Scene Viewer link alone when Chrome cannot', async () => {
    withXr({});
    const { module, start } = fakeXr(false);
    const loadXr = vi.fn(async () => module);
    const { container } = render(<ArButton availability={ANDROID} loadXr={loadXr} />);
    await waitFor(() => expect(loadXr).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    container.querySelector('a.cfgv-ar').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(container.querySelector('a.cfgv-ar').getAttribute('href')).toBe(ANDROID.url);
  });

  it('does not even load the AR code where there is no WebXR', async () => {
    const loadXr = vi.fn();
    render(<ArButton availability={ANDROID} loadXr={loadXr} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(loadXr).not.toHaveBeenCalled();
  });

  it('starts one session per tap, not two', async () => {
    withXr({});
    const { module, start } = fakeXr(true, vi.fn(() => new Promise(() => {})));
    const { container } = render(<ArButton availability={ANDROID} loadXr={async () => module} />);
    const link = container.querySelector('a.cfgv-ar');
    await waitFor(() => {
      fireEvent.click(link);
      expect(start).toHaveBeenCalled();
    });
    fireEvent.click(link);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe('what the Android answer carries', () => {
  it('the GLB and the title, for Chrome, beside the intent for Scene Viewer', () => {
    const a = arAvailability({
      ar: { glb: 'product.glb', usdz: 'product.usdz', route: null },
      pageHref: 'https://shop.test/configure/',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      title: 'YouK shelving',
    });
    expect(a.mode).toBe(AR_MODE.SCENE_VIEWER);
    expect(a.glb).toBe('https://shop.test/configure/ar/product.glb');
    expect(a.title).toBe('YouK shelving');
    expect(a.url).toMatch(/^intent:\/\//);
  });
});
