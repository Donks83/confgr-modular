// Which side the light comes from, which is not a matter of taste here.
//
// This project fixed an axis convention early and has leaned on it ever since:
// +z is the WALL, -z is the ROOM. A wall unit's back is at +z, its open front
// faces -z, and every snap in the range is authored to that.
//
// The key light was at z = +2.2. It stood BEHIND the product, lighting the face
// nobody looks at, leaving every shelf front in fill light only. Matt, after
// looking at it on a phone: "the light direction definitely needs rotating 180
// degrees." He was reading the symptom; the convention says why.
//
// Tested as arithmetic on the scene graph rather than by rendering, because the
// claim is about a direction rather than about pixels - and because a renderer
// needs a GPU that jsdom has not got.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

// The lights are created inside `createScene`, which needs a canvas and a WebGL
// context. Rather than mock a GPU, this reads the positions out of the source -
// crude, and it does hold the one thing that matters: which side of the product
// each light stands on.
const source = readFileSync('src/viewer/scene.js', 'utf8');
const positionOf = (name) => {
  const m = source.match(new RegExp(`const ${name} = new THREE\\.DirectionalLight[\\s\\S]*?${name}\\.position\\.set\\(([^)]*)\\)`));
  if (!m) throw new Error(`no position found for the ${name} light`);
  return new THREE.Vector3(...m[1].split(',').map((n) => Number(n.trim())));
};

const key = positionOf('key');
const fill = positionOf('fill');

describe('the key light', () => {
  it('stands on the ROOM side, not the wall side', () => {
    // -z is the room. This is the whole fix, and the assertion that fails if
    // anybody ever "tidies" the light back to where it was.
    expect(key.z).toBeLessThan(0);
  });

  it('is above the product, so shelves read as horizontal surfaces', () => {
    expect(key.y).toBeGreaterThan(0);
    // Higher than it is far, or the shadows rake across the floor and the
    // product stops looking like it is standing on anything.
    expect(key.y).toBeGreaterThan(Math.abs(key.z));
  });

  it('is off to one side rather than straight on', () => {
    // A light on the camera axis flattens everything it touches. Furniture is
    // photographed from three-quarters for the same reason.
    expect(Math.abs(key.x)).toBeGreaterThan(0.5);
  });
});

describe('the fill light', () => {
  it('opposes the key rather than joining it', () => {
    // The pair were rotated TOGETHER. Turning only the key would have put both
    // on the same side, which is not a fill - it is a second key, and the
    // product would have lost its shadow side entirely.
    expect(Math.sign(fill.z)).toBe(-Math.sign(key.z));
    expect(Math.sign(fill.x)).toBe(-Math.sign(key.x));
  });

  it('is lower than the key, which is what makes it a fill', () => {
    expect(fill.y).toBeLessThan(key.y);
  });
});

describe('the pair, as a rotation', () => {
  it('is the old rig turned 180° about the vertical axis', () => {
    // Which is exactly negating x and z and leaving y alone. Recorded as the
    // arithmetic rather than as new numbers, so the relationship to what came
    // before survives in something other than a commit message.
    const wasKey = new THREE.Vector3(2, 3.5, 2.2);
    const wasFill = new THREE.Vector3(-2, 1.5, -1.5);
    expect(key.toArray()).toEqual([-wasKey.x, wasKey.y, -wasKey.z]);
    expect(fill.toArray()).toEqual([-wasFill.x, wasFill.y, -wasFill.z]);
  });
});
