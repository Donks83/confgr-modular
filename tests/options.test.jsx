// @vitest-environment jsdom
//
// The controls a customer gets. Rendered rather than reasoned about, for the
// same reason `ArButton` is: `Options` holds no state, so what it draws is a
// pure function of the choices it was handed, and that is exactly the kind of
// thing that quietly stops being true.
//
// Three claims worth a test:
//
//   1. A refusal appears NEXT TO the control it refers to. The engine can only
//      fit three shelves in a bay with three free rungs; a stepper that stops
//      going up with no explanation is indistinguishable from a broken one.
//   2. Ceilings are enforced in the UI as well as in the engine, so a person
//      cannot sit on + watching nothing happen.
//   3. A group with one option is not drawn at all. The 200 mm range has one
//      width in some schemas, and a "choice" of one is furniture, not a choice.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import Options from '../src/viewer/Options.jsx';
import { MOUNTING } from '../src/engine/ar.js';

afterEach(cleanup);

const SHELF = 'shelf-900';
const RAIL = 'rail-900';

const variant = {
  id: 'd320',
  label: '320 deep',
  help: 'The full range.',
  maxBays: 3,
  frames: [
    { componentId: 'frame-905', label: '905 tall' },
    { componentId: 'frame-1500', label: '1500 tall' },
  ],
  sizes: [
    { id: 'w600', label: '600 wide' },
    { id: 'w900', label: '900 wide' },
  ],
};

const size = {
  id: 'w900',
  label: '900 wide',
  span: { componentId: SHELF },
  adds: [
    { componentId: SHELF, label: 'Extra shelf', max: 4, spans: true },
    { componentId: RAIL, label: 'Clothes rail', max: 1, spans: true },
  ],
};

const schema = { version: 1, variants: [variant, { id: 'd200', label: '200 deep', sizes: [], frames: [] }] };

const choices = {
  variantId: 'd320',
  sizeId: 'w900',
  frameId: 'frame-1500',
  bays: 2,
  adds: { [SHELF]: 3 },
  mounting: MOUNTING.FEET,
};

const draw = (props = {}) => render(
  <Options
    schema={schema}
    choices={choices}
    variant={variant}
    size={size}
    mountings={[
      { id: MOUNTING.FLOOR, label: 'The floor' },
      { id: MOUNTING.FEET, label: 'Feet' },
    ]}
    onChange={() => {}}
    {...props}
  />,
);

const stepper = (label) => {
  const row = [...document.querySelectorAll('.cfgo-row')]
    .find((r) => r.querySelector('.cfgo-rowlabel').textContent === label);
  return {
    row,
    count: row.querySelector('.cfgo-count').textContent,
    minus: row.querySelectorAll('.cfgo-step')[0],
    plus: row.querySelectorAll('.cfgo-step')[1],
    note: row.querySelector('.cfgo-note')?.textContent || null,
  };
};

describe('what the panel offers', () => {
  it('draws a group for each real decision', () => {
    draw();
    const labels = [...document.querySelectorAll('.cfgo-label')].map((e) => e.textContent);
    expect(labels).toContain('Depth');
    expect(labels).toContain('Width');
    expect(labels).toContain('Height');
    expect(labels).toContain('Add to it');
  });

  it('marks the current choice, and only that one', () => {
    draw();
    const on = [...document.querySelectorAll('.cfgo-segbtn.cfgo-on')].map((b) => b.textContent);
    expect(on).toEqual(['320 deep', '900 wide', '1500 tall', 'Feet']);
  });

  it('does not draw a choice of one', () => {
    // A single-option "choice" is furniture. The 200 mm range genuinely has one
    // width in some schemas and the control would just sit there.
    draw({ mountings: [{ id: MOUNTING.FLOOR, label: 'The floor' }] });
    const labels = [...document.querySelectorAll('.cfgo-label')].map((e) => e.textContent);
    expect(labels).not.toContain('Standing on');
  });

  it('shows the counts it was given', () => {
    draw();
    expect(stepper('Bays').count).toBe('2');
    expect(stepper('Extra shelf').count).toBe('3');
    expect(stepper('Clothes rail').count).toBe('0');
  });
});

describe('what the panel refuses to let you do', () => {
  it('will not go below one bay', () => {
    draw({ choices: { ...choices, bays: 1 } });
    expect(stepper('Bays').minus.disabled).toBe(true);
  });

  // One render per test. `stepper()` queries the whole document, so a second
  // `draw()` in the same test finds the FIRST render's rows and quietly asserts
  // about the wrong thing - which is what this pair of tests was at first.
  it('will not go past the bay ceiling', () => {
    draw({ choices: { ...choices, bays: 3 } });
    expect(stepper('Bays').plus.disabled).toBe(true);
  });

  it('will not go past an accessory ceiling', () => {
    draw({ choices: { ...choices, adds: { [RAIL]: 1 } } });
    expect(stepper('Clothes rail').plus.disabled).toBe(true);
  });

  it('will not go below none of an accessory', () => {
    draw();
    expect(stepper('Clothes rail').minus.disabled).toBe(true);
  });

  it('raises a per-bay ceiling with the bays', () => {
    const perBay = {
      ...size,
      adds: [{ componentId: RAIL, label: 'Clothes rail', max: 1, perBay: true }],
    };
    draw({ size: perBay, choices: { ...choices, bays: 3, adds: { [RAIL]: 2 } } });
    expect(stepper('Clothes rail').plus.disabled).toBe(false);
  });
});

describe('telling somebody why', () => {
  it('puts the engine\'s refusal next to the control that caused it', () => {
    draw({
      refused: [{ componentId: SHELF, label: 'Extra shelf', placed: 3, asked: 5, reason: 'x' }],
    });
    expect(stepper('Extra shelf').note).toBe('only 3 fit');
    // And nowhere else — a note on the wrong row is worse than none.
    expect(stepper('Clothes rail').note).toBe(null);
  });

  it('says so when not even one would go on', () => {
    draw({
      refused: [{ componentId: RAIL, label: 'Clothes rail', placed: 0, asked: 1, reason: 'x' }],
    });
    expect(stepper('Clothes rail').note).toBe('no room for one');
  });
});

describe('reporting a change', () => {
  it('sends back the whole choice set, patched', () => {
    // A partial choice set would reach `normaliseChoices` as a request to reset
    // everything the panel did not mention.
    const onChange = vi.fn();
    draw({ onChange });
    stepper('Bays').plus.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith({ ...choices, bays: 3 });
  });

  it('reports a switch of depth without touching anything else', () => {
    const onChange = vi.fn();
    draw({ onChange });
    screen.getByText('200 deep').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith({ ...choices, variantId: 'd200' });
  });
});

// An option that can never be placed on the chosen frame. Matt's sweep found
// eighteen combinations where pressing + refused and left the count where it
// was, which is a control that looks live until it is used. He chose greying
// the row with the reason over hiding it: a list whose rows come and go as the
// depth changes reads as things going missing.
describe('an option that cannot go on this frame', () => {
  const dead = { [RAIL]: { ok: false, kind: 'never', reason: 'not available on 200 mm deep frames' } };

  it('greys the row and says why', () => {
    draw({ availability: dead });
    const rail = stepper('Clothes rail');
    expect(rail.row.className).toContain('cfgo-rowoff');
    expect(rail.note).toBe('not available on 200 mm deep frames');
  });

  it('disables both ends of the stepper, not just plus', () => {
    draw({ availability: dead });
    const rail = stepper('Clothes rail');
    expect(rail.plus.disabled).toBe(true);
    expect(rail.minus.disabled).toBe(true);
  });

  it('leaves every other row alone', () => {
    draw({ availability: dead });
    const shelf = stepper('Extra shelf');
    expect(shelf.row.className).not.toContain('cfgo-rowoff');
    expect(shelf.plus.disabled).toBe(false);
  });

  // 'full' is a different claim - it fits, there is just nowhere free right
  // now - so it carries the sentence without killing the control. Adding a bay
  // is the action, and a dead + cannot lead anybody to it.
  it('a full product says so without disabling the control', () => {
    draw({ availability: { [RAIL]: { ok: false, kind: 'full', reason: 'no room left - add a bay' } } });
    const rail = stepper('Clothes rail');
    expect(rail.note).toBe('no room left - add a bay');
    expect(rail.row.className).not.toContain('cfgo-rowoff');
    expect(rail.plus.disabled).toBe(false);
  });

  // Both questions can answer at once, and they explain different things. The
  // unavailable sentence is the one that says why the control is dead, so
  // printing "only 2 fit" over the top of it would explain the wrong thing.
  it('the unavailable reason wins over a shortfall', () => {
    draw({
      availability: dead,
      refused: [{ componentId: RAIL, label: 'Clothes rail', placed: 2, asked: 3 }],
    });
    expect(stepper('Clothes rail').note).toBe('not available on 200 mm deep frames');
  });
});
