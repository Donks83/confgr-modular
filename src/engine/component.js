// Turning a loaded glTF into a component the snap engine understands — and
// refusing it if it breaks the rules that keep AR and manufacturing honest.
//
// This file is the enforcement point for plan section 7.6. Every rule below is
// here because getting it wrong is invisible on screen and expensive later:
//
//   Rule 1  Real-world scale, declared in mm, cross-checked against geometry.
//           A model authored at the wrong scale looks identical in a viewport
//           and arrives in AR the size of a mug. There is no way to detect it
//           later, so it is detected here or never.
//   Rule 2  Origin at base centre, Y-up. AR drops the model onto a floor plane.
//   Rule 3  Mesh names are contract. We record them so a test can assert that
//           detail levels carry identical names.
//   Rule 9  A triangle budget is recorded even though nothing reads it yet.
//
// The input is a plain description, not a three.js object — see src/three/loadGlb.js
// for the adapter. That keeps this testable and renderer-agnostic.

import { rotateVec, normalise, EPS } from './vec.js';

/** Local facing of an unrotated snap plane. The node's rotation turns it outward. */
const SNAP_LOCAL_FACING = [0, 0, 1];

export const SNAP_PREFIX = 'md-snap';
const BODY_NODE = 'body';

/** Node-name prefixes that are structure, not visible geometry. */
const NON_VISIBLE_PREFIXES = [SNAP_PREFIX, 'col-', 'dim'];

export class ComponentError extends Error {
  constructor(message, { code, detail } = {}) {
    super(message);
    this.name = 'ComponentError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Parse a snap node name into its mask and label.
 *
 * The mask is what decides whether two snaps MAY connect, and it travels in the
 * node name so the GLB is self-describing. Mimeeq instead assigns masks in their
 * admin panel, which means their GLB alone does not tell you how a part connects
 * — hand the file to a different tool and the information is gone.
 *
 * Returns null for anything that is not a snap node.
 */
export function parseSnapName(name) {
  if (typeof name !== 'string' || !name.startsWith(`${SNAP_PREFIX}.`)) return null;

  // md-snap.<mask>.<label> — the label may itself contain dots (Blender appends
  // .001 to duplicates), so mask is the first segment and label is the rest.
  const rest = name.slice(SNAP_PREFIX.length + 1);
  const firstDot = rest.indexOf('.');
  if (firstDot <= 0) {
    throw new ComponentError(
      `Snap "${name}" is missing a label. Expected ${SNAP_PREFIX}.<mask>.<label>.`,
      { code: 'SNAP_NAME_MALFORMED', detail: { name } },
    );
  }

  const mask = rest.slice(0, firstDot);
  const label = rest.slice(firstDot + 1);
  if (!label) {
    throw new ComponentError(
      `Snap "${name}" has an empty label.`,
      { code: 'SNAP_NAME_MALFORMED', detail: { name } },
    );
  }
  return { mask, label };
}

/**
 * The direction a snap looks, in component-local space.
 *
 * Two snaps connect only when their facings oppose. This replaces Mimeeq's
 * red-to-blue normal-colour convention with the thing the colour was standing
 * in for, which is easier to validate and impossible to misread.
 */
export function snapFacing(node) {
  const facing = normalise(rotateVec(node.rotation, SNAP_LOCAL_FACING));
  if (Math.hypot(facing[0], facing[2]) < EPS) {
    throw new ComponentError(
      `Snap "${node.name}" faces straight up or down. Horizontal facings only — `
      + 'a floor-standing assembly cannot connect through a ceiling.',
      { code: 'SNAP_FACING_VERTICAL', detail: { name: node.name, facing } },
    );
  }
  return facing;
}

function validateSnapGeometry(node) {
  // Mimeeq: "Snaps should be completely flat planes with 4 vertices, without any
  // thickness or subdivisions." Enforced rather than documented, because a snap
  // with subdivisions still renders fine and connects wrongly.
  if (node.vertexCount !== 4) {
    throw new ComponentError(
      `Snap "${node.name}" has ${node.vertexCount} vertices, expected exactly 4. `
      + 'Snaps must be single flat quads with no subdivisions.',
      { code: 'SNAP_NOT_QUAD', detail: { name: node.name, vertexCount: node.vertexCount } },
    );
  }

  const [minZ, maxZ] = [node.min[2], node.max[2]];
  if (Math.abs(maxZ - minZ) > 1e-5) {
    throw new ComponentError(
      `Snap "${node.name}" is not flat — it has thickness along its own normal.`,
      { code: 'SNAP_NOT_FLAT', detail: { name: node.name, thickness: maxZ - minZ } },
    );
  }
}

const mm = (metres) => Math.round(metres * 1000);

/**
 * Build a component from a described glTF scene.
 *
 * @param desc {{
 *   name: string,
 *   extras: object,
 *   nodes: Array<{ name, translation, rotation, min, max, vertexCount, triangleCount }>
 * }}
 * @param opts {{ scaleToleranceMm?: number }}
 */
export function extractComponent(desc, { scaleToleranceMm = 1 } = {}) {
  if (!desc?.nodes?.length) {
    throw new ComponentError('This file contains no nodes.', { code: 'EMPTY' });
  }

  const declared = desc.extras?.confgr;
  if (!declared || declared.widthMm == null) {
    throw new ComponentError(
      'This file does not declare its real-world size. Add confgr '
      + '{ widthMm, heightMm, depthMm } to the scene extras on export.',
      { code: 'NO_DECLARED_SIZE' },
    );
  }

  const body = desc.nodes.find((n) => n.name === BODY_NODE);
  if (!body) {
    throw new ComponentError(
      `No node named "${BODY_NODE}". The visible geometry must be named "${BODY_NODE}" `
      + 'so the pipeline can find it without guessing.',
      { code: 'NO_BODY' },
    );
  }

  // ---- Rule 1: declared millimetres must match measured geometry ----------
  // Geometry is in metres (glTF's unit); the declaration is in millimetres.
  // If these disagree, something applied a scale factor, and we stop here.
  const measured = {
    widthMm: mm(body.max[0] - body.min[0]),
    heightMm: mm(body.max[1] - body.min[1]),
    depthMm: mm(body.max[2] - body.min[2]),
  };

  const drift = {
    widthMm: Math.abs(measured.widthMm - declared.widthMm),
    heightMm: Math.abs(measured.heightMm - declared.heightMm),
    depthMm: Math.abs(measured.depthMm - declared.depthMm),
  };

  if (Math.max(drift.widthMm, drift.heightMm, drift.depthMm) > scaleToleranceMm) {
    throw new ComponentError(
      `Declared size ${declared.widthMm}x${declared.heightMm}x${declared.depthMm}mm does not `
      + `match the geometry, which measures ${measured.widthMm}x${measured.heightMm}x${measured.depthMm}mm. `
      + 'Something has been scaled. Fix the model rather than the declaration.',
      { code: 'SCALE_MISMATCH', detail: { declared, measured, drift } },
    );
  }

  // ---- Rule 2: origin at base centre, Y-up -------------------------------
  if (Math.abs(body.min[1]) > 1e-4) {
    throw new ComponentError(
      `The base of "${BODY_NODE}" sits at y=${body.min[1].toFixed(4)}m, not 0. `
      + 'Origin must be at the base centre or the model will float or sink when placed on a floor.',
      { code: 'ORIGIN_NOT_AT_BASE', detail: { minY: body.min[1] } },
    );
  }

  const centreX = (body.max[0] + body.min[0]) / 2;
  const centreZ = (body.max[2] + body.min[2]) / 2;
  if (Math.abs(centreX) > 1e-4 || Math.abs(centreZ) > 1e-4) {
    throw new ComponentError(
      `"${BODY_NODE}" is not centred on the origin in plan — centre is `
      + `(${centreX.toFixed(4)}, ${centreZ.toFixed(4)}). Rotation would swing the part off its snaps.`,
      { code: 'ORIGIN_NOT_CENTRED', detail: { centreX, centreZ } },
    );
  }

  // ---- Snaps -------------------------------------------------------------
  const snaps = [];
  const seen = new Set();

  for (const node of desc.nodes) {
    const parsed = parseSnapName(node.name);
    if (!parsed) continue;

    validateSnapGeometry(node);

    if (seen.has(node.name)) {
      throw new ComponentError(
        `Two snaps are both named "${node.name}". Snap names must be unique within a component.`,
        { code: 'SNAP_NAME_DUPLICATE', detail: { name: node.name } },
      );
    }
    seen.add(node.name);

    snaps.push({
      id: node.name,
      mask: parsed.mask,
      label: parsed.label,
      // Snap centre in component-local space. Connections are resolved so that
      // two snap centres coincide exactly — Mimeeq: they "will always 'glue' to
      // each other at their centers, without any space in between."
      position: node.translation,
      facing: snapFacing(node),
      required: false,   // set in the editor, not in the model
      condition: null,   // an expression, evaluated in Phase 1
    });
  }

  if (!snaps.length) {
    throw new ComponentError(
      `No snap planes found. Add at least one node named ${SNAP_PREFIX}.<mask>.<label>.`,
      { code: 'NO_SNAPS' },
    );
  }

  // ---- Rule 3: record mesh names so a test can pin them ------------------
  const meshNames = desc.nodes.map((n) => n.name).sort();
  const visibleNodes = desc.nodes.filter(
    (n) => !NON_VISIBLE_PREFIXES.some((p) => n.name === 'dim' || n.name.startsWith(p)),
  );

  return {
    name: desc.name,
    dimsMm: { ...measured },
    snaps,
    meshNames,
    // ---- Rule 9: budget recorded now, enforced later --------------------
    triangleCount: visibleNodes.reduce((sum, n) => sum + (n.triangleCount || 0), 0),
    targetTriangleBudget: null,
    collisionBox: desc.nodes.some((n) => n.name.startsWith('col-')) ? 'present' : null,
    dimensionBox: desc.nodes.some((n) => n.name === 'dim') ? 'present' : null,
  };
}
