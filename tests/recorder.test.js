// The recorder (Matt, 13 Nov 2026: "record the actions i do when configuring a
// product as i was able to kind of break the build"). Opt-in, in words, and
// replayable: every step carries its own ?o=.

import { describe, it, expect } from 'vitest';
import { recordingRequested, describeChange, drawnFacts, recordingFile, RECORDING_FORMAT } from '../src/viewer/recorder.js';

describe('turning it on', () => {
  it('records only when the page asks', () => {
    expect(recordingRequested('https://x.test/?record')).toBe(true);
    expect(recordingRequested('https://x.test/?o=abc&record=1')).toBe(true);
    expect(recordingRequested('https://x.test/?record=0')).toBe(false);
    expect(recordingRequested('https://x.test/')).toBe(false);
    expect(recordingRequested('not a url')).toBe(false);
  });
});

describe('saying what changed', () => {
  const base = { variantId: 'd320', sizeId: 'w900', frameId: 'f1500', bays: 1, mounting: 'feet', adds: {}, at: {}, widths: {}, frames: {} };

  it('names the first step', () => {
    expect(describeChange(null, base)).toEqual(['started']);
  });

  it('names every kind of change, from the choices alone', () => {
    const next = {
      ...base,
      bays: 2,
      mounting: 'floor',
      adds: { 'side-rack': 1 },
      widths: { 1: 'w600' },
      at: { 'side-rack#0': { instanceId: 'g1', slot: 'frame#0', snapId: 'md-snap.youk-d320.rung-2-left' } },
    };
    const said = describeChange(base, next);
    expect(said).toContain('bays: 1 → 2');
    expect(said).toContain('mounting: feet → floor');
    expect(said).toContain('side-rack: 0 → 1');
    expect(said).toContain('bay width 1: default → w600');
    expect(said).toContain('side-rack#0 placed: auto → frame#0·rung-2-left');
  });

  it('says so when nothing about the product changed', () => {
    expect(describeChange(base, { ...base })).toEqual(['no change to the product']);
  });
});

describe('what the page drew', () => {
  it('records the lowest base against the floor', () => {
    const transforms = new Map([['p0', { translation: [0, 0, 0] }], ['p1', { translation: [0, -0.0585, 0] }]]);
    const assembly = { instances: [{ instanceId: 'p0', componentId: 'ladder' }, { instanceId: 'p1', componentId: 'rack' }] };
    const facts = drawnFacts({
      resolved: { id: 'abc', assembly, transforms, scene: { assembly, transforms }, mounting: 'floor', judgement: { ok: false, reasons: [{ says: 'x' }, { says: 'x' }] } },
      size: { w: 950, h: 1600, d: 320 },
    });
    expect(facts.lowestBase).toEqual({ componentId: 'rack', mm: -58 }); // -58.5 rounds to -58
    expect(facts.issues).toEqual(['x']);
    expect(facts.c).toBe('abc');
  });

  it('measures from the REAL floor on feet - the bottom of the foot', () => {
    // The product's origin is the first ladder's base; 100 mm feet stand below
    // it. A rack 58.5 mm below the ladder's base is 41.5 mm ABOVE the floor.
    const transforms = new Map([
      ['p0', { translation: [0, 0, 0] }],
      ['p1', { translation: [0, -0.0585, 0] }],
      ['implied:foot', { translation: [0, -0.1, 0] }],
    ]);
    const assembly = { instances: [{ instanceId: 'p0', componentId: 'ladder' }, { instanceId: 'p1', componentId: 'rack' }] };
    const scene = { assembly: { instances: [...assembly.instances, { instanceId: 'implied:foot', componentId: 'foot' }] }, transforms };
    const facts = drawnFacts({ resolved: { id: 'f', assembly, transforms, scene, mounting: 'feet', footHeightMm: 100, judgement: { ok: true, reasons: [] } } });
    expect(facts.floorMm).toBe(-100);
    expect(facts.lowestBase).toEqual({ componentId: 'foot', mm: 0 });
  });
});

describe('the file', () => {
  it('names its format and drops the address\'s own query', () => {
    const f = recordingFile([{ step: 0 }], { page: 'https://x.test/?o=old&record', userAgent: 'ua' });
    expect(f.format).toBe(RECORDING_FORMAT);
    expect(f.page).toBe('https://x.test/');
    expect(f.steps).toHaveLength(1);
  });
});
