// Tests for the attach matrix — "what can go where".
//
// This is the query the whole anchored-product interaction rests on, and both
// attach flows are projections of it. If it is right, point-first and
// part-first are both just filters; if it is wrong, every marker on screen is
// wrong and there is no second opinion anywhere in the app.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describeGltf } from '../src/three/loadGlb.js';
import { extractComponent } from '../src/engine/component.js';
import { resolveTransforms } from '../src/engine/assembly.js';
import { makeGridCellId, parseGridCellId } from '../src/engine/grid.js';
import {
  attachMatrix, pointsForComponent, componentsForPoint, livePoints,
  whyNothingFits, attachAt, detach, pointKey,
  canMove, moveTargets, moveTo, subtreeOf, mountingConnection,
} from '../src/engine/attach.js';
import { canConnectLogically, REASONS } from '../src/engine/snapMatch.js';

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

let components;
let CATALOGUE;

beforeAll(async () => {
  const files = [
    'molle-panel.glb', 'pouch-2x3.glb', 'pouch-3x2.glb',
    'rack-upright-1800.glb', 'rack-shelf-900.glb', 'rack-drawer-900.glb',
    'unit-600.glb', 'unit-900.glb', 'wall-cabinet-720.glb',
  ];
  const loaded = await Promise.all(files.map(loadComponent));
  components = new Map(loaded.map((c) => [c.id, c]));
  CATALOGUE = loaded.map((c) => c.id);
});

const build = (assembly) => {
  const { transforms } = resolveTransforms(assembly, components);
  return attachMatrix(assembly, components, CATALOGUE, transforms);
};

const seed = (componentId) => ({
  instances: [{ instanceId: 'root', componentId, position: [0, 0, 0], rotation: [0, 0, 0, 1], freeMove: true }],
  connections: [],
});

describe('options come off the component definition', () => {
  it('a pouch declares a finish with four values and a default', () => {
    const pouch = components.get('pouch-2x3');
    expect(pouch.options).toHaveLength(1);
    expect(pouch.options[0]).toMatchObject({ id: 'finish', label: 'Finish' });
    expect(pouch.options[0].values.map((v) => v.id))
      .toEqual(['olive', 'coyote', 'black', 'wolf']);
    // Explicit default, so a configuration id always resolves to the same
    // appearance rather than to whatever the renderer happened to show.
    expect(pouch.options[0].defaultValueId).toBe('olive');
  });

  it('a component with no options declares none rather than undefined', () => {
    expect(components.get('unit-600').options).toEqual([]);
  });
});

describe('attachMatrix on a MOLLE panel', () => {
  it('offers only pals-masked parts, never a kitchen unit', () => {
    const matrix = build(seed('molle-panel'));
    const offered = new Set(matrix.placements.map((p) => p.componentId));
    expect(offered).toEqual(new Set(['pouch-2x3', 'pouch-3x2']));
  });

  // The span rule made visible: a bigger pouch has fewer legal cells.
  it('offers each pouch exactly its number of legal placements', () => {
    const matrix = build(seed('molle-panel'));
    expect(pointsForComponent(matrix, 'pouch-2x3')).toHaveLength(6 * 10);
    expect(pointsForComponent(matrix, 'pouch-3x2')).toHaveLength(5 * 11);
  });

  it('draws a marker only where something can actually go', () => {
    const matrix = build(seed('molle-panel'));
    // A cell in the top-right corner takes neither pouch, so it gets no marker
    // even though it is empty. An empty cell and a usable cell are different.
    const corner = `root::${makeGridCellId('md-grid.pals.front', 6, 11)}`;
    expect(livePoints(matrix).some((p) => pointKey(p) === corner)).toBe(false);
    expect(whyNothingFits(matrix, corner)).toMatch(/run off the edge/);
  });

  it('point-first and part-first agree', () => {
    const matrix = build(seed('molle-panel'));
    const key = `root::${makeGridCellId('md-grid.pals.front', 0, 0)}`;

    const partsHere = componentsForPoint(matrix, key).map((p) => p.componentId).sort();
    expect(partsHere).toEqual(['pouch-2x3', 'pouch-3x2']);

    // The same fact reached from the other direction.
    const pointsForPouch = pointsForComponent(matrix, 'pouch-2x3').map((p) => p.pointKey);
    expect(pointsForPouch).toContain(key);
  });
});

describe('attaching, and what it closes off', () => {
  it('attaches a pouch and derives its position from the graph', () => {
    const before = seed('molle-panel');
    const matrix = build(before);
    const placement = pointsForComponent(matrix, 'pouch-2x3')
      .find((p) => p.point.col === 0 && p.point.row === 0);

    const after = attachAt(before, placement, 'a1', { finish: 'coyote' });

    expect(after.instances).toHaveLength(2);
    // The interaction changed; the data model did not. No coordinates stored.
    expect(after.instances[1].position).toBeNull();
    expect(after.instances[1].selections).toEqual({ finish: 'coyote' });
    expect(after.connections).toHaveLength(1);

    const { transforms } = resolveTransforms(after, components);
    expect(transforms.get('a1').translation[2]).toBeCloseTo(0.05);
  });

  it('a fitted 2x3 pouch removes every placement that would overlap it', () => {
    const before = seed('molle-panel');
    const first = pointsForComponent(build(before), 'pouch-2x3')
      .find((p) => p.point.col === 0 && p.point.row === 0);
    const after = attachAt(before, first, 'a1');

    const matrix = build(after);
    const stillFree = pointsForComponent(matrix, 'pouch-2x3').map((p) => p.pointKey);

    // Six cells are covered, and a 2x3 anchored at any of six positions would
    // have hit them.
    expect(stillFree).not.toContain(`root::${makeGridCellId('md-grid.pals.front', 0, 0)}`);
    expect(pointsForComponent(matrix, 'pouch-2x3').length).toBeLessThan(60);
  });

  it('says a covered cell is already taken', () => {
    const before = seed('molle-panel');
    const first = pointsForComponent(build(before), 'pouch-2x3')
      .find((p) => p.point.col === 0 && p.point.row === 0);
    const after = attachAt(before, first, 'a1');

    const covered = `root::${makeGridCellId('md-grid.pals.front', 0, 1)}`;
    expect(whyNothingFits(build(after), covered)).toMatch(/already fitted/);
  });

  // The subtle case, and the reason spans need explaining at all: a cell can be
  // FREE while every part that would sit there overlaps a neighbour. Note this
  // cannot happen between two 2x3 pouches — every overlapping anchor is itself
  // inside the occupied block — so it takes two different footprints to
  // produce, which is exactly why it would be easy to ship broken.
  it('explains that a free cell has no room for a part that would overlap', () => {
    const before = seed('molle-panel');
    const interior = pointsForComponent(build(before), 'pouch-2x3')
      .find((p) => p.point.col === 2 && p.point.row === 4);
    const after = attachAt(before, interior, 'a1');   // covers cols 2-3, rows 4-6

    const matrix = build(after);
    // A 3x2 anchored at col 0 row 5 would cover cols 0-2 of rows 5-6, and
    // (2,5) is taken. The anchor cell itself is empty.
    const free = `root::${makeGridCellId('md-grid.pals.front', 0, 5)}`;

    const stillOffered = componentsForPoint(matrix, free).map((p) => p.componentId);
    expect(stillOffered).toContain('pouch-2x3');      // a 2x3 there is fine
    expect(stillOffered).not.toContain('pouch-3x2');  // a 3x2 is not

    const rejection = matrix.rejected.find(
      (r) => pointKey(r.point) === free && r.componentId === 'pouch-3x2',
    );
    expect(rejection.message).toMatch(/would overlap/);
  });
});

describe('attachMatrix on racking — authored points, not a grid', () => {
  // EIGHT, not four: an upright carries a socket on BOTH faces at each of its
  // four levels, so a shelf can hang off either side of it. That is what makes a
  // two-upright bay possible — see the role tests below.
  it('offers both level SKUs at every empty level, on both faces', () => {
    const matrix = build(seed('rack-upright-1800'));
    expect(pointsForComponent(matrix, 'rack-shelf-900')).toHaveLength(8);
    expect(pointsForComponent(matrix, 'rack-drawer-900')).toHaveLength(8);
  });

  it('a filled level stops being offered', () => {
    const before = seed('rack-upright-1800');
    const placement = pointsForComponent(build(before), 'rack-shelf-900')[0];
    const after = attachAt(before, placement, 's1');

    expect(pointsForComponent(build(after), 'rack-shelf-900')).toHaveLength(7);
  });

  // A spanning part has no meaning against a single authored point: it would be
  // placed by its footprint centre against something with no footprint.
  it('never offers a spanning pouch on a shelf level', () => {
    const matrix = build(seed('rack-upright-1800'));
    expect(pointsForComponent(matrix, 'pouch-2x3')).toHaveLength(0);
  });
});

describe('masks still gate everything', () => {
  it('a wall cabinet is never offered on a base unit', () => {
    const matrix = build(seed('unit-600'));
    const offered = new Set(matrix.placements.map((p) => p.componentId));
    expect(offered.has('wall-cabinet-720')).toBe(false);
    expect(offered).toEqual(new Set(['unit-600', 'unit-900', 'corner-connector']
      .filter((id) => components.has(id))));
  });
});

describe('detach cascades', () => {
  it('removes a part', () => {
    const before = seed('molle-panel');
    const placement = pointsForComponent(build(before), 'pouch-2x3')[0];
    const after = detach(attachAt(before, placement, 'a1'), 'a1');

    expect(after.instances).toHaveLength(1);
    expect(after.connections).toHaveLength(0);
    expect(after.removed).toEqual(['a1']);
  });

  // The failure the old drag path had: removing something left whatever hung
  // off it orphaned, and an orphan with no position teleported to the origin.
  it('takes everything hanging off the removed part with it', () => {
    let assembly = seed('unit-600');
    assembly = attachAt(assembly, pointsForComponent(build(assembly), 'unit-900')[0], 'b1');

    // Attach the third unit to b1 SPECIFICALLY. Taking the first available
    // placement would have hung it off the root instead, and the test would
    // have passed for the wrong reason.
    const onB1 = pointsForComponent(build(assembly), 'unit-600')
      .find((p) => p.point.instanceId === 'b1');
    expect(onB1).toBeTruthy();
    assembly = attachAt(assembly, onB1, 'b2');

    expect(assembly.instances).toHaveLength(3);

    const after = detach(assembly, 'b1');
    // b2 hung off b1, so it goes too — no orphan, no teleport.
    expect(after.instances.map((i) => i.instanceId)).toEqual(['root']);
    expect(after.removed.sort()).toEqual(['b1', 'b2']);
  });

  it('leaves the assembly resolvable after a cascade', () => {
    let assembly = seed('unit-600');
    assembly = attachAt(assembly, pointsForComponent(build(assembly), 'unit-900')[0], 'b1');
    const after = detach(assembly, 'b1');
    expect(() => resolveTransforms(after, components)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ROLES. Matt, 3 Sep: "I couldn't attach another upright to the other end of
// the shelf but I was able to add an upright to the existing upright which
// intersected with the original 900 shelf."
//
// Both halves of that are one bug. Every rack snap shared the `shelf-level`
// mask, so upright-to-upright matched logically, and the solver never refuses
// on facing — it yaws the part 180 degrees instead — so it placed an upright
// straight through the shelf. Roles are the fix: sockets offer a place, plugs
// take one, and two of a kind never join.
// ---------------------------------------------------------------------------

describe('socket and plug roles', () => {
  it('refuses two sockets', () => {
    const socket = { mask: 'shelf-level', role: 'socket' };
    expect(canConnectLogically(socket, { ...socket }).reason).toBe(REASONS.ROLE_CLASH);
  });

  it('refuses two plugs', () => {
    const plug = { mask: 'shelf-level', role: 'plug' };
    expect(canConnectLogically(plug, { ...plug }).reason).toBe(REASONS.ROLE_CLASH);
  });

  it('allows a socket and a plug', () => {
    expect(canConnectLogically(
      { mask: 'shelf-level', role: 'socket' },
      { mask: 'shelf-level', role: 'plug' },
    ).ok).toBe(true);
  });

  // A null role means "either", which is what a plain chain of identical parts
  // wants. Roles must not become mandatory by accident.
  it('leaves unroled snaps alone', () => {
    const bare = { mask: 'carcass-side' };
    expect(canConnectLogically(bare, { ...bare }).ok).toBe(true);
  });

  it('never offers an upright on an upright', () => {
    const matrix = build(seed('rack-upright-1800'));
    const offered = new Set(matrix.placements.map((p) => p.componentId));
    expect(offered.has('rack-upright-1800')).toBe(false);
    expect(offered).toEqual(new Set(['rack-shelf-900', 'rack-drawer-900']));
  });

  it('builds a bay: upright, 900 shelf, second upright on the far end', () => {
    let assembly = seed('rack-upright-1800');

    const shelfSpot = pointsForComponent(build(assembly), 'rack-shelf-900')[0];
    assembly = attachAt(assembly, shelfSpot, 'shelf1');

    // The far end of the shelf — its other plug — must now accept an upright.
    const farEnd = pointsForComponent(build(assembly), 'rack-upright-1800')
      .filter((p) => p.point.instanceId === 'shelf1');
    expect(farEnd).toHaveLength(1);

    assembly = attachAt(assembly, farEnd[0], 'upright2');

    const { transforms, orphans } = resolveTransforms(assembly, components);
    expect(orphans).toEqual([]);

    // A 900 shelf between two 60mm uprights is a 990mm run: uprights centred
    // 960mm apart, each 60 wide. Nothing intersects.
    const a = transforms.get('root').translation[0];
    const b = transforms.get('upright2').translation[0];
    expect(Math.abs(b - a)).toBeCloseTo(0.96, 3);
  });

  it('will not stack a second shelf on an occupied level', () => {
    let assembly = seed('rack-upright-1800');
    const first = pointsForComponent(build(assembly), 'rack-shelf-900')[0];
    assembly = attachAt(assembly, first, 'shelf1');

    const stillOpen = pointsForComponent(build(assembly), 'rack-shelf-900');
    expect(stillOpen.some((p) => pointKey(p.point) === pointKey(first.point))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MOVING. Matt, 3 Sep: "it would be nice for me to be able to click and drag an
// object to a different snap point (not to drag it anywhere in 3d space but
// only to another snap point".
// ---------------------------------------------------------------------------

describe('moving a part to another point', () => {
  const bayWithShelf = () => {
    const assembly = seed('rack-upright-1800');
    const spot = pointsForComponent(build(assembly), 'rack-shelf-900')[0];
    return attachAt(assembly, spot, 'shelf1');
  };

  const moveMatrix = (assembly, instanceId) => {
    const { transforms } = resolveTransforms(assembly, components);
    return moveTargets(assembly, components, transforms, instanceId);
  };

  it('will not move the anchor — there is nothing holding it', () => {
    expect(canMove(bayWithShelf(), 'root')).toEqual({ ok: false, reason: 'is-anchor' });
    expect(moveMatrix(bayWithShelf(), 'root').blocked).toBe('is-anchor');
  });

  it('offers the other levels, including the one it is on', () => {
    const assembly = bayWithShelf();
    const targets = moveMatrix(assembly, 'shelf1');

    // Eight sockets on the upright, and the shelf can meet any of them with
    // either of its two ends — so sixteen (point, end) pairs over eight points.
    // The UI draws points; livePoints is what dedupes them.
    expect(targets.placements).toHaveLength(16);
    expect(livePoints(targets)).toHaveLength(8);

    // Its own current point is in the list on purpose: dropping it back where
    // it came from is a legal no-op, and filtering it out would make the marker
    // the drag started from vanish under the cursor.
    const held = mountingConnection(assembly, 'shelf1');
    expect(targets.placements.some((p) => p.point.snapId === held.fromSnapId)).toBe(true);
  });

  it('rehangs the part and moves it', () => {
    const before = bayWithShelf();
    const beforeY = resolveTransforms(before, components).transforms.get('shelf1').translation[1];

    // A different LEVEL, not merely a different snap: the two sockets at one
    // level sit at the same height on opposite faces, so picking any other snap
    // could move the shelf sideways and prove nothing about height.
    const elsewhere = moveMatrix(before, 'shelf1').placements
      .find((p) => Math.abs(p.point.worldPosition[1] - beforeY) > 0.1);

    const after = moveTo(before, 'shelf1', elsewhere);

    // Same parts, same number of joints — a move is a rewiring, not an add.
    expect(after.instances).toHaveLength(before.instances.length);
    expect(after.connections).toHaveLength(before.connections.length);

    const afterY = resolveTransforms(after, components).transforms.get('shelf1').translation[1];
    expect(afterY).not.toBeCloseTo(beforeY, 3);
  });

  it('carries whatever the part is holding', () => {
    let assembly = bayWithShelf();
    const farEnd = pointsForComponent(build(assembly), 'rack-upright-1800')
      .find((p) => p.point.instanceId === 'shelf1');
    assembly = attachAt(assembly, farEnd, 'upright2');

    expect(subtreeOf(assembly, 'shelf1')).toEqual(new Set(['shelf1', 'upright2']));

    const before = resolveTransforms(assembly, components).transforms;
    const gapBefore = before.get('upright2').translation[1] - before.get('shelf1').translation[1];

    const elsewhere = moveMatrix(assembly, 'shelf1').placements
      .find((p) => Math.abs(p.point.worldPosition[1] - before.get('shelf1').translation[1]) > 0.1);
    const after = resolveTransforms(moveTo(assembly, 'shelf1', elsewhere), components).transforms;

    // The second upright went with the shelf and kept its relationship to it,
    // for free, because it never stored a position of its own.
    expect(after.get('upright2').translation[1] - after.get('shelf1').translation[1])
      .toBeCloseTo(gapBefore, 6);
    expect(after.get('shelf1').translation[1]).not.toBeCloseTo(before.get('shelf1').translation[1], 3);
  });

  it('never offers a point on something the part is carrying', () => {
    let assembly = bayWithShelf();
    const farEnd = pointsForComponent(build(assembly), 'rack-upright-1800')
      .find((p) => p.point.instanceId === 'shelf1');
    assembly = attachAt(assembly, farEnd, 'upright2');

    const targets = moveMatrix(assembly, 'shelf1');
    const owners = new Set(targets.placements.map((p) => p.point.instanceId));
    expect(owners.has('upright2')).toBe(false);
    expect(owners.has('shelf1')).toBe(false);
  });

  it('refuses a loop outright', () => {
    let assembly = bayWithShelf();
    const farEnd = pointsForComponent(build(assembly), 'rack-upright-1800')
      .find((p) => p.point.instanceId === 'shelf1');
    assembly = attachAt(assembly, farEnd, 'upright2');

    const onCarriedUpright = pointsForComponent(build(assembly), 'rack-shelf-900')
      .find((p) => p.point.instanceId === 'upright2');
    expect(onCarriedUpright).toBeTruthy();

    expect(() => moveTo(assembly, 'shelf1', onCarriedUpright)).toThrow(/loop/);
  });

  it('will not use a mount the part\'s own child is in', () => {
    let assembly = bayWithShelf();
    const farEnd = pointsForComponent(build(assembly), 'rack-upright-1800')
      .find((p) => p.point.instanceId === 'shelf1');
    assembly = attachAt(assembly, farEnd, 'upright2');

    const used = assembly.connections
      .filter((c) => c.fromInstanceId === 'shelf1').map((c) => c.fromSnapId);
    expect(used).toHaveLength(1);

    const targets = moveMatrix(assembly, 'shelf1');
    expect(targets.placements.every((p) => !used.includes(p.mountSnapId))).toBe(true);
    // Still movable: the shelf's other end is free.
    expect(targets.placements.length).toBeGreaterThan(0);
  });

  it('leaves the assembly resolvable after a move', () => {
    const before = bayWithShelf();
    const elsewhere = moveMatrix(before, 'shelf1').placements
      .find((p) => p.point.snapId !== mountingConnection(before, 'shelf1').fromSnapId);
    const after = moveTo(before, 'shelf1', elsewhere);

    const { orphans } = resolveTransforms(after, components);
    expect(orphans).toEqual([]);
  });

  it('a moved pouch keeps its grid cells straight', () => {
    let assembly = seed('molle-panel');
    const spot = pointsForComponent(build(assembly), 'pouch-3x2')[0];
    assembly = attachAt(assembly, spot, 'p1');

    const targets = moveMatrix(assembly, 'p1');
    // A 3x2 pouch anchors at cols 0-4 and rows 0-10 of a 7x12 panel: 55 places,
    // every one of them offered because the only pouch on the panel is the one
    // being moved and it has vacated its cells.
    expect(livePoints(targets)).toHaveLength(55);

    // Somewhere that does NOT overlap where it was. Anchoring one column over
    // still covers most of the old footprint, so the old anchor cell would stay
    // taken and this test would look like a leak when it was only arithmetic.
    const from = parseGridCellId(mountingConnection(assembly, 'p1').fromSnapId);
    const elsewhere = targets.placements.find((p) => {
      const cell = parseGridCellId(p.point.snapId);
      return cell.col >= from.col + 3 || cell.row >= from.row + 2;
    });
    expect(elsewhere).toBeTruthy();

    const after = moveTo(assembly, 'p1', elsewhere);

    // One pouch, one joint, and the cells it vacated are free again.
    expect(after.connections).toHaveLength(1);
    const reoffered = pointsForComponent(build(after), 'pouch-3x2');
    expect(reoffered.some((p) => pointKey(p.point) === pointKey(spot.point))).toBe(true);
  });
});
