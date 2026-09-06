// A part has a front, and the engine has to know.
//
// Found by looking at a render rather than at a number. Every bay the app has
// ever built put its SECOND ladder in back to front — wall-fixing holes facing
// the room — in every scenario, since the beginning, and fourteen probe runs
// agreed it was fine because every assertion in them was a coordinate somebody
// had predicted.
//
// The mechanism is not subtle once you look at it. A shelf is a `span` part
// with a plug at each end, facing +x and -x. A ladder offers a socket on BOTH
// faces of every rung — `rung-1-left` and `rung-1-right`. Either one satisfies
// the shelf's free plug: one seats the ladder as it stands, the other needs the
// solver to turn it 180 degrees, which the solver will always happily do
// because facing is the only thing it is asked about. Nothing chose between
// them, and the two collapse to the same bounding box, so distinctPlacements
// deduped them and the first one won.
//
// The rule that fixes it is a fact about the PART, not about the joint: a
// ladder has a front, and no rotation of the product may reverse it. That is
// what these tests pin.
//
// Built by hand rather than from GLBs, for the same reason as sharedRung: the
// real YouK models are derived supplier geometry and gitignored, so a test that
// loaded them would pass here and fail on a clean checkout.

import { describe, it, expect } from 'vitest';
import {
  attachMatrix, attachAt, pointKey, placementsAt, distinctPlacements,
  whyComponentFitsNowhere,
} from '../src/engine/attach.js';
import {
  resolveTransforms, validateAssembly, productFront, backToFrontParts, worldFrontOf,
} from '../src/engine/assembly.js';
import { extractComponent } from '../src/engine/component.js';
import { REASONS } from '../src/engine/snapMatch.js';

const MASK = 'youk-d320';

const snap = (id, role, position, facing) => ({
  id, mask: MASK, label: id, position, facing, required: false,
  condition: null, role, span: null, roll: 0,
});

/**
 * A ladder, as the real ones come out of add-snaps.py: 30 mm across in x,
 * 320 mm deep in z, and a socket on EACH face of every rung.
 *
 * Its front is -z, because the wall-fixing holes are in the z = +160 face.
 */
const LADDER = {
  id: 'ladder',
  dimsMm: { widthMm: 30, heightMm: 1500, depthMm: 320 },
  body: { min: [-0.015, 0, -0.16], max: [0.015, 1.5, 0.16] },
  front: [0, 0, -1],
  snaps: [
    snap('rung-1-right', 'socket', [0, 0.1, 0], [1, 0, 0]),
    snap('rung-1-left', 'socket', [0, 0.1, 0], [-1, 0, 0]),
    snap('rung-2-right', 'socket', [0, 0.455, 0], [1, 0, 0]),
    snap('rung-2-left', 'socket', [0, 0.455, 0], [-1, 0, 0]),
  ],
  grids: [],
  options: [],
  triangleCount: 100,
};

/** A 900 shelf: a plug at each end, 870 mm apart, no front of its own. */
const HALF = 0.435;
const SHELF = {
  id: 'shelf',
  dimsMm: { widthMm: 900, heightMm: 68, depthMm: 287 },
  body: { min: [-0.45, 0, -0.1435], max: [0.45, 0.068, 0.1435] },
  front: null,
  snaps: [
    snap('mount-left', 'plug', [-HALF, 0, 0], [-1, 0, 0]),
    snap('mount-right', 'plug', [HALF, 0, 0], [1, 0, 0]),
  ],
  grids: [],
  options: [],
  triangleCount: 100,
};

const components = new Map([LADDER, SHELF].map((c) => [c.id, c]));

/** One ladder at the origin, a shelf on its right-hand rung 1. */
function bayWithOneShelf() {
  const anchor = {
    instances: [{
      instanceId: 'l1', componentId: 'ladder',
      position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
    }],
    connections: [],
  };
  return attachAt(anchor, {
    point: { instanceId: 'l1', snapId: 'rung-1-right' },
    componentId: 'shelf',
    mountSnapId: 'mount-left',
  }, 's1');
}

const matrixFor = (assembly, catalogue = ['ladder', 'shelf']) => {
  const { transforms } = resolveTransforms(assembly, components);
  return { matrix: attachMatrix(assembly, components, catalogue, transforms), transforms };
};

describe('declaring a front', () => {
  const scene = (front) => ({
    name: 'ladder',
    extras: { confgr: { widthMm: 30, heightMm: 1500, depthMm: 320, ...(front ? { front } : {}) } },
    nodes: [
      {
        name: 'body', translation: [0, 0, 0], rotation: [0, 0, 0, 1],
        min: [-0.015, 0, -0.16], max: [0.015, 1.5, 0.16],
        vertexCount: 8, triangleCount: 12,
      },
      {
        name: `md-snap.${MASK}.rung-1-right`, translation: [0, 0.1, 0],
        rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
        min: [-0.02, -0.02, 0], max: [0.02, 0.02, 0],
        vertexCount: 4, triangleCount: 2,
      },
    ],
  });

  it('turns the four accepted strings into unit vectors', () => {
    expect(extractComponent(scene('-z')).front).toEqual([0, 0, -1]);
    expect(extractComponent(scene('+z')).front).toEqual([0, 0, 1]);
    expect(extractComponent(scene('-x')).front).toEqual([-1, 0, 0]);
    expect(extractComponent(scene('+x')).front).toEqual([1, 0, 0]);
  });

  it('is optional — a symmetric part reads the same either way round', () => {
    expect(extractComponent(scene(null)).front).toBeNull();
  });

  // A front that does not parse must fail at load, not silently do nothing.
  // Silently doing nothing is exactly the state the range was already in.
  it('refuses anything else', () => {
    expect(() => extractComponent(scene('+y'))).toThrow(/not recognised/);
    expect(() => extractComponent(scene('front'))).toThrow(/not recognised/);
  });
});

describe('which way the product faces', () => {
  it('is taken from the first part that has a front', () => {
    const assembly = bayWithOneShelf();
    const { transforms } = resolveTransforms(assembly, components);
    expect(productFront(assembly, components, transforms)).toEqual([0, 0, -1]);
  });

  // The product can be turned round — in AR it will be — and the rule has to
  // turn with it rather than being pinned to world -z.
  it('turns with the product', () => {
    const turned = {
      instances: [{
        instanceId: 'l1', componentId: 'ladder',
        position: [0, 0, 0],
        rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],   // +90 degrees about y
        freeMove: true,
      }],
      connections: [],
    };
    const { transforms } = resolveTransforms(turned, components);
    const front = productFront(turned, components, transforms);
    expect(front[0]).toBeCloseTo(-1, 6);
    expect(front[2]).toBeCloseTo(0, 6);
  });

  it('is null when nothing declares one, and then the rule is inert', () => {
    const shelfOnly = {
      instances: [{
        instanceId: 's1', componentId: 'shelf',
        position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
      }],
      connections: [],
    };
    const { transforms } = resolveTransforms(shelfOnly, components);
    expect(productFront(shelfOnly, components, transforms)).toBeNull();
    expect(backToFrontParts(shelfOnly, components, transforms)).toEqual([]);
  });
});

describe('the second ladder of a bay', () => {
  const FREE_END = 's1::mount-right';

  // The whole point. Before this rule both sockets were offered, they collapsed
  // to one bounding box, and the reversed one happened to be first.
  it('is offered only on the socket that keeps it the right way round', () => {
    const { matrix } = matrixFor(bayWithOneShelf());
    const here = placementsAt(matrix, FREE_END, 'ladder');

    expect(here.length).toBeGreaterThan(0);
    for (const p of here) expect(p.mountSnapId).toMatch(/-left$/);
    expect(here.some((p) => p.mountSnapId.endsWith('-right'))).toBe(false);
  });

  it('says why the other socket is gone, in words a person can act on', () => {
    const { matrix } = matrixFor(bayWithOneShelf());
    const why = matrix.rejected.find(
      (r) => pointKey(r.point) === FREE_END
        && r.componentId === 'ladder'
        && r.reason === REASONS.FRONT_REVERSED,
    );
    expect(why).toBeTruthy();
    expect(why.message).toMatch(/back to front/);
  });

  // Both rungs are still real choices — the staggered layouts in Kesseböhmer's
  // own photography depend on it — so this must not have collapsed the height
  // chooser down to one option.
  it('still offers every rung height', () => {
    const { matrix } = matrixFor(bayWithOneShelf());
    const here = placementsAt(matrix, FREE_END, 'ladder');
    expect(new Set(here.map((p) => p.mountSnapId)))
      .toEqual(new Set(['rung-1-left', 'rung-2-left']));
  });

  it('lands facing the same way as the first, once fitted', () => {
    const assembly = attachAt(bayWithOneShelf(), {
      point: { instanceId: 's1', snapId: 'mount-right' },
      componentId: 'ladder',
      mountSnapId: 'rung-1-left',
    }, 'l2');

    const { transforms } = resolveTransforms(assembly, components);
    const first = worldFrontOf(LADDER, transforms.get('l1'));
    const second = worldFrontOf(LADDER, transforms.get('l2'));

    expect(second[0]).toBeCloseTo(first[0], 6);
    expect(second[2]).toBeCloseTo(first[2], 6);
    expect(backToFrontParts(assembly, components, transforms)).toEqual([]);
    expect(validateAssembly(assembly, components, transforms).isValid).toBe(true);
  });

  // And the ladder is where it always was: 870 mm along, which is the shelf's
  // plug spacing. Turning it round never moved it — that is why nothing caught
  // this for so long.
  it('is in the same place it was before the rule existed', () => {
    const assembly = attachAt(bayWithOneShelf(), {
      point: { instanceId: 's1', snapId: 'mount-right' },
      componentId: 'ladder',
      mountSnapId: 'rung-1-left',
    }, 'l2');

    const { transforms } = resolveTransforms(assembly, components);
    expect(transforms.get('l2').translation[0]).toBeCloseTo(2 * HALF, 6);
    expect(transforms.get('l2').translation[1]).toBeCloseTo(0, 6);
  });
});

describe('an assembly that is already wrong', () => {
  // Stored configurations, and any rewiring that does not go through
  // attachMatrix, can still produce this. Naming the parts is the useful thing.
  const reversed = () => attachAt(bayWithOneShelf(), {
    point: { instanceId: 's1', snapId: 'mount-right' },
    componentId: 'ladder',
    mountSnapId: 'rung-1-right',
  }, 'l2');

  it('names the part that is back to front', () => {
    const assembly = reversed();
    const { transforms } = resolveTransforms(assembly, components);
    expect(backToFrontParts(assembly, components, transforms))
      .toEqual([{ instanceId: 'l2', componentId: 'ladder' }]);
  });

  it('counts against the assembly being buildable', () => {
    const assembly = reversed();
    const { transforms } = resolveTransforms(assembly, components);
    const result = validateAssembly(assembly, components, transforms);
    expect(result.isValid).toBe(false);
    expect(result.backToFront).toHaveLength(1);
  });
});

describe('what the rule does NOT do', () => {
  // A part with no front is unaffected, which is what keeps every model
  // authored before this change working unchanged.
  it('leaves a part with no front alone', () => {
    const anchor = {
      instances: [{
        instanceId: 'l1', componentId: 'ladder',
        position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
      }],
      connections: [],
    };
    const { matrix } = matrixFor(anchor, ['shelf']);
    // Both faces of both rungs still take a shelf, by either of its plugs.
    expect(matrix.placements.filter((p) => p.componentId === 'shelf').length).toBe(8);
  });

  // distinctPlacements deduped the two sockets by bounding box, which is right
  // for a symmetric shelf and was hiding the reversal. With one of the two gone
  // there is nothing left to dedupe, so the height chooser still gets its list.
  it('leaves a real choice standing', () => {
    const { matrix } = matrixFor(bayWithOneShelf());
    const here = placementsAt(matrix, 's1::mount-right', 'ladder');
    const distinct = distinctPlacements(bayWithOneShelf(), components, here);
    expect(distinct.length).toBe(2);
  });

  it('does not grey the ladder out of the palette', () => {
    const { matrix } = matrixFor(bayWithOneShelf());
    expect(matrix.placements.some((p) => p.componentId === 'ladder')).toBe(true);
    // The explanation is there for the sockets it did refuse, but the part
    // itself still fits somewhere, which is what the palette asks.
    expect(whyComponentFitsNowhere(matrix, 'ladder')).toBeTruthy();
  });
});
