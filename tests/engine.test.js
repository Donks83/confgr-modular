// Tests for the snap engine.
//
// These run without a renderer or a canvas, which is the whole reason the engine
// has no three.js dependency. They are also the Phase 0 answer: if these pass,
// snapping works, and the remaining question is only whether it FEELS right to
// drag — which no test can answer.

import { describe, it, expect } from 'vitest';
import { extractComponent, parseSnapName, ComponentError } from '../src/engine/component.js';
import {
  canConnect, canConnectLogically, canConnectGeometrically,
  findBestConnection, mostRelevantRejection, REASONS,
} from '../src/engine/snapMatch.js';
import {
  solveChildTransform, resolveTransforms, worldSnaps, validateAssembly, AssemblyError,
} from '../src/engine/assembly.js';
import { approxEqual, rotateVec, normalise } from '../src/engine/vec.js';

const R2 = Math.SQRT1_2;

// A described glTF scene, in the shape src/three/loadGlb.js produces.
function describeUnit({ name = 'unit-600', w = 0.6, h = 0.72, d = 0.56, mask = 'carcass-side' } = {}) {
  return {
    name,
    extras: { confgr: { widthMm: w * 1000, heightMm: h * 1000, depthMm: d * 1000 } },
    nodes: [
      {
        name: 'body', translation: [0, 0, 0], rotation: [0, 0, 0, 1],
        min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], vertexCount: 24, triangleCount: 12,
      },
      {
        name: `md-snap.${mask}.left`, translation: [-w / 2, h / 2, 0], rotation: [0, -R2, 0, R2],
        min: [-d / 2, -h / 2, 0], max: [d / 2, h / 2, 0], vertexCount: 4, triangleCount: 2,
      },
      {
        name: `md-snap.${mask}.right`, translation: [w / 2, h / 2, 0], rotation: [0, R2, 0, R2],
        min: [-d / 2, -h / 2, 0], max: [d / 2, h / 2, 0], vertexCount: 4, triangleCount: 2,
      },
      {
        name: 'col-body', translation: [0, 0, 0], rotation: [0, 0, 0, 1],
        min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], vertexCount: 24, triangleCount: 12,
      },
      {
        name: 'dim', translation: [0, 0, 0], rotation: [0, 0, 0, 1],
        min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], vertexCount: 24, triangleCount: 12,
      },
    ],
  };
}

describe('parseSnapName', () => {
  it('splits mask from label', () => {
    expect(parseSnapName('md-snap.carcass-side.left')).toEqual({ mask: 'carcass-side', label: 'left' });
  });

  it('keeps Blender duplicate suffixes in the label', () => {
    // Blender appends .001 to duplicated objects. If that ended up in the mask,
    // a duplicated snap would silently stop matching its own family.
    expect(parseSnapName('md-snap.carcass-side.left.001'))
      .toEqual({ mask: 'carcass-side', label: 'left.001' });
  });

  it('ignores nodes that are not snaps', () => {
    expect(parseSnapName('body')).toBeNull();
    expect(parseSnapName('col-body')).toBeNull();
  });

  it('rejects a snap with no label', () => {
    expect(() => parseSnapName('md-snap.carcass-side')).toThrow(ComponentError);
  });
});

describe('extractComponent — the AR-safe rules', () => {
  it('accepts a well-formed component', () => {
    const c = extractComponent(describeUnit());
    expect(c.dimsMm).toEqual({ widthMm: 600, heightMm: 720, depthMm: 560 });
    expect(c.snaps).toHaveLength(2);
    expect(c.collisionBox).toBe('present');
    expect(c.dimensionBox).toBe('present');
  });

  // Rule 1. This is the test that earns its keep: a stray scale factor is
  // invisible in a viewport and catastrophic in AR.
  it('refuses geometry that does not match its declared millimetres', () => {
    const desc = describeUnit();
    desc.extras.confgr.widthMm = 1200;   // claims 1200mm, geometry says 600
    expect(() => extractComponent(desc)).toThrow(/does not match the geometry/);
    try {
      extractComponent(desc);
    } catch (e) {
      expect(e.code).toBe('SCALE_MISMATCH');
      expect(e.detail.measured.widthMm).toBe(600);
    }
  });

  it('refuses a component with no declared size at all', () => {
    const desc = describeUnit();
    delete desc.extras.confgr;
    expect(() => extractComponent(desc)).toThrow(/does not declare its real-world size/);
  });

  // Rule 2.
  it('refuses a component whose origin is not at the base', () => {
    const desc = describeUnit();
    desc.nodes[0].min = [-0.3, -0.36, -0.28];
    desc.nodes[0].max = [0.3, 0.36, 0.28];
    expect(() => extractComponent(desc)).toThrow(/Origin must be at the base centre/);
  });

  it('refuses a component that is off-centre in plan', () => {
    const desc = describeUnit();
    desc.nodes[0].min = [0, 0, -0.28];
    desc.nodes[0].max = [0.6, 0.72, 0.28];
    expect(() => extractComponent(desc)).toThrow(/not centred on the origin/);
  });

  it('refuses a snap that is not a 4-vertex quad', () => {
    const desc = describeUnit();
    desc.nodes[1].vertexCount = 9;   // subdivided
    expect(() => extractComponent(desc)).toThrow(/expected exactly 4/);
  });

  it('refuses a snap with thickness', () => {
    const desc = describeUnit();
    desc.nodes[1].min = [-0.28, -0.36, -0.01];
    desc.nodes[1].max = [0.28, 0.36, 0.01];
    expect(() => extractComponent(desc)).toThrow(/not flat/);
  });

  // This used to be a refusal, and the refusal was wrong about this range.
  // Kesseböhmer's carcase-holder and office-solution sheets both describe a part
  // LAID ON its brackets and screwed up from below: its only mating face points
  // down, and rejecting that made the cabinets and the desktop unbuildable.
  // The check that a joint makes sense moved to solveChildTransform, which is
  // where both ends of it are visible - see tests/verticalJoint.test.js.
  it('accepts a snap facing straight up, and reports the facing', () => {
    const desc = describeUnit();
    desc.nodes[1].rotation = [-R2, 0, 0, R2];   // +Z rotated to +Y
    const component = extractComponent(desc);
    const up = component.snaps.find((s) => Math.abs(s.facing[1]) > 0.99);
    expect(up).toBeDefined();
    expect(up.facing[1]).toBeCloseTo(1, 6);
    expect(Math.hypot(up.facing[0], up.facing[2])).toBeCloseTo(0, 6);
  });

  // A component needs SOME attach point, but a grid counts — a MOLLE panel has
  // no authored snaps at all, only a generated field of them.
  it('refuses a component with no attach points of any kind', () => {
    const desc = describeUnit();
    desc.nodes = desc.nodes.filter((n) => !n.name.startsWith('md-snap'));
    expect(() => extractComponent(desc)).toThrow(/No attach points found/);
  });

  it('reports no grids on a component that has none', () => {
    expect(extractComponent(describeUnit()).grids).toEqual([]);
  });

  it('computes outward facings from node rotation', () => {
    const c = extractComponent(describeUnit());
    const left = c.snaps.find((s) => s.label === 'left');
    const right = c.snaps.find((s) => s.label === 'right');
    expect(approxEqual(left.facing, [-1, 0, 0])).toBe(true);
    expect(approxEqual(right.facing, [1, 0, 0])).toBe(true);
  });

  // Rule 3. Mimeeq's low-poly requirement is that mesh names match exactly
  // between detail levels. This pins the set so an optimiser that renames
  // something fails the build rather than quietly breaking AR later.
  it('records mesh names so detail levels can be compared', () => {
    const c = extractComponent(describeUnit());
    expect(c.meshNames).toEqual([
      'body', 'col-body', 'dim', 'md-snap.carcass-side.left', 'md-snap.carcass-side.right',
    ]);
  });
});

describe('snap matching — stage 1, logical', () => {
  const a = { mask: 'carcass-side', condition: null };
  const b = { mask: 'carcass-side', condition: null };

  it('matches identical masks', () => {
    expect(canConnectLogically(a, b).ok).toBe(true);
  });

  it('refuses different masks', () => {
    const wall = { mask: 'wall-side', condition: null };
    expect(canConnectLogically(a, wall)).toMatchObject({ ok: false, reason: REASONS.MASK_MISMATCH });
  });

  it('refuses a snap that is already in use', () => {
    expect(canConnectLogically(a, { ...b, occupied: true }))
      .toMatchObject({ ok: false, reason: REASONS.ALREADY_OCCUPIED });
  });

  it('refuses a part connecting to itself', () => {
    expect(canConnectLogically(a, b, { sameInstance: true }))
      .toMatchObject({ ok: false, reason: REASONS.SAME_INSTANCE });
  });

  // Failing closed matters: an unevaluated condition must not permit a joint.
  it('treats a condition with no evaluator as unmet', () => {
    expect(canConnectLogically({ ...a, condition: 'hasEndPanel == false' }, b))
      .toMatchObject({ ok: false, reason: REASONS.CONDITION_FAILED });
  });

  it('honours an evaluator when one is supplied', () => {
    const ctx = { evaluateCondition: () => true };
    expect(canConnectLogically({ ...a, condition: 'anything' }, b, ctx).ok).toBe(true);
  });
});

describe('snap matching — stage 2, geometric', () => {
  it('accepts coincident snaps with opposing facings', () => {
    const result = canConnectGeometrically(
      { worldPosition: [0.3, 0.36, 0], worldFacing: [1, 0, 0] },
      { worldPosition: [0.3, 0.36, 0], worldFacing: [-1, 0, 0] },
    );
    expect(result.ok).toBe(true);
    expect(result.distance).toBeCloseTo(0);
  });

  it('refuses snaps that are too far apart', () => {
    expect(canConnectGeometrically(
      { worldPosition: [0, 0, 0], worldFacing: [1, 0, 0] },
      { worldPosition: [2, 0, 0], worldFacing: [-1, 0, 0] },
    )).toMatchObject({ ok: false, reason: REASONS.TOO_FAR });
  });

  // The case Mimeeq's red/blue normal convention exists to prevent.
  it('refuses snaps that face the same way', () => {
    expect(canConnectGeometrically(
      { worldPosition: [0, 0, 0], worldFacing: [1, 0, 0] },
      { worldPosition: [0, 0, 0], worldFacing: [1, 0, 0] },
    )).toMatchObject({ ok: false, reason: REASONS.FACING_WRONG });
  });

  it('tolerates a little slop, since a person is dragging with a mouse', () => {
    const nudged = normalise([-1, 0, 0.15]);   // about 8.5 degrees off
    expect(canConnectGeometrically(
      { worldPosition: [0, 0, 0], worldFacing: [1, 0, 0] },
      { worldPosition: [0.04, 0, 0], worldFacing: nudged },
    ).ok).toBe(true);
  });
});

describe('solveChildTransform', () => {
  const component = extractComponent(describeUnit());
  const leftSnap = component.snaps.find((s) => s.label === 'left');
  const rightSnap = component.snaps.find((s) => s.label === 'right');

  it('places a unit flush to the right of another', () => {
    const parent = { translation: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const child = solveChildTransform(parent, rightSnap, leftSnap);

    // 600mm wide units, snaps on the outer faces, so centres end up 600mm apart.
    expect(approxEqual(child.translation, [0.6, 0, 0])).toBe(true);
    expect(approxEqual(rotateVec(child.rotation, [0, 0, 1]), [0, 0, 1])).toBe(true);
  });

  it('makes the two snap centres coincide exactly', () => {
    const parent = { translation: [1.4, 0, -0.7], rotation: [0, R2, 0, R2] };
    const child = solveChildTransform(parent, rightSnap, leftSnap);

    const parentSnapWorld = [
      parent.translation[0] + rotateVec(parent.rotation, rightSnap.position)[0],
      parent.translation[1] + rotateVec(parent.rotation, rightSnap.position)[1],
      parent.translation[2] + rotateVec(parent.rotation, rightSnap.position)[2],
    ];
    const childSnapWorld = [
      child.translation[0] + rotateVec(child.rotation, leftSnap.position)[0],
      child.translation[1] + rotateVec(child.rotation, leftSnap.position)[1],
      child.translation[2] + rotateVec(child.rotation, leftSnap.position)[2],
    ];

    expect(approxEqual(parentSnapWorld, childSnapWorld)).toBe(true);
  });

  it('keeps the child upright when the parent is rotated', () => {
    const parent = { translation: [0, 0, 0], rotation: [0, R2, 0, R2] };   // yawed 90 degrees
    const child = solveChildTransform(parent, rightSnap, leftSnap);
    // Yaw-only solving means no roll or pitch can leak in — a base unit that
    // tipped over would be the most obvious possible bug, so pin it.
    expect(child.rotation[0]).toBeCloseTo(0);
    expect(child.rotation[2]).toBeCloseTo(0);
  });
});

describe('resolveTransforms', () => {
  const components = new Map([
    ['unit-600', extractComponent(describeUnit())],
    ['unit-900', extractComponent(describeUnit({ name: 'unit-900', w: 0.9 }))],
  ]);

  const run = (a, b, c) => ({
    instances: [
      { instanceId: 'i1', componentId: 'unit-600', position: [0, 0, 0] },
      { instanceId: 'i2', componentId: a },
      { instanceId: 'i3', componentId: b },
    ].slice(0, c || 3),
    connections: [
      { fromInstanceId: 'i1', fromSnapId: 'md-snap.carcass-side.right', toInstanceId: 'i2', toSnapId: 'md-snap.carcass-side.left' },
      { fromInstanceId: 'i2', fromSnapId: 'md-snap.carcass-side.right', toInstanceId: 'i3', toSnapId: 'md-snap.carcass-side.left' },
    ].slice(0, (c || 3) - 1),
  });

  it('derives a run of three units left to right', () => {
    const { transforms, orphans } = resolveTransforms(run('unit-600', 'unit-600'), components);
    expect(orphans).toEqual([]);
    expect(approxEqual(transforms.get('i1').translation, [0, 0, 0])).toBe(true);
    expect(approxEqual(transforms.get('i2').translation, [0.6, 0, 0])).toBe(true);
    expect(approxEqual(transforms.get('i3').translation, [1.2, 0, 0])).toBe(true);
  });

  it('accounts for differing widths', () => {
    // Worth being explicit, because this is exactly where an off-by-half-a-unit
    // bug would hide: a transform is the part's CENTRE, not its left edge.
    //
    // 600 at origin      -> centre 0,     right snap at 300
    // 900 attached       -> centre 750,   because its left snap is 450 from its centre
    //                       right snap at 1200
    // 600 attached       -> centre 1500,  its left snap being 300 from its centre
    const { transforms } = resolveTransforms(run('unit-900', 'unit-600'), components);
    expect(approxEqual(transforms.get('i2').translation, [0.75, 0, 0])).toBe(true);
    expect(approxEqual(transforms.get('i3').translation, [1.5, 0, 0])).toBe(true);
  });

  // The reason for deriving rather than storing: move the root, everything follows.
  it('moves the whole run when the root moves', () => {
    const assembly = run('unit-600', 'unit-600');
    assembly.instances[0].position = [3, 0, 2];
    const { transforms } = resolveTransforms(assembly, components);
    expect(approxEqual(transforms.get('i3').translation, [4.2, 0, 2])).toBe(true);
  });

  it('rotates the whole run when the root rotates', () => {
    const assembly = run('unit-600', 'unit-600');
    assembly.instances[0].rotation = [0, R2, 0, R2];   // yaw 90 degrees
    const { transforms } = resolveTransforms(assembly, components);
    // Rotating +90 about Y sends +X to -Z, so the run should extend along -Z.
    const third = transforms.get('i3').translation;
    expect(third[0]).toBeCloseTo(0);
    expect(third[2]).toBeCloseTo(-1.2);
  });

  it('reports parts that are not attached to anything as their own roots', () => {
    const assembly = {
      instances: [
        { instanceId: 'i1', componentId: 'unit-600', position: [0, 0, 0] },
        { instanceId: 'loose', componentId: 'unit-600', position: [5, 0, 0], freeMove: true },
      ],
      connections: [],
    };
    const { transforms, roots, orphans } = resolveTransforms(assembly, components);
    expect(roots).toContain('loose');
    expect(orphans).toEqual([]);
    expect(approxEqual(transforms.get('loose').translation, [5, 0, 0])).toBe(true);
  });

  it('refuses a connection that names a part which is not there', () => {
    const assembly = {
      instances: [{ instanceId: 'i1', componentId: 'unit-600', position: [0, 0, 0] }],
      connections: [{ fromInstanceId: 'i1', fromSnapId: 'md-snap.carcass-side.right', toInstanceId: 'ghost', toSnapId: 'x' }],
    };
    expect(() => resolveTransforms(assembly, components)).toThrow(AssemblyError);
  });

  it('does not re-derive a part reached twice, so layout never depends on walk order', () => {
    // A closed loop is geometrically over-constrained. First path wins.
    const assembly = run('unit-600', 'unit-600');
    assembly.connections.push({
      fromInstanceId: 'i3', fromSnapId: 'md-snap.carcass-side.right',
      toInstanceId: 'i1', toSnapId: 'md-snap.carcass-side.left',
    });
    const { transforms } = resolveTransforms(assembly, components);
    expect(approxEqual(transforms.get('i1').translation, [0, 0, 0])).toBe(true);
  });
});

describe('worldSnaps and validation', () => {
  const components = new Map([['unit-600', extractComponent(describeUnit())]]);
  const assembly = {
    instances: [
      { instanceId: 'i1', componentId: 'unit-600', position: [0, 0, 0] },
      { instanceId: 'i2', componentId: 'unit-600' },
    ],
    connections: [
      { fromInstanceId: 'i1', fromSnapId: 'md-snap.carcass-side.right', toInstanceId: 'i2', toSnapId: 'md-snap.carcass-side.left' },
    ],
  };

  it('marks used snaps as occupied and leaves the ends free', () => {
    const { transforms } = resolveTransforms(assembly, components);
    const snaps = worldSnaps(assembly, components, transforms);

    const free = snaps.filter((s) => !s.occupied);
    expect(free).toHaveLength(2);          // the far left and the far right
    expect(snaps.filter((s) => s.occupied)).toHaveLength(2);
  });

  it('reports an unfilled required snap as invalid', () => {
    const strict = new Map([['unit-600', {
      ...components.get('unit-600'),
      snaps: components.get('unit-600').snaps.map((s) => ({ ...s, required: true })),
    }]]);

    const { transforms } = resolveTransforms(assembly, strict);
    const result = validateAssembly(assembly, strict, transforms);

    expect(result.isValid).toBe(false);
    expect(result.missingRequiredSnaps).toHaveLength(2);
  });
});

describe('findBestConnection and its error messages', () => {
  const components = new Map([
    ['unit-600', extractComponent(describeUnit())],
    ['wall-720', extractComponent(describeUnit({ name: 'wall-720', w: 0.72, h: 0.6, d: 0.33, mask: 'wall-side' }))],
  ]);

  const placedAssembly = {
    instances: [{ instanceId: 'i1', componentId: 'unit-600', position: [0, 0, 0] }],
    connections: [],
  };
  const { transforms } = resolveTransforms(placedAssembly, components);
  const placed = worldSnaps(placedAssembly, components, transforms);

  const movingAt = (componentId, translation, rotation = [0, 0, 0, 1]) => {
    const a = { instances: [{ instanceId: 'm', componentId, position: translation, rotation }], connections: [] };
    const t = resolveTransforms(a, components).transforms;
    return worldSnaps(a, components, t);
  };

  it('finds the joint when a unit is dragged alongside', () => {
    const { best } = findBestConnection(movingAt('unit-600', [0.62, 0, 0]), placed);
    expect(best).toBeTruthy();
    expect(best.moving.label).toBe('left');
    expect(best.placed.label).toBe('right');
  });

  it('finds nothing when the masks differ, and says why', () => {
    const { best, rejections } = findBestConnection(movingAt('wall-720', [0.62, 0, 0]), placed);
    expect(best).toBeNull();
    expect(mostRelevantRejection(rejections).reason).toBe(REASONS.MASK_MISMATCH);
  });

  // A symmetric unit with snaps on both sides cannot fail this way — yaw it 180
  // degrees and the OTHER snap lines up perfectly, which is correct behaviour
  // and worth stating so nobody "fixes" it later.
  it('still connects a symmetric unit that has been turned around', () => {
    const { best } = findBestConnection(movingAt('unit-600', [0.6, 0, 0], [0, 1, 0, 0]), placed);
    expect(best).toBeTruthy();
    expect(best.moving.label).toBe('right');   // the far snap did the work
  });

  it('tells the person to turn the part around when facings clash', () => {
    // A one-sided part has no second snap to save it, so a 180 degree yaw puts
    // its only snap coincident with the target but facing the same way.
    const oneSided = new Map([['end-panel', extractComponent({
      name: 'end-panel',
      extras: { confgr: { widthMm: 600, heightMm: 720, depthMm: 560 } },
      nodes: [
        {
          name: 'body', translation: [0, 0, 0], rotation: [0, 0, 0, 1],
          min: [-0.3, 0, -0.28], max: [0.3, 0.72, 0.28], vertexCount: 24, triangleCount: 12,
        },
        {
          name: 'md-snap.carcass-side.left', translation: [-0.3, 0.36, 0], rotation: [0, -R2, 0, R2],
          min: [-0.28, -0.36, 0], max: [0.28, 0.36, 0], vertexCount: 4, triangleCount: 2,
        },
      ],
    })]]);

    const a = { instances: [{ instanceId: 'm', componentId: 'end-panel', position: [0, 0, 0], rotation: [0, 1, 0, 0] }], connections: [] };
    const moving = worldSnaps(a, oneSided, resolveTransforms(a, oneSided).transforms);

    const { best, rejections } = findBestConnection(moving, placed);
    expect(best).toBeNull();

    const message = mostRelevantRejection(rejections);
    expect(message.reason).toBe(REASONS.FACING_WRONG);
    expect(message.message).toMatch(/turn one of the parts around/);
  });

  it('says move closer when the part is out of range', () => {
    const { best, rejections } = findBestConnection(movingAt('unit-600', [4, 0, 0]), placed);
    expect(best).toBeNull();
    expect(mostRelevantRejection(rejections).reason).toBe(REASONS.TOO_FAR);
  });
});
