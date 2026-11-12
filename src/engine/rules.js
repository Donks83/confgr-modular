// A range's connection rules, as data (docs/design/A2-rule-model.md).
//
// The engine knows contacts, families, ends, floors and sentences. What a
// family must satisfy, what a refusal says and where the rule came from live in
// the range's own rules.json - nothing here is Kesseböhmer's.
//
// FAILS CLOSED, the way `condition` always has: a key, rule, family or
// placeholder this file does not understand stops the load and names itself. A
// rule that is silently ignored is worse than no rule, because the product looks
// checked when it is not.

export const RULES_VERSION = 1;

export class RulesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RulesError';
  }
}

const HELD = ['every-end', 'any-end', 'none'];
const FAMILY_RULES = ['mountingNeeds'];
const PRODUCT_RULES = ['notBelowFloor', 'noPassThrough', 'notTwiceInOnePlace'];
const PREFERENCES = ['lowest', 'highest'];
const PLACEHOLDERS = ['label', 'other', 'mm', 'mounting'];
const MOUNTINGS = ['floor', 'feet', 'wall'];

/**
 * What every range gets with no rules file at all.
 *
 * These three are true of any physical product, so they are not YouK's to opt
 * into: nothing under the floor when it stands on one, nothing through anything,
 * no two parts in one space. A range's rules.json may reword them; it cannot
 * switch them off by omission.
 */
export const DEFAULT_PRODUCT_RULES = Object.freeze([
  { rule: 'notBelowFloor', when: 'grounded', toleranceMm: 1, says: 'That would put the {label} {mm} mm below the floor.' },
  { rule: 'noPassThrough', says: 'The {label} would pass through the {other}.' },
  { rule: 'notTwiceInOnePlace', says: 'The {label} would take the space the {other} is already in.' },
]);

const isComment = (key) => key.startsWith('_');
const where = (path) => (path ? ` (at ${path})` : '');

function onlyKeys(obj, allowed, path) {
  for (const key of Object.keys(obj)) {
    if (isComment(key)) continue;
    if (!allowed.includes(key)) {
      throw new RulesError(`Unknown key "${key}"${where(path)}. Allowed: ${allowed.join(', ')}.`);
    }
  }
}

function checkSays(text, path) {
  if (text === undefined) return;
  if (typeof text !== 'string' || !text.trim()) throw new RulesError(`"says" must be a sentence${where(path)}.`);
  for (const [, name] of text.matchAll(/\{([^}]*)\}/g)) {
    if (!PLACEHOLDERS.includes(name)) {
      throw new RulesError(`Unknown placeholder {${name}} in "${text}"${where(path)}. Allowed: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`);
    }
  }
}

/**
 * Read and check a rules file.
 *
 * @param {object} json      the parsed rules.json
 * @param {object} [options]
 * @param {object} [options.catalogue]  catalogue.json; its items' `family` say
 *   which part is in which family. Without it, family rules apply to nothing and
 *   only the product rules hold.
 * @returns a frozen rules object: { range, families, product, preferences, familyOf(componentId) }
 */
export function parseRules(json, { catalogue = null } = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new RulesError('A rules file must be a JSON object.');
  onlyKeys(json, ['range', 'version', 'families', 'product', 'preferences'], '');
  if (json.version !== RULES_VERSION) {
    throw new RulesError(`This rules file is version ${json.version}; this engine reads version ${RULES_VERSION}.`);
  }

  const known = new Set(Object.values(catalogue?.items || {}).map((i) => i.family).filter(Boolean));
  const families = {};
  for (const [name, fam] of Object.entries(json.families || {})) {
    if (isComment(name)) continue;
    const path = `families.${name}`;
    if (catalogue && !known.has(name)) {
      throw new RulesError(`Family "${name}" has no parts in the catalogue${where(path)}. Families there: ${[...known].sort().join(', ')}.`);
    }
    onlyKeys(fam, ['held', 'says', 'source', 'hollow', 'rules'], path);
    if (fam.held !== undefined && !HELD.includes(fam.held)) {
      throw new RulesError(`"held" must be one of ${HELD.join(', ')}${where(path)}; got "${fam.held}".`);
    }
    if (fam.held && fam.held !== 'none' && !fam.says) throw new RulesError(`A family that must be held needs a "says" sentence${where(path)}.`);
    checkSays(fam.says, path);
    const rules = (fam.rules || []).map((r, k) => {
      const rp = `${path}.rules[${k}]`;
      if (!FAMILY_RULES.includes(r.rule)) throw new RulesError(`Unknown rule "${r.rule}"${where(rp)}. Known: ${FAMILY_RULES.join(', ')}.`);
      onlyKeys(r, ['rule', 'mounting', 'socketLabel', 'says', 'source'], rp);
      if (!MOUNTINGS.includes(r.mounting)) throw new RulesError(`"mounting" must be one of ${MOUNTINGS.join(', ')}${where(rp)}.`);
      if (!r.socketLabel) throw new RulesError(`mountingNeeds needs a "socketLabel"${where(rp)}.`);
      if (!r.says) throw new RulesError(`Every rule needs a "says" sentence${where(rp)}.`);
      checkSays(r.says, rp);
      return Object.freeze({ ...r });
    });
    families[name] = Object.freeze({ held: fam.held || 'none', says: fam.says, source: fam.source, hollow: !!fam.hollow, rules: Object.freeze(rules) });
  }

  const product = (json.product || DEFAULT_PRODUCT_RULES).map((r, k) => {
    const rp = `product[${k}]`;
    if (!PRODUCT_RULES.includes(r.rule)) throw new RulesError(`Unknown rule "${r.rule}"${where(rp)}. Known: ${PRODUCT_RULES.join(', ')}.`);
    onlyKeys(r, ['rule', 'when', 'toleranceMm', 'says', 'source'], rp);
    if (r.when !== undefined && r.when !== 'grounded') throw new RulesError(`"when" can only be "grounded"${where(rp)}.`);
    checkSays(r.says, rp);
    return Object.freeze({ ...r });
  });
  // Omission does not switch a physical rule off; a range may only reword one.
  for (const d of DEFAULT_PRODUCT_RULES) if (!product.some((r) => r.rule === d.rule)) product.push(d);

  const prefs = json.preferences || {};
  onlyKeys(prefs, ['default', 'byKind'], 'preferences');
  for (const [k, v] of [['default', prefs.default ?? 'lowest'], ...Object.entries(prefs.byKind || {}).filter(([key]) => !isComment(key))]) {
    if (!PREFERENCES.includes(v)) throw new RulesError(`Preference for "${k}" must be one of ${PREFERENCES.join(', ')}; got "${v}".`);
  }

  const familyByPart = new Map(Object.entries(catalogue?.items || {}).map(([id, i]) => [id, i.family]));
  // The words a refusal uses for a part: the catalogue's own description, which is
  // what the bill of materials calls it too, so the two never disagree.
  const labelByPart = new Map(Object.entries(catalogue?.items || {}).map(([id, i]) => [id, i.description]));
  return Object.freeze({
    labelOf: (componentId) => labelByPart.get(componentId) || componentId,
    range: json.range || null,
    families: Object.freeze(families),
    product: Object.freeze(product),
    preferences: Object.freeze({
      default: prefs.default || 'lowest',
      byKind: Object.freeze(Object.fromEntries(Object.entries(prefs.byKind || {}).filter(([k]) => !isComment(k)))),
    }),
    familyOf: (componentId) => familyByPart.get(componentId) || null,
  });
}

/** The rules every range gets when it brings none: the physical ones only. */
export const DEFAULT_RULES = parseRules({ version: RULES_VERSION });

/** Fill a sentence's {placeholders}. Unknown ones were refused at load. */
export function sentence(text, values) {
  return text.replace(/\{([^}]*)\}/g, (_, k) => (values[k] ?? `{${k}}`));
}
