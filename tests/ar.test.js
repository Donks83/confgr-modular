// AR readiness, at the unit that matters: the whole configuration.
//
// The point these tests exist to pin: parts that are each inside the triangle
// budget can add up to an assembly that is not. That is the actual failure
// mode, and a per-component budget cannot see it.

import { describe, it, expect } from 'vitest';
import {
  AR_LIMITS, MOUNTING, isMounting, placementFor,
  assemblyTriangles, arReadiness,
} from '../src/engine/ar.js';

const componentsWith = (spec) => new Map(
  Object.entries(spec).map(([id, triangleCount]) => [id, { id, triangleCount }]),
);

const assemblyOf = (...ids) => ({
  instances: ids.map((componentId, i) => ({ instanceId: `i${i + 1}`, componentId })),
  connections: [],
});

// Roughly the real YouK numbers, so the arithmetic below is not invented.
const YOUK = componentsWith({
  frame1500: 7475,
  shelf900: 2088,
  youboxx4: 33216,
  hookstrip: 2640,
});

describe('mounting', () => {
  it('is two options and not a height', () => {
    expect(Object.values(MOUNTING)).toEqual(['floor', 'wall']);
    expect(isMounting('floor')).toBe(true);
    expect(isMounting('wall')).toBe(true);
    expect(isMounting(1400)).toBe(false);
    expect(isMounting('floating')).toBe(false);
  });

  it('asks for vertical surfaces only when the product is wall-mounted', () => {
    expect(placementFor(MOUNTING.WALL)).toEqual({
      horizontal: false,
      vertical: true,
      sceneViewerEnableVerticalPlacement: true,
    });
    expect(placementFor(MOUNTING.FLOOR)).toEqual({
      horizontal: true,
      vertical: false,
      sceneViewerEnableVerticalPlacement: false,
    });
  });
});

describe('assemblyTriangles', () => {
  it('adds up every placed part, counting repeats', () => {
    expect(assemblyTriangles(assemblyOf('frame1500', 'frame1500', 'shelf900'), YOUK))
      .toBe(7475 + 7475 + 2088);
  });

  it('treats an unknown component as zero rather than throwing', () => {
    expect(assemblyTriangles(assemblyOf('mystery'), YOUK)).toBe(0);
    expect(assemblyTriangles(undefined, YOUK)).toBe(0);
  });
});

describe('arReadiness', () => {
  it('passes a small configuration with nothing to say', () => {
    const r = arReadiness(assemblyOf('frame1500', 'shelf900', 'frame1500'), YOUK);
    expect(r.triangles).toBe(17038);
    expect(r.ready).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('catches an assembly over budget whose PARTS are all under it', () => {
    // The whole reason this module exists. Every one of these is comfortably
    // inside a 40,000-triangle per-part budget; together they are not.
    const heavy = assemblyOf(
      'youboxx4', 'youboxx4', 'youboxx4',
      'frame1500', 'frame1500', 'shelf900',
    );
    for (const [, c] of YOUK) expect(c.triangleCount).toBeLessThan(40000);

    const r = arReadiness(heavy, YOUK);
    expect(r.triangles).toBeGreaterThan(AR_LIMITS.trianglesMax);
    expect(r.ready).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain('TRIANGLES_OVER_MAX');
  });

  it('warns short of the maximum without blocking', () => {
    const r = arReadiness(assemblyOf('youboxx4', 'youboxx4'), YOUK);
    expect(r.triangles).toBe(66432);
    expect(r.triangles).toBeGreaterThan(AR_LIMITS.trianglesIdeal);
    expect(r.triangles).toBeLessThan(AR_LIMITS.trianglesMax);
    expect(r.warnings.map((w) => w.code)).toEqual(['TRIANGLES_OVER_IDEAL']);
    // Above ideal is advice, not a refusal.
    expect(r.ready).toBe(true);
  });

  it('checks file size against both published limits when told the size', () => {
    const small = assemblyOf('shelf900');
    expect(arReadiness(small, YOUK, { bytes: 4 * 1048576 }).warnings).toEqual([]);
    expect(arReadiness(small, YOUK, { bytes: 12 * 1048576 }).warnings[0].code)
      .toBe('BYTES_OVER_RECOMMENDED');

    const tooBig = arReadiness(small, YOUK, { bytes: 20 * 1048576 });
    expect(tooBig.warnings[0].code).toBe('BYTES_OVER_MAX');
    expect(tooBig.ready).toBe(false);
  });

  it('says nothing about size when the size is not known yet', () => {
    // There is no exporter, so usually it is not. Silence beats a guess.
    expect(arReadiness(assemblyOf('shelf900'), YOUK).warnings).toEqual([]);
  });

  it('flags the Android vertical-placement trap for a wall product', () => {
    const r = arReadiness(assemblyOf('frame1500'), YOUK, { mounting: MOUNTING.WALL });
    expect(r.placement.vertical).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('VERTICAL_PLACEMENT_REQUIRED');
    // A note, not a blocker.
    expect(r.ready).toBe(true);
  });

  it('is not ready when nothing is configured', () => {
    const r = arReadiness({ instances: [] }, YOUK);
    expect(r.ready).toBe(false);
    expect(r.warnings[0].code).toBe('EMPTY');
  });
});
