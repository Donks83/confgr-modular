#!/usr/bin/env node
// Record what TODAY's engine makes of real links, before A3 changes the engine.
//
//   npx vite-node tools/audit/capture-fixtures.mjs
//     -> tests/fixtures/links-v1.json
//
// The A3 migration test opens every one of these with the new engine and
// compares part for part. Where the new engine differs, the difference has to be
// one of the audit's failures being FIXED (a rack lifted off the floor, a shelf
// no longer doubled) and it is listed against the link as `expectedChange` -
// anything else is a regression.
//
// Run once, committed, and then not again: re-running after the engine changes
// would record the new answers as the old ones and the test would prove nothing.
// The file says when it was captured and at which commit.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { loadFolder } from '../export-glb.mjs';
import { parseGuided, normaliseChoices, buildGuided, defaultChoices } from '../../src/engine/guided.js';
import { resolveConfiguration } from '../../src/engine/configuration.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { components } = loadFolder(join(ROOT, 'youk'));
const schema = parseGuided(JSON.parse(readFileSync(join(ROOT, 'youk', 'guided.json'), 'utf8')));
const catalogue = JSON.parse(readFileSync(join(ROOT, 'youk', 'catalogue.json'), 'utf8'));
const enc = (c) => Buffer.from(JSON.stringify(c)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const dec = (o) => JSON.parse(Buffer.from(o.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
const base = defaultChoices(schema);
const mm = (v) => Math.round(v * 10000) / 10;

// The audit's links, verbatim (docs/audit/A1-failures.md, L1-L8).
const audit = readFileSync(join(ROOT, 'docs', 'audit', 'A1-failures.md'), 'utf8');
const links = [...audit.matchAll(/^- \*\*(L\d)\*\* ([^:]+): `([A-Za-z0-9_-]+)`/gm)].map((m) => ({ name: `${m[1]} ${m[2]}`, o: m[3] }));

// Plus products nobody wrote down: each variant's default, mixed runs, every mounting,
// a moved accessory, a moved bay shelf, a moved ladder.
const extra = [
  ['default d320', { ...base, variantId: 'd320' }],
  ['default d200', { ...base, variantId: 'd200' }],
  ['3 bays mixed widths and ladders', { ...base, variantId: 'd320', bays: 3, frames: { 1: '236754-ladder-depth-320mm', 2: '236762-ladder-depth-320mm', 3: '236758-ladder-depth-320mm' }, widths: { 0: 'w1200', 1: 'w600', 2: 'w900' }, adds: { 'metal-shelf': 2, 'clothes-rail': 1 } }],
  ['wall-mounted 2 bays with storage', { ...base, variantId: 'd320', bays: 2, mounting: 'wall', adds: { 'timber-shelf': 2, youboxx: 1, 'hook-strip': 1 } }],
  ['floor 1 bay 2210 every shelf', { ...base, variantId: 'd320', frameId: '236762-ladder-depth-320mm', bays: 1, mounting: 'floor', adds: { 'metal-shelf': 4 } }],
  ['d200 2 bays timber', { ...base, variantId: 'd200', bays: 2, mounting: 'floor', adds: { 'timber-shelf': 2, 'side-rack': 1 } }],
];

const out = [];
const record = (name, choices) => {
  const c = normaliseChoices(schema, choices);
  const built = buildGuided(schema, c, components);
  const r = resolveConfiguration(built.configurationId, components, { catalogue });
  out.push({
    name,
    o: enc(choices),
    c: built.configurationId,
    layout: built.assembly.instances.map((i, k) => ({
      componentId: i.componentId,
      slot: built.slots[i.instanceId] || null,
      at: r.transforms.get(r.assembly.instances[k].instanceId).translation.map(mm),
    })),
    bom: (r.quote?.lines || []).map((l) => [l.article ?? l.componentId, l.qty ?? l.quantity]),
    refused: built.refused.map((x) => x.reason),
    dropped: built.dropped.map((x) => x.slot),
  });
};

for (const l of links) record(l.name, dec(l.o));
for (const [name, c] of extra) record(name, c);

// The id of a moved ladder needs a real recorded position, so take one the
// current move list offers and record that.
{
  const c = normaliseChoices(schema, { ...base, variantId: 'd320', bays: 2, mounting: 'wall', adds: {} });
  const built = buildGuided(schema, c, components);
  const { moveOptions } = await import('../../src/engine/guided.js');
  const ladder = Object.entries(built.slots).find(([, s]) => s === 'frame#2')[0];
  const opt = moveOptions(built, components, ladder).options.find((o) => !o.current);
  record('wall 2 bays, last ladder moved', { ...c, at: { 'frame#2': opt.at } });
  const shelf = Object.entries(built.slots).find(([, s]) => s === 'span#0')[0];
  const sopt = moveOptions(built, components, shelf).options.find((o) => !o.current);
  record('wall 2 bays, bay 1 shelf moved', { ...c, at: { 'span#0': sopt.at } });
}

const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
mkdirSync(join(ROOT, 'tests', 'fixtures'), { recursive: true });
writeFileSync(join(ROOT, 'tests', 'fixtures', 'links-v1.json'), `${JSON.stringify({
  _: 'What the engine at this commit made of each link, captured BEFORE the A3 rules rewrite. Do not regenerate: see tools/audit/capture-fixtures.mjs.',
  capturedAt: new Date().toISOString(),
  commit,
  links: out,
}, null, 1)}\n`);
console.log(`${out.length} links captured at ${commit}`);
for (const l of out) console.log(`  ${l.name.padEnd(40)} ${l.layout.length} parts${l.refused.length ? `, ${l.refused.length} refused` : ''}${l.dropped.length ? `, dropped ${l.dropped}` : ''}`);
