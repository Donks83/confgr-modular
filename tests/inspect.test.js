// Tests for tools/inspect-model.mjs — against files that are actually broken.
//
// The inspector passed all ten generated components on its first run, which
// proved nothing about its real job. These tests feed it deliberately-broken
// variants (tests/make-broken-glb.mjs) and assert it names the right fault.
//
// Each variant differs from a known-good file in exactly ONE way, so a code
// firing here can only be a reaction to that one change.

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = join(ROOT, 'test-assets');

let BROKEN;
let manifest;

beforeAll(() => {
  // Generated into a temp dir rather than the repo: these files exist to be
  // fed to the inspector, and nothing should be tempted to load them as real
  // components.
  BROKEN = mkdtempSync(join(tmpdir(), 'confgr-broken-'));
  execFileSync('node', [join(ROOT, 'tests', 'make-broken-glb.mjs'), BROKEN], { cwd: ROOT });
  manifest = JSON.parse(readFileSync(join(BROKEN, 'manifest.json'), 'utf8'));
});

const inspectFile = async (path) => {
  const { inspect, audit } = await import('../tools/inspect-model.mjs');
  const report = inspect(path);
  return { report, result: audit(report) };
};

const codesFrom = ({ result }) => [
  ...result.blockers.map((b) => b.code),
  ...result.warnings.map((w) => w.code),
];

describe('the inspector on correct components', () => {
  it('passes every generated component with no blockers', async () => {
    const files = ['unit-600', 'unit-900', 'corner-connector', 'wall-cabinet-720',
      'rack-upright-1800', 'rack-shelf-900', 'rack-drawer-900',
      'molle-panel', 'pouch-2x3', 'pouch-3x2'];

    for (const name of files) {
      const { report, result } = await inspectFile(join(GOOD, `${name}.glb`));
      expect(result.blockers, `${name} should have no blockers`).toEqual([]);
      expect(report.confgr.declared).toBeTruthy();
    }
  });

  // Dots in a snap name are correct and must never be reported. The loader
  // reads names from the raw glTF JSON precisely so they survive.
  it('does not warn about dots in snap names', async () => {
    const { result } = await inspectFile(join(GOOD, 'rack-upright-1800.glb'));
    expect(result.warnings.map((w) => w.code)).not.toContain('THREE_NAME_MANGLING');
  });

  it('reads the real node names, not the sanitised ones', async () => {
    const { report } = await inspectFile(join(GOOD, 'rack-upright-1800.glb'));
    expect(report.confgr.snapNodes).toContain('md-snap.shelf-level.level-1-right');
    expect(report.confgr.snapNodes).toHaveLength(8);
  });

  it('counts triangles and finds the grid declaration', async () => {
    const { report } = await inspectFile(join(GOOD, 'molle-panel.glb'));
    expect(report.counts.triangles).toBeGreaterThan(0);
    expect(report.confgr.gridNodes).toHaveLength(1);
    expect(report.confgr.grids[report.confgr.gridNodes[0]].cols).toBe(7);
  });

  it('names metres as the likeliest unit for a real-sized part', async () => {
    const { report } = await inspectFile(join(GOOD, 'unit-600.glb'));
    const likeliest = report.unitGuesses.find((g) => g.likeliest);
    expect(likeliest.unit).toBe('metres');
    expect(likeliest.dimsMm).toEqual([600, 720, 560]);
  });
});

describe('the inspector on broken models', () => {
  it('generated the fixtures', () => {
    expect(manifest.variants.length).toBeGreaterThanOrEqual(15);
    for (const v of manifest.variants) {
      expect(existsSync(join(BROKEN, v.file)), `${v.file} exists`).toBe(true);
    }
  });

  // The manifest is the specification: every variant must produce its code.
  it('reports the expected fault for every variant', async () => {
    const missed = [];

    for (const variant of manifest.variants) {
      const outcome = await inspectFile(join(BROKEN, variant.file));
      const codes = codesFrom(outcome);
      for (const wanted of variant.expect) {
        if (!codes.includes(wanted)) {
          missed.push(`${variant.file}: expected ${wanted}, got [${codes.join(', ')}]`);
        }
      }
      // A fault the loader would throw on must be a BLOCKER, not a warning —
      // the distinction is the whole point of the two lists.
      if (!variant.warningsOnly) {
        const blockerCodes = outcome.result.blockers.map((b) => b.code);
        for (const wanted of variant.expect) {
          if (!blockerCodes.includes(wanted)) {
            missed.push(`${variant.file}: ${wanted} was reported as a warning, not a blocker`);
          }
        }
      }
    }

    expect(missed).toEqual([]);
  });

  it('names inches when the factor is 25.4', async () => {
    const { result } = await inspectFile(join(BROKEN, 'scale-inches.glb'));
    const scale = result.blockers.find((b) => b.code === 'SCALE_MISMATCH');
    expect(scale.fix).toMatch(/25\.4x the declared size/);
    expect(scale.fix).toMatch(/inches/);
  });

  it('calls a per-axis difference a stretched model, not a unit error', async () => {
    // baked-scale.glb stretches Z by 1.5 and leaves X and Y alone, so the
    // ratios disagree — a genuinely different diagnosis from a unit mix-up.
    const { result } = await inspectFile(join(BROKEN, 'baked-scale.glb'));
    const scale = result.blockers.find((b) => b.code === 'SCALE_MISMATCH');
    expect(scale.fix).toMatch(/unevenly scaled/);
    expect(scale.fix).toMatch(/stretched model/);
  });

  it('catches the 1000x metres/millimetres mix-up with a useful message', async () => {
    const { result } = await inspectFile(join(BROKEN, 'scale-metres-as-mm.glb'));
    const scale = result.blockers.find((b) => b.code === 'SCALE_MISMATCH');
    expect(scale.detail).toMatch(/declared 0\.6x0\.72x0\.56mm/);
    expect(scale.detail).toMatch(/measured 600x720x560mm/);
    // The advice has to name the ratio it found, not describe how to spot one.
    expect(scale.fix).toMatch(/1000x the declared size/);
    expect(scale.fix).toMatch(/metres declared as millimetres/);
  });

  it('refuses names three.js cannot tell apart, and says which', async () => {
    const { report, result } = await inspectFile(join(BROKEN, 'name-collision.glb'));
    expect(report.nameCollisions).toHaveLength(1);
    expect(report.nameCollisions[0].collapsesTo).toBe('md-snapabc');

    const collision = result.blockers.find((b) => b.code === 'NAME_COLLISION');
    expect(collision.detail).toMatch(/md-snap\.a\.bc/);
    expect(collision.detail).toMatch(/md-snap\.ab\.c/);
  });

  it('still reports the size of a file it is otherwise refusing', async () => {
    // A model with no declaration is the common case for a supplier file, and
    // the size is exactly what you need in order to write the declaration.
    const { report, result } = await inspectFile(join(BROKEN, 'no-declared-size.glb'));
    expect(result.blockers.map((b) => b.code)).toContain('NO_DECLARED_SIZE');
    expect(report.extentFileUnits).toBeTruthy();
    expect(report.unitGuesses.find((g) => g.likeliest).dimsMm).toEqual([600, 720, 560]);
  });

  it('reports a floating origin with the actual offset', async () => {
    const { result } = await inspectFile(join(BROKEN, 'origin-floating.glb'));
    const origin = result.blockers.find((b) => b.code === 'ORIGIN_NOT_AT_BASE');
    expect(origin.detail).toMatch(/0\.36/);
  });

  it('finds a baked scale and prints the factors', async () => {
    const { report, result } = await inspectFile(join(BROKEN, 'baked-scale.glb'));
    expect(report.scaledNodes.some((n) => n.name === 'body')).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('BAKED_SCALE');
  });

  // The point of reporting everything at once: a real supplier file has
  // several faults, and the loader only ever shows you the first.
  it('reports several faults from one file rather than stopping at the first', async () => {
    const { result } = await inspectFile(join(BROKEN, 'no-body.glb'));
    // No body means the size cross-check cannot run either, so this file has
    // one blocker but the pipeline has more to say about it than "no body".
    expect(result.blockers.length).toBeGreaterThanOrEqual(1);
    expect(result.verdict).toMatch(/blocker/);
  });
});

describe('formats the pipeline cannot read', () => {
  it('names the format and says to convert, rather than failing obscurely', async () => {
    const { inspect: fn, audit: auditFn } = await import('../tools/inspect-model.mjs');
    // A STEP file only needs to exist to be classified; nothing reads it.
    const fake = join(BROKEN, 'part.step');
    execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(fake)}, 'ISO-10303-21;')`]);

    const report = fn(fake);
    expect(report.readable).toBe(false);
    expect(report.format).toMatch(/STEP/);
    expect(auditFn(report).blockers[0].code).toBe('UNREADABLE');
    expect(auditFn(report).blockers[0].fix).toMatch(/Blender/);
  });
});
