#!/usr/bin/env node
// Replay a recording made with ?record, and say where it went wrong.
//
//   npx vite-node tools/audit/replay.mjs path/to/confgr-recording-....json [--models youk]
//
// Each step's choices are rebuilt with the engine on THIS checkout and checked
// the way the audit sweep checks: is anything below the floor, is a ladder off
// the floor, does the judge object, did the engine drop a record. Where the
// recording also says what the page DREW at that step, the two are compared -
// a difference means the page was running another engine (an older deploy), and
// the replay says so rather than blaming the step.

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFolder } from '../export-glb.mjs';
import { parseGuided, buildGuided, normaliseChoices } from '../../src/engine/guided.js';
import { parseRules } from '../../src/engine/rules.js';
import { judge } from '../../src/engine/judge.js';
import { resolveTransforms } from '../../src/engine/assembly.js';
import { boxesFor } from '../../src/engine/collision.js';
import { isGrounded, groundClearanceMm } from '../../src/engine/ar.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const at = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
if (!file) {
  console.error('usage: npx vite-node tools/audit/replay.mjs <recording.json> [--models youk]');
  process.exit(2);
}
const MODELS = resolve(ROOT, at('models', 'youk'));

const recording = JSON.parse(readFileSync(file, 'utf8'));
if (recording.format !== 'confgr-recording') throw new Error(`${file} is not a confgr recording`);
const { components } = loadFolder(MODELS);
const schema = parseGuided(JSON.parse(readFileSync(join(MODELS, 'guided.json'), 'utf8')));
const catalogue = JSON.parse(readFileSync(join(MODELS, 'catalogue.json'), 'utf8'));
const rules = parseRules(JSON.parse(readFileSync(join(MODELS, 'rules.json'), 'utf8')), { catalogue });
const frameIds = new Set(schema.variants.flatMap((v) => v.frames.map((f) => f.componentId)));
const dec = (o) => JSON.parse(Buffer.from(o.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
const label = (id) => catalogue.items?.[id]?.description || id;

console.log(`${recording.steps.length} steps, recorded ${recording.startedAt || '?'} on ${recording.page || '?'}`);
console.log(`device: ${recording.userAgent || '?'}\n`);

let firstBad = null;
for (const step of recording.steps) {
  const choices = normaliseChoices(schema, dec(step.o));
  const built = buildGuided(schema, choices, components, { rules });
  const { transforms } = resolveTransforms(built.assembly, components);
  // The real floor: on feet, the bottom of the foot.
  const floor = transforms.get(built.assembly.instances[0].instanceId).translation[1] - groundClearanceMm(choices.mounting, choices.footHeightMm) / 1000;
  const problems = [];
  const notes = [];

  if (isGrounded(choices.mounting)) {
    for (const i of built.assembly.instances) {
      let lo = Infinity;
      for (const b of boxesFor(components.get(i.componentId), transforms.get(i.instanceId))) {
        lo = Math.min(lo, b.centre[1] - b.axes.reduce((s, ax, k) => s + Math.abs(ax[1]) * b.half[k], 0));
      }
      if (lo < floor - 0.001) problems.push(`${label(i.componentId)} reaches ${Math.round((floor - lo) * 1000)} mm below the floor`);
    }
  }
  // A ladder whose base is not level with the first ladder's is hung off
  // something (allowed - it is fixed to the wall, Matt 12 Nov) or a fault worth
  // seeing. Measured from the first ladder's base, which is where every ladder
  // stands when nothing has been moved.
  const base = transforms.get(built.assembly.instances[0].instanceId).translation[1];
  for (const i of built.assembly.instances) {
    if (!frameIds.has(i.componentId)) continue;
    const up = Math.round((transforms.get(i.instanceId).translation[1] - base) * 1000);
    if (up !== 0) notes.push(`ladder ${built.slots[i.instanceId] || i.instanceId} is ${Math.abs(up)} mm ${up > 0 ? 'higher' : 'lower'} than the first ladder`);
  }
  for (const r of judge(built.assembly, components, rules, { mounting: choices.mounting, footHeightMm: choices.footHeightMm })) problems.push(r.says);
  for (const d of built.dropped) notes.push(`${d.slot}: ${d.reason}`);
  for (const r of built.refused) notes.push(`${r.kind || r.componentId}: ${r.reason}`);
  if (step.drawn?.c && step.drawn.c !== built.configurationId) {
    notes.push('the page drew a DIFFERENT product here - it was running another version of the engine');
  }
  if (step.drawn?.lowestBase && isGrounded(choices.mounting) && step.drawn.lowestBase.mm < -1) {
    notes.push(`on the page: ${label(step.drawn.lowestBase.componentId)} based ${-step.drawn.lowestBase.mm} mm below the floor`);
  }
  for (const issue of step.drawn?.issues || []) notes.push(`page said: ${issue}`);

  const mark = problems.length ? '✗' : '✓';
  if (problems.length && firstBad === null) firstBad = step.step;
  console.log(`${mark} step ${step.step} (${step.action}, ${Math.round((step.ms || 0) / 1000)} s): ${step.changes.join('; ')}`);
  for (const p of problems) console.log(`    PROBLEM  ${p}`);
  for (const n of notes) console.log(`    note     ${n}`);
  if (problems.length) console.log(`    open it  ?o=${step.o}`);
}
console.log(firstBad === null
  ? '\nNo step breaks a rule with this engine.'
  : `\nFirst step that breaks a rule: ${firstBad}. Open its ?o= on the page to see it.`);
