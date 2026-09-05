// A part that sits ON another part, rather than meeting it edge-on.
//
// Every joint in the range until now was horizontal: a plug on one part's end
// face meets a socket on a rung's side face, and the solver turns the child
// about the vertical until the two oppose. Two of Kesseböhmer's assemblies do
// not work that way. `mounting instructions Carcass holder.pdf` step 3 and
// `mounting instructions Office solution.pdf` step 5 both say the same thing:
// the carcase, or the desktop, is LAID ON its brackets and screwed up from
// below. Its only mating face points DOWN. There is no horizontal facing to
// solve, and the engine refused the joint outright - component.js threw
// SNAP_FACING_VERTICAL before a solve was even attempted.
//
// Three things change with a vertical joint, and each has a test here:
//
//   1. It is allowed at all.
//   2. Yaw is UNDETERMINED by the joint, because spinning a part about the
//      vertical leaves two vertical facings opposed. It therefore comes from
//      the product, not from the parent - see the note in solveChildTransform
//      for why the parent's would be actively wrong.
//   3. The solver can no longer rescue a mismatch. On a horizontal joint it
//      always succeeds, turning the child 180 degrees if it must; two upward
//      faces stay two upward faces however far you spin them, so a bad pairing
//      has to be refused rather than silently placed.
//
// Built by hand rather than from GLBs, for the same reason as sharedRung: the
// real YouK models are derived supplier geometry and gitignored, so a test that
// loaded them would pass here and fail on a clean checkout.

import { describe, it, expect } from 'vitest';
import { solveChildTransform, AssemblyError } from '../src/engine/assembly.js';
import { snapBearingSide } from '../src/engine/component.js';
import { mountLabel, isFlatMount } from '../src/engine/attach.js';

const UP = [0, 1, 0];
const DOWN = [0, -1, 0];
const SIDEWAYS = [1, 0, 0];

const IDENTITY = { translation: [0, 0, 0], rotation: [0, 0, 0, 1] };

/** A yaw quaternion, so a parent can be turned to face the other way. */
const yaw = (radians) => [0, Math.sin(radians / 2), 0, Math.cos(radians / 2)];

/**
 * The cabinet bracket, as measured off 008558.
 *
 * An 8 mm plate. Its own plug sits 1.5 mm below its top face - that is the top
 * sheet bearing on the rung - and the carcase lands on the top face plus
 * another 1.5 mm packer, which is step 5 of the sheet. So the socket the
 * carcase uses is at local y = 8.0 + 1.5 = 9.5 mm.
 */
const BRACKET_SOCKET = {
  id: 'carries',
  mask: 'youk-carcase-d320',
  label: 'carries',
  position: [0, 0.0095, 0],
  facing: UP,
  role: 'socket',
  condition: null,
  span: null,
};

/** The carcase: a plug on its underside at each end, 889.9 mm apart. */
const carcasePlug = (id, x) => ({
  id,
  mask: 'youk-carcase-d320',
  label: id,
  position: [x, 0, 0],
  facing: DOWN,
  role: 'plug',
  condition: null,
  span: null,
});

const HALF_SPAN = 0.88990 / 2;

describe('a vertical joint — one part laid on another', () => {
  it('is solved rather than refused', () => {
    const t = solveChildTransform(IDENTITY, BRACKET_SOCKET, carcasePlug('left', -HALF_SPAN));
    expect(t).toBeTruthy();
    expect(t.translation).toHaveLength(3);
  });

  it('puts the carcase underside on the bracket socket', () => {
    // The bracket sits where the probe puts it: 15.1 mm inboard of a ladder at
    // the origin, its rung 810 mm up, so its own origin 6.5 mm below that.
    const bracket = { translation: [0.0151, 0.8035, 0], rotation: [0, 0, 0, 1] };
    const t = solveChildTransform(bracket, BRACKET_SOCKET, carcasePlug('left', -HALF_SPAN));

    // y: the bracket's origin plus the socket height. The carcase's plug is at
    // its own y = 0, so this IS the underside of the box.
    expect(t.translation[1]).toBeCloseTo(0.8035 + 0.0095, 6);
    // x: the plug is half a span left of the carcase centre, so the centre ends
    // up half a span right of the bracket.
    expect(t.translation[0]).toBeCloseTo(0.0151 + HALF_SPAN, 6);
  });

  it('lands its far plug on the second bracket, which is the whole point', () => {
    // Two brackets, one per ladder of a 900 bay: 15.1 mm inboard of ladders at
    // 0 and 920.1, so 889.9 mm apart. If the carcase is the right width its far
    // plug arrives exactly over the second bracket with no joint needed.
    const left = { translation: [0.0151, 0.8035, 0], rotation: [0, 0, 0, 1] };
    const t = solveChildTransform(left, BRACKET_SOCKET, carcasePlug('left', -HALF_SPAN));

    const farPlugWorldX = t.translation[0] + HALF_SPAN;
    expect(farPlugWorldX).toBeCloseTo(0.9050, 6);
  });

  // The reason yaw does not come from the parent. The two brackets in a bay hook
  // opposite faces of their ladders, so they are 180 degrees apart. A carcase
  // inheriting its parent's yaw would face into the room from one and into the
  // wall from the other, decided by nothing but which bracket got clicked.
  it('gives the same orientation whichever bracket it is dropped on', () => {
    const left = { translation: [0.0151, 0.8035, 0], rotation: [0, 0, 0, 1] };
    const right = { translation: [0.9050, 0.8035, 0], rotation: yaw(Math.PI) };

    const fromLeft = solveChildTransform(left, BRACKET_SOCKET, carcasePlug('a', -HALF_SPAN));
    const fromRight = solveChildTransform(right, BRACKET_SOCKET, carcasePlug('b', HALF_SPAN));

    expect(fromLeft.rotation).toEqual(fromRight.rotation);
    // And both put the box in the same place, which is the check that the
    // orientation rule and the width agree with each other.
    expect(fromLeft.translation[0]).toBeCloseTo(fromRight.translation[0], 6);
  });

  it('leaves the carcase square with the product, not with the bracket', () => {
    const turned = { translation: [0, 0, 0], rotation: yaw(Math.PI / 2) };
    const t = solveChildTransform(turned, BRACKET_SOCKET, carcasePlug('left', -HALF_SPAN));
    expect(t.rotation[1]).toBeCloseTo(0, 6);   // no yaw
    expect(t.rotation[3]).toBeCloseTo(1, 6);
  });

  it('refuses two faces that both point up', () => {
    const bad = { ...carcasePlug('left', -HALF_SPAN), facing: UP };
    expect(() => solveChildTransform(IDENTITY, BRACKET_SOCKET, bad))
      .toThrow(/point the same way up/);
  });

  it('names the refusal, so the UI can tell them apart', () => {
    const bad = { ...carcasePlug('left', -HALF_SPAN), facing: UP };
    try {
      solveChildTransform(IDENTITY, BRACKET_SOCKET, bad);
      throw new Error('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(AssemblyError);
      expect(err.code).toBe('FACING_SAME_VERTICAL');
    }
  });

  it('refuses a flat face paired with an upright one', () => {
    const upright = { ...carcasePlug('left', -HALF_SPAN), facing: SIDEWAYS };
    try {
      solveChildTransform(IDENTITY, BRACKET_SOCKET, upright);
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('FACING_AXIS_MISMATCH');
    }
  });

  // The horizontal path must be untouched: this is the joint every existing
  // part uses, and the solver still rescues a same-facing pair by turning the
  // child around. That asymmetry between the two paths is deliberate, not an
  // oversight, so it is asserted rather than left to be rediscovered.
  it('still turns a horizontal joint around to make it fit', () => {
    const socket = { ...BRACKET_SOCKET, facing: [1, 0, 0] };
    const plug = { ...carcasePlug('left', 0), facing: [1, 0, 0] };
    const t = solveChildTransform(IDENTITY, socket, plug);
    expect(Math.abs(t.rotation[1])).toBeCloseTo(1, 6);   // yawed 180
  });
});

describe('a carried part deeper than the thing carrying it', () => {
  // The office desktop. A cabinet is exactly as deep as its ladder, so its plugs
  // sit at its own middle and it comes out centred. A 600 mm desktop on a 320 mm
  // ladder cannot: centred would put 140 mm of desk INSIDE the wall, and it
  // would still look right from the front.
  //
  // `Office solution` step 6 draws a tick and a cross over exactly this - the
  // desktop's rear edge against the bracket upstand - so the rule is that a
  // carried part sits BACK FLUSH, and add-snaps offsets the plugs by half the
  // difference in depth. This checks the consequence: the solver puts the part
  // where that offset says, along an axis nothing else in the range uses.
  const DESK_DEPTH = 0.600;
  const LADDER_DEPTH = 0.320;
  const backFlushZ = (LADDER_DEPTH - DESK_DEPTH) / 2;    // -0.140

  const deskPlug = {
    id: 'rest-left',
    mask: 'youk-desktop-d320',
    label: 'rest-left',
    position: [-0.44505, 0, backFlushZ],
    facing: DOWN,
    role: 'plug',
    condition: null,
    span: null,
  };

  const arm = { translation: [0.015, 0.7615, 0], rotation: [0, 0, 0, 1] };
  const armSocket = { ...BRACKET_SOCKET, position: [0, 0.0515, 0] };

  it('offsets the part along z rather than centring it', () => {
    const t = solveChildTransform(arm, armSocket, deskPlug);
    expect(t.translation[2]).toBeCloseTo(0.140, 6);
  });

  it('lands the back edge on the ladder line, not 140 mm inside the wall', () => {
    const t = solveChildTransform(arm, armSocket, deskPlug);
    const backEdgeZ = t.translation[2] - DESK_DEPTH / 2;
    expect(backEdgeZ).toBeCloseTo(-LADDER_DEPTH / 2, 6);
  });

  it('leaves a part the same depth as its ladder centred, as before', () => {
    const cabinetPlug = { ...deskPlug, position: [-0.44495, 0, 0] };
    const t = solveChildTransform(arm, armSocket, cabinetPlug);
    expect(t.translation[2]).toBeCloseTo(0, 6);
  });
});

describe('what the chooser calls a flat placement', () => {
  // The chooser labels each option by how far up the part its own joint sits,
  // which is exactly right for every joint that meets edge-on and useless here:
  // a carcase has both plugs on its underside, so the panel offered "0 mm up the
  // part" twice. That is the same complaint that produced the chooser in the
  // first place, arriving by a different door.
  const placement = (snap) => ({ mountSnap: snap, mountSnapId: snap.id });

  it('still gives the height for an upright joint', () => {
    const rung = { ...BRACKET_SOCKET, facing: [1, 0, 0], position: [0, 0.81, 0] };
    expect(mountLabel(placement(rung))).toBe('810 mm up the part');
  });

  it('gives the direction for a flat one instead', () => {
    expect(mountLabel(placement(carcasePlug('left', -HALF_SPAN))))
      .toBe('running to the right');
    expect(mountLabel(placement(carcasePlug('right', HALF_SPAN))))
      .toBe('running to the left');
  });

  it('tells the two ends of a carcase apart, which is the whole point', () => {
    const left = mountLabel(placement(carcasePlug('left', -HALF_SPAN)));
    const right = mountLabel(placement(carcasePlug('right', HALF_SPAN)));
    expect(left).not.toBe(right);
  });

  it('says so when a flat joint is centred rather than at an end', () => {
    expect(mountLabel(placement(BRACKET_SOCKET))).toBe('centred on this point');
  });

  it('knows a flat mount from an upright one', () => {
    expect(isFlatMount(placement(BRACKET_SOCKET))).toBe(true);
    expect(isFlatMount(placement({ ...BRACKET_SOCKET, facing: [1, 0, 0] }))).toBe(false);
  });
});

describe('which side of a vertical snap a part sits on', () => {
  // snapBearingSide is what lets one rung carry two parts. It reads the body
  // centre against the snap's height, which is axis-agnostic - so it keeps
  // working on a snap that lies flat, and this pins that down rather than
  // assuming it.
  const BRACKET = {
    id: 'bracket',
    body: { min: [-0.025, 0, -0.1575], max: [0.025, 0.008, 0.1575] },
    snaps: [BRACKET_SOCKET],
  };

  const CARCASE = {
    id: 'carcase',
    body: { min: [-0.445, 0, -0.16], max: [0.445, 0.45, 0.16] },
    snaps: [carcasePlug('left', -HALF_SPAN)],
  };

  it('puts the bracket below its own top socket', () => {
    expect(snapBearingSide(BRACKET, 'carries')).toBe('below');
  });

  it('puts the carcase above its own underside plug', () => {
    expect(snapBearingSide(CARCASE, 'left')).toBe('above');
  });
});
