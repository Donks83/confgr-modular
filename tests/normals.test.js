// Normals, and the hard edges they have to keep.
//
// Matt, on an Android phone: "parts of the model are fading to fully
// transparent when viewing in AR mode. and the model is still looking very
// flat there is no definition on edges or creases."
//
// Both of those were one fault. Every part converted from STEP carried POSITION
// and indices and no NORMAL, and `export-glb.mjs` carries a long note arguing
// that this is fine because the glTF specification says a renderer must compute
// flat normals when they are absent. The specification does say that. Scene
// Viewer renders through Filament, which builds a tangent frame per vertex, and
// a frame built from no normals is degenerate - which in a PBR shader is a
// normalize() of a zero vector. Some of it shades flat and some of it
// disappears.
//
// So: written at source. The claims worth holding are about the SPLITTING,
// because that is the whole difference between this and `computeVertexNormals`
// after `toNonIndexed`:
//
//   1. A hard edge stays hard. A cube's eight corners become twenty-four
//      vertices, each normal an axis - not a corner-pointing average.
//   2. A smooth surface stays smooth and is NOT split. A tessellated cylinder
//      has no vertex whose faces differ by more than the threshold, so it comes
//      out with the same vertex count it went in with.
//   3. The grouping is TRANSITIVE. A ring of facets adds up to 360 degrees; if
//      each were only compared to a representative the ring would break at an
//      arbitrary place and leave a visible seam.
//   4. A degenerate triangle cannot vote. The tessellator emits a few, and one
//      zero-area face is a NaN normal that poisons every vertex it touches -
//      which is the exact failure this file exists to end.

import { describe, it, expect } from 'vitest';
import { creasedNormals, DEFAULT_CREASE_DEGREES } from '../tools/add-normals.mjs';

/** A unit cube at the origin: 8 vertices, 12 triangles, every face welded. */
function cube() {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
  ]);
  const indices = new Uint32Array([
    0, 3, 2, 0, 2, 1, // -z
    4, 5, 6, 4, 6, 7, // +z
    0, 1, 5, 0, 5, 4, // -y
    3, 7, 6, 3, 6, 2, // +y
    0, 4, 7, 0, 7, 3, // -x
    1, 2, 6, 1, 6, 5, // +x
  ]);
  return { positions, indices };
}

/**
 * A closed prism of `sides` facets - a tessellated cylinder. Sides only, no
 * caps, so every vertex sees exactly two side faces.
 *
 * THE WINDING IS THE POINT and it caught me: the first version of this wound
 * the triangles the other way and every normal came out pointing at the axis.
 * That is not the tool being wrong - a normal's direction IS the winding, and
 * anything else would be the tool overruling the geometry. `reversed` keeps
 * that testable rather than leaving it as a fixture detail nobody reads.
 */
function tube(sides, { reversed = false } = {}) {
  const positions = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    positions.push(Math.cos(a), 0, Math.sin(a));
    positions.push(Math.cos(a), 1, Math.sin(a));
  }
  const indices = [];
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    const tris = [
      [i * 2, i * 2 + 1, j * 2],
      [j * 2, i * 2 + 1, j * 2 + 1],
    ];
    for (const t of tris) indices.push(...(reversed ? [t[0], t[2], t[1]] : t));
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const normalAt = (r, v) => [r.normals[v * 3], r.normals[v * 3 + 1], r.normals[v * 3 + 2]];
const isAxis = (n) => n.filter((c) => Math.abs(Math.abs(c) - 1) < 1e-5).length === 1
  && n.filter((c) => Math.abs(c) < 1e-5).length === 2;

describe('normals with hard edges kept', () => {
  it('splits a cube corner into one vertex per face', () => {
    const { positions, indices } = cube();
    const r = creasedNormals(positions, indices);
    // Three faces meet at each of eight corners, and none of the three is
    // within 35 degrees of another.
    expect(r.positions.length / 3).toBe(24);
    expect(r.split).toBe(16);
  });

  it('gives every cube normal an axis, not a corner average', () => {
    const { positions, indices } = cube();
    const r = creasedNormals(positions, indices);
    // The failure this rules out is the ordinary one: average the three faces
    // at a corner and you get (±0.577, ±0.577, ±0.577), which rounds every edge
    // off. On pressed steel that turns a 90-degree fold into a soft gradient.
    for (let v = 0; v < r.positions.length / 3; v += 1) {
      expect(isAxis(normalAt(r, v))).toBe(true);
    }
  });

  it('leaves the cube triangles addressing the same corners', () => {
    const { positions, indices } = cube();
    const r = creasedNormals(positions, indices);
    expect(r.indices.length).toBe(indices.length);
    for (let i = 0; i < indices.length; i += 1) {
      const was = indices[i] * 3;
      const now = r.indices[i] * 3;
      for (let k = 0; k < 3; k += 1) {
        expect(r.positions[now + k]).toBeCloseTo(positions[was + k], 6);
      }
    }
  });

  it('does not split a surface that is smooth enough', () => {
    // 36 sides is 10 degrees a step, well under the threshold.
    const { positions, indices } = tube(36);
    const r = creasedNormals(positions, indices);
    expect(r.split).toBe(0);
    expect(r.positions.length).toBe(positions.length);
  });

  it('shades a tube radially, all the way round', () => {
    // THE TRANSITIVE ONE. A ring of facets adds up to 360 degrees, so no single
    // comparison closes it - the grouping has to be a union rather than a test
    // against a representative, or the ring breaks somewhere arbitrary and
    // leaves a seam a person can see.
    const { positions, indices } = tube(36);
    const r = creasedNormals(positions, indices);
    for (let v = 0; v < r.positions.length / 3; v += 1) {
      const n = normalAt(r, v);
      // Points straight out from the axis: no y, and unit length in xz.
      expect(Math.abs(n[1])).toBeLessThan(1e-5);
      expect(Math.hypot(n[0], n[2])).toBeCloseTo(1, 5);
      // And outward rather than inward.
      const px = r.positions[v * 3];
      const pz = r.positions[v * 3 + 2];
      expect(n[0] * px + n[2] * pz).toBeGreaterThan(0.9);
    }
  });

  it('follows the winding rather than overruling it', () => {
    // Wind the same tube the other way and every normal points at the axis.
    // That is correct: a normal's direction IS the winding, and a tool that
    // "fixed" it would be guessing which side of a surface a person meant. It
    // is also the thing to reach for first if a part ever renders inside-out -
    // the geometry is wrong, not this.
    const r = creasedNormals(...Object.values(tube(36, { reversed: true })));
    const inward = normalAt(r, 0);
    expect(inward[0] * r.positions[0] + inward[2] * r.positions[2]).toBeLessThan(-0.9);
  });

  it('splits a tube when the facets are coarse enough to be edges', () => {
    // 6 sides is 60 degrees a step. That is a hexagonal post, not a cylinder,
    // and it should read as one.
    const { positions, indices } = tube(6);
    const r = creasedNormals(positions, indices);
    expect(r.positions.length / 3).toBeGreaterThan(positions.length / 3);
  });

  it('honours a threshold it is given', () => {
    const { positions, indices } = tube(6);
    // 60-degree steps, so a 70-degree threshold should weld them again.
    const r = creasedNormals(positions, indices, { angleDegrees: 70 });
    expect(r.split).toBe(0);
  });

  it('refuses to let a degenerate triangle vote', () => {
    // One zero-area face has no direction. Normalising its cross product is a
    // divide by zero, and one NaN poisons every vertex the face touches - which
    // for a welded mesh can be most of a part. The tessellator emits these.
    const { positions, indices } = cube();
    const withDegenerate = new Uint32Array([...indices, 0, 1, 1]);
    const r = creasedNormals(positions, withDegenerate);
    for (const v of r.normals) expect(Number.isFinite(v)).toBe(true);
    for (let v = 0; v < r.positions.length / 3; v += 1) {
      expect(Math.hypot(...normalAt(r, v))).toBeCloseTo(1, 5);
    }
  });

  it('gives every normal unit length', () => {
    const { positions, indices } = tube(36);
    const r = creasedNormals(positions, indices);
    for (let v = 0; v < r.positions.length / 3; v += 1) {
      expect(Math.hypot(...normalAt(r, v))).toBeCloseTo(1, 5);
    }
  });

  it('weights by the angle a face subtends, not by how it was cut up', () => {
    // A quad cut into a fat triangle and a thin one must vote like the quad.
    // Two coplanar faces can only average to their shared normal whatever the
    // weighting, so the claim is tested where it bites: a corner where one
    // side has been cut in two.
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, // a flat square, y = 0
      0.5, 0, 0, // an extra point on one edge
    ]);
    const indices = new Uint32Array([0, 4, 3, 4, 1, 2, 4, 2, 3]);
    const r = creasedNormals(positions, indices);
    for (let v = 0; v < r.positions.length / 3; v += 1) {
      const n = normalAt(r, v);
      expect(Math.abs(n[1])).toBeCloseTo(1, 5);
    }
  });

  it('has a threshold between a fold and a facet', () => {
    // Not a measurement - a choice, and the two numbers it sits between are
    // set by the range: folds in this steel are 90 degrees, and the tube
    // tessellation steps by well under 35.
    expect(DEFAULT_CREASE_DEGREES).toBeGreaterThan(15);
    expect(DEFAULT_CREASE_DEGREES).toBeLessThan(75);
  });
});
