// Generates test components as GLB, with correctly-formed md-snap planes.
//
// WHY THIS EXISTS. The snap spike needs real GLB files with real snap planes,
// because the integration point we are actually testing is "load a glTF, find
// the snap nodes, work out where they are and which way they face". Procedural
// boxes built in three.js would prove the maths and skip the part that breaks.
//
// No dependencies on purpose. A GLB is a 12-byte header plus a JSON chunk plus
// a binary chunk, and writing it by hand is less work than making a headless
// three.js exporter behave.
//
// CONVENTIONS BAKED IN HERE — these are the ones from plan section 7.6, and the
// generator is the reference implementation for the Blender validator:
//   * Geometry is authored in METRES (glTF's unit). Real dimensions are declared
//     separately in MILLIMETRES in scene extras. The loader cross-checks the two
//     and refuses the file if they disagree, which is how we stop a "looks right
//     on screen" scale factor ever entering the pipeline.
//   * Origin at BASE CENTRE, Y-up. AR drops a model onto a floor plane; an origin
//     at the mesh centre buries half the unit in the carpet.
//   * Snap planes are flat, 4 vertices, no thickness. Local +Z is the facing
//     direction; the node's rotation turns it outward. Two snaps may connect only
//     if their facings oppose — that is Mimeeq's red-to-blue rule with the colour
//     metaphor removed.
//   * Mask travels in the node name: md-snap.<mask>.<label>. Mimeeq assigns masks
//     in their admin panel instead, which means the GLB alone is not portable.
//     Putting it in the name keeps the file self-describing.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || '.';
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- primitives

// A box with flat-shaded faces: 24 vertices so each face gets its own normals.
// Sits on y=0 and is centred in x and z, per the origin rule above.
function boxGeometry(w, h, d) {
  const x = w / 2, z = d / 2;
  const faces = [
    { n: [0, 0, 1],  v: [[-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]] },       // front  +Z
    { n: [0, 0, -1], v: [[x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]] },   // back   -Z
    { n: [1, 0, 0],  v: [[x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z]] },       // right  +X
    { n: [-1, 0, 0], v: [[-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z]] },   // left   -X
    { n: [0, 1, 0],  v: [[-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z]] },     // top    +Y
    { n: [0, -1, 0], v: [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]] },     // bottom -Y
  ];

  const positions = [], normals = [], indices = [];
  faces.forEach((face, i) => {
    face.v.forEach((v) => { positions.push(...v); normals.push(...face.n); });
    const b = i * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { positions, normals, indices };
}

// A flat plane in the local XY plane, normal along +Z. Four vertices, no
// subdivisions — the shape Mimeeq requires and the shape the validator enforces.
function planeGeometry(w, h) {
  const x = w / 2, y = h / 2;
  return {
    positions: [-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

// Facing direction -> quaternion. Rotating by t about Y sends local +Z to
// (sin t, 0, cos t), so the four horizontal facings fall out directly.
const R2 = Math.SQRT1_2;
const FACING_QUAT = {
  '+z': [0, 0, 0, 1],
  '+x': [0, R2, 0, R2],
  '-z': [0, 1, 0, 0],
  '-x': [0, -R2, 0, R2],
};

// ---------------------------------------------------------------- glb writer

class GlbBuilder {
  constructor() {
    this.chunks = [];       // raw binary, one per accessor
    this.accessors = [];
    this.meshes = [];
    this.nodes = [];
    this.materials = [];
  }

  _accessor(data, TypedArray, componentType, type, extra = {}) {
    const arr = new TypedArray(data);
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    // Accessor offsets must be aligned to the component size; pad to 4 which
    // satisfies every type we emit here.
    const pad = (4 - (buf.length % 4)) % 4;
    this.chunks.push(pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf);
    this.accessors.push({
      bufferView: this.accessors.length,
      componentType, count: data.length / (type === 'VEC3' ? 3 : 1), type, ...extra,
    });
    return this.accessors.length - 1;
  }

  material(name, [r, g, b, a], { metallic = 0.0, roughness = 0.6 } = {}) {
    this.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: [r, g, b, a], metallicFactor: metallic, roughnessFactor: roughness,
      },
      ...(a < 1 ? { alphaMode: 'BLEND', doubleSided: true } : {}),
    });
    return this.materials.length - 1;
  }

  mesh(name, geo, materialIndex) {
    // min/max on POSITION is required by the spec, and viewers genuinely use it
    // for frustum culling — an absent or wrong bounding box shows up as parts
    // vanishing at certain camera angles.
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geo.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], geo.positions[i + a]);
        max[a] = Math.max(max[a], geo.positions[i + a]);
      }
    }
    const position = this._accessor(geo.positions, Float32Array, 5126, 'VEC3', { min, max });
    const normal = this._accessor(geo.normals, Float32Array, 5126, 'VEC3');
    const index = this._accessor(geo.indices, Uint16Array, 5123, 'SCALAR');

    this.meshes.push({
      name,
      primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices: index, material: materialIndex }],
    });
    return this.meshes.length - 1;
  }

  node(name, meshIndex, { translation, rotation } = {}) {
    const n = { name, mesh: meshIndex };
    if (translation) n.translation = translation;
    if (rotation) n.rotation = rotation;
    this.nodes.push(n);
    return this.nodes.length - 1;
  }

  write(path, sceneName, sceneExtras) {
    const bin = Buffer.concat(this.chunks);

    let offset = 0;
    const bufferViews = this.chunks.map((c, i) => {
      const view = {
        buffer: 0, byteOffset: offset, byteLength: c.length,
        // 34962 = ARRAY_BUFFER for attributes, 34963 = ELEMENT_ARRAY_BUFFER for
        // indices. Getting these the wrong way round loads without error and
        // renders nothing, which is a miserable afternoon.
        target: this.accessors[i].type === 'SCALAR' ? 34963 : 34962,
      };
      offset += c.length;
      return view;
    });

    const gltf = {
      asset: { version: '2.0', generator: 'confgr-modular test-glb generator' },
      scene: 0,
      scenes: [{ name: sceneName, nodes: this.nodes.map((_, i) => i), extras: sceneExtras }],
      nodes: this.nodes,
      meshes: this.meshes,
      materials: this.materials,
      accessors: this.accessors,
      bufferViews,
      buffers: [{ byteLength: bin.length }],
    };

    const json = Buffer.from(JSON.stringify(gltf), 'utf8');
    const jsonPad = (4 - (json.length % 4)) % 4;
    // The JSON chunk pads with spaces and the binary chunk pads with zeros.
    // Both are spec-mandated; strict loaders reject the file otherwise.
    const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
    const binPad = (4 - (bin.length % 4)) % 4;
    const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0x00)]);

    const header = Buffer.alloc(12);
    header.write('glTF', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonChunk.length, 0);
    jsonHeader.write('JSON', 4, 'ascii');

    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binChunk.length, 0);
    binHeader.write('BIN\0', 4, 'ascii');

    writeFileSync(path, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));
    return 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  }
}

// ---------------------------------------------------------------- components

// A snap spec is where it sits on the box and which way it looks. Positions are
// given as fractions of the box so the same spec works at any width.
function buildComponent({ name, widthMm, heightMm, depthMm, snaps, colour }) {
  const w = widthMm / 1000, h = heightMm / 1000, d = depthMm / 1000;
  const g = new GlbBuilder();

  const bodyMat = g.material('body', colour, { roughness: 0.55 });
  const snapMat = g.material('snap-debug', [0.1, 0.85, 0.9, 0.35]);
  const boxMat = g.material('box-debug', [0.9, 0.2, 0.6, 0.15]);

  // The visible geometry. Deliberately named 'body' and never renamed by the
  // pipeline — mesh names are contract (plan 7.6 rule 3).
  g.node('body', g.mesh('body', boxGeometry(w, h, d), bodyMat));

  for (const s of snaps) {
    // Plane size defaults to the face the snap sits on, so a side snap is
    // depth x height. A LEVEL point overrides it with a small square: four
    // full-face planes stacked up an upright would overlap, and overlapping
    // snaps weld into nonsense (Mimeeq warn about this explicitly).
    const [pw, ph] = s.size
      ? s.size
      : (s.facing === '+x' || s.facing === '-x' ? [d, h] : [w, h]);

    // Height is absolute millimetres when given, because a shelf level is a
    // real dimension off the floor, not a fraction of whatever the upright
    // happens to be. Defaults to mid-height for a plain side snap.
    const y = s.yMm != null ? s.yMm / 1000 : h / 2;

    const mesh = g.mesh(`md-snap.${s.mask}.${s.label}`, planeGeometry(pw, ph), snapMat);
    g.node(`md-snap.${s.mask}.${s.label}`, mesh, {
      translation: [s.at[0] * w, y, s.at[2] * d],
      rotation: FACING_QUAT[s.facing],
    });
  }

  // Collision and dimension boxes are cubic by rule, and here they are the same
  // size as the body. On a real component with an overhanging worktop or puffed
  // upholstery they would differ, which is exactly why they are separate objects.
  g.node('col-body', g.mesh('col-body', boxGeometry(w, h, d), boxMat));
  g.node('dim', g.mesh('dim', boxGeometry(w, h, d), boxMat));

  const bytes = g.write(join(OUT, `${name}.glb`), name, {
    // Declared real-world size, in millimetres. The loader compares this against
    // the measured bounding box and refuses the file on a mismatch. This is the
    // whole defence against a stray scale factor.
    confgr: { widthMm, heightMm, depthMm, unitScale: 'metres' },
  });

  return { name, bytes, snaps: snaps.length };
}

const COMPONENTS = [
  {
    name: 'unit-600',
    widthMm: 600, heightMm: 720, depthMm: 560,
    colour: [0.62, 0.48, 0.34, 1],
    snaps: [
      { mask: 'carcass-side', label: 'left',  at: [-0.5, 0, 0], facing: '-x' },
      { mask: 'carcass-side', label: 'right', at: [0.5, 0, 0],  facing: '+x' },
    ],
  },
  {
    name: 'unit-900',
    widthMm: 900, heightMm: 720, depthMm: 560,
    colour: [0.55, 0.42, 0.3, 1],
    snaps: [
      { mask: 'carcass-side', label: 'left',  at: [-0.5, 0, 0], facing: '-x' },
      { mask: 'carcass-side', label: 'right', at: [0.5, 0, 0],  facing: '+x' },
    ],
  },
  {
    // Turns a corner: one snap on the left face, one on the back. Proves the
    // graph handles a rotation rather than only building in a straight line.
    name: 'corner-connector',
    widthMm: 560, heightMm: 720, depthMm: 560,
    colour: [0.38, 0.4, 0.44, 1],
    snaps: [
      { mask: 'carcass-side', label: 'left', at: [-0.5, 0, 0], facing: '-x' },
      { mask: 'carcass-side', label: 'back', at: [0, 0, -0.5], facing: '-z' },
    ],
  },
  {
    // A deliberately WRONG component, so the validator has something to fail on.
    // Its snap mask does not match the others, so it must refuse to connect.
    name: 'wall-cabinet-720',
    widthMm: 720, heightMm: 600, depthMm: 330,
    colour: [0.7, 0.7, 0.68, 1],
    snaps: [
      { mask: 'wall-side', label: 'left',  at: [-0.5, 0, 0], facing: '-x' },
      { mask: 'wall-side', label: 'right', at: [0.5, 0, 0],  facing: '+x' },
    ],
  },

  // ---- Racking: the multi-height case ---------------------------------------
  // An upright offering FOUR independent shelf levels. Every level shares the
  // mask `shelf-level`, so any level accepts any part carrying that mask —
  // which means levels can be filled in any combination, with different SKUs,
  // and left empty. No height control anywhere: the POINT owns the height.
  //
  // Four points are hand-listed here because four is few. A 20-position upright
  // wants a generated range instead (Roomle's `ranges` with a step), which is
  // the scaling answer rather than authoring twenty nodes.
  {
    name: 'rack-upright-1800',
    widthMm: 60, heightMm: 1800, depthMm: 400,
    colour: [0.22, 0.24, 0.27, 1],
    snaps: [300, 700, 1100, 1500].map((yMm, i) => ({
      mask: 'shelf-level',
      label: `level-${i + 1}`,
      at: [0.5, 0, 0],
      facing: '+x',
      yMm,
      size: [0.06, 0.06],
    })),
  },
  {
    // SKU A for a level: a plain shelf.
    name: 'rack-shelf-900',
    widthMm: 900, heightMm: 30, depthMm: 400,
    colour: [0.66, 0.52, 0.36, 1],
    snaps: [
      { mask: 'shelf-level', label: 'mount', at: [-0.5, 0, 0], facing: '-x', yMm: 15, size: [0.06, 0.06] },
    ],
  },
  {
    // SKU B for the SAME level mask: a drawer box. Interchangeable with a shelf
    // at any level, which is the whole point of keying on the mask.
    name: 'rack-drawer-900',
    widthMm: 900, heightMm: 180, depthMm: 400,
    colour: [0.45, 0.35, 0.3, 1],
    snaps: [
      { mask: 'shelf-level', label: 'mount', at: [-0.5, 0, 0], facing: '-x', yMm: 15, size: [0.06, 0.06] },
    ],
  },
];

const results = COMPONENTS.map(buildComponent);
console.log('Wrote to', OUT);
for (const r of results) {
  console.log(`  ${r.name}.glb  ${String(r.bytes).padStart(6)} bytes  ${r.snaps} snaps`);
}
