// The one gesture that tells select, add and move apart.
//
// This logic has existed since 3 September and has never had a test, because it
// lived inside the editor component wired to a raycaster: covering it needed a
// GPU, so only the probe touched it. Pulling it into `createGesture` with the
// hit tests injected is what makes it reachable from here - and the first thing
// this file found is a bug that had been shipped: the editor called
// `moveTargetAt`, which was never defined, so the drag preview threw a
// ReferenceError on every pointermove and no ghost has ever appeared.
//
// What is worth holding:
//
//   1. A dot beats a part. Dots are small and sit ON the geometry they belong
//      to, so testing the product first makes them unclickable.
//   2. A press that does not travel is a SELECT, not a move. Below the
//      threshold nothing is picked up.
//   3. A part that cannot move does not interrupt the orbit.
//   4. Releasing away from a dot leaves the part where it was - a drag has
//      exactly as many destinations as there are dots.

import { describe, it, expect, vi } from 'vitest';
import { createGesture, DRAG_THRESHOLD_PX, markerStyleFor, MARKER_MODE } from '../src/viewer/interact.js';

const ev = (x, y, button = 0) => ({ clientX: x, clientY: y, button });

/** A dot, shaped the way a three.js mesh carries its key. */
const dot = (key) => ({ userData: { pointKey: key, baseRadius: 0.014 }, scale: { setScalar() {} } });

// `marker` is MUTABLE on purpose. A real drag presses on the part - not on a
// dot, or the press would be an add - and only crosses dots later, so a harness
// that answers "there is a dot here" from the first event tests the wrong
// branch. The first version of this file did exactly that and five tests failed
// telling me so, which is the gesture behaving correctly.
function harness({ marker = null, instance = null, canDrag = () => ({ ok: true }) } = {}) {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  let hit = marker;
  const io = {
    hitMarker: vi.fn(() => (typeof hit === 'function' ? hit() : hit)),
    hitInstance: vi.fn(() => instance),
    canDrag,
    hooks: {
      onPoint: record('point'),
      onSelect: record('select'),
      onDragStart: record('dragStart'),
      onDragOver: record('dragOver'),
      onDrop: record('drop'),
      onDragEnd: record('dragEnd'),
      onBlocked: record('blocked'),
    },
  };
  return {
    g: createGesture(io),
    calls,
    io,
    names: () => calls.map((c) => c[0]),
    setMarker: (m) => { hit = m; },
  };
}

describe('pressing on things', () => {
  it('a dot wins over the part behind it', () => {
    const h = harness({ marker: dot('p1'), instance: 'i7' });
    h.g.onPointerDown(ev(10, 10));
    expect(h.names()).toEqual(['point']);
    expect(h.calls[0][1]).toBe('p1');
    // The product was never asked - the dot answered first.
    expect(h.io.hitInstance).not.toHaveBeenCalled();
  });

  it('a press on a part with no travel selects it', () => {
    const h = harness({ instance: 'i7' });
    h.g.onPointerDown(ev(10, 10));
    h.g.onPointerMove(ev(11, 11));
    h.g.onPointerUp(ev(11, 11));
    expect(h.names()).toEqual(['select']);
    expect(h.calls[0][1]).toBe('i7');
  });

  it('a press on nothing clears the selection', () => {
    const h = harness({});
    h.g.onPointerDown(ev(10, 10));
    expect(h.names()).toEqual(['select']);
    expect(h.calls[0][1]).toBe(null);
  });

  it('ignores a right-click entirely', () => {
    const h = harness({ marker: dot('p1'), instance: 'i7' });
    h.g.onPointerDown(ev(10, 10, 2));
    expect(h.names()).toEqual([]);
  });
});

describe('dragging a part to another dot', () => {
  const start = (h) => {
    h.g.onPointerDown(ev(100, 100));
    h.g.onPointerMove(ev(100 + DRAG_THRESHOLD_PX + 1, 100));
  };

  it('does not start until the cursor passes the threshold', () => {
    const h = harness({ instance: 'i7' });
    h.g.onPointerDown(ev(100, 100));
    h.g.onPointerMove(ev(100 + DRAG_THRESHOLD_PX - 1, 100));
    expect(h.names()).toEqual([]);
    expect(h.g.dragging()).toBe(null);
  });

  it('starts once it does, and says which part', () => {
    const h = harness({ instance: 'i7' });
    start(h);
    expect(h.names()).toEqual(['dragStart']);
    expect(h.g.dragging()).toBe('i7');
  });

  it('reports what the cursor is over while dragging', () => {
    const h = harness({ instance: 'i7' });
    start(h);
    h.setMarker(dot('p9'));
    h.g.onPointerMove(ev(200, 200));
    const hover = h.calls.find((c) => c[0] === 'dragOver');
    expect(hover[1]).toBe('p9');
    expect(hover[3]).toBe('i7');
  });

  it('reports a null point when the cursor is over nothing', () => {
    const h = harness({ instance: 'i7' });
    start(h);
    h.setMarker(dot('p9'));
    h.g.onPointerMove(ev(200, 200));
    h.setMarker(null);
    h.g.onPointerMove(ev(300, 300));
    const last = [...h.calls].reverse().find((c) => c[0] === 'dragOver');
    expect(last[1]).toBe(null);
  });

  it('drops on the dot under the release', () => {
    const h = harness({ instance: 'i7' });
    start(h);
    h.setMarker(dot('p9'));
    h.g.onPointerUp(ev(200, 200));
    const drop = h.calls.find((c) => c[0] === 'drop');
    expect(drop[1]).toBe('i7');
    expect(drop[2]).toBe('p9');
  });

  // Releasing in open space must be a no-op rather than a move to the nearest
  // thing. The whole safety property of this gesture is that a part can only
  // land where a dot is.
  it('releasing away from every dot leaves it where it was', () => {
    const h = harness({ instance: 'i7' });
    start(h);
    h.setMarker(dot('p9'));
    h.g.onPointerMove(ev(200, 200));
    h.setMarker(null);
    h.g.onPointerUp(ev(400, 400));
    const drop = h.calls.find((c) => c[0] === 'drop');
    expect(drop[2]).toBe(null);
  });

  it('always ends the drag, dropped or not', () => {
    const h = harness({ instance: 'i7', marker: () => null });
    start(h);
    h.g.onPointerUp(ev(400, 400));
    expect(h.names()).toContain('dragEnd');
    expect(h.g.dragging()).toBe(null);
  });

  // The anchor cannot move. Interrupting the orbit with a message nobody asked
  // for is worse than letting the camera keep turning.
  it('a part that cannot move is reported once and not picked up', () => {
    const h = harness({ instance: 'i1', canDrag: () => ({ ok: false, reason: 'is-anchor' }) });
    start(h);
    expect(h.names()).toEqual(['blocked']);
    expect(h.calls[0][1]).toBe('is-anchor');
    expect(h.g.dragging()).toBe(null);
  });

  it('a blocked press does not keep asking on every move', () => {
    const h = harness({ instance: 'i1', canDrag: () => ({ ok: false, reason: 'is-anchor' }) });
    start(h);
    h.g.onPointerMove(ev(300, 300));
    h.g.onPointerMove(ev(400, 400));
    expect(h.names().filter((n) => n === 'blocked')).toHaveLength(1);
  });

  it('cancel ends a drag in progress without dropping', () => {
    const h = harness({ instance: 'i7' });
    start(h);
    h.setMarker(dot('p9'));
    h.g.cancel();
    expect(h.names()).toEqual(['dragStart', 'dragEnd']);
    expect(h.names()).not.toContain('drop');
  });

  it('cancel on nothing is harmless', () => {
    const h = harness({});
    h.g.cancel();
    expect(h.names()).toEqual([]);
  });

  // A move that finishes inside one frame is the reason dropTargets asks the
  // engine fresh rather than reading a memo; the gesture's own contract is that
  // down/move/up in immediate succession still produces a drop.
  it('survives down, move and up in the same tick', () => {
    const h = harness({ instance: 'i7' });
    h.g.onPointerDown(ev(0, 0));
    h.g.onPointerMove(ev(50, 0));
    h.setMarker(dot('p9'));
    h.g.onPointerUp(ev(50, 0));
    expect(h.names()).toEqual(['dragStart', 'dragEnd', 'drop']);
  });
});

describe('what a dot looks like', () => {
  it('says a different thing in a different colour', () => {
    const add = markerStyleFor({}, { mode: MARKER_MODE.ADD });
    const targeted = markerStyleFor({}, { mode: MARKER_MODE.ADD, targeted: true });
    const moving = markerStyleFor({}, { mode: MARKER_MODE.MOVE });
    expect(new Set([add.color, targeted.color, moving.color]).size).toBe(3);
  });

  it('grows the target during a drag, because the hand is already full', () => {
    const add = markerStyleFor({}, { mode: MARKER_MODE.ADD });
    const moving = markerStyleFor({}, { mode: MARKER_MODE.MOVE });
    expect(moving.radius).toBeGreaterThan(add.radius);
  });

  it('draws a grid cell smaller than an authored point', () => {
    const cell = markerStyleFor({ isGridCell: true }, {});
    const point = markerStyleFor({ isGridCell: false }, {});
    expect(cell.radius).toBeLessThan(point.radius);
  });
});
