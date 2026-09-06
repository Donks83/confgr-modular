// A configuration you can send someone.
//
// The plan calls this a week-one item and it has been outstanding since the
// first session, which is fair but understates why it matters. It is not a
// feature, it is the SEAM: the point where the configurator stops being an
// application somebody is using and becomes a value that other things can
// consume. Everything downstream needs it and none of it can start without it:
//
//   * the AR handoff       /ar?c=<id> resolves the assembly and exports a GLB
//   * the tear-sheet PDF   the same resolve, rendered to paper
//   * a saved project      an id in a file, not a serialised editor
//   * a quote a customer   an id in an email that still opens next year
//     can come back to
//
// The plan is emphatic that retrofitting this is painful, and the reason is
// visible in this file: the id has to encode exactly what the resolver needs
// and nothing about the editor. No camera, no selection, no pending click, no
// panel state. What comes back is a product, not a session.
//
// TWO PROPERTIES ARE WORTH MORE THAN COMPACTNESS.
//
// It is VERSIONED. `v` is in the payload and the decoder refuses a version it
// does not know, rather than reading the fields it recognises and quietly
// dropping the rest. An id that cannot be read is a bad afternoon; an id that
// reads as a DIFFERENT product is a wrong order.
//
// It FAILS LOUDLY. A component that is not in the catalogue is named in the
// error, not skipped. This is the same rule as quote.js's "a missing price is
// not zero": a configuration that has lost a part is not a smaller
// configuration, it is a configuration nobody can build.
//
// WHY JSON AND BASE64 RATHER THAN A TIGHTER FORMAT. A delimiter-separated
// string would be perhaps 40% shorter and would need escaping rules, because
// component ids carry hyphens and snap ids carry dots. Escaping rules are where
// this kind of format goes wrong, and it goes wrong silently on the one part
// whose name has the delimiter in it. The dictionaries below get most of the
// saving anyway - a bay names its ladder once and refers to it three times -
// and a short-code service can sit in front of this later without changing it.
//
// HOW LONG IT ACTUALLY IS, since that is the first question anyone asks: a
// three-part bay on feet comes out at **416 characters**, and almost all of it
// is the ids themselves — `pws-timber-cabinet-900mm-h450mm-for-ladder-depth-320mm`
// is forty-nine of them before anything is encoded. That is a link, not a text
// message, and the answer when a short one is wanted is a short-code service
// rather than a cleverer string.
//
// One saving was considered and REFUSED. A snap could be stored as an index
// into its component's own snap list — the component is already known, so
// "snap 3 of part 0" is unambiguous and tiny. It would also bind every id ever
// issued to the order the snaps happen to sit in the GLB, so re-exporting a
// model with its nodes in a different order would silently change what every
// stored id means. Undetectably, which is the one failure mode this file is
// built to avoid. The ids are long because the ids are long.

import { resolveTransforms, validateAssembly } from './assembly.js';
import { impliedParts, impliedBom, withImplied } from './implied.js';
import { overlaps } from './collision.js';
import { quote } from './quote.js';
import { MOUNTING, FOOT, isMounting } from './ar.js';

/** The format this file writes. Bumped when the payload's shape changes. */
export const CONFIG_VERSION = 1;

export class ConfigurationError extends Error {
  constructor(message, { code, detail } = {}) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * The configuration as a string.
 *
 * @param assembly  the instances and connections
 * @param options   { mounting, footHeightMm }
 */
export function encodeConfiguration(assembly, options = {}) {
  const instances = assembly?.instances || [];
  const connections = assembly?.connections || [];

  // INDEX, not id. The instance ids in a live assembly come from a counter that
  // restarts with the process, so writing them down would make an id that only
  // means anything in the session that produced it. Positions in the list are
  // stable by construction.
  const order = new Map(instances.map((i, n) => [i.instanceId, n]));

  const componentIds = [];
  const componentIndex = new Map();
  const intern = (list, map) => (value) => {
    if (!map.has(value)) { map.set(value, list.length); list.push(value); }
    return map.get(value);
  };
  const componentOf = intern(componentIds, componentIndex);

  const snapIds = [];
  const snapIndex = new Map();
  const snapOf = intern(snapIds, snapIndex);

  const mounting = isMounting(options.mounting) ? options.mounting : MOUNTING.FLOOR;

  const payload = {
    v: CONFIG_VERSION,
    m: mounting,
    // Only when it means something. A foot height carried on a wall-mounted
    // product is a number that would have to be explained every time somebody
    // read the id by hand.
    ...(mounting === MOUNTING.FEET
      ? { f: FOOT.heightsMm.includes(options.footHeightMm)
        ? options.footHeightMm : FOOT.heightsMm[0] }
      : {}),
    c: componentIds,
    s: snapIds,
    i: instances.map((instance) => {
      const out = { c: componentOf(instance.componentId) };
      // Defaults are omitted rather than written as nulls: a connected part is
      // the common case and it should cost four characters, not forty.
      if (instance.position) out.p = instance.position.map(round4);
      if (instance.rotation && !isIdentityQuat(instance.rotation)) {
        out.r = instance.rotation.map(round4);
      }
      if (instance.freeMove) out.f = 1;
      if (instance.selections && Object.keys(instance.selections).length) {
        out.o = { ...instance.selections };
      }
      return out;
    }),
    n: connections.map((c) => [
      order.get(c.fromInstanceId),
      snapOf(c.fromSnapId),
      order.get(c.toInstanceId),
      snapOf(c.toSnapId),
    ]),
  };

  // A connection to a part that is not in the list would decode into something
  // that cannot resolve. Better to refuse to write it.
  for (const [from, , to] of payload.n) {
    if (from == null || to == null) {
      throw new ConfigurationError(
        'This configuration has a joint to a part that is not in it, so it cannot be written down.',
        { code: 'DANGLING_CONNECTION' },
      );
    }
  }

  return toBase64Url(JSON.stringify(payload));
}

/**
 * The configuration back again — instances, connections, and the options that
 * belong to the product rather than to the editor.
 *
 * Instance ids are regenerated as `p0`, `p1`, … rather than reusing whatever
 * the session that wrote the id happened to be counting at. They are indices
 * with a letter in front, so an id decodes to the same assembly every time and
 * two decodes of the same string are comparable.
 */
export function decodeConfiguration(id) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new ConfigurationError('There is no configuration id here.', { code: 'EMPTY' });
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(id.trim()));
  } catch (err) {
    throw new ConfigurationError(
      'This is not a configuration id — it could not be read at all.',
      { code: 'UNREADABLE', detail: { message: err.message } },
    );
  }

  if (payload?.v !== CONFIG_VERSION) {
    throw new ConfigurationError(
      `This configuration was written in format ${payload?.v ?? '?'} and this is `
      + `format ${CONFIG_VERSION}. Refusing to guess: an id that reads as a `
      + 'different product is worse than one that will not read.',
      { code: 'VERSION_MISMATCH', detail: { found: payload?.v, expected: CONFIG_VERSION } },
    );
  }

  const componentIds = payload.c || [];
  const snapIds = payload.s || [];
  const idOf = (n) => `p${n}`;

  const instances = (payload.i || []).map((entry, n) => {
    const componentId = componentIds[entry.c];
    if (componentId == null) {
      throw new ConfigurationError(
        `Part ${n + 1} refers to component ${entry.c}, which this id does not name.`,
        { code: 'COMPONENT_INDEX_MISSING', detail: { index: entry.c } },
      );
    }
    return {
      instanceId: idOf(n),
      componentId,
      selections: entry.o ? { ...entry.o } : {},
      position: entry.p ? [...entry.p] : null,
      rotation: entry.r ? [...entry.r] : (entry.p ? [0, 0, 0, 1] : null),
      freeMove: !!entry.f,
    };
  });

  const connections = (payload.n || []).map(([from, fromSnap, to, toSnap], n) => {
    if (!instances[from] || !instances[to]) {
      throw new ConfigurationError(
        `Joint ${n + 1} refers to a part that is not in this configuration.`,
        { code: 'DANGLING_CONNECTION', detail: { from, to } },
      );
    }
    return {
      fromInstanceId: idOf(from),
      fromSnapId: snapIds[fromSnap],
      toInstanceId: idOf(to),
      toSnapId: snapIds[toSnap],
    };
  });

  return {
    assembly: { instances, connections },
    mounting: isMounting(payload.m) ? payload.m : MOUNTING.FLOOR,
    footHeightMm: FOOT.heightsMm.includes(payload.f) ? payload.f : FOOT.heightsMm[0],
  };
}

/**
 * A short, stable reference for one configuration.
 *
 * NOT the id — you cannot rebuild a product from eight hex characters. This is
 * what goes on a quote header, in a filename, or in a sentence: "the 7f3a91c2
 * one". FNV-1a, because it is four lines and this is a label rather than a
 * security boundary.
 */
export function configurationDigest(id) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * THE HEADLESS RESOLVE. One id, one catalogue, everything the product is.
 *
 * The function the plan has been asking for since week one, and the reason it
 * is worth having is that everything else calls it rather than reimplementing
 * it: AR export, the tear sheet, a server-side price, a saved project reopened
 * next year. There is no editor in here and no three.js — it runs in a test, in
 * Node, and one day in a lambda.
 *
 * `components` is the loaded geometry, `catalogue` the price book. Both are
 * OPTIONAL in the sense that what can be computed is: an id resolves to an
 * assembly with no catalogue at all, and prices simply come back null, which is
 * exactly what quote.js does with a part it cannot price.
 */
export function resolveConfiguration(id, components, { catalogue = null, tierId = null } = {}) {
  const { assembly, mounting, footHeightMm } = decodeConfiguration(id);

  const missing = [...new Set(
    assembly.instances
      .map((i) => i.componentId)
      .filter((componentId) => !components?.get?.(componentId)),
  )];
  if (missing.length) {
    // Named, not dropped. A configuration that has lost a part is not a smaller
    // configuration - it is one nobody can build, and silently resolving the
    // rest would produce a quote that is short by exactly the missing parts.
    throw new ConfigurationError(
      `This configuration needs ${missing.length} part`
      + `${missing.length === 1 ? '' : 's'} that are not in the catalogue: `
      + `${missing.join(', ')}.`,
      { code: 'COMPONENTS_MISSING', detail: { missing } },
    );
  }

  const options = { mounting, footHeightMm };
  const { transforms } = resolveTransforms(assembly, components);
  const implied = impliedParts(assembly, components, options);
  const scene = withImplied(assembly, components, options);
  const sceneTransforms = resolveTransforms(scene, components).transforms;

  return {
    id,
    digest: configurationDigest(id),
    assembly,
    mounting,
    footHeightMm,
    // What is placed, and where. `transforms` is the product; `scene` adds what
    // the configuration implies, which is what a renderer or an exporter wants.
    transforms,
    scene: { assembly: scene, transforms: sceneTransforms },
    validity: validateAssembly(assembly, components, transforms),
    implied,
    overlaps: overlaps(scene, components, sceneTransforms),
    quote: catalogue
      ? quote(assembly, catalogue, {
        tierId,
        implied: impliedBom(assembly, components, options),
        notes: implied.notes,
      })
      : null,
  };
}

/** Round to 0.1 mm in metres — enough for a position, and it keeps ids short. */
const round4 = (v) => Math.round(v * 10000) / 10000;

const isIdentityQuat = (q) => q.length === 4
  && Math.abs(q[0]) < 1e-9 && Math.abs(q[1]) < 1e-9
  && Math.abs(q[2]) < 1e-9 && Math.abs(q[3] - 1) < 1e-9;

/**
 * base64url, by hand, because the built-ins disagree about environments.
 *
 * `Buffer` is Node's and `btoa` is the browser's, and this module has to run in
 * both — vitest, the renderer, and eventually a server. TextEncoder and btoa
 * are in all three, so the conversion goes through bytes explicitly rather than
 * relying on btoa's Latin-1 assumption, which would mangle any option value
 * somebody names in a language with accents.
 */
function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
