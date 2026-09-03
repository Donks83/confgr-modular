// Tests for tools/declare.mjs — writing a component's declaration into a GLB.
//
// The declaration is the half of a component that Blender cannot express, so
// this tool is the only thing standing between a geometrically-correct supplier
// model and a loadable component. Its failure mode is quiet: a declaration that
// is subtly wrong produces a model that loads and assembles incorrectly.

import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = join(ROOT, 'test-assets');

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confgr-declare-'));
  execFileSync('node', [join(ROOT, 'tests', 'make-broken-glb.mjs'), dir], { cwd: ROOT });
});

const tools = async () => import('../tools/declare.mjs');
const inspector = async () => import('../tools/inspect-model.mjs');

// The tool exits non-zero when a model still has blockers, which is correct
// behaviour and not a test failure — so stdout is returned either way.
const run = (args) => {
  try {
    return execFileSync('node', [join(ROOT, 'tools', 'declare.mjs'), ...args],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return `${err.stdout || ''}${err.stderr || ''}`;
  }
};

const sidecar = (glb) => glb.replace(/\.glb$/, '.confgr.json');

describe('measuring a declaration from the geometry', () => {
  it('writes the size a supplier model already has', async () => {
    const glb = join(dir, 'no-declared-size.glb');
    const out = run([glb, '--measure']);

    expect(out).toMatch(/600 x 720 x 560 mm/);
    expect(out).toMatch(/loads as a component/);

    const { inspect } = await inspector();
    expect(inspect(glb).confgr.declared).toMatchObject({ widthMm: 600, heightMm: 720, depthMm: 560 });
  });

  it('saves a reviewable sidecar beside the model', async () => {
    const glb = join(dir, 'no-declared-size.glb');
    run([glb, '--measure']);

    expect(existsSync(sidecar(glb))).toBe(true);
    const decl = JSON.parse(readFileSync(sidecar(glb), 'utf8'));
    expect(decl.confgr.unitScale).toBe('metres');
    // Every snap is listed, so the file itself is the checklist of decisions.
    expect(Object.keys(decl.confgrRoles)).toEqual([
      'md-snap.carcass-side.left', 'md-snap.carcass-side.right',
    ]);
  });

  it('changes nothing with --dry-run', async () => {
    const glb = join(dir, 'no-declared-size.glb');
    const before = readFileSync(glb);

    const out = run([glb, '--measure', '--dry-run']);
    expect(out).toMatch(/would write/);
    expect(readFileSync(glb).equals(before)).toBe(true);
    expect(existsSync(sidecar(glb))).toBe(false);
  });

  it('refuses to measure a model with no body node', () => {
    const glb = join(dir, 'no-body.glb');
    const out = run([glb, '--measure']);
    expect(out).toMatch(/No node named "body"/);
    expect(out).toMatch(/refuses to guess/);
  });

  // Roles are a decision about how a range assembles, not a measurement.
  // Inventing them produces a model that connects wrongly and silently.
  it('never invents a role', async () => {
    const glb = join(dir, 'no-declared-size.glb');
    // Start from a model whose extras carry no roles at all.
    const { inspect } = await inspector();
    const stripped = join(dir, 'roleless.glb');
    copyFileSync(glb, stripped);

    const { applyDeclaration } = await tools();
    const report = inspect(stripped);
    applyDeclaration(stripped, { confgr: { widthMm: 600, heightMm: 720, depthMm: 560 } });

    run([stripped, '--measure']);
    const decl = JSON.parse(readFileSync(sidecar(stripped), 'utf8'));
    for (const value of Object.values(decl.confgrRoles)) {
      expect(value === null || value === 'plug' || value === 'socket').toBe(true);
    }
    expect(report.confgr.snapNodes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The regression that made this file worth writing.
//
// Re-measuring a model whose roles had already been filled in wrote the
// measured declaration — roles back to null, therefore stripped — over them.
// The sidecar was left alone, so nothing looked lost; the roles had simply
// disappeared from the GLB, which is the copy the app reads. Re-exporting
// geometry from Blender and re-measuring is routine, so the loss would have
// surfaced much later and been blamed on something else.
// ---------------------------------------------------------------------------

describe('re-measuring keeps decisions that cannot be measured', () => {
  const withRolesDecided = () => {
    const glb = join(dir, 'no-declared-size.glb');
    run([glb, '--measure']);

    const decl = JSON.parse(readFileSync(sidecar(glb), 'utf8'));
    decl.confgrRoles['md-snap.carcass-side.left'] = 'plug';
    decl.confgrRoles['md-snap.carcass-side.right'] = 'socket';
    writeFileSync(sidecar(glb), JSON.stringify(decl, null, 2));
    run([glb]);
    return glb;
  };

  it('keeps roles through a re-measure', async () => {
    const glb = withRolesDecided();
    const { inspect } = await inspector();
    expect(inspect(glb).confgr.roles).toEqual({
      'md-snap.carcass-side.left': 'plug',
      'md-snap.carcass-side.right': 'socket',
    });

    run([glb, '--measure']);

    expect(inspect(glb).confgr.roles, 'roles must survive a re-measure').toEqual({
      'md-snap.carcass-side.left': 'plug',
      'md-snap.carcass-side.right': 'socket',
    });
  });

  it('says how many decisions it carried over', () => {
    const glb = withRolesDecided();
    expect(run([glb, '--measure'])).toMatch(/keeping 2 roles already decided/);
  });

  it('keeps the sidecar and the model in step', async () => {
    const glb = withRolesDecided();
    run([glb, '--measure']);

    const decl = JSON.parse(readFileSync(sidecar(glb), 'utf8'));
    expect(decl.confgrRoles['md-snap.carcass-side.left']).toBe('plug');
  });

  it('recovers a declaration from the GLB when there is no sidecar', async () => {
    // A model declared before sidecars existed, or by hand. Its roles are in
    // the file and must not be lost just because no sidecar sits beside it.
    const glb = join(GOOD, 'unit-600.glb');
    const copy = join(dir, 'unit-600.glb');
    copyFileSync(glb, copy);
    expect(existsSync(sidecar(copy))).toBe(false);

    run([copy, '--measure']);

    const { inspect } = await inspector();
    expect(inspect(copy).confgr.roles).toMatchObject({
      'md-snap.carcass-side.left': 'plug',
      'md-snap.carcass-side.right': 'socket',
    });
  });
});

describe('refusing a declaration that cannot be right', () => {
  const applyTo = async (file, declaration) => {
    const { applyDeclaration } = await tools();
    return applyDeclaration(join(dir, file), declaration);
  };

  it('refuses a missing size', async () => {
    const r = await applyTo('no-declared-size.glb', { confgrRoles: {} });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/must declare widthMm/);
  });

  it('refuses a size that is not a positive number', async () => {
    const r = await applyTo('no-declared-size.glb', { confgr: { widthMm: 0, heightMm: 720, depthMm: 560 } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/confgr\.widthMm is 0/);
  });

  it('refuses a role on a snap the model does not have', async () => {
    const r = await applyTo('no-declared-size.glb', {
      confgr: { widthMm: 600, heightMm: 720, depthMm: 560 },
      confgrRoles: { 'md-snap.imaginary.thing': 'plug' },
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/not a snap node in this model/);
  });

  it('refuses a role that is neither socket nor plug', async () => {
    const r = await applyTo('no-declared-size.glb', {
      confgr: { widthMm: 600, heightMm: 720, depthMm: 560 },
      confgrRoles: { 'md-snap.carcass-side.left': 'male' },
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/must be "socket", "plug", or null/);
  });

  it('refuses a grid with a missing pitch', async () => {
    const r = await applyTo('grid-not-declared.glb', {
      confgr: { widthMm: 600, heightMm: 720, depthMm: 560 },
      confgrGrids: { 'md-grid.pals.front': { cols: 7, rows: 12, pitchXMm: 38.1 } },
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/pitchYMm/);
  });

  it('writes nothing when it refuses', async () => {
    const glb = join(dir, 'no-declared-size.glb');
    const before = readFileSync(glb);
    await applyTo('no-declared-size.glb', { confgr: { widthMm: -1, heightMm: 1, depthMm: 1 } });
    expect(readFileSync(glb).equals(before)).toBe(true);
  });
});

describe('leaving the supplier alone', () => {
  it('keeps extras it does not own', async () => {
    const { applyDeclaration, readGlb, writeGlb } = await tools();
    const { inspect } = await inspector();
    const glb = join(dir, 'no-declared-size.glb');

    // Stand in for a supplier's own metadata: something we must not discard
    // just because we are writing our own keys next to it.
    const { json, bin } = readGlb(glb);
    json.scenes[json.scene ?? 0].extras = {
      ...json.scenes[json.scene ?? 0].extras,
      supplierPartNumber: 'KB-YOUK-001',
    };
    writeGlb(glb, json, bin);
    expect(inspect(glb).scene.extras.supplierPartNumber).toBe('KB-YOUK-001');

    applyDeclaration(glb, { confgr: { widthMm: 600, heightMm: 720, depthMm: 560 } });

    const after = inspect(glb);
    expect(after.scene.extras.supplierPartNumber, 'supplier metadata must survive').toBe('KB-YOUK-001');
    expect(after.confgr.declared.widthMm).toBe(600);
  });

  it('replaces its own keys rather than merging into them', async () => {
    const { applyDeclaration } = await tools();
    const { inspect } = await inspector();
    const glb = join(dir, 'no-declared-size.glb');

    applyDeclaration(glb, {
      confgr: { widthMm: 600, heightMm: 720, depthMm: 560 },
      confgrRoles: { 'md-snap.carcass-side.left': 'plug', 'md-snap.carcass-side.right': 'socket' },
    });
    applyDeclaration(glb, { confgr: { widthMm: 600, heightMm: 720, depthMm: 560 } });

    // A declaration with no roles means no roles. Merging would make it
    // impossible to ever REMOVE one, and a stale role is worse than none.
    expect(inspect(glb).confgr.roles).toBeNull();
  });
});
