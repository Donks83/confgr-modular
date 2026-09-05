// The first part in the range that joins nothing.
//
// Kesseböhmer's shoe rack sheet (MA 406213) is a spirit level, a pencil, a drill
// and wall plugs. No ladder appears in it anywhere. The part is sized to the bay
// and sits inside the composition — which is exactly why it looks attached in
// their photography and is not.
//
// Matt's call: place it in space as a wall-fixed item so it is there when AR
// puts the whole thing on a real wall, rather than pretending it bolts on.
//
// Two things are being pinned here. That a component may DECLARE it joins
// nothing, so no snaps is a fact rather than a missing authoring step — and that
// having declared it, the assembly can carry it as a second anchor without any
// new concept in the data model.

import { describe, it, expect } from 'vitest';
import { extractComponent } from '../src/engine/component.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { placeFree, freePositionFor } from '../src/engine/attach.js';

const describeOf = (extras, nodes) => ({
  name: 'part',
  extras,
  nodes: [
    // Centred in plan and sitting on its own base, as the converter leaves it.
    // The pipeline enforces both, and the first version of this fixture ignored
    // them and failed on ORIGIN_NOT_CENTRED before reaching what it was testing.
    { name: 'body', translation: [0, 0, 0], rotation: [0, 0, 0, 1],
      min: [-0.449, 0, -0.05505], max: [0.449, 0.0766, 0.05505],
      vertexCount: 8, triangleCount: 12 },
    ...nodes,
  ],
});

const SIZE = { widthMm: 898, heightMm: 76.6, depthMm: 110.1 };

describe('declaring that a part joins nothing', () => {
  it('refuses a part with no snaps and no declaration', () => {
    expect(() => extractComponent(describeOf({ confgr: SIZE }, [])))
      .toThrowError(/No attach points found/);
  });

  it('accepts one that says it fixes to the wall', () => {
    const c = extractComponent(describeOf({ confgr: { ...SIZE, mounting: 'wall' } }, []));
    expect(c.mounting).toBe('wall');
    expect(c.snaps).toEqual([]);
  });

  it('leaves everything else with mounting null', () => {
    const c = extractComponent(describeOf({ confgr: SIZE }, [
      { name: 'md-snap.d320.mount', translation: [0, 0, 0], rotation: [0, 0, 0, 1],
        min: [-0.015, -0.015, 0], max: [0.015, 0.015, 0], vertexCount: 4, triangleCount: 2 },
    ]));
    expect(c.mounting).toBe(null);
  });

  // A typo must not quietly become "joins nothing" — that would turn a real
  // authoring mistake into a part that loads and can never be attached.
  it('refuses a mounting it does not recognise', () => {
    expect(() => extractComponent(describeOf({ confgr: { ...SIZE, mounting: 'walls' } }, [])))
      .toThrowError(/not recognised/);
  });
});

describe('carrying a wall-fixed part in an assembly', () => {
  const FRAME = {
    id: 'frame',
    body: { min: [0, 0, 0], max: [0.03, 1.5, 0.32] },
    snaps: [], grids: [], options: [], mounting: null,
    dimsMm: { widthMm: 30, heightMm: 1500, depthMm: 320 },
  };
  const RACK = {
    id: 'rack',
    body: { min: [-0.449, 0, -0.05505], max: [0.449, 0.0766, 0.05505] },
    snaps: [], grids: [], options: [], mounting: 'wall',
    dimsMm: SIZE,
  };
  const components = new Map([[FRAME.id, FRAME], [RACK.id, RACK]]);

  const anchored = () => ({
    instances: [{
      instanceId: 'f1', componentId: 'frame',
      position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
    }],
    connections: [],
  });

  // The point of the whole design: a second root needs nothing new. The
  // assembly always allowed an instance with a real position to be a root; it
  // had just never been used for anything but the first part.
  it('resolves a second anchor with no new machinery', () => {
    const a = placeFree(anchored(), 'r1', 'rack', [0.5, 0.15, 0]);
    const { transforms } = resolveTransforms(a, components);

    expect(transforms.get('f1').translation).toEqual([0, 0, 0]);
    expect(transforms.get('r1').translation).toEqual([0.5, 0.15, 0]);
  });

  it('adds no connection, so nothing hangs off it and it hangs off nothing', () => {
    const a = placeFree(anchored(), 'r1', 'rack', [0, 0.15, 0]);
    expect(a.connections).toEqual([]);
    expect(a.instances).toHaveLength(2);
  });

  it('centres it on the product and sets it back to the product’s own back face', () => {
    const { transforms } = resolveTransforms(anchored(), components);
    const at = freePositionFor(anchored(), components, transforms, RACK);

    // Frame spans x 0..0.03, so its centre is 0.015, and the rack's body is
    // already centred on its own origin - so the translation IS that centre.
    // Getting this wrong by half a width is exactly the bug this caught.
    expect(at[0]).toBeCloseTo(0.015, 6);
    expect(at[1]).toBeCloseTo(0.15, 6);
    expect(at[2]).toBeCloseTo(0 + 0.05505, 6);
  });

  it('falls back to the origin when there is no product to measure against', () => {
    expect(freePositionFor({ instances: [] }, components, new Map(), RACK))
      .toEqual([0, 0, 0]);
  });
});
