// Attach GRIDS — a field of attach points generated from a declaration, and
// parts that occupy more than one cell of it.
//
// WHY THIS EXISTS. Everything before this was a single hand-authored attach
// point, which is fine for four shelf levels and hopeless for MOLLE/PALS
// webbing: rows of loops across, columns down, and a pouch spanning several
// cells. Nobody is authoring 48 nodes, and a pouch covering 3x2 of them cannot
// be expressed as a point at all.
//
// Mimeeq has no equivalent — their snaps are individual planes, so a webbing
// panel is not something their model expresses. Roomle does, via `ranges` with
// a step and an index recovered from the connection position. This is that idea
// with the span problem solved, which Roomle's docs do not cover.
//
// THE COORDINATE MODEL, because it is the part that gets confused:
//   * A grid is a plane. Columns run along the plane's LOCAL +X, rows along
//     LOCAL +Y. The facing is local +Z, exactly as for a snap.
//   * Cell (0, 0) is the MIN corner — bottom-left when looking at the panel.
//   * A cell id is `<gridNodeName>#c<col>r<row>`, so a grid cell travels through
//     the connection graph as an ordinary snap id and nothing downstream needs
//     a second code path.
//   * A spanning part anchors at its MIN-corner cell, but glues by its snap
//     CENTRE — so the effective attach position is the centre of the footprint,
//     not the centre of the anchor cell. Conflating those two is the bug this
//     comment exists to prevent.

import { add, rotateVec, normalise } from './vec.js';

const CELL_ID = /^(.*)#c(\d+)r(\d+)$/;

export class GridError extends Error {
  constructor(message, { code, detail } = {}) {
    super(message);
    this.name = 'GridError';
    this.code = code;
    this.detail = detail;
  }
}

export const makeGridCellId = (gridId, col, row) => `${gridId}#c${col}r${row}`;

/** Split a cell id back into its grid and coordinates, or null if it is not one. */
export function parseGridCellId(id) {
  const m = CELL_ID.exec(id || '');
  if (!m) return null;
  return { gridId: m[1], col: Number(m[2]), row: Number(m[3]) };
}

export const isGridCellId = (id) => CELL_ID.test(id || '');

/** A part occupying `span` cells from an anchor covers this set of cell keys. */
export function cellsCovered(col, row, span = { cols: 1, rows: 1 }) {
  const cols = Math.max(1, span.cols || 1);
  const rows = Math.max(1, span.rows || 1);
  const out = [];
  for (let c = col; c < col + cols; c++) {
    for (let r = row; r < row + rows; r++) out.push(`c${c}r${r}`);
  }
  return out;
}

/** Does a span starting here fit inside the grid at all? */
export function spanFits(grid, col, row, span = { cols: 1, rows: 1 }) {
  const cols = Math.max(1, span.cols || 1);
  const rows = Math.max(1, span.rows || 1);
  return col >= 0 && row >= 0 && col + cols <= grid.cols && row + rows <= grid.rows;
}

/**
 * Where a part's snap centre must sit, in the grid PLANE's local 2D space.
 *
 * For a 1x1 span this is the cell centre. For anything larger it is the centre
 * of the whole footprint, which is what makes a 3x2 pouch sit centred over the
 * three columns and two rows it actually covers.
 */
export function footprintCentre2D(grid, col, row, span = { cols: 1, rows: 1 }) {
  const cols = Math.max(1, span.cols || 1);
  const rows = Math.max(1, span.rows || 1);
  const width = grid.cols * grid.pitchX;
  const height = grid.rows * grid.pitchY;
  return [
    -width / 2 + (col + cols / 2) * grid.pitchX,
    -height / 2 + (row + rows / 2) * grid.pitchY,
  ];
}

/**
 * A grid cell as an attach point in COMPONENT-local space.
 *
 * Returns the same shape as an authored snap, so the assembly resolver and the
 * matcher cannot tell the difference — which is the point.
 */
export function gridAttachPoint(grid, col, row, span = { cols: 1, rows: 1 }) {
  if (!spanFits(grid, col, row, span)) {
    throw new GridError(
      `A ${span.cols || 1}x${span.rows || 1} part does not fit at column ${col}, row ${row} `
      + `of a ${grid.cols}x${grid.rows} grid.`,
      { code: 'SPAN_OUT_OF_BOUNDS', detail: { grid: grid.id, col, row, span } },
    );
  }

  const [localX, localY] = footprintCentre2D(grid, col, row, span);

  return {
    id: makeGridCentreId(grid, col, row),
    gridId: grid.id,
    col,
    row,
    mask: grid.mask,
    label: `c${col}r${row}`,
    condition: grid.condition ?? null,
    required: false,
    // The plane's own rotation carries the cell out of plane-local space and
    // into component-local space, so a grid on the side of a pack works the
    // same as one on its front with no special casing.
    position: add(grid.position, rotateVec(grid.rotation, [localX, localY, 0])),
    facing: normalise(rotateVec(grid.rotation, [0, 0, 1])),
  };
}

const makeGridCentreId = (grid, col, row) => makeGridCellId(grid.id, col, row);

/**
 * Every cell of a grid as a 1x1 attach point, for DISPLAY.
 *
 * The markers a person sees are per-cell regardless of what they are about to
 * attach — you cannot draw a marker for a span that has not been chosen yet.
 * Validity for an actual part comes from placementsFor below.
 */
export function expandGridCells(grid) {
  const out = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      out.push(gridAttachPoint(grid, col, row, { cols: 1, rows: 1 }));
    }
  }
  return out;
}

/**
 * Every placement a part with this span could legally take, given what is
 * already occupied.
 *
 * This is the grid's answer to "where can this go", and it is span-aware in a
 * way a fixed point list cannot be: a 3x2 pouch has fewer valid positions than
 * a 1x1 one on the same panel, and a single occupied cell rules out every
 * placement that would have covered it.
 */
export function placementsFor(grid, span = { cols: 1, rows: 1 }, occupiedCells = new Set()) {
  const out = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!spanFits(grid, col, row, span)) continue;
      if (cellsCovered(col, row, span).some((key) => occupiedCells.has(key))) continue;
      out.push(gridAttachPoint(grid, col, row, span));
    }
  }
  return out;
}

/**
 * Validate a declared grid.
 *
 * The plane's drawn size must agree with cols x pitch, for the same reason a
 * component's declared millimetres must agree with its geometry: if the two
 * disagree, the markers a person clicks will not be where the webbing actually
 * is, and nothing about the render will look wrong.
 */
export function validateGrid(grid, planeSize, tolerance = 0.002) {
  if (!(grid.cols > 0) || !(grid.rows > 0)) {
    throw new GridError(
      `Grid "${grid.id}" declares ${grid.cols} columns and ${grid.rows} rows. Both must be at least 1.`,
      { code: 'GRID_EMPTY', detail: { grid: grid.id, cols: grid.cols, rows: grid.rows } },
    );
  }

  if (!(grid.pitchX > 0) || !(grid.pitchY > 0)) {
    throw new GridError(
      `Grid "${grid.id}" is missing a cell pitch. Declare pitchXMm and pitchYMm.`,
      { code: 'GRID_NO_PITCH', detail: { grid: grid.id } },
    );
  }

  if (!planeSize) return;

  const expectedW = grid.cols * grid.pitchX;
  const expectedH = grid.rows * grid.pitchY;

  if (Math.abs(planeSize[0] - expectedW) > tolerance
      || Math.abs(planeSize[1] - expectedH) > tolerance) {
    throw new GridError(
      `Grid "${grid.id}" is drawn ${(planeSize[0] * 1000).toFixed(0)}x${(planeSize[1] * 1000).toFixed(0)}mm `
      + `but declares ${grid.cols}x${grid.rows} cells at ${(grid.pitchX * 1000).toFixed(1)}x${(grid.pitchY * 1000).toFixed(1)}mm, `
      + `which is ${(expectedW * 1000).toFixed(0)}x${(expectedH * 1000).toFixed(0)}mm. `
      + 'The plane and the declaration must agree or the markers will not sit on the webbing.',
      { code: 'GRID_SIZE_MISMATCH', detail: { grid: grid.id, planeSize, expectedW, expectedH } },
    );
  }
}

/**
 * PALS / MOLLE, for reference.
 *
 * The published spec is 1-inch webbing rows spaced 1 inch apart, stitched at
 * 1.5-inch intervals horizontally. So a cell is 38.1 x 25.4mm. Pouches are sold
 * by how many columns and rows they cover, which is exactly the span model.
 */
export const PALS = { pitchXMm: 38.1, pitchYMm: 25.4 };
