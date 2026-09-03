// Deliberately-broken models, so the inspector can be tested on the thing it
// exists for.
//
// WHY THIS EXISTS. tools/inspect-model.mjs passed all ten generated components
// on its first run, which proves only that it agrees with files that were
// already correct. Its whole job is the opposite case: telling you what is
// wrong with a supplier model. Until it has been shown a file with a scale
// factor baked in, it is an untested claim.
//
// Rather than hand-author broken files, this takes a CORRECT one and mutates
// the glTF JSON. Each variant differs from a known-good file in exactly one
// way, so when the inspector reports a code, that code is the only thing it
// could be reacting to.
//
// Usage: node tests/make-broken-glb.mjs [outputDir] [sourceGlb]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || 'test-assets-broken';
const SOURCE = process.argv[3] || join('test-assets', 'unit-600.glb');

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- glb io

function readGlb(path) {
  const bytes = readFileSync(path);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(bytes.subarray(start, start + length).toString('utf8'));
    if (type === 0x004e4942) bin = Buffer.from(bytes.subarray(start, start + length));
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error(`No JSON chunk in ${path}`);
  return { json, bin: bin || Buffer.alloc(0) };
}

function writeGlb(path, json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  // The JSON chunk pads with SPACES and the binary chunk with ZEROS. Both are
  // spec-mandated and strict loaders reject the file otherwise.
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0x00)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const chunk = (buf, type) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(buf.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, buf]);
  };

  writeFileSync(path, Buffer.concat([
    header, chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942),
  ]));
}

// ---------------------------------------------------------------- helpers

const clone = (o) => JSON.parse(JSON.stringify(o));
const nodeNamed = (json, name) => json.nodes.find((n) => n.name === name);
const sceneExtras = (json) => json.scenes[json.scene ?? 0].extras;

// ---------------------------------------------------------------- variants
//
// Each entry says what it breaks and which inspector code should fire. The test
// asserts on `expect`, so this table is the specification.

const VARIANTS = [
  {
    file: 'no-declared-size.glb',
    breaks: 'removes the confgr block from scene extras',
    expect: ['NO_DECLARED_SIZE'],
    mutate: (json) => { delete sceneExtras(json).confgr; },
  },
  {
    file: 'scale-metres-as-mm.glb',
    breaks: 'declares millimetres as though the geometry were already in them — '
      + 'the 1000x mix-up, and the single most likely fault in a supplier file',
    expect: ['SCALE_MISMATCH'],
    mutate: (json) => {
      const c = sceneExtras(json).confgr;
      c.widthMm = 0.6; c.heightMm = 0.72; c.depthMm = 0.56;
    },
  },
  {
    file: 'scale-inches.glb',
    breaks: 'declares the size a CAD export in inches would have produced',
    expect: ['SCALE_MISMATCH'],
    // NOT rounded. Rounding each axis to whole inches makes the three ratios
    // disagree by ~3%, which the inspector then correctly calls a non-uniform
    // scale — a true statement about the file, but it would stop this fixture
    // from exercising the "that factor is inches" diagnosis it exists for.
    mutate: (json) => {
      const c = sceneExtras(json).confgr;
      c.widthMm = 600 / 25.4;
      c.heightMm = 720 / 25.4;
      c.depthMm = 560 / 25.4;
    },
  },
  {
    file: 'no-body.glb',
    breaks: 'renames the visible geometry the way an exporter would',
    expect: ['NO_BODY'],
    mutate: (json) => { nodeNamed(json, 'body').name = 'Mesh_001'; },
  },
  {
    file: 'origin-floating.glb',
    breaks: 'lifts the body off y=0, as a model centred on its own middle would be',
    expect: ['ORIGIN_NOT_AT_BASE'],
    mutate: (json) => { nodeNamed(json, 'body').translation = [0, 0.36, 0]; },
  },
  {
    file: 'origin-off-centre.glb',
    breaks: 'shifts the body sideways in plan',
    expect: ['ORIGIN_NOT_CENTRED'],
    mutate: (json) => { nodeNamed(json, 'body').translation = [0.3, 0, 0.1]; },
  },
  {
    file: 'no-snaps.glb',
    breaks: 'strips every snap plane, leaving a model that cannot join anything',
    expect: ['NO_SNAPS'],
    mutate: (json) => {
      const keep = json.nodes.filter((n) => !n.name.startsWith('md-snap.'));
      const removed = json.nodes.filter((n) => n.name.startsWith('md-snap.'));
      json.nodes = keep;
      json.scenes[json.scene ?? 0].nodes = keep.map((_, i) => i);
      for (const n of removed) delete sceneExtras(json).confgrRoles?.[n.name];
    },
  },
  {
    file: 'snap-name-malformed.glb',
    breaks: 'a snap named with no label — one dot where two are required',
    expect: ['SNAP_NAME_MALFORMED'],
    mutate: (json) => { nodeNamed(json, 'md-snap.carcass-side.left').name = 'md-snap.carcass-side'; },
  },
  {
    file: 'snap-role-invalid.glb',
    breaks: 'a role that is neither socket nor plug',
    expect: ['SNAP_ROLE_INVALID'],
    mutate: (json) => { sceneExtras(json).confgrRoles['md-snap.carcass-side.left'] = 'male'; },
  },
  {
    file: 'grid-not-declared.glb',
    breaks: 'a grid plane with no confgrGrids entry, so its cells cannot be generated',
    expect: ['GRID_NOT_DECLARED'],
    mutate: (json) => { nodeNamed(json, 'md-snap.carcass-side.right').name = 'md-grid.pals.front'; },
  },
  {
    file: 'name-collision.glb',
    breaks: 'two names three.js cannot tell apart once it strips dots',
    expect: ['NAME_COLLISION'],
    mutate: (json) => {
      // Two names that differ ONLY in where the dots fall, so sanitisation
      // makes them identical: both become "md-snapabc". My first attempt used
      // "a.b-c" vs "a.bc", which does NOT collide — the hyphen survives, and
      // only . : / [ ] are stripped. Worth the note: the near-miss is easy to
      // write and would have made this fixture prove nothing.
      nodeNamed(json, 'md-snap.carcass-side.left').name = 'md-snap.a.bc';
      nodeNamed(json, 'md-snap.carcass-side.right').name = 'md-snap.ab.c';
      const roles = sceneExtras(json).confgrRoles || {};
      roles['md-snap.a.bc'] = 'plug';
      roles['md-snap.ab.c'] = 'socket';
    },
  },
  {
    file: 'duplicate-names.glb',
    breaks: 'two nodes with the same name, so a snap id is ambiguous',
    expect: ['SNAP_NAME_DUPLICATE'],
    mutate: (json) => { nodeNamed(json, 'md-snap.carcass-side.right').name = 'md-snap.carcass-side.left'; },
  },
  {
    file: 'baked-scale.glb',
    breaks: 'a scale factor left on a node instead of applied to the mesh',
    expect: ['BAKED_SCALE'],
    warningsOnly: true,
    mutate: (json) => { nodeNamed(json, 'body').scale = [1, 1, 1.5]; },
  },
  {
    file: 'has-animation.glb',
    breaks: 'an animation channel, which does not survive the USDZ conversion AR needs',
    expect: ['NOT_STATIC'],
    warningsOnly: true,
    mutate: (json) => {
      // A structurally-valid but empty animation: enough to be reported, and it
      // references nothing, so nothing else about the file changes.
      json.animations = [{ name: 'idle', channels: [], samplers: [] }];
    },
  },
  {
    file: 'requires-unknown-extension.glb',
    breaks: 'requires an extension no loader implements, which makes the whole file unloadable',
    expect: ['UNHANDLED_REQUIRED_EXTENSION'],
    warningsOnly: true,
    mutate: (json) => {
      json.extensionsUsed = ['VENDOR_secret_sauce'];
      json.extensionsRequired = ['VENDOR_secret_sauce'];
    },
  },
];

// ---------------------------------------------------------------- run

const source = readGlb(SOURCE);
const written = [];

for (const variant of VARIANTS) {
  const json = clone(source.json);
  variant.mutate(json);
  const path = join(OUT, variant.file);
  writeGlb(path, json, source.bin);
  written.push({ file: variant.file, expect: variant.expect, breaks: variant.breaks });
}

// The table is the specification, so it is written out beside the files rather
// than living only in this script.
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(
  { source: SOURCE, variants: VARIANTS.map(({ file, breaks, expect, warningsOnly }) => ({ file, breaks, expect, warningsOnly: !!warningsOnly })) },
  null, 2,
)}\n`);

console.log(`Wrote ${written.length} broken variants to ${OUT}, from ${SOURCE}`);
for (const w of written) console.log(`  ${w.file.padEnd(34)} expects ${w.expect.join(', ')}`);
