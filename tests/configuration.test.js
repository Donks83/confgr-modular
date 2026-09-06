// A configuration you can send someone, and read back without the editor.
//
// The plan's week-one item, outstanding since the first session. What is being
// tested is not really the string format - that could be anything - but the two
// properties the format exists to have:
//
//   IT ROUND-TRIPS. The same product comes back, in the same place, at the same
//   price. Asserted against RESOLVED GEOMETRY rather than against the decoded
//   object, because two assemblies can look identical field by field and still
//   put a shelf somewhere else.
//
//   IT FAILS LOUDLY. A version it does not know, a part the catalogue no longer
//   has, a joint to a part that is not there: named, not guessed at. An id that
//   reads as a DIFFERENT product is a wrong order, which is worse than an id
//   that will not read at all.

import { describe, it, expect } from 'vitest';
import {
  encodeConfiguration, decodeConfiguration, resolveConfiguration,
  configurationDigest, ConfigurationError, CONFIG_VERSION,
} from '../src/engine/configuration.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { attachAt } from '../src/engine/attach.js';
import { MOUNTING } from '../src/engine/ar.js';

const snap = (id, mask, label, role, position, facing) => ({
  id, mask, label, position, facing, required: false, condition: null, role, span: null, roll: 0,
});

const LADDER = {
  id: '236758-ladder-depth-320mm',
  dimsMm: { widthMm: 30, heightMm: 1500, depthMm: 320 },
  body: { min: [-0.015, 0, -0.16], max: [0.015, 1.5, 0.16] },
  front: [0, 0, -1],
  wallFixings: 2,
  snaps: [
    snap('md-snap.youk-d320.rung-1-right', 'youk-d320', 'rung-1-right', 'socket', [0, 0.1, 0], [1, 0, 0]),
    snap('md-snap.youk-d320.rung-1-left', 'youk-d320', 'rung-1-left', 'socket', [0, 0.1, 0], [-1, 0, 0]),
    snap('md-snap.youk-foot.foot', 'youk-foot', 'foot', 'socket', [0, 0, -0.119], [0, -1, 0]),
  ],
  grids: [],
  options: [{ id: 'finish', label: 'Finish', defaultValueId: 'white', values: [{ id: 'white' }, { id: 'black' }] }],
  triangleCount: 7475,
};

const SHELF = {
  id: '008563-shelf-900mm-for-ladder-depth-320mm',
  dimsMm: { widthMm: 950, heightMm: 68, depthMm: 287 },
  body: { min: [-0.4751, 0, -0.1435], max: [0.4751, 0.0685, 0.1435] },
  front: [0, 0, -1],
  wallFixings: 0,
  snaps: [
    snap('md-snap.youk-d320.mount-left', 'youk-d320', 'mount-left', 'plug', [-0.46005, 0, 0], [-1, 0, 0]),
    snap('md-snap.youk-d320.mount-right', 'youk-d320', 'mount-right', 'plug', [0.46005, 0, 0], [1, 0, 0]),
  ],
  grids: [], options: [], triangleCount: 4060,
};

const FOOT_PART = {
  id: '237023-adjustable-foot-100mm',
  dimsMm: { widthMm: 20, heightMm: 99.8, depthMm: 50 },
  body: { min: [-0.01, 0, -0.025], max: [0.01, 0.0998, 0.025] },
  front: null,
  wallFixings: 0,
  snaps: [
    snap('md-snap.youk-foot.foot', 'youk-foot', 'foot', 'plug', [0, 0.0998, -0.019], [0, 1, 0]),
  ],
  grids: [], options: [], triangleCount: 7548,
};

const components = new Map([LADDER, SHELF, FOOT_PART].map((c) => [c.id, c]));

const CATALOGUE = {
  currency: 'GBP',
  vatRatePercent: 20,
  tiers: [{ id: 'retail', name: 'Retail', markupOnCost: 2 }],
  items: {
    [LADDER.id]: { article: '236758', description: 'YouK ladder 1500', costEach: 50 },
    [SHELF.id]: { article: '008563', description: 'YouK shelf 900', costEach: 20 },
    [FOOT_PART.id]: { article: '237023', description: 'YouK adjustable foot', costEach: 5 },
  },
};

/** A bay: two ladders and a shelf, built the way the app builds one. */
function bay() {
  const anchor = {
    instances: [{
      instanceId: 'i1',
      componentId: LADDER.id,
      selections: { finish: 'black' },
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      freeMove: true,
    }],
    connections: [],
  };
  const withShelf = attachAt(anchor, {
    point: { instanceId: 'i1', snapId: 'md-snap.youk-d320.rung-1-right' },
    componentId: SHELF.id,
    mountSnapId: 'md-snap.youk-d320.mount-left',
  }, 'i2');
  return attachAt(withShelf, {
    point: { instanceId: 'i2', snapId: 'md-snap.youk-d320.mount-right' },
    componentId: LADDER.id,
    mountSnapId: 'md-snap.youk-d320.rung-1-left',
  }, 'i3');
}

/** Where every part ended up, to 0.1 mm — the only comparison that means much. */
function layout(assembly) {
  const { transforms } = resolveTransforms(assembly, components);
  return assembly.instances.map((i) => {
    const t = transforms.get(i.instanceId);
    return `${i.componentId} @ ${t.translation.map((v) => Math.round(v * 10000) / 10).join(',')}`;
  });
}

describe('the round trip', () => {
  it('brings the product back to the same place', () => {
    const before = bay();
    const { assembly } = decodeConfiguration(encodeConfiguration(before));
    expect(layout(assembly)).toEqual(layout(before));
  });

  it('brings the options back with it', () => {
    const { assembly } = decodeConfiguration(encodeConfiguration(bay()));
    expect(assembly.instances[0].selections).toEqual({ finish: 'black' });
  });

  it('brings the mounting back with it', () => {
    const id = encodeConfiguration(bay(), { mounting: MOUNTING.FEET, footHeightMm: 150 });
    const decoded = decodeConfiguration(id);
    expect(decoded.mounting).toBe(MOUNTING.FEET);
    expect(decoded.footHeightMm).toBe(150);
  });

  // A foot height on a wall-mounted product is a number somebody would have to
  // explain every time they read the id, so it is not written.
  it('leaves the foot height out when nothing stands on feet', () => {
    const id = encodeConfiguration(bay(), { mounting: MOUNTING.WALL, footHeightMm: 150 });
    expect(decodeConfiguration(id).mounting).toBe(MOUNTING.WALL);
    expect(atobJson(id).f).toBeUndefined();
  });

  // The instance ids in a live assembly come from a counter that restarts with
  // the process. Writing them down would make an id that only means something
  // in the session that produced it.
  it('does not carry the session\'s instance ids', () => {
    const id = encodeConfiguration(bay());
    // Asserted on the PAYLOAD, not on the base64 - a base64 string contains
    // "i1" often enough by chance that the first version of this test failed
    // on a product that was encoded perfectly.
    expect(JSON.stringify(atobJson(id))).not.toMatch(/"i[123]"/);
    expect(decodeConfiguration(id).assembly.instances.map((i) => i.instanceId))
      .toEqual(['p0', 'p1', 'p2']);
  });

  it('is stable — the same product always writes the same id', () => {
    expect(encodeConfiguration(bay())).toBe(encodeConfiguration(bay()));
  });

  // The dictionary is most of the point of the format: a bay names its ladder
  // once and refers to it twice.
  it('names a repeated part once', () => {
    const payload = atobJson(encodeConfiguration(bay()));
    expect(payload.c).toHaveLength(2);
    expect(payload.i.map((e) => e.c)).toEqual([0, 1, 0]);
  });

  it('survives an option value with accents in it', () => {
    const a = bay();
    a.instances[0].selections = { finish: 'chêne foncé' };
    const { assembly } = decodeConfiguration(encodeConfiguration(a));
    expect(assembly.instances[0].selections.finish).toBe('chêne foncé');
  });
});

describe('failing loudly', () => {
  it('refuses a format it does not know', () => {
    const payload = atobJson(encodeConfiguration(bay()));
    const wrong = reencode({ ...payload, v: CONFIG_VERSION + 7 });
    expect(() => decodeConfiguration(wrong)).toThrow(ConfigurationError);
    expect(() => decodeConfiguration(wrong)).toThrow(/format 8 and this is format 1/);
  });

  it('refuses something that is not an id at all', () => {
    expect(() => decodeConfiguration('hello')).toThrow(/could not be read/);
    expect(() => decodeConfiguration('')).toThrow(/no configuration id/);
    expect(() => decodeConfiguration(null)).toThrow(/no configuration id/);
  });

  it('refuses a joint to a part that is not there', () => {
    const payload = atobJson(encodeConfiguration(bay()));
    const wrong = reencode({ ...payload, n: [[0, 0, 9, 1]] });
    expect(() => decodeConfiguration(wrong)).toThrow(/not in this configuration/);
  });

  // The rule quote.js is built on, one level up: a configuration that has lost
  // a part is not a smaller configuration.
  it('NAMES a part the catalogue no longer has, rather than dropping it', () => {
    const id = encodeConfiguration(bay());
    const thin = new Map([[LADDER.id, LADDER]]);
    expect(() => resolveConfiguration(id, thin)).toThrow(ConfigurationError);
    expect(() => resolveConfiguration(id, thin)).toThrow(new RegExp(SHELF.id));
  });
});

describe('the headless resolve', () => {
  it('gives the whole product from an id and a catalogue', () => {
    const id = encodeConfiguration(bay());
    const r = resolveConfiguration(id, components, { catalogue: CATALOGUE, tierId: 'retail' });

    expect(r.assembly.instances).toHaveLength(3);
    expect(r.transforms.size).toBe(3);
    expect(r.validity.isValid).toBe(true);
    expect(r.quote.partCount).toBe(3);
    // Two ladders at 100 and one shelf at 40, twice cost.
    expect(r.quote.net).toBe(240);
    expect(r.quote.complete).toBe(true);
  });

  it('prices nothing rather than guessing when there is no catalogue', () => {
    const r = resolveConfiguration(encodeConfiguration(bay()), components);
    expect(r.quote).toBeNull();
    expect(r.assembly.instances).toHaveLength(3);
  });

  // The implied parts are part of the product, so they have to survive the trip
  // - an id that resolves to a bay with no feet is an id that prices a bay that
  // cannot stand up.
  it('carries what the configuration implies', () => {
    const id = encodeConfiguration(bay(), { mounting: MOUNTING.FEET });
    const r = resolveConfiguration(id, components, { catalogue: CATALOGUE, tierId: 'retail' });

    expect(r.implied.connections).toHaveLength(2);
    expect(r.scene.assembly.instances).toHaveLength(5);
    const feet = r.quote.lines.find((l) => l.componentId === FOOT_PART.id);
    expect(feet.qty).toBe(2);
    expect(feet.implied).toBe(true);
    // 240 for the bay, plus two feet at twice their 5.00 cost.
    expect(r.quote.net).toBe(260);
  });

  it('reports the same collision survey the app would', () => {
    const r = resolveConfiguration(encodeConfiguration(bay()), components);
    expect(r.overlaps.every((o) => !o.through)).toBe(true);
  });
});

describe('the short reference', () => {
  it('is stable and eight hex characters', () => {
    const id = encodeConfiguration(bay());
    expect(configurationDigest(id)).toMatch(/^[0-9a-f]{8}$/);
    expect(configurationDigest(id)).toBe(configurationDigest(id));
  });

  it('changes when the product does', () => {
    const one = configurationDigest(encodeConfiguration(bay()));
    const other = configurationDigest(
      encodeConfiguration(bay(), { mounting: MOUNTING.FEET }),
    );
    expect(one).not.toBe(other);
  });
});

/** Read an id's payload, for the tests that need to see inside the envelope. */
function atobJson(id) {
  const padded = id.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (id.length % 4)) % 4);
  return JSON.parse(new TextDecoder().decode(
    Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0)),
  ));
}

/** And write one back, for the tests that need to corrupt it deliberately. */
function reencode(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
