// @vitest-environment jsdom
//
// What a customer gets when they tap a part, and the slot bookkeeping behind
// the Remove button.
//
// The panel itself is nearly all judgement about what to SAY, which is exactly
// the kind of thing that rots: a structural part must read as a direction
// rather than a refusal, an accessory with nowhere to go must not look broken,
// and the destructive control must not sit next to the one somebody meant to
// press.
//
// `removeSlot` is here rather than in the engine tests because it is the
// panel's half of the slot model and it is where the off-by-one lives.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import MovePanel from '../src/viewer/MovePanel.jsx';
import { removeSlot } from '../src/viewer/Guided.jsx';

afterEach(cleanup);

const heights = [
  { heightMm: 100, at: { instanceId: 'g1', snapId: 'a' }, current: true, held: 2, heldOf: 2 },
  { heightMm: 455, at: { instanceId: 'g1', snapId: 'b' }, current: false, held: 2, heldOf: 2 },
  { heightMm: 810, at: { instanceId: 'g1', snapId: 'c' }, current: false, held: 2, heldOf: 2 },
];

const draw = (props = {}) => render(
  <MovePanel
    label="Clothes rail"
    options={heights}
    onMove={() => {}}
    onDelete={() => {}}
    onClose={() => {}}
    {...props}
  />,
);

const buttons = () => [...document.querySelectorAll('.cfgm-height')]
  .map((b) => b.textContent + (b.className.includes('cfgm-on') ? '*' : ''));

describe('the move panel', () => {
  it('names the part and offers every height', () => {
    draw();
    expect(screen.getByText('Clothes rail')).toBeTruthy();
    expect(buttons()).toEqual(['100 mm*', '455 mm', '810 mm']);
  });

  it('reports the height that was chosen', () => {
    const onMove = vi.fn();
    draw({ onMove });
    screen.getByText('810 mm').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onMove).toHaveBeenCalledWith(heights[2]);
  });

  it('closes rather than moving when the current height is pressed', () => {
    // Re-recording the position it already has would be a no-op that still
    // rewrites the URL and the configuration id.
    const onMove = vi.fn();
    const onClose = vi.fn();
    draw({ onMove, onClose });
    screen.getByText('100 mm').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onMove).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('reads as a direction, not a refusal, for a structural part', () => {
    // A frame is not a failure. "Change the size or the number of bays" is the
    // actual answer, and it gets its own quieter styling for that reason.
    const { container } = draw({
      options: [],
      reason: 'That is part of the frame. Change the size or the number of bays instead.',
      structural: true,
      canDelete: false,
    });
    expect(container.querySelector('.cfgm-structural')).toBeTruthy();
    expect(container.querySelector('.cfgm-height')).toBeNull();
    // And no way to delete a frame from here.
    expect(container.querySelector('.cfgm-delete')).toBeNull();
  });

  it('says so when an accessory has nowhere else to go', () => {
    // Rather than a panel with one dead button in it, which looks broken.
    draw({ options: [heights[0]] });
    expect(screen.getByText(/nowhere else/i)).toBeTruthy();
  });

  it('keeps Remove away from the heights', () => {
    // Not a style point: a destructive control sharing an edge with the one
    // somebody is aiming for is how it gets pressed by accident.
    const { container } = draw();
    const last = [...container.querySelectorAll('.cfgm-height')].pop();
    const remove = container.querySelector('.cfgm-delete');
    expect(remove).toBeTruthy();
    expect(remove.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_PRECEDING)
      .toBeTruthy();
  });
});

describe('removing the nth of something', () => {
  const RAIL = 'rail';
  const SHELF = 'shelf';

  it('drops the count and the position together', () => {
    const next = removeSlot(
      { adds: { [RAIL]: 1 }, at: { 'rail#0': { instanceId: 'g1', snapId: 'a' } } },
      RAIL,
      0,
    );
    expect(next.adds[RAIL]).toBeUndefined();
    expect(next.at).toEqual({});
  });

  it('shifts the positions above the hole down', () => {
    // THE OFF-BY-ONE. Removing the second of three shelves makes the third one
    // the second, so a position recorded against #2 now describes what used to
    // be #1's neighbour. Without the shift, deleting a shelf silently moved the
    // ones above it to positions chosen for different parts.
    const next = removeSlot(
      {
        adds: { [SHELF]: 3 },
        at: {
          'shelf#0': { instanceId: 'g1', snapId: 'low' },
          'shelf#1': { instanceId: 'g1', snapId: 'mid' },
          'shelf#2': { instanceId: 'g1', snapId: 'high' },
        },
      },
      SHELF,
      1,
    );
    expect(next.adds[SHELF]).toBe(2);
    expect(next.at).toEqual({
      'shelf#0': { instanceId: 'g1', snapId: 'low' },
      'shelf#1': { instanceId: 'g1', snapId: 'high' },
    });
  });

  it('leaves other components alone', () => {
    const next = removeSlot(
      {
        adds: { [SHELF]: 2, [RAIL]: 1 },
        at: {
          'shelf#1': { instanceId: 'g1', snapId: 'x' },
          'rail#0': { instanceId: 'g1', snapId: 'y' },
        },
      },
      SHELF,
      0,
    );
    expect(next.adds).toEqual({ [SHELF]: 1, [RAIL]: 1 });
    expect(next.at['rail#0']).toEqual({ instanceId: 'g1', snapId: 'y' });
    expect(next.at['shelf#0']).toEqual({ instanceId: 'g1', snapId: 'x' });
  });

  it('refuses an index that is not there', () => {
    const before = { adds: { [RAIL]: 1 }, at: {} };
    expect(removeSlot(before, RAIL, 3)).toBe(before);
    expect(removeSlot(before, 'nothing-like-it', 0)).toBe(before);
  });
});
