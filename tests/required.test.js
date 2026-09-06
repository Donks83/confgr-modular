// A part that is only held at one end.
//
// `snap.required` existed from the first session and nothing ever set it -
// component.js said "set in the editor, not in the model" and there was no
// editor. So `validateAssembly` dutifully reported that every assembly was
// complete, including the two that are not:
//
//   * a CARCASE dropped on one bracket, with its other end in the air
//   * an office DESKTOP resting on one arm, which is the same part family and
//     therefore the same fault
//
// Both are cantilevers. A carcase is a board laid across two brackets and
// screwed up from below (`Carcass holder` step 3); it holds itself up in no
// other way, so one bracket is not half a fitting.
//
// The requirement turns out to belong in the MODEL after all, not in an editor:
// it is a fact about the part, and there is no carcase in the range that rests
// on one support. `carcase_snaps` sets it and nothing per-configuration can.

import { describe, it, expect } from 'vitest';
import { resolveTransforms, validateAssembly } from '../src/engine/assembly.js';
import { attachAt } from '../src/engine/attach.js';
import { extractComponent } from '../src/engine/component.js';

const MASK = 'youk-carcase-d320';

const snap = (id, mask, label, role, position, facing) => ({
  id, mask, label, position, facing, required: false, condition: null, role, span: null, roll: 0,
});

/** A ladder, so a bay can be built and the brackets have somewhere to hang. */
const LADDER = {
  id: 'ladder',
  dimsMm: { widthMm: 30, heightMm: 1500, depthMm: 320 },
  body: { min: [-0.015, 0, -0.16], max: [0.015, 1.5, 0.16] },
  front: [0, 0, -1],
  wallFixings: 2,
  snaps: [
    snap('rung-1-right', 'youk-d320', 'rung-1-right', 'socket', [0, 0.81, 0], [1, 0, 0]),
    snap('rung-1-left', 'youk-d320', 'rung-1-left', 'socket', [0, 0.81, 0], [-1, 0, 0]),
  ],
  grids: [], options: [], triangleCount: 100,
};

/** A cabinet bracket: hooks a rung, offers a flat socket for what it carries. */
const BRACKET = {
  id: 'bracket',
  dimsMm: { widthMm: 315, heightMm: 8, depthMm: 315 },
  body: { min: [-0.1575, 0, -0.1575], max: [0.1575, 0.008, 0.1575] },
  front: null,
  wallFixings: 0,
  snaps: [
    snap('hook', 'youk-d320', 'hook', 'plug', [0, 0.0065, 0], [1, 0, 0]),
    snap('carries', MASK, 'carries', 'socket', [0, 0.0095, 0], [0, 1, 0]),
  ],
  grids: [], options: [], triangleCount: 100,
};

/** The carcase: a plug at each end, on its underside, and BOTH are required. */
const HALF = 0.88990 / 2;
const CARCASE = {
  id: 'carcase',
  dimsMm: { widthMm: 890, heightMm: 450, depthMm: 320 },
  body: { min: [-0.445, 0, -0.16], max: [0.445, 0.45, 0.16] },
  front: null,
  wallFixings: 0,
  snaps: [
    { ...snap('rest-left', MASK, 'rest-left', 'plug', [-HALF, 0, 0], [0, -1, 0]), required: true },
    { ...snap('rest-right', MASK, 'rest-right', 'plug', [HALF, 0, 0], [0, -1, 0]), required: true },
  ],
  grids: [], options: [], triangleCount: 100,
};

const components = new Map([LADDER, BRACKET, CARCASE].map((c) => [c.id, c]));

const anchored = () => ({
  instances: [{
    instanceId: 'l1', componentId: 'ladder',
    position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
  }],
  connections: [],
});

/** A bay with one bracket, and a carcase laid on it by its LEFT end only. */
function cantilever() {
  const withBracket = attachAt(anchored(), {
    point: { instanceId: 'l1', snapId: 'rung-1-right' },
    componentId: 'bracket',
    mountSnapId: 'hook',
  }, 'b1');
  return attachAt(withBracket, {
    point: { instanceId: 'b1', snapId: 'carries' },
    componentId: 'carcase',
    mountSnapId: 'rest-left',
  }, 'c1');
}

const validate = (assembly) => validateAssembly(
  assembly, components, resolveTransforms(assembly, components).transforms,
);

describe('declaring that a snap must be filled', () => {
  const scene = (required) => ({
    name: 'carcase',
    extras: {
      confgr: { widthMm: 890, heightMm: 450, depthMm: 320 },
      confgrRoles: { [`md-snap.${MASK}.rest-left`]: 'plug' },
      ...(required ? { confgrRequired: { [`md-snap.${MASK}.rest-left`]: true } } : {}),
    },
    nodes: [
      {
        name: 'body', translation: [0, 0, 0], rotation: [0, 0, 0, 1],
        min: [-0.445, 0, -0.16], max: [0.445, 0.45, 0.16],
        vertexCount: 8, triangleCount: 12,
      },
      {
        name: `md-snap.${MASK}.rest-left`, translation: [-HALF, 0, 0],
        rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
        min: [-0.02, -0.02, 0], max: [0.02, 0.02, 0],
        vertexCount: 4, triangleCount: 2,
      },
    ],
  });

  it('reads it off the model', () => {
    expect(extractComponent(scene(true)).snaps[0].required).toBe(true);
  });

  // The old default, kept: a snap says nothing unless the pipeline says so.
  it('defaults to not required', () => {
    expect(extractComponent(scene(false)).snaps[0].required).toBe(false);
  });
});

describe('a cabinet carried at one end', () => {
  it('is not a buildable assembly', () => {
    const result = validate(cantilever());
    expect(result.isValid).toBe(false);
    expect(result.missingRequiredSnaps).toHaveLength(1);
  });

  it('names the part and the end that is in the air', () => {
    const [missing] = validate(cantilever()).missingRequiredSnaps;
    expect(missing.instanceId).toBe('c1');
    expect(missing.label).toBe('rest-right');
  });

  // The number somebody needs in order to fix it. "A required point is empty"
  // is not an actionable sentence about a cabinet whose end is in the air.
  it('says WHERE, in world millimetres', () => {
    const [missing] = validate(cantilever()).missingRequiredSnaps;
    // The bracket's hook meets the rung 810 up, which puts its own base at
    // 803.5, and it carries at 9.5 above that: 813. The carcase's free end is
    // 889.9 along from the one that is held, so 890 to the millimetre.
    expect(missing.atMm[0]).toBe(890);
    expect(missing.atMm[1]).toBe(813);
  });
});

describe('a cabinet carried at both ends', () => {
  // Two brackets, then the carcase across them - the order the instruction
  // sheet uses and the order the probe scenarios build in.
  function supported() {
    const a = cantilever();
    // The second bracket, on the far ladder, hanging its `carries` socket
    // exactly under the carcase's free end. Placed rather than attached,
    // because that is the situation being tested: the box IS carried and the
    // graph does not say so.
    return {
      ...a,
      instances: [...a.instances, {
        instanceId: 'b2',
        componentId: 'bracket',
        position: [2 * HALF, 0.8035, 0],
        rotation: [0, 0, 0, 1],
        freeMove: true,
      }],
    };
  }

  // THE POINT. The requirement is met by geometry, not by the graph: the second
  // bracket is right there under the free end. The first version of this asked
  // `connections` and reported a cantilever on the `carcase` scenario, which
  // fits both brackets and is correct - the probe caught it.
  it('is buildable, though no joint to the second bracket is recorded', () => {
    const a = supported();
    expect(a.connections.some((c) => c.toInstanceId === 'b2')).toBe(false);
    const result = validate(a);
    expect(result.missingRequiredSnaps).toEqual([]);
    expect(result.isValid).toBe(true);
  });

  // A bracket at the right height on the WRONG ladder does not hold anything,
  // and a tolerance loose enough to think it does would be worse than no check.
  it('is not satisfied by a bracket that is merely nearby', () => {
    const a = cantilever();
    // A second bracket 5 mm short of where the box needs it.
    const near = {
      ...a,
      instances: [...a.instances, {
        instanceId: 'b2',
        componentId: 'bracket',
        position: [2 * HALF - 0.005, 0.8035, 0],
        rotation: [0, 0, 0, 1],
        freeMove: true,
      }],
    };
    expect(validate(near).missingRequiredSnaps).toHaveLength(1);
  });
});

describe('what this does NOT make required', () => {
  // A bracket with nothing on it is a bracket somebody has not finished
  // choosing, not an error. Only the CARRIED part knows it needs two supports.
  it('leaves a bare bracket alone', () => {
    const withBracket = attachAt(anchored(), {
      point: { instanceId: 'l1', snapId: 'rung-1-right' },
      componentId: 'bracket',
      mountSnapId: 'hook',
    }, 'b1');
    expect(validate(withBracket).isValid).toBe(true);
  });

  it('leaves a bare ladder alone', () => {
    expect(validate(anchored()).isValid).toBe(true);
  });
});
