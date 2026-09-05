// The `condition` field, which sat on every snap doing nothing until the range
// produced a rule that masks and roles cannot express.
//
// `mounting instructions Office solution.pdf` page 3 opens with a tick and a
// cross over four ladders: a green dashed line across one rung level, red across
// two others. Matt read it correctly and I did not - it marks the only levels at
// which the office desktop assembly may be fitted. A mask says what KIND of
// thing fits a point; a role says which way round; neither can say "this kind,
// but only there".
//
// Three properties are worth pinning down, and each is a describe block:
//
//   1. The evaluator is a CLOSED vocabulary, not an expression language. There
//      is nothing to parse and nothing to execute, and an unrecognised clause
//      refuses rather than guesses - a rule that is mis-authored shows up as a
//      part that will not fit, never as a rule that quietly does nothing.
//   2. The rule is symmetric: it is checked whichever end of the joint carries
//      it, because the arriving part is sometimes a and sometimes b.
//   3. It has to be able to SAY why. A configurator that refuses without a
//      reason is indistinguishable from one that is broken.

import { describe, it, expect } from 'vitest';
import {
  canConnectLogically, evaluateCondition, REASONS,
} from '../src/engine/snapMatch.js';
import { attachMatrix, whyComponentFitsNowhere } from '../src/engine/attach.js';

const RUNG_3_AND_UP = {
  otherLabelAnyOf: [
    'rung-3-right', 'rung-3-left', 'rung-4-right', 'rung-4-left',
    'rung-5-right', 'rung-5-left', 'rung-6-right', 'rung-6-left',
  ],
  because: 'The office desktop assembly fits at rung 3 and above only.',
};

const socket = (label) => ({
  id: label, mask: 'youk-d320', label, role: 'socket', condition: null,
});
const plug = (condition = null) => ({
  id: 'mount', mask: 'youk-d320', label: 'mount', role: 'plug', condition,
});

describe('the condition evaluator', () => {
  it('passes a snap with no condition', () => {
    expect(evaluateCondition(null, { other: socket('rung-1-right') })).toBe(true);
  });

  it('allows a label on the list', () => {
    expect(evaluateCondition(RUNG_3_AND_UP, { other: socket('rung-3-left') })).toBe(true);
  });

  it('refuses a label that is not', () => {
    expect(evaluateCondition(RUNG_3_AND_UP, { other: socket('rung-1-right') })).toBe(false);
    expect(evaluateCondition(RUNG_3_AND_UP, { other: socket('rung-2-left') })).toBe(false);
  });

  // The three failing-closed cases. Each is a way of writing a condition wrong,
  // and every one of them has to refuse rather than pass - a rule that silently
  // stops applying is the hardest kind of wrong to notice.
  it('refuses a clause it does not know', () => {
    expect(evaluateCondition({ rungIndexAbove: 3 }, { other: socket('rung-4-left') }))
      .toBe(false);
  });

  it('refuses a condition with only a because, which tests nothing', () => {
    expect(evaluateCondition({ because: 'no reason at all' }, { other: socket('rung-4-left') }))
      .toBe(false);
  });

  it('refuses a condition that is not a clause object', () => {
    expect(evaluateCondition('rung >= 3', { other: socket('rung-4-left') })).toBe(false);
    expect(evaluateCondition(['rung-3-left'], { other: socket('rung-3-left') })).toBe(false);
  });

  it('refuses an otherLabelAnyOf that is not a list', () => {
    expect(evaluateCondition({ otherLabelAnyOf: 'rung-3-left' }, { other: socket('rung-3-left') }))
      .toBe(false);
  });
});

describe('a condition inside the connect rules', () => {
  it('lets the joint through at an allowed rung', () => {
    const r = canConnectLogically(plug(RUNG_3_AND_UP), socket('rung-3-right'));
    expect(r.ok).toBe(true);
  });

  it('refuses it at a forbidden one, and names the reason', () => {
    const r = canConnectLogically(plug(RUNG_3_AND_UP), socket('rung-1-right'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASONS.CONDITION_FAILED);
  });

  it('carries the authored words back, not a generic string', () => {
    const r = canConnectLogically(plug(RUNG_3_AND_UP), socket('rung-1-right'));
    expect(r.message).toBe(RUNG_3_AND_UP.because);
  });

  // Whichever side carries the rule. attachMatrix calls this with the arriving
  // part's snap first, the drag path called it the other way round, and a rule
  // that only worked one way would look like an intermittent bug.
  it('applies whichever end of the joint carries it', () => {
    const forwards = canConnectLogically(plug(RUNG_3_AND_UP), socket('rung-1-right'));
    const backwards = canConnectLogically(socket('rung-1-right'), plug(RUNG_3_AND_UP));
    expect(forwards.ok).toBe(false);
    expect(backwards.ok).toBe(false);
    expect(backwards.message).toBe(RUNG_3_AND_UP.because);
  });

  // Order of checks matters. A part that clashes on role AND fails a condition
  // should report the role, because that is the cheaper and more fundamental
  // fact - and because the condition's message would be misleading.
  it('reports a role clash ahead of a condition', () => {
    const a = { ...plug(RUNG_3_AND_UP), role: 'socket' };
    const r = canConnectLogically(a, socket('rung-1-right'));
    expect(r.reason).toBe(REASONS.ROLE_CLASH);
  });
});

describe('a whole part that fits nowhere because of a rule', () => {
  // The knock-on Kesseböhmer's own sheet implies and never states: the 550 mm
  // ladder has only rungs 1 and 2, both of them forbidden, so it cannot take a
  // desk at all. Nothing had to be written for that - it falls out.
  const shortFrame = {
    id: 'frame-550',
    dimsMm: { widthMm: 30, heightMm: 550, depthMm: 320 },
    body: { min: [0, 0, 0], max: [0.03, 0.55, 0.32] },
    snaps: [
      { ...socket('rung-1-right'), position: [0, 0.1, 0], facing: [1, 0, 0], span: null },
      { ...socket('rung-2-right'), position: [0, 0.455, 0], facing: [1, 0, 0], span: null },
    ],
    grids: [], options: [], triangleCount: 100,
  };

  const arm = {
    id: 'office-arm',
    dimsMm: { widthMm: 50, heightMm: 50, depthMm: 310 },
    body: { min: [0, 0, 0], max: [0.05, 0.05, 0.31] },
    snaps: [{
      ...plug(RUNG_3_AND_UP), position: [0.015, 0.0485, 0], facing: [-1, 0, 0], span: null,
    }],
    grids: [], options: [], triangleCount: 100,
  };

  const components = new Map([['frame-550', shortFrame], ['office-arm', arm]]);
  const assembly = {
    instances: [{ instanceId: 'i1', componentId: 'frame-550', position: [0, 0, 0] }],
    connections: [],
  };

  const matrixFor = () => attachMatrix(
    assembly, components, ['office-arm'],
    new Map([['i1', { translation: [0, 0, 0], rotation: [0, 0, 0, 1] }]]),
  );

  it('offers the arm nowhere on a 550 mm ladder', () => {
    const matrix = matrixFor();
    expect(matrix.placements.filter((p) => p.componentId === 'office-arm')).toHaveLength(0);
  });

  it('says why, in the rule\'s own words', () => {
    const matrix = matrixFor();
    expect(whyComponentFitsNowhere(matrix, 'office-arm')).toBe(RUNG_3_AND_UP.because);
  });

  it('returns null for a part that was never in the running', () => {
    const matrix = matrixFor();
    expect(whyComponentFitsNowhere(matrix, 'something-else')).toBe(null);
  });
});
