// @vitest-environment jsdom
//
// What the line opens.
//
// Rendered rather than reasoned about, for the same reason `Options` and
// `MovePanel` are: it holds no state, so what it draws is a pure function of
// what it was handed, and that is exactly the kind of thing that quietly stops
// being true.
//
// The claims:
//
//   1. It names the two ladders it sits between, counting from one, because
//      "bay 2" is a number somebody has to map onto the product in front of
//      them and "between ladder 2 and 3" is not.
//   2. Choosing a width reports the OPTION, not a string, so the caller writes
//      `widths[bay] = option.id` without parsing a label.
//   3. Choosing the width it already has closes the panel instead of writing
//      the same choice back - the same behaviour the height list has, and the
//      only way out for somebody who opened it by accident.
//   4. The measured centres are shown, and they are not the label.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import SpacingPanel from '../src/viewer/SpacingPanel.jsx';

afterEach(cleanup);

const options = [
  { id: 'w450', label: '450 mm wide' },
  { id: 'w600', label: '600 mm wide' },
  { id: 'w900', label: '900 mm wide', current: true },
  { id: 'w1200', label: '1200 mm wide' },
];

const draw = (props = {}) => {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(
    <SpacingPanel
      bay={1}
      options={options}
      centresMm={920}
      onChoose={onChoose}
      onClose={onClose}
      {...props}
    />,
  );
  return { onChoose, onClose };
};

describe('the spacing panel', () => {
  it('names the two ladders it sits between', () => {
    draw();
    expect(screen.getByText('Between ladder 2 and 3')).toBeTruthy();
  });

  it('offers every width it was given', () => {
    draw();
    for (const o of options) expect(screen.getByText(o.label)).toBeTruthy();
  });

  it('marks the one in use', () => {
    draw();
    expect(screen.getByText('900 mm wide').getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('600 mm wide').getAttribute('aria-current')).toBe(null);
  });

  it('reports the option rather than its label', () => {
    const { onChoose } = draw();
    fireEvent.click(screen.getByText('1200 mm wide'));
    expect(onChoose).toHaveBeenCalledWith(options[3]);
  });

  it('closes rather than rewriting the width it already has', () => {
    const { onChoose, onClose } = draw();
    fireEvent.click(screen.getByText('900 mm wide'));
    expect(onChoose).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // The number that is true of the product, next to the label that is on the
  // box. A YouK 900 bay stands its ladders 920 mm apart.
  it('shows the measured centres', () => {
    draw();
    expect(screen.getByText('Ladder centres 920 mm apart')).toBeTruthy();
  });

  it('leaves the measurement out when there is none', () => {
    draw({ centresMm: null });
    expect(screen.queryByText(/Ladder centres/)).toBe(null);
  });

  // A range with one width is not a choice, and a panel with one dead button
  // in it invites somebody to look for the others.
  it('says so when there is nothing to choose', () => {
    draw({ options: [] });
    expect(screen.getByText(/one width/)).toBeTruthy();
  });

  // The bay count is the Bays stepper's business. Offering "remove" on a gap
  // would either take a bay out of the middle of a run or do nothing.
  it('does not offer to remove the bay', () => {
    draw();
    expect(screen.queryByText(/Remove/)).toBe(null);
  });
});
