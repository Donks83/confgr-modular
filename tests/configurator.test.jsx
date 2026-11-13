// @vitest-environment jsdom
//
// The configurator's direction C (workstream B; Matt chose it 12 Nov 2026) and
// the design tokens under it (B1).
//
// The claims worth holding:
//   1. A step shows ITS controls and nothing else - and which step an accessory
//      belongs to is data (`group` in guided.json), not a list in code.
//   2. Every token a stylesheet uses is defined in the neutral theme, so a typo
//      cannot quietly leave a control unstyled.
//   3. The rail is permanent on a wide screen and steps aside on a phone, and on
//      a phone the product comes before the step.

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { render, screen, cleanup } from '@testing-library/react';

import Options from '../src/viewer/Options.jsx';
import { MOUNTING } from '../src/engine/ar.js';

afterEach(cleanup);

const variant = {
  id: 'd320', label: '320 deep', maxBays: 3,
  frames: [{ componentId: 'frame-905', label: '905 tall' }, { componentId: 'frame-1500', label: '1500 tall' }],
  sizes: [{ id: 'w900', label: '900 wide' }],
};
const adds = [
  { componentId: 'shelf', kind: 'metal-shelf', label: 'Extra shelf', max: 4, group: 'storage' },
  { componentId: 'rail', kind: 'clothes-rail', label: 'Clothes rail', max: 1, group: 'accessories' },
  { componentId: 'strip', kind: 'hook-strip', label: 'Hook strip', max: 2 },
];
const size = { id: 'w900', label: '900 wide', span: { componentId: 'shelf' }, adds };
const schema = { version: 1, variants: [variant, { id: 'd200', label: '200 deep', sizes: [], frames: [] }] };
const choices = { variantId: 'd320', sizeId: 'w900', frameId: 'frame-1500', bays: 2, adds: {}, mounting: MOUNTING.FLOOR };
const mountings = [{ id: 'floor', label: 'The floor' }, { id: 'wall', label: 'The wall' }];
const draw = (step) => render(
  <Options step={step} schema={schema} choices={choices} variant={variant} size={size} adds={adds} mountings={mountings} onChange={() => {}} />,
);

describe('one step at a time', () => {
  it('shows only the size controls on the size step', () => {
    draw('size');
    expect(screen.getByText('Depth')).toBeTruthy();
    expect(screen.getByText('Height')).toBeTruthy();
    expect(screen.queryByText('Bays')).toBeNull();
    expect(screen.queryByText('Extra shelf')).toBeNull();
  });

  it('puts shelves on the storage step, by their group', () => {
    draw('storage');
    expect(screen.getByText('Extra shelf')).toBeTruthy();
    expect(screen.queryByText('Clothes rail')).toBeNull();
  });

  it('puts everything else on the accessories step, including an add with no group', () => {
    draw('accessories');
    expect(screen.getByText('Clothes rail')).toBeTruthy();
    expect(screen.getByText('Hook strip')).toBeTruthy();
    expect(screen.queryByText('Extra shelf')).toBeNull();
  });

  it('tells you how to set one bay on the bays step', () => {
    draw('bays');
    expect(screen.getByText(/Tap the line between two ladders/)).toBeTruthy();
  });

  it('shows the mounting on its own step', () => {
    draw('mounting');
    expect(screen.getByText('Standing on')).toBeTruthy();
    expect(screen.queryByText('Depth')).toBeNull();
  });

  it('still shows everything when no step is given (the embed and older callers)', () => {
    draw(null);
    for (const t of ['Depth', 'Bays', 'Extra shelf', 'Clothes rail', 'Standing on']) expect(screen.getByText(t)).toBeTruthy();
  });
});

describe('YouK\'s schema names a step for every accessory', () => {
  const guided = JSON.parse(readFileSync('youk/guided.json', 'utf8'));
  it('has a group on every add, and only the two the flow knows', () => {
    for (const v of guided.variants) {
      for (const s of v.sizes) {
        for (const a of s.adds || []) expect(['storage', 'accessories'], `${v.id}/${s.id}/${a.kind}`).toContain(a.group);
      }
    }
  });
});

describe('the tokens', () => {
  const tokens = readFileSync('src/viewer/tokens.css', 'utf8');
  const neutral = tokens.slice(tokens.indexOf('.cfg-theme {'), tokens.indexOf('.cfg-theme[data-cfg-theme'));
  const defined = new Set([...neutral.matchAll(/--(cfg-[\w-]+):/g)].map((m) => m[1]));

  for (const file of ['viewer.css', 'options.css', 'move.css', 'configurator.css']) {
    it(`defines every token ${file} uses`, () => {
      const css = readFileSync(`src/viewer/${file}`, 'utf8');
      const used = [...new Set([...css.matchAll(/var\(--(cfg-[\w-]+)\)/g)].map((m) => m[1]))];
      expect(used.length).toBeGreaterThan(0);
      for (const t of used) expect(defined.has(t), `--${t} in ${file}`).toBe(true);
    });
  }

  it('leaves no hard-coded colour in the runtime stylesheets', () => {
    // Shadows may stay rgba black; every other colour is a token, or a theme
    // could not change it.
    for (const file of ['viewer.css', 'options.css', 'move.css', 'configurator.css']) {
      const css = readFileSync(`src/viewer/${file}`, 'utf8');
      expect(css.match(/#[0-9a-f]{3,8}\b/gi) || [], file).toEqual([]);
    }
  });

  it('scopes them to the instance, never the page', () => {
    // Two configurators on one page may wear different themes (§2).
    const code = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/:root/);
  });
});

describe('the layout', () => {
  const css = readFileSync('src/viewer/configurator.css', 'utf8');
  it('keeps the rail on a wide screen, even while it is [hidden] for a phone', () => {
    expect(css).toMatch(/@media \(min-width: 721px\)[^@]*\.cfgc-rail\[hidden\] \{ display: flex !important; \}/);
  });
  it('puts the product before the step on a phone', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(phone).toMatch(/\.cfgc-stage \{ order: 1;/);
    expect(phone).toMatch(/\.cfgc-rail \{ order: 2;/);
  });
});
