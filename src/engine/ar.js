// Can this configuration go to AR, and where can somebody put it?
//
// No AR is built yet. This module exists because the phone AR viewers impose
// hard limits on the whole MODEL, and the plan's AR-safe rule 9 records a
// triangle budget PER COMPONENT - which is the wrong unit. A customer does not
// send a component to AR, they send an assembly, and an assembly of parts that
// are each comfortably inside the budget is not necessarily inside it itself.
// Three frames, four shelves and two YouboXx sets are individually fine and
// together are not.
//
// So this answers the question at the unit that matters, today, before there is
// an AR button to be surprised by.
//
// THE PUBLISHED LIMITS, and they are Google's, not ours. Android hands the
// model to Scene Viewer, which states:
//
//     file format   glTF 2.0 / glb
//     file size     10 MB recommended, 15 MB hard limit
//     triangles     30,000-50,000 ideal, 100,000 recommended maximum
//     materials     10 maximum recommended
//     textures      2048 x 2048 maximum
//
//   https://developers.google.com/ar/develop/scene-viewer
//
// Apple's AR Quick Look publishes no equivalent triangle number, but it will
// not accept a compressed USDZ, so the iOS file is always the larger of the
// two. Sizing to Scene Viewer's limits keeps both honest.
//
// WHERE IT CAN BE PLACED, which is the other half and is a product decision:
//
//   * AR Quick Look has supported VERTICAL surfaces since iOS 13 - "this year,
//     we've added support for vertical surfaces like walls" (WWDC 2019, session
//     612). Dragging a model from a table onto a wall is a supported gesture.
//   * Scene Viewer needs it asked for: `enable_vertical_placement`, an optional
//     intent parameter that DEFAULTS TO FALSE. Without it a wall-mounted
//     product can only be put on the floor. There are also open reports of
//     wall placement being unreliable through Scene Viewer, so this is the one
//     thing to test on a real Android handset before promising it.
//
// Which is why `mounting` is not cosmetic. It is the flag that decides whether
// the AR handoff asks for vertical placement at all.

/** Scene Viewer's published limits. Named so a warning can cite one. */
export const AR_LIMITS = {
  trianglesIdeal: 50000,
  trianglesMax: 100000,
  bytesRecommended: 10 * 1024 * 1024,
  bytesMax: 15 * 1024 * 1024,
  materialsRecommended: 10,
  textureMax: 2048,
};

/**
 * How a product meets the world.
 *
 * Matt's call, 4 Sep 2026, and it is the right simplification: two options, not
 * a height. Every YouK frame is wall-mounted in reality, and the height it
 * hangs at is chosen when the customer places it in AR - so a mounting height
 * in the configurator would be a number that nothing downstream reads.
 */
export const MOUNTING = {
  FLOOR: 'floor',
  WALL: 'wall',
};

export function isMounting(value) {
  return value === MOUNTING.FLOOR || value === MOUNTING.WALL;
}

/**
 * Which surfaces the AR viewer should offer for this product.
 *
 * A floor-standing product on a wall is nonsense, and a wall-mounted product
 * on the floor is the mistake Scene Viewer makes by default.
 */
export function placementFor(mounting) {
  const wall = mounting === MOUNTING.WALL;
  return {
    horizontal: !wall,
    vertical: wall,
    // The Scene Viewer intent parameter, by name, so the Phase 2 handoff has
    // one thing to read rather than a boolean to reinterpret.
    sceneViewerEnableVerticalPlacement: wall,
  };
}

/** Total triangles across every placed part. */
export function assemblyTriangles(assembly, components) {
  let total = 0;
  for (const instance of assembly?.instances || []) {
    const component = components?.get?.(instance.componentId);
    total += component?.triangleCount || 0;
  }
  return total;
}

/**
 * Is this configuration inside the AR budget, and if not, what is over?
 *
 * Reports rather than refuses. A configuration that is too heavy for a phone is
 * still a configuration somebody may want to price and order - it just cannot
 * be viewed in a room, and they should be told that rather than handed an AR
 * button that fails on a mid-range Android.
 */
export function arReadiness(assembly, components, { mounting = MOUNTING.FLOOR, bytes = null } = {}) {
  const triangles = assemblyTriangles(assembly, components);
  const parts = (assembly?.instances || []).length;
  const warnings = [];

  if (parts === 0) {
    return {
      parts: 0, triangles: 0, bytes, ready: false, placement: placementFor(mounting),
      warnings: [{ code: 'EMPTY', message: 'Nothing configured yet.' }],
    };
  }

  if (triangles > AR_LIMITS.trianglesMax) {
    warnings.push({
      code: 'TRIANGLES_OVER_MAX',
      message: `${triangles.toLocaleString()} triangles is past Scene Viewer's `
        + `${AR_LIMITS.trianglesMax.toLocaleString()} recommended maximum. `
        + 'Decimate the heaviest parts or offer fewer of them.',
    });
  } else if (triangles > AR_LIMITS.trianglesIdeal) {
    warnings.push({
      code: 'TRIANGLES_OVER_IDEAL',
      message: `${triangles.toLocaleString()} triangles is above the `
        + `${AR_LIMITS.trianglesIdeal.toLocaleString()} Google calls ideal. `
        + 'Fine on a recent phone, worth watching on a mid-range one.',
    });
  }

  if (bytes != null) {
    if (bytes > AR_LIMITS.bytesMax) {
      warnings.push({
        code: 'BYTES_OVER_MAX',
        message: `${(bytes / 1048576).toFixed(1)} MB is past Scene Viewer's 15 MB hard limit.`,
      });
    } else if (bytes > AR_LIMITS.bytesRecommended) {
      warnings.push({
        code: 'BYTES_OVER_RECOMMENDED',
        message: `${(bytes / 1048576).toFixed(1)} MB is over the 10 MB recommendation.`,
      });
    }
  }

  if (mounting === MOUNTING.WALL) {
    // Not a fault - a note, because it is the one platform behaviour that will
    // bite silently. Scene Viewer defaults to floors, so a wall product placed
    // on the floor looks like a bug in our model rather than a missing flag.
    warnings.push({
      code: 'VERTICAL_PLACEMENT_REQUIRED',
      message: 'Wall-mounted: the Android handoff must pass '
        + 'enable_vertical_placement, and wall placement needs testing on a '
        + 'real handset. iOS has supported walls since iOS 13.',
    });
  }

  const blocking = warnings.filter(
    (w) => w.code === 'TRIANGLES_OVER_MAX' || w.code === 'BYTES_OVER_MAX',
  );

  return {
    parts,
    triangles,
    bytes,
    placement: placementFor(mounting),
    ready: blocking.length === 0,
    warnings,
  };
}
