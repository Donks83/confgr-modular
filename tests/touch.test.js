// Targets big enough for a thumb, and a panel that closes.
//
// Matt, testing on Android: "the configure menu is still always visible on
// mobile (even when I click done) ... and its very difficult to click the snap
// markers (on mobile) can they be bigger or have a bigger/easier hit box".
//
// Three separate faults in one message, and the interesting thing is that two
// of them were the same shape as the AR button being unreachable: the code was
// right and the thing on screen was not usable.
//
//   1. `hidden` was inert. React set it, the attribute was correct, and
//      `.cfgg-panel { display: flex }` beat the browser's own
//      `[hidden] { display: none }` - which is the weakest rule in the cascade.
//   2. The dots were drawn at 14 mm, which is a couple of pixels on a phone.
//   3. A tap that travels more than 5 px became a drag, and a thumb travels
//      more than 5 px, so half the taps never selected anything.
//
// The cascade fault is a CSS fact jsdom cannot model, so it is covered here by
// reading the stylesheet and requiring the rule to exist. That is a weaker test
// than behaviour and it is honest about being one: it cannot prove the panel
// closes, but it does stop the rule being deleted by somebody tidying up.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  markerStyleFor, MARKER_MODE, HIT_SCALE, DRAG_THRESHOLD_PX, isCoarsePointer,
} from '../src/viewer/interact.js';

describe('a dot big enough to hit with a thumb', () => {
  it('draws bigger on a touch screen than under a mouse', () => {
    const mouse = markerStyleFor({}, { touch: false });
    const thumb = markerStyleFor({}, { touch: true });
    expect(thumb.radius).toBeGreaterThan(mouse.radius);
  });

  it('leaves the colours and opacity alone - only the size changes', () => {
    const mouse = markerStyleFor({}, { touch: false });
    const thumb = markerStyleFor({}, { touch: true });
    expect(thumb.color).toBe(mouse.color);
    expect(thumb.opacity).toBe(mouse.opacity);
  });

  it('still says a different thing in a different colour on touch', () => {
    const add = markerStyleFor({}, { mode: MARKER_MODE.ADD, touch: true });
    const moving = markerStyleFor({}, { mode: MARKER_MODE.MOVE, touch: true });
    expect(add.color).not.toBe(moving.color);
  });

  // The hit sphere has to be generous enough to matter and small enough not to
  // reach the next rung's dot. YouK rungs are 236.5 mm apart, so the radius has
  // to stay under half of that.
  it('has a hit box that beats a thumb without reaching the next rung', () => {
    const thumb = markerStyleFor({}, { touch: true });
    const hitRadiusMm = thumb.radius * HIT_SCALE * 1000;
    expect(hitRadiusMm).toBeGreaterThan(50);
    expect(hitRadiusMm).toBeLessThan(236.5 / 2);
  });

  it('keeps grid cells smaller than authored points, touch or not', () => {
    for (const touch of [false, true]) {
      const cell = markerStyleFor({ isGridCell: true }, { touch });
      const point = markerStyleFor({ isGridCell: false }, { touch });
      expect(cell.radius).toBeLessThan(point.radius);
    }
  });
});

describe('telling a tap from a drag', () => {
  // 5 px is right for a mouse. A deliberate tap with a thumb travels further
  // than that, and every one of those was being read as "pick this part up".
  it('has a mouse threshold tight enough to feel deliberate', () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThan(2);
    expect(DRAG_THRESHOLD_PX).toBeLessThan(8);
  });

  it('answers no to a coarse pointer when there is no matchMedia', () => {
    // Node, and the export has to survive being imported outside a browser -
    // the engine tests import this module for `markerStyleFor`.
    expect(isCoarsePointer()).toBe(false);
  });
});

describe('the options panel closes when Done is pressed', () => {
  const css = readFileSync(join(process.cwd(), 'src/viewer/options.css'), 'utf8');

  // A PROXY FOR A CASCADE FACT. React toggles the `hidden` attribute, which
  // works only through the UA stylesheet's `[hidden] { display: none }` - and
  // `.cfgg-panel { display: flex }` beats it. Without this rule the attribute
  // is set, correct and inert, which is precisely what Matt saw.
  it('overrides its own display for [hidden]', () => {
    expect(css).toMatch(/\.cfgg-panel\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  // And the wide-screen rail must still win, because there the panel is
  // permanent and there is nothing to dismiss - so the [hidden] rule must NOT
  // be !important.
  it('does not use !important, so the wide-screen rail can still override it', () => {
    const rule = css.match(/\.cfgg-panel\[hidden\]\s*\{[^}]*\}/)[0];
    expect(rule).not.toMatch(/!important/);
    expect(css).toMatch(/display:\s*flex\s*!important/);
  });
});
