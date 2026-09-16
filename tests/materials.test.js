// Why the range looked like white chrome, and why AR blew out.
//
// Kesseboehmer's STEP files carry no materials. A glTF primitive with no
// material takes the FORMAT'S DEFAULT - white, metallic 1.0, roughness 1.0 -
// and 80 of 80 parts were in that state. In the app it reads as pale and flat;
// in AR, where the viewer supplies its own bright environment and a fully
// metallic white surface has nothing to do but reflect it, it blows out.
// Matt on a phone: "when i load it in AR is very bright and over exposed."
//
// That is a fact about the files rather than about the lighting, which is why
// the fix is written INTO the files and why this file tests the conversion
// rather than the renderer.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { srgbToLinear, classOf } from '../tools/add-materials.mjs';

const FOLDER = 'youk';
const specPath = join(FOLDER, 'material-spec.json');
const has = existsSync(specPath);
const spec = has ? JSON.parse(readFileSync(specPath, 'utf8')) : null;

describe('sRGB to linear', () => {
  it('converts the dark grey to the value glTF actually stores', () => {
    // THE MISTAKE THIS EXISTS TO PREVENT. baseColorFactor is LINEAR. Writing
    // 27/255 = 0.1059 straight in would render nearly ten times too bright -
    // for a colour chosen precisely because everything was too bright.
    expect(srgbToLinear(27)).toBeCloseTo(0.01096, 5);
    expect(srgbToLinear(27)).not.toBeCloseTo(27 / 255, 2);
  });

  it('uses the sRGB transfer function, not a gamma of 2.2', () => {
    // They differ most in the dark end, which is exactly where both of Matt's
    // greys sit. A 2.2 gamma would give 0.0084 for 27.
    expect(srgbToLinear(27)).not.toBeCloseTo((27 / 255) ** 2.2, 4);
    // The linear segment near black is the part a plain power curve misses.
    expect(srgbToLinear(10)).toBeCloseTo(0.00304, 4);
  });

  it('pins the ends', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1, 6);
  });
});

describe.runIf(has)('which part is made of what', () => {
  it('treats the range as steel unless told otherwise', () => {
    // 39 of 80 parts, and naming them individually would be 39 chances to miss
    // one. The default is the rule; the exceptions are the list.
    expect(classOf('236758-ladder-depth-320mm', spec)).toBe('metal');
    expect(classOf('008563-shelf-900mm-for-ladder-depth-320mm', spec)).toBe('metal');
    expect(classOf('237023-adjustable-foot-100mm', spec)).toBe('metal');
  });

  it('knows the timber boards are ours and wooden', () => {
    expect(classOf('pws-timber-shelf-900mm-for-ladder-depth-320mm', spec)).toBe('timber');
  });

  it('knows the YouboXx is plastic', () => {
    expect(classOf('008547-youboxx-set-4', spec)).toBe('plastic');
  });
});

describe.runIf(has)('the materials themselves', () => {
  it('uses the greys Matt gave, not ones chosen here', () => {
    // 27,27,27 was chosen unseen. With the range rendering he said it was too
    // dark, was shown 27, 45 and 68 against the product, and picked 45. The
    // point of this test is unchanged and it is the reason the figure moved
    // by being ASKED rather than by being adjusted: three renders went to Matt
    // and the number came back from him.
    expect(spec.classes.metal.srgb).toEqual([45, 45, 45]);
    expect(spec.classes.plastic.srgb).toEqual([50, 50, 50]);
  });

  it('keeps the YouboXx plastic lighter than the steel', () => {
    // "slightly lighter grey for the plastic items (youboxX)". It is the
    // relation that was asked for, not the two numbers - and the gap is now
    // five points rather than twenty-three, so raising the steel again means
    // raising the plastic with it.
    expect(spec.classes.plastic.srgb[0]).toBeGreaterThan(spec.classes.metal.srgb[0]);
  });

  it('does not leave plastic claiming to be metal', () => {
    // A dielectric with metallic 1.0 is the other way to blow out in AR: it
    // reflects the viewer's environment instead of taking its own colour.
    expect(spec.classes.plastic.metallic).toBe(0);
    expect(spec.classes.timber.metallic).toBe(0);
  });

  it('treats the steel as powder coat rather than as bare metal', () => {
    // THE SECOND HALF OF THE SAME MISTAKE. A metallic surface has no diffuse
    // colour at all - it answers with reflections - so in a viewer whose
    // environment is mostly empty it goes black however bright the lights
    // are. The first pass set 0.85 and Matt said the result was "too dark",
    // which is not a colour complaint: a Kesseboehmer shelf is a dielectric
    // with a thin dark paint film on it, so the key light should land on it
    // as shading rather than bounce off it as a reflection.
    //
    // Bounded rather than pinned, because the exact figure is a look and the
    // claim worth holding is the physics: coated steel is not a mirror.
    expect(spec.classes.metal.metallic).toBeGreaterThan(0);
    expect(spec.classes.metal.metallic).toBeLessThan(0.3);
  });

  it('leaves the timber colour where make-timber.py had it', () => {
    // Changing the boards was not asked for, and a material pass that quietly
    // restyles something nobody mentioned is a material pass you cannot trust.
    expect(spec.classes.timber.srgb).toEqual([194, 150, 102]);
  });
});
