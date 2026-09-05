// Staggered uprights: can one shelf span two uprights standing at DIFFERENT
// heights?
//
// This is a product question, asked because Kesseboehmer's own photography
// shows exactly that - YouK frames of different sizes, hung at different
// heights, with shelves running across between them. Before designing anything
// for it, the honest first move is to find out whether the engine already does
// it, and these tests are the answer: it does, and nothing new is needed in the
// solver. What is missing is a way to ASK for it in the UI.
//
// Why it works. A shelf's plug and an upright's level socket simply have their
// centres brought together. So the pair of levels chosen - which level of the
// left upright, which of the right - sets the height difference between the two
// uprights, and it falls out of the chain with no extra machinery:
//
//     shelf on left level 4 (1500) + right upright joined by ITS level 1 (300)
//        =>  right upright's base sits 1200mm above the left one's
//
// The uprights here are the synthetic test fixtures, with four levels at
// 300/700/1100/1500mm on both faces.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describeGltf } from '../src/three/loadGlb.js';
import { extractComponent } from '../src/engine/component.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import {
  attachMatrix, attachAt, pointKey, placementsAt, mountHeightMm,
  distinctPlacements,
} from '../src/engine/attach.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets');
const loader = new GLTFLoader();

function loadComponent(file) {
  const bytes = new Uint8Array(readFileSync(join(ASSETS, file)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => loader.parse(buffer, '',
    (gltf) => {
      try {
        const name = file.replace(/\.glb$/, '');
        resolve({ id: name, ...extractComponent(describeGltf(gltf, name)) });
      } catch (err) { reject(err); }
    }, reject));
}

const UPRIGHT = 'rack-upright-1800';
const SHELF = 'rack-shelf-900';

let components;
let CATALOGUE;

beforeAll(async () => {
  const loaded = await Promise.all(
    [`${UPRIGHT}.glb`, `${SHELF}.glb`].map(loadComponent),
  );
  components = new Map(loaded.map((c) => [c.id, c]));
  CATALOGUE = loaded.map((c) => c.id);
});

const build = (assembly) => {
  const { transforms } = resolveTransforms(assembly, components);
  return { matrix: attachMatrix(assembly, components, CATALOGUE, transforms), transforms };
};

const seed = () => ({
  instances: [{
    instanceId: 'left', componentId: UPRIGHT,
    position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true,
  }],
  connections: [],
});

/** Metres to millimetres, rounded - the engine works in metres. */
const mm = (v) => Math.round(v * 1000);

/** left upright + a shelf on the level whose socket sits nearest `heightMm`. */
function withShelfAt(heightMm) {
  const { matrix, transforms } = build(seed());
  const options = matrix.placements.filter((p) => p.componentId === SHELF);
  expect(options.length).toBeGreaterThan(1);

  // Pick by the socket's resolved world height rather than by snap name, so
  // the test does not depend on how the fixture labels its levels.
  const best = options
    .map((p) => ({ p, y: mm(worldY(p, transforms)) }))
    .sort((a, b) => Math.abs(a.y - heightMm) - Math.abs(b.y - heightMm))[0];

  return { assembly: attachAt(seed(), best.p, 'shelf'), levelY: best.y };
}

function worldY(placement, transforms) {
  const t = transforms.get(placement.point.instanceId);
  const local = components.get(placement.point.componentId ?? UPRIGHT);
  const snap = (local?.snaps || []).find((s) => s.id === placement.point.snapId);
  // The fixture's uprights are unrotated at the origin, so the socket's world
  // height is its local height plus the instance's. Enough for this test, and
  // it keeps the assertion about heights rather than about quaternions.
  return (t ? t.translation[1] : 0) + (snap ? snap.position[1] : 0);
}

describe('a shelf spanning two uprights', () => {
  it('offers every level of the second upright at the shelf’s free end', () => {
    const { assembly } = withShelfAt(300);
    const { matrix } = build(assembly);

    // The shelf's unused plug is one attach POINT, but the incoming upright can
    // meet it with any of its own level sockets - and each of those is a
    // distinct placement. This is the whole basis of staggering.
    const onShelf = matrix.placements.filter(
      (p) => p.componentId === UPRIGHT && p.point.instanceId === 'shelf',
    );
    expect(onShelf.length).toBeGreaterThan(1);

    // All at the same point, differing only in which socket the upright uses.
    expect(new Set(onShelf.map((p) => pointKey(p.point))).size).toBe(1);
    expect(new Set(onShelf.map((p) => p.mountSnapId)).size).toBe(onShelf.length);
  });

  // The UI used to call .find() on this list and take whichever came first, so
  // seven of the eight staggered layouts were unreachable. placementsAt is the
  // query that hands a person the choice instead of making it for them.
  it('hands over every one of those placements rather than the first', () => {
    const { assembly } = withShelfAt(300);
    const { matrix } = build(assembly);

    const onShelf = matrix.placements.filter(
      (p) => p.componentId === UPRIGHT && p.point.instanceId === 'shelf',
    );
    const key = pointKey(onShelf[0].point);
    const offered = placementsAt(matrix, key, UPRIGHT);

    expect(offered.length).toBe(onShelf.length);
    expect(new Set(offered.map((p) => p.mountSnapId)).size).toBe(offered.length);

    // And what tells them apart is a height they can read, not an opaque id.
    // The fixture's levels are at 300/700/1100/1500 on each of two faces.
    expect([...new Set(offered.map(mountHeightMm))].sort((a, b) => a - b))
      .toEqual([300, 700, 1100, 1500]);
  });

  // The rule that keeps the chooser worth reading. Two placements that put the
  // part in the same place at the same angle are one choice, however
  // differently they are wired underneath.
  it('collapses a shelf’s two ends into one choice, because they land identically', () => {
    const { matrix } = build(seed());
    const key = pointKey(matrix.placements.find((p) => p.componentId === SHELF).point);

    const offered = placementsAt(matrix, key, SHELF);
    expect(offered.length).toBeGreaterThan(1);   // two plugs, both legal

    const real = distinctPlacements(seed(), components, offered);
    expect(real.length).toBe(1);                 // one visible outcome
  });

  // Eight placements, four choices - and four is the right number. Written
  // expecting eight, which was wrong: the left and right socket of ONE level
  // put the upright in the same space, so offering both would be offering the
  // same picture twice. What survives is exactly one option per height, which
  // is what a person staggering a run is actually choosing between.
  it('reduces an arriving upright to one choice per height, not one per socket', () => {
    const { assembly } = withShelfAt(300);
    const { matrix } = build(assembly);
    const key = pointKey(matrix.placements.find(
      (p) => p.componentId === UPRIGHT && p.point.instanceId === 'shelf',
    ).point);

    const offered = placementsAt(matrix, key, UPRIGHT);
    const real = distinctPlacements(assembly, components, offered);

    expect(offered.length).toBe(8);              // 4 levels x 2 faces
    expect(real.length).toBe(4);                 // 4 visible outcomes
    expect(real.map(mountHeightMm)).toEqual([300, 700, 1100, 1500]);
  });

  it('leaves the assembly it probes with untouched', () => {
    const start = seed();
    const before = JSON.stringify(start);
    const { matrix } = build(start);
    const key = pointKey(matrix.placements.find((p) => p.componentId === SHELF).point);

    distinctPlacements(start, components, placementsAt(matrix, key, SHELF));
    expect(JSON.stringify(start)).toBe(before);
  });

  it('offers those choices in bottom-to-top order, like the thing itself', () => {
    const { assembly } = withShelfAt(300);
    const { matrix } = build(assembly);
    const key = pointKey(matrix.placements.find(
      (p) => p.componentId === UPRIGHT && p.point.instanceId === 'shelf',
    ).point);

    const heights = placementsAt(matrix, key, UPRIGHT).map(mountHeightMm);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });

  // Millimetres, not metres. The engine works in metres and the label is in
  // millimetres, so a missing x1000 would read "0 mm" for every option and make
  // the whole chooser useless while looking like it worked.
  it('reports mount heights in millimetres', () => {
    const { assembly } = withShelfAt(300);
    const { matrix } = build(assembly);
    const key = pointKey(matrix.placements.find(
      (p) => p.componentId === UPRIGHT && p.point.instanceId === 'shelf',
    ).point);

    for (const p of placementsAt(matrix, key, UPRIGHT)) {
      expect(mountHeightMm(p)).toBeGreaterThan(100);
      expect(mountHeightMm(p)).toBe(Math.round(p.mountSnap.position[1] * 1000));
    }
  });

  it('puts the second upright at a different height for each level chosen', () => {
    const { assembly } = withShelfAt(300);
    const { matrix } = build(assembly);
    const onShelf = matrix.placements.filter(
      (p) => p.componentId === UPRIGHT && p.point.instanceId === 'shelf',
    );

    const heights = new Set();
    for (const placement of onShelf) {
      const next = attachAt(assembly, placement, 'right');
      const { transforms } = resolveTransforms(next, components);
      heights.add(mm(transforms.get('right').translation[1]));
    }

    // One resulting base height per LEVEL, not per placement. The upright
    // carries a socket on both faces at each level, so eight placements are
    // four levels x two faces - and the face changes which side of the shelf
    // the upright ends up on, not how high it sits. Worth pinning: the
    // difference between 8 and 4 here is exactly the difference between "the
    // UI must offer eight choices" and "it must offer four".
    const levels = new Set(
      components.get(UPRIGHT).snaps.map((s) => mm(s.position[1])),
    );
    expect(onShelf.length).toBe(8);
    expect(heights.size).toBe(levels.size);
    expect(heights.size).toBe(4);
    // And one of them is level - the ordinary, both-feet-on-the-floor case.
    expect(heights.has(0)).toBe(true);
  });

  it('staggers by exactly the difference between the two levels chosen', () => {
    // The claim in the header, checked numerically. Shelf high on the left
    // upright, second upright joined by a LOWER level of its own: the second
    // upright rises by the difference.
    const { assembly, levelY } = withShelfAt(1500);
    const { matrix } = build(assembly);

    const onShelf = matrix.placements.filter(
      (p) => p.componentId === UPRIGHT && p.point.instanceId === 'shelf',
    );

    for (const placement of onShelf) {
      const socket = components.get(UPRIGHT).snaps.find((s) => s.id === placement.mountSnapId);
      const socketY = mm(socket.position[1]);
      const next = attachAt(assembly, placement, 'right');
      const { transforms } = resolveTransforms(next, components);
      const baseY = mm(transforms.get('right').translation[1]);

      // base = where the shelf is - how far up the incoming upright its own
      // socket sits. Nothing more than that.
      expect(baseY).toBe(levelY - socketY);
    }
  });

  it('keeps the shelf level while the uprights are not', () => {
    // The point of the feature: staggered uprights, level shelf. A shelf that
    // tilted to meet a higher upright would be a different product.
    const { assembly, levelY } = withShelfAt(1100);
    const { matrix } = build(assembly);
    const staggered = matrix.placements
      .filter((p) => p.componentId === UPRIGHT && p.point.instanceId === 'shelf')
      .find((p) => {
        const socket = components.get(UPRIGHT).snaps.find((s) => s.id === p.mountSnapId);
        return mm(socket.position[1]) !== levelY;
      });
    expect(staggered).toBeTruthy();

    const next = attachAt(assembly, staggered, 'right');
    const { transforms } = resolveTransforms(next, components);

    expect(mm(transforms.get('right').translation[1])).not.toBe(0);
    // The shelf did not move or tilt: it is still where it was put, and level.
    expect(mm(transforms.get('shelf').translation[1])).toBe(
      mm(resolveTransforms(assembly, components).transforms.get('shelf').translation[1]),
    );
    expect(transforms.get('shelf').rotation.map((v) => Math.round(v * 1000) / 1000))
      .toEqual(resolveTransforms(assembly, components).transforms.get('shelf')
        .rotation.map((v) => Math.round(v * 1000) / 1000));
  });
});
