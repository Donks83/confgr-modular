// One-shot: move the office solution onto the `bolted` family.
//
// The arm was in `hang`, which was wrong - it bolts to the plate, it never
// touches a rung. See the correction in youk/FINDINGS.md.
//
// Kept as a script rather than done by hand because the four plate sockets are
// derived from two measured hole pairs and an angle, and typing eight numbers
// is how the wrong one gets typed.

import { readFileSync, writeFileSync } from 'node:fs';

const path = 'youk/snap-spec.json';
const spec = JSON.parse(readFileSync(path, 'utf8'));

const ARM = '008551-shelf-supports-for-office-solution';
const PLATE = '008551-base-brackets-for-office-solution';

// The arm leaves `hang` entirely. Its rung "slot" was a desktop screw hole.
spec.hang = spec.hang.filter((h) => h.id !== ARM);

// The plate stays in `hang` - it really does hook a rung, at y 298.5 - and
// keeps its rung-3 condition. It gains a second role as a bolted HOST below.
// A part in two families would be authored twice and the second would win, so
// the plate's sockets ride along with its hang entry instead.
const plate = spec.hang.find((h) => h.id === PLATE);
if (!plate) throw new Error('plate is not in the hang family any more');

// Measured off the GLB with tools/find-holes.py, face x = 13.65.
// Rear hole is shared by both angles; only the front hole moves.
//   flat: (z -125.00, y 83.50) -> (z +125.00, y 83.50)   250.00mm,  0.000 deg
//   tilt: (z -125.00, y 83.50) -> (z +121.92, y 44.39)   250.00mm,  9.000 deg
// and the same pair again 100mm higher, which is their 650 / 750.
const REAR_Z = -125.0;

// WHICH END CARRIES THE ANGLE, and it is not the obvious one.
//
// The plate's holes are what physically set the tilt, so the roll started on the
// plate: four sockets, two heights x two angles. It SOLVED correctly - the
// tilted arm landed at y 554.9, exactly where the arithmetic said - and it was
// unusable. Flat and tilted share the rear hole, so those two sockets sit at the
// SAME POINT, and the app drew two markers on top of each other. Neither the
// harness nor a person can click the one underneath.
//
// So the angle moves to the arm, which is where a person chooses it anyway. The
// plate offers two markers at two real heights; the arm offers two ways to sit
// on either, and the chooser names them - "flat" and "tilted 9deg". That is what
// the roll clause in mountLabel was written for.
plate.face = '+x';
plate.boltMask = 'office-arm';
plate.holes = [
  { label: 'arm-650', x: 13.65, y: 83.5, z: REAR_Z, role: 'socket' },
  { label: 'arm-750', x: 13.65, y: 183.5, z: REAR_Z, role: 'socket' },
];

// The arm's own bolt hole: its web at x -25.00, the rear of the 250mm pair. Two
// plugs at the one hole, because the FAR bolt is what differs between flat and
// tilted and the engine solves one pair.
spec.bolted = [{
  id: ARM,
  boltMask: 'office-arm',
  face: '-x',
  holes: [
    { label: 'bolt-flat', x: -25.0, y: 20.0, z: -130.0, role: 'plug' },
    { label: 'bolt-tilt9', x: -25.0, y: 20.0, z: -130.0, role: 'plug', roll: 9 },
  ],
  carries: 'desktop',
  depth: 320,
}];

writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
console.log('hang:', spec.hang.length, '| bolted:', spec.bolted.length);
console.log('plate sockets:', plate.holes.map((h) => h.label).join(', '));
