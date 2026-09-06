// Turning a configuration into a bill of materials, and a bill of materials
// into a quote.
//
// This is the first module in the project that produces a NUMBER SOMEBODY MIGHT
// SEND A CUSTOMER, so it is written around one rule:
//
//   A MISSING PRICE IS NOT ZERO.
//
// Every other rule here follows from it. An unpriced line reports null and is
// counted in `unpriced`, never folded into a total as nothing. A total is
// marked `complete: false` while any line is unpriced, so a caller cannot show
// a subtotal that quietly excludes half the product. There is no default price,
// no fallback to cost, no "0 for now" - a quote that under-reports is worse
// than one that admits it cannot price the job, because the second gets fixed
// and the first gets sent.
//
// Money is held in whole pence internally. 0.1 + 0.2 is not 0.3 in binary
// floating point, and a line total that is a hundredth out is a line total that
// somebody has to explain.

/** Pence from a price in currency units, or null. */
function toPence(value) {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Currency units from pence, to 2dp, or null. */
function fromPence(pence) {
  return pence == null ? null : Math.round(pence) / 100;
}

/**
 * What the configuration is made of. Pure counting - no prices, no catalogue.
 *
 * Separate from pricing on purpose: the parts list is worth having on its own
 * (a packing list, an availability check, a triangle budget) and it is right
 * even when every price is missing.
 */
export function billOfMaterials(assembly, implied = []) {
  const counts = new Map();
  for (const instance of assembly?.instances || []) {
    counts.set(instance.componentId, (counts.get(instance.componentId) || 0) + 1);
  }
  // A chosen row carries no `implied` field at all, rather than `implied:
  // false`. The absence IS the default, every caller that only wanted
  // componentId and qty still gets exactly that, and the two tests that pin
  // this shape went on passing - which is the signal that adding derived parts
  // changed nothing about the ones somebody picked.
  const chosen = [...counts.entries()]
    .map(([componentId, qty]) => ({ componentId, qty }))
    .sort((a, b) => a.componentId.localeCompare(b.componentId));

  // Parts nobody chose, from implied.js. APPENDED rather than merged into the
  // counts, because "2 feet, because you chose feet" and "2 feet, because you
  // clicked twice" are different lines on a quote even when they name the same
  // part - and nothing in this range is both at once.
  const derived = (implied || [])
    .map((row) => ({
      componentId: row.componentId,
      qty: row.qty,
      implied: true,
      because: row.because || null,
    }))
    .sort((a, b) => a.componentId.localeCompare(b.componentId));

  return [...chosen, ...derived];
}

/**
 * The unit price for one part at one tier, and where it came from.
 *
 * Explicit beats derived: a real price list is loaded verbatim into priceEach
 * and must win over any markup, because the markup is a stand-in for the price
 * list and stops being an authority the moment the real number arrives.
 */
export function unitPrice(item, tier) {
  if (!item) return { pence: null, source: 'no-catalogue-entry' };

  const explicit = toPence(item.priceEach?.[tier?.id]);
  if (explicit != null) return { pence: explicit, source: 'price-list' };

  const cost = toPence(item.costEach);
  const markup = tier?.markupOnCost;
  if (cost != null && typeof markup === 'number' && Number.isFinite(markup)) {
    // Round the unit price before multiplying by quantity, which is what an
    // invoice does: eight lines of a rounded unit price, not a rounded total.
    return { pence: Math.round(cost * markup), source: 'cost-x-markup' };
  }

  if (cost != null) return { pence: null, source: 'no-markup-for-tier' };
  return { pence: null, source: 'no-price-on-file' };
}

/**
 * Price a configuration.
 *
 * Returns lines in bill-of-materials order plus totals. `complete` is the field
 * to check before showing anyone a number: it is false whenever a line could
 * not be priced, and the totals then describe only the part of the product
 * that could.
 */
export function quote(assembly, catalogue, { tierId, implied = [], notes = [] } = {}) {
  const tiers = catalogue?.tiers || [];
  const tier = tiers.find((t) => t.id === tierId) || tiers[0] || null;
  const items = catalogue?.items || {};
  const bom = billOfMaterials(assembly, implied);

  let netPence = 0;
  let costPence = 0;
  let costComplete = true;

  const lines = bom.map(({ componentId, qty, implied: derived, because }) => {
    const item = items[componentId];
    const { pence, source } = unitPrice(item, tier);
    const linePence = pence == null ? null : pence * qty;
    if (linePence != null) netPence += linePence;

    const unitCost = toPence(item?.costEach);
    if (unitCost == null) costComplete = false; else costPence += unitCost * qty;

    return {
      componentId,
      article: item?.article ?? null,
      description: item?.description ?? componentId,
      qty,
      unitPrice: fromPence(pence),
      lineTotal: fromPence(linePence),
      unitCost: fromPence(unitCost),
      priceSource: source,
      // Included rather than chosen — a foot that follows from the mounting
      // option. It is priced exactly like everything else; what differs is what
      // the customer is told about why it is on the list.
      implied: !!derived,
      because: because || null,
    };
  });

  const unpriced = lines.filter((l) => l.lineTotal == null);
  const pricedCount = lines.length - unpriced.length;
  const complete = unpriced.length === 0 && lines.length > 0;

  // When NOTHING could be priced there is no total at all - not 0.00. Found by
  // running it: a real seven-part bill of materials with no price list printed
  // "Net (PARTIAL): GBP 0.00", which is the exact failure this module exists to
  // prevent, wearing a label. A zero is a price; the absence of any price is
  // not, however carefully the heading is worded.
  const anyPriced = pricedCount > 0;

  const vatRate = catalogue?.vatRatePercent;
  const hasVat = anyPriced && typeof vatRate === 'number' && Number.isFinite(vatRate);
  const vatPence = hasVat ? Math.round(netPence * (vatRate / 100)) : null;

  // Margin only when BOTH sides are fully known. A margin computed from a
  // partial cost is a number that looks like a fact and is not one.
  const marginPence = complete && costComplete ? netPence - costPence : null;

  return {
    currency: catalogue?.currency || null,
    priceList: catalogue?.priceList || null,
    tier: tier ? { id: tier.id, name: tier.name || tier.id } : null,
    lines,
    partCount: lines.reduce((n, l) => n + l.qty, 0),
    lineCount: lines.length,

    // Quantities with no part number on file — plugs, screws, packers. Carried
    // through verbatim from implied.js and NEVER folded into a line, because a
    // line with no price is the thing this module exists to refuse. They belong
    // on an installation list, not on an invoice.
    notes: [...notes],

    // Totals describe the priced lines only, and `complete` says whether that
    // is all of them.
    complete,
    unpriced: unpriced.map((l) => ({
      componentId: l.componentId,
      description: l.description,
      qty: l.qty,
      why: l.priceSource,
    })),

    net: anyPriced ? fromPence(netPence) : null,
    pricedLineCount: pricedCount,
    vatRatePercent: hasVat ? vatRate : null,
    vat: fromPence(vatPence),
    gross: hasVat ? fromPence(netPence + vatPence) : null,

    cost: costComplete && lines.length > 0 ? fromPence(costPence) : null,
    margin: fromPence(marginPence),
    marginPercent: marginPence != null && netPence > 0
      ? Math.round((marginPence / netPence) * 1000) / 10
      : null,
  };
}

/**
 * The quote as plain text, for a terminal, a log or a verification harness.
 *
 * Deliberately blunt about what it does not know: unpriced lines print a dash
 * and are listed again underneath, and the total is labelled as partial. If
 * this reads awkwardly when prices are missing, that is the point.
 */
export function formatQuote(q) {
  const money = (v) => (v == null ? '—' : v.toFixed(2));
  const out = [];
  const cur = q.currency || '';

  out.push(`Bill of materials — ${q.partCount} parts, ${q.lineCount} lines`
    + (q.tier ? `, priced at ${q.tier.name}` : ', no tier'));
  if (q.priceList?.ref) out.push(`Price list: ${q.priceList.ref}`);

  const w = Math.max(...q.lines.map((l) => l.description.length), 11);
  out.push(`${'Art.'.padEnd(8)}${'Description'.padEnd(w)}  Qty      Each     Total`);
  let saidIncluded = false;
  for (const l of q.lines) {
    // Included lines go under a heading of their own rather than a marker on
    // each row. A customer reading a quote should be able to see at a glance
    // which part of it they chose and which part follows from it.
    if (l.implied && !saidIncluded) {
      saidIncluded = true;
      out.push('');
      out.push('Included — not chosen:');
    }
    out.push(
      `${(l.article ?? '??').padEnd(8)}${l.description.padEnd(w)}  `
      + `${String(l.qty).padStart(3)}  ${money(l.unitPrice).padStart(8)}  ${money(l.lineTotal).padStart(8)}`,
    );
    if (l.implied && l.because) out.push(`${' '.repeat(8)}${l.because}`);
  }

  out.push('');
  out.push(q.net == null
    ? 'Net: — (nothing on this list has a price on file)'
    : `${q.complete ? 'Net' : 'Net (PARTIAL)'}: ${cur} ${money(q.net)}`);
  if (q.vat != null) {
    out.push(`VAT @ ${q.vatRatePercent}%: ${cur} ${money(q.vat)}`);
    out.push(`Gross: ${cur} ${money(q.gross)}`);
  }
  if (q.margin != null) out.push(`Margin: ${cur} ${money(q.margin)} (${q.marginPercent}%)`);

  if (q.unpriced.length) {
    out.push('');
    out.push(`${q.unpriced.length} line(s) NOT PRICED — this quote is incomplete:`);
    for (const u of q.unpriced) out.push(`  ${u.qty} x ${u.description} (${u.why})`);
  }

  // Below the total and outside it, which is the whole point of a note.
  if (q.notes?.length) {
    out.push('');
    out.push('To install — no part number on file, not in the total:');
    for (const n of q.notes) out.push(`  ${n.text}`);
  }
  return out.join('\n');
}
