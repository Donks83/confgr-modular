#!/usr/bin/env node
// Write a component's declaration into an exported GLB.
//
// WHY THIS IS A SEPARATE STEP. A component is geometry plus a declaration:
// real-world size in millimetres, grid definitions, snap roles, option lists.
// Blender is good at the geometry and the node names and bad at the
// declaration — the glTF exporter maps object custom properties to NODE extras,
// and there is no route at all to SCENE extras, which is where this pipeline
// reads from. Fighting that with an addon means maintaining an addon.
//
// So: Blender exports geometry and correctly-named nodes, and this writes the
// declaration afterwards from a small JSON file that lives next to the model in
// git. Two consequences worth having:
//   * The declaration is reviewable. A change from 600mm to 900mm shows up as a
//     one-line diff, not as a difference between two binary files.
//   * Re-exporting the model does not lose it. Overwrite the GLB from Blender,
//     run this again, and the declaration is back.
//
// It refuses to write a declaration that would not load. There is no point
// producing a file whose only purpose is to be rejected by the next step.
//
// Usage:
//   node tools/declare.mjs <model.glb>                      apply model.confgr.json
//   node tools/declare.mjs <model.glb> --decl <file.json>   apply a named declaration
//   node tools/declare.mjs <model.glb> --measure            write a declaration FROM the
//                                                           geometry, and save the sidecar
//   node tools/declare.mjs <model.glb> --measure --dry-run  show it without writing
//   node tools/declare.mjs <dir> --measure                  every GLB in a folder

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { inspect, audit } from './inspect-model.mjs';

const BODY_NODE = 'body';
const SNAP_PREFIX = 'md-snap.';
const GRID_PREFIX = 'md-grid.';

// The keys this tool owns in scene extras. Anything else already there is left
// alone — a supplier's own extras are not ours to discard.
const OWNED = ['confgr', 'confgrGrids', 'confgrSpans', 'confgrRoles', 'confgrOptions'];

/** The reviewable declaration that lives next to a model in git. */
const sidecarPath = (glbPath) => join(dirname(glbPath), `${basename(glbPath, extname(glbPath))}.confgr.json`);

// ---------------------------------------------------------------- glb io

export function readGlb(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 12 || bytes.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`${basename(path)} is not a GLB. Export as .glb, not .gltf, so the model travels as one file.`);
  }

  let offset = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(bytes.subarray(start, start + length).toString('utf8'));
    if (type === 0x004e4942) bin = Buffer.from(bytes.subarray(start, start + length));
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error(`No JSON chunk in ${basename(path)}.`);
  return { json, bin };
}

export function writeGlb(path, json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0x00)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const chunkOf = (buf, type) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(buf.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, buf]);
  };

  writeFileSync(path, Buffer.concat([
    header, chunkOf(jsonChunk, 0x4e4f534a), chunkOf(binChunk, 0x004e4942),
  ]));
}

// ---------------------------------------------------------------- measuring

/**
 * A declaration derived from the model itself, MERGED over anything already
 * declared that cannot be measured.
 *
 * This is the common case: the model is geometrically right and simply has not
 * said so. Rounded to 0.1mm because a measurement of 599.9997 is noise, and a
 * declaration should read like a datasheet.
 *
 * Roles are LEFT NULL on purpose. Which end of a shelf is a plug and which face
 * of an upright is a socket cannot be measured — it is a decision about how the
 * range assembles, and guessing it produces a model that connects wrongly and
 * silently. The one thing this tool will not invent.
 *
 * THE MERGE MATTERS, and it was missing at first. Re-measuring a model whose
 * roles had already been filled in wrote the measured declaration — with those
 * roles back to null and therefore stripped — straight over them. The sidecar
 * was preserved, so nothing looked lost; the roles had simply vanished from the
 * GLB, which is the copy the app reads. Re-exporting geometry from Blender and
 * re-measuring is a completely routine thing to do, so a silent loss there
 * would have been found much later and blamed on something else.
 */
function measureDeclaration(report, existing = null) {
  const body = report.confgr.bodyNode;
  if (!body) {
    throw new Error(
      `No node named "${BODY_NODE}", so there is nothing to measure. Rename the visible `
      + 'geometry first — the pipeline refuses to guess which node is the product.',
    );
  }

  const round = (v) => Math.round(v * 1000 * 10) / 10;
  const declaration = {
    confgr: {
      widthMm: round(body.max[0] - body.min[0]),
      heightMm: round(body.max[1] - body.min[1]),
      depthMm: round(body.max[2] - body.min[2]),
      unitScale: 'metres',
    },
  };

  // Grids need cols/rows/pitch, which are a spec decision, not a measurement.
  // A placeholder is emitted so the shape is obvious, and it is deliberately
  // invalid so it cannot be forgotten.
  if (report.confgr.gridNodes.length) {
    declaration.confgrGrids = {};
    for (const name of report.confgr.gridNodes) {
      declaration.confgrGrids[name] = {
        cols: null, rows: null, pitchXMm: null, pitchYMm: null,
        mask: name.slice(GRID_PREFIX.length).split('.')[0] || null,
      };
    }
  }

  if (report.confgr.snapNodes.length) {
    // Every snap listed, so the file itself is the checklist — but a role
    // already decided is kept.
    declaration.confgrRoles = Object.fromEntries(
      report.confgr.snapNodes.map((n) => [n, existing?.confgrRoles?.[n] ?? null]),
    );
  }

  // Everything else the measurement cannot know: carried over verbatim.
  if (existing) {
    for (const [name, grid] of Object.entries(existing.confgrGrids || {})) {
      if (declaration.confgrGrids?.[name]) {
        declaration.confgrGrids[name] = { ...declaration.confgrGrids[name], ...grid };
      }
    }
    if (existing.confgrSpans) declaration.confgrSpans = existing.confgrSpans;
    if (existing.confgrOptions) declaration.confgrOptions = existing.confgrOptions;
  }

  return declaration;
}

/**
 * What this model already says about itself, whichever copy is more complete.
 *
 * The sidecar wins where both exist, because it is the reviewable source; the
 * GLB's own extras are the fallback for a model declared before sidecars, or
 * one declared by hand.
 */
function existingDeclaration(glbPath, report) {
  const path = sidecarPath(glbPath);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new Error(`${basename(path)} is not valid JSON: ${err.message}`);
    }
  }

  const c = report.confgr;
  if (!c.declared && !c.roles && !c.grids) return null;
  return {
    ...(c.declared ? { confgr: c.declared } : {}),
    ...(c.grids ? { confgrGrids: c.grids } : {}),
    ...(c.spans ? { confgrSpans: c.spans } : {}),
    ...(c.roles ? { confgrRoles: c.roles } : {}),
    ...(c.options ? { confgrOptions: c.options } : {}),
  };
}

// ---------------------------------------------------------------- validation

/** Reject a declaration that cannot be right, before writing anything. */
function validateDeclaration(decl, report) {
  const problems = [];

  const c = decl.confgr;
  if (!c) problems.push('No "confgr" block. It must declare widthMm, heightMm and depthMm.');
  else {
    for (const key of ['widthMm', 'heightMm', 'depthMm']) {
      if (typeof c[key] !== 'number' || !(c[key] > 0)) {
        problems.push(`confgr.${key} is ${JSON.stringify(c[key])}; it must be a positive number of millimetres.`);
      }
    }
  }

  const known = new Set(report.confgr.snapNodes);
  for (const name of Object.keys(decl.confgrRoles || {})) {
    const role = decl.confgrRoles[name];
    if (!known.has(name)) {
      problems.push(`confgrRoles names "${name}", which is not a snap node in this model.`);
    }
    if (role !== null && role !== 'socket' && role !== 'plug') {
      problems.push(`confgrRoles["${name}"] is ${JSON.stringify(role)}; it must be "socket", "plug", or null.`);
    }
  }

  const grids = new Set(report.confgr.gridNodes);
  for (const [name, g] of Object.entries(decl.confgrGrids || {})) {
    if (!grids.has(name)) {
      problems.push(`confgrGrids names "${name}", which is not a grid node in this model.`);
      continue;
    }
    for (const key of ['cols', 'rows', 'pitchXMm', 'pitchYMm']) {
      if (typeof g[key] !== 'number' || !(g[key] > 0)) {
        problems.push(`confgrGrids["${name}"].${key} is ${JSON.stringify(g[key])}; fill it in — a grid `
          + 'cannot generate cells without all four.');
      }
    }
  }

  for (const [name, span] of Object.entries(decl.confgrSpans || {})) {
    if (!known.has(name)) {
      problems.push(`confgrSpans names "${name}", which is not a snap node in this model.`);
    } else if (!(span?.cols > 0) || !(span?.rows > 0)) {
      problems.push(`confgrSpans["${name}"] must be { cols, rows } with both at least 1.`);
    }
  }

  return problems;
}

/** Drop nulls, which are placeholders rather than values. */
function stripPlaceholders(decl) {
  const out = {};
  for (const [key, value] of Object.entries(decl)) {
    if (key !== 'confgrRoles') { out[key] = value; continue; }
    const roles = Object.fromEntries(Object.entries(value).filter(([, v]) => v != null));
    if (Object.keys(roles).length) out.confgrRoles = roles;
  }
  return out;
}

// ---------------------------------------------------------------- apply

export function applyDeclaration(glbPath, declaration, { dryRun = false } = {}) {
  const before = inspect(glbPath);
  const problems = validateDeclaration(declaration, before);
  if (problems.length) return { ok: false, problems };

  const { json, bin } = readGlb(glbPath);
  const sceneIndex = json.scene ?? 0;
  json.scenes = json.scenes || [{ nodes: (json.nodes || []).map((_, i) => i) }];
  const scene = json.scenes[sceneIndex];
  scene.extras = scene.extras || {};

  // Only our own keys are replaced. A supplier's extras stay.
  for (const key of OWNED) delete scene.extras[key];
  Object.assign(scene.extras, stripPlaceholders(declaration));

  if (!dryRun) writeGlb(glbPath, json, bin);

  // Report against what the file WOULD be, so --dry-run is honest.
  const after = dryRun
    ? { ...before, confgr: { ...before.confgr, declared: declaration.confgr } }
    : inspect(glbPath);

  return { ok: true, problems: [], before, after, audit: audit(after) };
}

// ---------------------------------------------------------------- cli

function handleOne(glbPath, opts) {
  const out = [];
  const say = (s = '') => out.push(s);
  say(`${basename(glbPath)}`);

  const report = inspect(glbPath);
  if (!report.readable) {
    say(`  cannot read: ${report.format}`);
    say(`  ${report.advice}`);
    return { text: out.join('\n'), ok: false };
  }

  let declaration;
  let source;

  if (opts.measure) {
    const existing = existingDeclaration(glbPath, report);
    declaration = measureDeclaration(report, existing);
    const kept = Object.values(declaration.confgrRoles || {}).filter(Boolean).length;
    source = existing
      ? `measured, keeping ${kept} role${kept === 1 ? '' : 's'} already decided`
      : 'measured from the geometry';
  } else {
    const path = opts.decl || sidecarPath(glbPath);
    if (!existsSync(path)) {
      say(`  no declaration at ${basename(path)}`);
      say('  Run with --measure to derive one from the geometry, then fill in the roles.');
      return { text: out.join('\n'), ok: false };
    }
    declaration = JSON.parse(readFileSync(path, 'utf8'));
    source = basename(path);
  }

  const result = applyDeclaration(glbPath, declaration, { dryRun: opts.dryRun });

  if (!result.ok) {
    say(`  declaration from ${source} is not usable:`);
    for (const p of result.problems) say(`    - ${p}`);
    return { text: out.join('\n'), ok: false };
  }

  const c = declaration.confgr;
  say(`  ${opts.dryRun ? 'would write' : 'wrote'} ${c.widthMm} x ${c.heightMm} x ${c.depthMm} mm  (${source})`);

  // The sidecar is the reviewable artefact, so --measure saves it unless this
  // is a dry run — and it overwrites, because the declaration being written is
  // already MERGED with whatever was there. Saving a superset cannot lose a
  // decision, and the sidecar staying in step with the GLB is worth more than
  // never touching the file.
  if (opts.measure && !opts.dryRun) {
    const path = sidecarPath(glbPath);
    const already = existsSync(path);
    writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`);
    const unset = Object.entries(declaration.confgrRoles || {}).filter(([, v]) => v == null);
    say(`  ${already ? 'updated' : 'saved'} ${basename(path)}`
      + (unset.length ? ` — ${unset.length} role${unset.length === 1 ? '' : 's'} still null and needing a decision` : ''));
  }

  const blockers = result.audit.blockers;
  if (blockers.length) {
    say(`  still ${blockers.length} blocker${blockers.length === 1 ? '' : 's'}:`);
    for (const b of blockers) say(`    - [${b.code}] ${b.says}`);
    say('  Run tools/inspect-model.mjs for the full report and the fixes.');
  } else {
    say('  loads as a component');
  }

  return { text: out.join('\n'), ok: blockers.length === 0 };
}

function main(argv) {
  const opts = {
    measure: argv.includes('--measure'),
    dryRun: argv.includes('--dry-run'),
    decl: argv[argv.indexOf('--decl') + 1] && argv.includes('--decl') ? argv[argv.indexOf('--decl') + 1] : null,
  };
  const targets = argv.filter((a) => !a.startsWith('--') && a !== opts.decl);

  if (!targets.length) {
    process.stdout.write(readFileSync(new URL(import.meta.url)).toString()
      .split('\n')
      .filter((l) => l.startsWith('// Usage:') || (l.startsWith('//   ') && l.includes('declare.mjs')))
      .map((l) => l.replace(/^\/\/ ?/, ''))
      .join('\n') + '\n');
    return 0;
  }

  const files = targets.flatMap((t) => (statSync(t).isDirectory()
    // <id>.converted.glb is the converter's raw output, which add-snaps.py
    // reads and never writes. It is an input, not a candidate component, so a
    // folder sweep skips it - otherwise every declared part is shadowed by an
    // undeclarable twin.
    ? readdirSync(t).filter((f) => extname(f).toLowerCase() === '.glb'
        && !f.toLowerCase().endsWith('.converted.glb')).sort().map((f) => join(t, f))
    : [t]));

  let exit = 0;
  for (const file of files) {
    let outcome;
    try {
      outcome = handleOne(file, opts);
    } catch (err) {
      outcome = { text: `${basename(file)}\n  ${err.message}`, ok: false };
    }
    process.stdout.write(`${outcome.text}\n\n`);
    if (!outcome.ok) exit = 1;
  }
  return exit;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('declare.mjs');
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
