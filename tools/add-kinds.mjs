// Give every add a KIND, once, in the schema.
//
//   node tools/add-kinds.mjs youk/guided.json [--check]
//
// WHY. Matt wants each bay to have its own spacing, and "when we add a shelf
// (timber or metal) its automatically the correct length". Today `choices.adds`
// is keyed by COMPONENT ID, and the component id encodes the width:
// 008563 is the 900 shelf and 008562 is the 600. That is fine while one width
// applies to the whole run and impossible the moment two bays differ - "four
// extra metal shelves" stops naming a part.
//
// So an add is chosen by KIND - "a metal shelf" - and the part number is
// resolved from the bay it ends up in. The kinds are written into the schema
// rather than guessed at runtime from labels, because the labels already differ
// between variants: the same kind is "Extra metal shelf" on the 320 deep range
// and "Extra timber shelf" on the 200, where the shelf really is timber.
//
// FOUR KINDS CHANGE PART NUMBER WITH THE WIDTH and three do not, which is the
// distinction this makes explicit:
//
//   metal-shelf      008561 / 008562 / 008563 / 008564   450 / 600 / 900 / 1200
//   timber-shelf     pws-timber-shelf-{450,600,900,1200}
//   clothes-rail     008530 / 008531 / 008532            600 / 900 / 1200 only
//   hook-strip-full  008540 / 008541                     900 / 1200 only
//
//   side-rack, hook-strip, youboxx   one part, whatever the bay is - they hang
//                                    off a ladder rather than spanning a bay

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The kind of an add, from its component id.
 *
 * Ordered most specific first: `pws-timber-shelf-450mm-for-ladder-depth-200mm`
 * matches both the timber rule and nothing else, but a looser rule written
 * earlier would have claimed the hook strips for the shelves.
 */
export const KIND_RULES = [
  [/^pws-timber-shelf-/, 'timber-shelf'],
  [/^00856[1-4]-shelf-/, 'metal-shelf'],
  [/^00853[0-2]-clothes-rail-/, 'clothes-rail'],
  [/^00854[01]-hook-strip-for-ladder-width-/, 'hook-strip-full'],
  [/^0085(36|37)-hook-strip-for-ladder-depth-/, 'hook-strip'],
  [/^0085(42|43)-rack-for-ladder-depth-/, 'side-rack'],
  [/^008547-youboxx/, 'youboxx'],
];

export function kindOf(componentId) {
  for (const [pattern, kind] of KIND_RULES) {
    if (pattern.test(componentId)) return kind;
  }
  return null;
}

/** Which kinds take a different part number in a different width. */
export const WIDTH_DEPENDENT = new Set([
  'metal-shelf', 'timber-shelf', 'clothes-rail', 'hook-strip-full',
]);

export function addKinds(schema) {
  const unknown = [];
  const seen = new Map();

  for (const variant of schema.variants) {
    for (const size of variant.sizes) {
      // The span is a kind too. It is the shelf that joins two ladders, and it
      // has to resolve per bay for exactly the same reason the extras do.
      const spanKind = kindOf(size.span.componentId);
      if (spanKind) size.span.kind = spanKind;
      else unknown.push(size.span.componentId);

      for (const add of size.adds || []) {
        const kind = kindOf(add.componentId);
        if (!kind) { unknown.push(add.componentId); continue; }
        add.kind = kind;

        // A kind must mean ONE thing across the schema. If two sizes disagree
        // about what "clothes-rail" is beyond the part number - a different
        // maximum, one that spans and one that does not - then resolving by
        // kind would silently change the rules with the width.
        const shape = `${add.max ?? ''}|${add.spans ? 'spans' : ''}|${add.perBay ? 'perBay' : ''}`;
        const before = seen.get(kind);
        if (before && before.shape !== shape) {
          throw new Error(
            `"${kind}" is described two ways: ${before.where} says ${before.shape || '(defaults)'}`
            + ` and ${variant.id}/${size.id} says ${shape || '(defaults)'}.`,
          );
        }
        if (!before) seen.set(kind, { shape, where: `${variant.id}/${size.id}`, label: add.label });
      }
    }
  }

  if (unknown.length) {
    throw new Error(`No kind rule matches: ${[...new Set(unknown)].join(', ')}`);
  }
  return { schema, kinds: seen };
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry && import.meta.url === entry) {
  const path = process.argv[2] || 'youk/guided.json';
  const check = process.argv.includes('--check');
  const schema = JSON.parse(readFileSync(path, 'utf8'));
  const { kinds } = addKinds(schema);

  for (const [kind, info] of kinds) {
    console.log(`  ${kind.padEnd(16)} ${WIDTH_DEPENDENT.has(kind) ? 'per width ' : 'one part  '} ${info.label}`);
  }
  if (!check) {
    writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
    console.log(`\nwrote ${path}`);
  } else {
    console.log('\n--check: nothing written');
  }
}
