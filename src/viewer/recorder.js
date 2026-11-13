// A recording of what somebody did while configuring, for reproducing a fault.
//
// Matt, 13 Nov 2026: "is there a way we can temporarily record the actions i
// do when configuring a product as i was able to kind of break the build ...
// the product was floating or even below the ground level". A description of a
// fault from memory is a guess; a recording is the fault.
//
// OPT-IN and per instance: `?record` in the page's address turns it on for that
// page, nothing is sent anywhere, and the recording lives in memory until the
// person copies or downloads it. Every entry carries the choices as the same
// base64url `?o=` the URL uses, so any single step can be opened on its own and
// `tools/audit/replay.mjs` can rebuild the whole sequence and say where it broke.

export const RECORDING_FORMAT = 'confgr-recording';
export const RECORDING_VERSION = 1;

/** Is recording asked for on this page? `?record`, `?record=1` or `?record=true`. */
export function recordingRequested(href) {
  try {
    const v = new URL(href).searchParams.get('record');
    return v !== null && v !== '0' && v !== 'false';
  } catch {
    return false;
  }
}

const count = (obj, key) => (obj?.[key] || 0);
const join = (list) => (list.length ? list.join(', ') : 'nothing');

/**
 * What changed between two sets of choices, in words.
 *
 * Read off the choices rather than told by each control, so nothing that
 * changes the product can be left out of the recording by a control that
 * forgot to say so.
 */
export function describeChange(prev, next) {
  if (!prev) return ['started'];
  const out = [];
  const was = (k) => prev?.[k];
  for (const [key, words] of [
    ['variantId', 'depth'], ['sizeId', 'width of every bay'], ['frameId', 'height of every ladder'],
    ['bays', 'bays'], ['mounting', 'mounting'], ['footHeightMm', 'foot height'],
  ]) {
    if (was(key) !== next?.[key]) out.push(`${words}: ${was(key) ?? '-'} → ${next?.[key] ?? '-'}`);
  }
  const kinds = new Set([...Object.keys(prev?.adds || {}), ...Object.keys(next?.adds || {})]);
  for (const k of kinds) {
    if (count(prev.adds, k) !== count(next.adds, k)) out.push(`${k}: ${count(prev.adds, k)} → ${count(next.adds, k)}`);
  }
  for (const [key, words] of [['widths', 'bay width'], ['frames', 'ladder type']]) {
    const slots = new Set([...Object.keys(prev?.[key] || {}), ...Object.keys(next?.[key] || {})]);
    for (const s of slots) {
      const a = prev?.[key]?.[s];
      const b = next?.[key]?.[s];
      if (a !== b) out.push(`${words} ${s}: ${a ?? 'default'} → ${b ?? 'default'}`);
    }
  }
  const at = new Set([...Object.keys(prev?.at || {}), ...Object.keys(next?.at || {})]);
  for (const slot of at) {
    const a = prev?.at?.[slot];
    const b = next?.at?.[slot];
    const where = (r) => (r ? `${r.slot || r.instanceId}·${String(r.snapId).replace(/^md-snap\.[^.]+\./, '')}${r.mountSnapId ? `/${String(r.mountSnapId).replace(/^md-snap\.[^.]+\./, '')}` : ''}` : 'auto');
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${slot} placed: ${where(a)} → ${where(b)}`);
  }
  return out.length ? out : ['no change to the product'];
}

/**
 * What the viewer drew for one step - attached to the entry once it is drawn.
 * Base heights are read from the transforms: every part's origin is its base
 * centre, and parts here are only ever yawed, so the lowest origin is the
 * lowest base. The floor is the anchor ladder's base.
 */
export function drawnFacts(info) {
  const r = info?.resolved;
  if (!r) return null;
  const scene = r.scene || { assembly: r.assembly, transforms: r.transforms };
  const ys = [];
  for (const i of scene.assembly?.instances || []) {
    const t = scene.transforms?.get?.(i.instanceId);
    if (t) ys.push({ id: i.componentId, y: Math.round(t.translation[1] * 1000) });
  }
  // The REAL floor: on feet, the bottom of the foot - the product's origin is the
  // anchor ladder's base and the feet stand below it.
  const anchor = r.assembly?.instances?.[0];
  const foot = r.mounting === 'feet' ? (r.footHeightMm || 100) : 0;
  const floor = (anchor ? Math.round((r.transforms?.get?.(anchor.instanceId)?.translation?.[1] || 0) * 1000) : 0) - foot;
  const lowest = ys.reduce((m, p) => (m && m.y <= p.y ? m : p), null);
  return {
    c: r.id || null,
    parts: r.assembly?.instances?.length || 0,
    size: info.size || null,
    mounting: r.mounting || null,
    floorMm: floor,
    lowestBase: lowest ? { componentId: lowest.id, mm: lowest.y - floor } : null,
    issues: r.judgement && !r.judgement.ok ? [...new Set(r.judgement.reasons.map((x) => x.says))] : [],
  };
}

/** The file a person sends: everything needed to replay, nothing about them. */
export function recordingFile(entries, { page = null, userAgent = null, startedAt = null } = {}) {
  return {
    format: RECORDING_FORMAT,
    version: RECORDING_VERSION,
    startedAt,
    savedAt: new Date().toISOString(),
    // The page without its query: the steps carry their own choices, and a
    // stale ?o= in the address would only confuse whoever reads this.
    page: page ? page.split('?')[0] : null,
    userAgent,
    steps: entries,
  };
}
