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

describe('the build space', () => {
  const css = readFileSync('src/viewer/viewer.css', 'utf8');
  const background = source.match(/export const BACKGROUND = '([^']+)'/)[1];

  // SINCE B1 the colours are tokens (src/viewer/tokens.css), scoped to each
  // instance. The facts these tests pin are unchanged; they are read through the
  // token, in the neutral theme AND the YouK one, so neither theme drifts alone.
  const tokens = readFileSync('src/viewer/tokens.css', 'utf8');
  const block = (selector) => tokens.slice(tokens.indexOf(`${selector} {`)).split('\n}')[0];
  const token = (name, selector = '.cfg-theme') => {
    const m = block(selector).match(new RegExp(`--${name}:\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };
  const brightnessOf = (hex) => {
    const h = hex.replace('#', '');
    return (parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16)) / 3;
  };

  it('is light, while the shell around it stays dark', () => {
    // Matt asked for the 3D space only: "not the menus just the 3d space
    // background". A light value here and a dark one on `.cfgv` is the whole
    // of that, and both halves are asserted so neither drifts alone.
    const brightness = parseInt(background.slice(1, 3), 16);
    expect(brightness).toBeGreaterThan(200);
    expect(css).toMatch(/\.cfgv \{[^}]*background: var\(--cfg-shell\)/);
    expect(token('cfg-shell')).toBe('#1b1815');
    // In the YouK theme the shell is dark too: a pine, not a light panel.
    expect(brightnessOf(token('cfg-shell', '.cfg-theme[data-cfg-theme="youk"]'))).toBeLessThan(60);
  });

  it('is not pure white', () => {
    // A 255 sweep blows the highlight on anything pale in front of it and
    // gives the eye nothing to judge exposure against.
    expect(background.toLowerCase()).not.toBe('#ffffff');
  });

  it('is the same colour in the CSS and in the scene', () => {
    // Two places holding one fact. When they disagree the symptom is a seam
    // down the edge of the canvas for the frame before WebGL paints.
    expect(css).toMatch(/\.cfgv-stage \{[^}]*background: var\(--cfg-stage\)/);
    expect(token('cfg-stage').toLowerCase()).toBe(background.toLowerCase());
    // The build space is Matt's, not a theme's: no theme may redefine it.
    expect(block('.cfg-theme[data-cfg-theme="youk"]')).not.toMatch(/--cfg-stage/);
  });

  it('gives metal something to reflect', () => {
    // WHY THE STEEL LOOKED BLACK. A metallic surface has no diffuse colour -
    // it shows what is around it - so with no environment map it reflects the
    // void, whatever its base colour says. AR never had the problem because
    // phones supply their own environment, which is what made the app the odd
    // one out rather than the files.
    expect(source).toMatch(/scene\.environment\s*=/);
    expect(source).toMatch(/PMREMGenerator/);
  });

  it('frees the environment when the scene goes', () => {
    // A prefiltered environment is a GPU render target and three does not free
    // it with the scene. Same class of leak as the cloned materials in §5.25.
    expect(source).toMatch(/environment\.dispose\(\)/);
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
