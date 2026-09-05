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
import { validateGrid } from './grid.js';

/** Local facing of an unrotated snap plane. The node's rotation turns it outward. */
const SNAP_LOCAL_FACING = [0, 0, 1];

export const SNAP_PREFIX = 'md-snap';
export const GRID_PREFIX = 'md-grid';
const BODY_NODE = 'body';

/** Node-name prefixes that are structure, not visible geometry. */
const NON_VISIBLE_PREFIXES = [SNAP_PREFIX, GRID_PREFIX, 'col-', 'dim'];

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
  return parsePrefixedName(name, SNAP_PREFIX);
}

/**
 * Same convention for a grid: md-grid.<mask>.<label>.
 *
 * A grid is a separate node type from a snap because the validation differs —
 * a snap plane is small and single, a grid plane spans a whole field of cells —
 * and because only grids read a pitch declaration.
 */
export function parseGridName(name) {
  return parsePrefixedName(name, GRID_PREFIX);
}

function parsePrefixedName(name, prefix) {
  if (typeof name !== 'string' || !name.startsWith(`${prefix}.`)) return null;

  // <prefix>.<mask>.<label> — the label may itself contain dots (Blender appends
  // .001 to duplicates), so mask is the first segment and label is the rest.
  const rest = name.slice(prefix.length + 1);
  const firstDot = rest.indexOf('.');
  if (firstDot <= 0) {
    throw new ComponentError(
      `"${name}" is missing a label. Expected ${prefix}.<mask>.<label>.`,
      { code: 'SNAP_NAME_MALFORMED', detail: { name } },
    );
  }

  const mask = rest.slice(0, firstDot);
  const label = rest.slice(firstDot + 1);
  if (!label) {
    throw new ComponentError(
      `"${name}" has an empty label.`,
      { code: 'SNAP_NAME_MALFORMED', detail: { name } },
    );
  }
  return { mask, label };
}

/**
 * Which side of one of its own snaps a part's body sits on: 'above' or 'below'.
 *
 * This is what lets a rung carry two things at once. Kesseböhmer's sheets show
 * it plainly - a shelf RESTS ON the rung, and a hook rail or a YouboXx HOOKS
 * OVER the same rung and hangs beneath it, and then the two are bolted together
 * through a 1.5 mm packer. One rung, two parts, opposite sides.
 *
 * A shelf's plug is on its bearing face so its body is above it; a suspended
 * element's plug comes off its mounting slot near the top so its body is below.
 * Nothing has to be declared: the geometry already says which is which.
 *
 * Read off the component with no transform, because the solver's only rotational
 * freedom is yaw - it turns the child about the vertical to oppose the facings -
 * and yaw leaves y alone. So local answers the question as well as world does,
 * for a great deal less work.
 */
export function snapBearingSide(component, snapId) {
  const snap = component?.snaps?.find((s) => s.id === snapId);
  const body = component?.body;
  if (!snap || !body) return 'above';
  const centreY = (body.min[1] + body.max[1]) / 2;
  return centreY >= (snap.position?.[1] ?? 0) ? 'above' : 'below';
}

/**
 * The direction a snap looks, in component-local space.
 *
 * Two snaps connect only when their facings oppose. This replaces Mimeeq's
 * red-to-blue normal-colour convention with the thing the colour was standing
 * in for, which is easier to validate and impossible to misread.
 */
export function snapFacing(node) {
  // A vertical facing used to be refused here, on the reasoning that "a
  // floor-standing assembly cannot connect through a ceiling". That was wrong
  // about this range. Kesseböhmer's carcase-holder and office-solution sheets
  // both describe the same joint: the part is LAID ON its brackets and screwed
  // up from below. It meets nothing edge-on, so its only mating face points
  // down, and refusing that made the cabinets and the desktop unbuildable.
  //
  // What the check was really worth was catching a snap plane left flat by
  // accident. That protection now lives where the mistake would be made:
  // add-snaps.py only emits a vertical facing when the spec asks for one, and
  // solveChildTransform refuses to pair a flat face with an upright one.
  return normalise(rotateVec(node.rotation, SNAP_LOCAL_FACING));
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

    // A SPAN says this snap covers more than one cell of whatever grid it
    // mounts to — a 3x2 MOLLE pouch, a divider crossing three slots. Declared
    // in scene extras rather than in the node name, because it is a number pair
    // and names are already carrying enough.
    const span = desc.extras?.confgrSpans?.[node.name] || null;

    // 'socket' offers a place, 'plug' takes one, null means either. Two of the
    // same kind never join — see canConnectLogically for why this is a role
    // check rather than a facing check.
    const role = desc.extras?.confgrRoles?.[node.name] || null;
    if (role && role !== 'socket' && role !== 'plug') {
      throw new ComponentError(
        `Snap "${node.name}" has role "${role}". Must be "socket", "plug", or absent.`,
        { code: 'SNAP_ROLE_INVALID', detail: { name: node.name, role } },
      );
    }

    // A rule about WHERE this snap may be used, not what fits it. Validated
    // here rather than at connect time: a mis-authored condition should be a
    // model that refuses to load, not a part that mysteriously never fits.
    const condition = desc.extras?.confgrConditions?.[node.name] ?? null;
    if (condition !== null) {
      const bad = typeof condition !== 'object' || Array.isArray(condition)
        || !Object.keys(condition).some((k) => k !== 'because');
      if (bad) {
        throw new ComponentError(
          `Snap "${node.name}" has a condition that is not a clause object. `
          + 'See evaluateCondition in snapMatch.js for the vocabulary.',
          { code: 'SNAP_CONDITION_INVALID', detail: { name: node.name, condition } },
        );
      }
    }

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
      condition,
      // A declared turn about the joint's own axis, in degrees. Zero for every
      // joint that has one sensible orientation; 9 on the office plate, whose
      // second set of holes tilts the desk. See solveChildTransform.
      roll: Number(desc.extras?.confgrRolls?.[node.name]) || 0,
      role,
      // {cols, rows} when this snap occupies a rectangle of grid cells, else
      // null meaning a single point or a single cell.
      span: span ? { cols: span.cols || 1, rows: span.rows || 1 } : null,
    });
  }

  // ---- Grids: a field of attach points, generated ------------------------
  const grids = [];

  for (const node of desc.nodes) {
    const parsed = parseGridName(node.name);
    if (!parsed) continue;

    validateSnapGeometry(node);   // a grid plane is a flat quad too

    const declared_ = desc.extras?.confgrGrids?.[node.name];
    if (!declared_) {
      throw new ComponentError(
        `Grid "${node.name}" has no declaration. Add confgrGrids["${node.name}"] `
        + '{ cols, rows, pitchXMm, pitchYMm } to the scene extras.',
        { code: 'GRID_NOT_DECLARED', detail: { name: node.name } },
      );
    }

    const grid = {
      id: node.name,
      mask: parsed.mask,
      label: parsed.label,
      cols: declared_.cols,
      rows: declared_.rows,
      pitchX: (declared_.pitchXMm || 0) / 1000,
      pitchY: (declared_.pitchYMm || 0) / 1000,
      position: node.translation,
      rotation: node.rotation,
      facing: snapFacing(node),
      condition: null,
    };

    // The drawn plane must agree with cols x pitch, for the same reason
    // declared millimetres must agree with geometry: if they disagree the
    // markers a person clicks are not where the webbing is, and nothing about
    // the render looks wrong.
    validateGrid(grid, [node.max[0] - node.min[0], node.max[1] - node.min[1]]);

    grids.push(grid);
  }

  // ---- How this part is held, when it is not held by the product ---------
  //
  // Almost everything in a modular range joins something else, so no attach
  // points is almost always a missing authoring step rather than a fact about
  // the part - which is why it throws.
  //
  // The exception is real and Kesseböhmer document it: the YouK shoe rack
  // (008553-56) is marked out with a spirit level and screwed STRAIGHT TO THE
  // WALL. No ladder appears anywhere in its instruction sheet. It is sized to
  // the bay and sits inside the composition, but it touches none of it.
  //
  // So a part may say so, and then having no snaps is a declaration rather than
  // an omission. Saying it explicitly keeps the check strict for the other 40-odd
  // parts: a shelf that lost its snaps still fails loudly.
  const mounting = declared?.mounting ?? null;
  if (mounting !== null && mounting !== 'wall') {
    throw new ComponentError(
      `Declared mounting "${mounting}" is not recognised. Use "wall", or leave it out `
      + 'for a part that joins the product.',
      { code: 'MOUNTING_INVALID', detail: { mounting } },
    );
  }

  if (!snaps.length && !grids.length && mounting !== 'wall') {
    throw new ComponentError(
      `No attach points found. Add at least one node named ${SNAP_PREFIX}.<mask>.<label> `
      + `or ${GRID_PREFIX}.<mask>.<label> — or declare mounting "wall" if this part `
      + 'fixes to the wall and joins nothing.',
      { code: 'NO_SNAPS' },
    );
  }

  // ---- Options: choices that belong to an INSTANCE, not the product ------
  // Every part carries its own finish. A military pack with eight pouches is
  // eight instances, each independently coloured — which is why selections live
  // on the instance (see createInstance) and the option DEFINITIONS live here.
  // Atom Packs do exactly this: Left Panel, Centre Panel and Right Panel each
  // get their own full palette.
  const options = [];
  const declaredOptions = desc.extras?.confgrOptions || {};

  for (const [id, def] of Object.entries(declaredOptions)) {
    if (!def?.values?.length) {
      throw new ComponentError(
        `Option "${id}" has no values. Remove it or give it at least one choice.`,
        { code: 'OPTION_EMPTY', detail: { id } },
      );
    }
    options.push({
      id,
      label: def.label || id,
      // The first value is the default. Explicit rather than "whatever the
      // renderer happens to show", so a configuration id always resolves to the
      // same appearance — plan 7.6 rule 7.
      defaultValueId: def.values[0].id,
      values: def.values.map((v) => ({ id: v.id, label: v.label || v.id, hex: v.hex || null })),
    });
  }

  // ---- Rule 3: record mesh names so a test can pin them ------------------
  const meshNames = desc.nodes.map((n) => n.name).sort();
  const visibleNodes = desc.nodes.filter(
    (n) => !NON_VISIBLE_PREFIXES.some((p) => n.name === 'dim' || n.name.startsWith(p)),
  );

  return {
    name: desc.name,
    dimsMm: { ...measured },
    // The body's local bounds, in metres, as the geometry actually sits - not
    // derived from dimsMm, which says how big it is but not where. Needed to
    // work out the space a part would occupy once placed, which is how the
    // "how should it sit?" chooser tells a real choice from a flipped duplicate
    // (see distinctPlacements). Collision will want the same thing.
    body: { min: [...body.min], max: [...body.max] },
    // null for anything that joins the product; 'wall' for a part that fixes to
    // the wall and joins nothing, like the YouK shoe rack.
    mounting,
    snaps,
    grids,
    options,
    meshNames,
    // ---- Rule 9: budget recorded now, enforced later --------------------
    triangleCount: visibleNodes.reduce((sum, n) => sum + (n.triangleCount || 0), 0),
    targetTriangleBudget: null,
    collisionBox: desc.nodes.some((n) => n.name.startsWith('col-')) ? 'present' : null,
    dimensionBox: desc.nodes.some((n) => n.name === 'dim') ? 'present' : null,
  };
}
