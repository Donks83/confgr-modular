// What a bundle contains, and how the runtime finds out.
//
// An exported bundle is a folder somebody can put on any web server, or open
// with the little .bat next to it. It has no Electron, no IPC and no build
// step — so the one thing the runtime cannot work out for itself is which
// files are its parts. `manifest.json` is that answer, and this file is the
// only place its shape is written down.
//
// WHY A MANIFEST RATHER THAN A DIRECTORY LISTING. A static host does not
// reliably offer one, and the ones that do differ. More usefully, an explicit
// list means the exporter can ship ONLY the parts a configuration references
// — a bay needs four models out of eighty, which is the difference between a
// 400 kB deliverable and a 20 MB one.
//
// This module is deliberately free of three.js and of React: `readManifest`
// and `partsNeededFor` both run in Node, which is what lets the exporter and
// the runtime agree about the contents of a folder without one of them
// guessing.

import { decodeConfiguration } from '../engine/configuration.js';
import { impliedComponentIds } from '../engine/implied.js';
import { MOUNTING } from '../engine/ar.js';

export const MANIFEST_NAME = 'manifest.json';
export const MANIFEST_VERSION = 1;
export const MODELS_DIR = 'models';

export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
  }
}

/**
 * Every component id a configuration needs in order to be drawn.
 *
 * The chosen parts plus the ones the configuration IMPLIES — a bay on feet
 * cannot be resolved without the foot, even though nobody picked it and it
 * appears nowhere in the id. Leaving it out produces a bundle that throws
 * COMPONENTS_MISSING on a part the customer never chose, which would be a
 * baffling thing to be told.
 *
 * Sorted, so two exports of the same configuration produce byte-identical
 * manifests. A diff that is noise is a diff nobody reads.
 */
export function partsNeededFor(configurationId) {
  const { assembly, mounting } = decodeConfiguration(configurationId);
  const ids = new Set(assembly.instances.map((i) => i.componentId));

  // Gated on the MOUNTING, matching `impliedParts`' own rule (implied.js:107).
  // `impliedComponentIds()` is the list of parts the engine may add at all —
  // it is what the palette filters on — not the list a given configuration
  // actually implies. Treating the two as the same thing would put the foot in
  // every bundle, including ones for a product standing on the floor, and would
  // make an export fail outright wherever the foot's model is not present.
  if (mounting === MOUNTING.FEET) {
    for (const id of impliedComponentIds()) ids.add(id);
  }

  return [...ids].sort();
}

/**
 * The manifest for a bundle.
 *
 * `catalogue` is optional and its absence is meaningful rather than an error:
 * a bundle exported before the prices arrive shows the bill of materials with
 * no total, which is what the quote module already does everywhere else.
 */
export function buildManifest({
  configuration, models, catalogue = null, title = null, generated = null,
}) {
  if (!configuration) throw new ManifestError('A bundle needs a configuration id.');
  if (!models?.length) throw new ManifestError('A bundle needs at least one model.');

  return {
    version: MANIFEST_VERSION,
    // Written for a person opening the folder in six months, not for a parser.
    title: title || 'confgr product',
    generated: generated || new Date().toISOString(),
    configuration,
    catalogue,
    models: [...models].sort(),
  };
}

/**
 * Read a manifest, and refuse one this runtime does not understand.
 *
 * Same discipline as the configuration id (§5.18): a version it does not know
 * is refused by NAME rather than half-read. A bundle is a file somebody may
 * open years later, and the honest failure is "this needs a newer viewer",
 * not a product with pieces missing.
 */
export function parseManifest(json) {
  if (!json || typeof json !== 'object') {
    throw new ManifestError('This folder has no readable manifest.json.');
  }
  if (json.version !== MANIFEST_VERSION) {
    throw new ManifestError(
      `This bundle was written for manifest version ${json.version}, `
      + `and this viewer reads version ${MANIFEST_VERSION}.`,
    );
  }
  if (!json.configuration) {
    throw new ManifestError('The manifest names no configuration to show.');
  }
  if (!Array.isArray(json.models) || !json.models.length) {
    throw new ManifestError('The manifest lists no models.');
  }
  return json;
}

/** Where a model lives, relative to the folder's index.html. */
export const modelUrl = (base, file) => `${base.replace(/\/$/, '')}/${MODELS_DIR}/${file}`;
