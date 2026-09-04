// Tests for the bill of materials and the quote.
//
// Weighted heavily towards the ways a pricing bug hurts somebody rather than
// the ways it looks wrong on screen. The central one is that a missing price
// must never behave like zero - not in a line, not in a total, not in a margin.

import { describe, it, expect } from 'vitest';
import { billOfMaterials, unitPrice, quote, formatQuote } from '../src/engine/quote.js';

const assemblyOf = (...componentIds) => ({
  instances: componentIds.map((componentId, i) => ({ instanceId: `i${i + 1}`, componentId })),
  connections: [],
});

const CATALOGUE = {
  currency: 'GBP',
  priceList: { ref: 'Test list 2026', dated: '2026-01-01', source: 'fixture' },
  vatRatePercent: 20,
  tiers: [
    { id: 'retailer', name: 'Retailer', markupOnCost: 1.4 },
    { id: 'retail', name: 'Retail (RRP)', markupOnCost: 2.5 },
    { id: 'nomarkup', name: 'No markup set', markupOnCost: null },
  ],
  items: {
    frame: { article: '236758', description: 'Frame 1500', costEach: 40, priceEach: {} },
    shelf: { article: '008563', description: 'Shelf 900', costEach: 20, priceEach: { retail: 59.99 } },
    tray: { article: '008543', description: 'Tray 320', costEach: null, priceEach: {} },
  },
};

describe('billOfMaterials', () => {
  it('counts instances per component', () => {
    const bom = billOfMaterials(assemblyOf('frame', 'shelf', 'frame'));
    expect(bom).toEqual([
      { componentId: 'frame', qty: 2 },
      { componentId: 'shelf', qty: 1 },
    ]);
  });

  it('is stable in order, so two runs of the same product agree', () => {
    const a = billOfMaterials(assemblyOf('shelf', 'frame', 'shelf'));
    const b = billOfMaterials(assemblyOf('frame', 'shelf', 'shelf'));
    expect(a).toEqual(b);
  });

  it('is empty for an empty assembly rather than throwing', () => {
    expect(billOfMaterials({ instances: [] })).toEqual([]);
    expect(billOfMaterials(undefined)).toEqual([]);
  });

  it('needs no catalogue - a parts list is right even with no prices', () => {
    expect(billOfMaterials(assemblyOf('nothing-priced'))).toEqual([
      { componentId: 'nothing-priced', qty: 1 },
    ]);
  });
});

describe('unitPrice', () => {
  const tier = (id) => CATALOGUE.tiers.find((t) => t.id === id);

  it('derives from cost x markup when there is no price list entry', () => {
    expect(unitPrice(CATALOGUE.items.frame, tier('retailer')))
      .toEqual({ pence: 5600, source: 'cost-x-markup' });
  });

  it('prefers an explicit price list entry over the markup', () => {
    // Cost 20 x 2.5 would be 50.00; the list says 59.99 and the list wins.
    expect(unitPrice(CATALOGUE.items.shelf, tier('retail')))
      .toEqual({ pence: 5999, source: 'price-list' });
  });

  it('falls back to the markup for a tier the price list does not cover', () => {
    expect(unitPrice(CATALOGUE.items.shelf, tier('retailer')))
      .toEqual({ pence: 2800, source: 'cost-x-markup' });
  });

  it('returns null, not zero, when a cost exists but the tier has no markup', () => {
    const r = unitPrice(CATALOGUE.items.frame, tier('nomarkup'));
    expect(r.pence).toBeNull();
    expect(r.source).toBe('no-markup-for-tier');
  });

  it('returns null, not zero, when nothing is on file', () => {
    expect(unitPrice(CATALOGUE.items.tray, tier('retail')).pence).toBeNull();
    expect(unitPrice(undefined, tier('retail')).source).toBe('no-catalogue-entry');
  });

  it('treats a genuine zero price as a price, not as missing', () => {
    const free = { costEach: 10, priceEach: { retail: 0 } };
    expect(unitPrice(free, tier('retail'))).toEqual({ pence: 0, source: 'price-list' });
  });
});

describe('quote', () => {
  it('prices a complete configuration and totals it', () => {
    const q = quote(assemblyOf('frame', 'shelf', 'frame'), CATALOGUE, { tierId: 'retail' });
    expect(q.complete).toBe(true);
    expect(q.tier.id).toBe('retail');
    // 2 frames at 40 x 2.5 = 100.00 each, 1 shelf from the list at 59.99
    expect(q.net).toBe(259.99);
    expect(q.vat).toBe(52.0);
    expect(q.gross).toBe(311.99);
    expect(q.partCount).toBe(3);
    expect(q.lineCount).toBe(2);
  });

  it('changes with the tier', () => {
    const cheap = quote(assemblyOf('frame'), CATALOGUE, { tierId: 'retailer' });
    const dear = quote(assemblyOf('frame'), CATALOGUE, { tierId: 'retail' });
    expect(cheap.net).toBe(56.0);
    expect(dear.net).toBe(100.0);
  });

  it('falls back to the first tier when none is named', () => {
    expect(quote(assemblyOf('frame'), CATALOGUE).tier.id).toBe('retailer');
  });

  // ---- the point of the module ------------------------------------------

  it('never counts a missing price as zero', () => {
    const q = quote(assemblyOf('frame', 'tray'), CATALOGUE, { tierId: 'retail' });
    expect(q.complete).toBe(false);
    // The frame alone, NOT the frame plus nothing for the tray.
    expect(q.net).toBe(100.0);
    expect(q.lines.find((l) => l.componentId === 'tray').lineTotal).toBeNull();
    expect(q.lines.find((l) => l.componentId === 'tray').unitPrice).toBeNull();
  });

  it('says which lines it could not price, and why', () => {
    const q = quote(assemblyOf('frame', 'tray', 'tray'), CATALOGUE, { tierId: 'retail' });
    expect(q.unpriced).toEqual([
      { componentId: 'tray', description: 'Tray 320', qty: 2, why: 'no-price-on-file' },
    ]);
  });

  it('is incomplete when a component is not in the catalogue at all', () => {
    const q = quote(assemblyOf('frame', 'mystery-part'), CATALOGUE, { tierId: 'retail' });
    expect(q.complete).toBe(false);
    expect(q.unpriced[0].why).toBe('no-catalogue-entry');
    // And it still names the thing, so the gap is actionable.
    expect(q.unpriced[0].componentId).toBe('mystery-part');
  });

  it('is not complete for an empty configuration', () => {
    // Nothing configured is not "fully priced at zero" - there is no quote.
    const q = quote({ instances: [] }, CATALOGUE, { tierId: 'retail' });
    expect(q.complete).toBe(false);
    expect(q.lineCount).toBe(0);
  });

  it('withholds margin unless both price and cost are fully known', () => {
    const full = quote(assemblyOf('frame', 'shelf'), CATALOGUE, { tierId: 'retail' });
    expect(full.cost).toBe(60.0);
    expect(full.margin).toBe(99.99);
    expect(full.marginPercent).toBe(62.5);

    const partial = quote(assemblyOf('frame', 'tray'), CATALOGUE, { tierId: 'retail' });
    expect(partial.cost).toBeNull();
    expect(partial.margin).toBeNull();
    expect(partial.marginPercent).toBeNull();
  });

  it('has NO total when nothing on the list has a price', () => {
    // Found by running the real thing: a seven-part bill of materials against a
    // catalogue with no prices printed "Net (PARTIAL): GBP 0.00". A zero is a
    // price. The absence of every price is not, however the heading is worded.
    const empty = { ...CATALOGUE, items: { frame: { article: 'a', description: 'Frame', costEach: null, priceEach: {} } } };
    const q = quote(assemblyOf('frame', 'frame'), empty, { tierId: 'retail' });
    expect(q.lineCount).toBe(1);
    expect(q.partCount).toBe(2);
    expect(q.net).toBeNull();
    expect(q.vat).toBeNull();
    expect(q.gross).toBeNull();
    expect(q.pricedLineCount).toBe(0);
    expect(formatQuote(q)).toContain('nothing on this list has a price');
    expect(formatQuote(q)).not.toContain('0.00');
  });

  it('still totals the priced part when only some lines price', () => {
    const q = quote(assemblyOf('frame', 'tray'), CATALOGUE, { tierId: 'retail' });
    expect(q.net).toBe(100.0);
    expect(q.pricedLineCount).toBe(1);
    expect(formatQuote(q)).toContain('Net (PARTIAL)');
  });

  it('omits VAT rather than assuming a rate', () => {
    const noVat = quote(assemblyOf('frame'), { ...CATALOGUE, vatRatePercent: null },
      { tierId: 'retail' });
    expect(noVat.vat).toBeNull();
    expect(noVat.gross).toBeNull();
    expect(noVat.net).toBe(100.0);
  });

  it('carries the price list reference through, so a quote can cite it', () => {
    expect(quote(assemblyOf('frame'), CATALOGUE).priceList.ref).toBe('Test list 2026');
  });

  it('does not drift on money that floating point handles badly', () => {
    const awkward = {
      ...CATALOGUE,
      tiers: [{ id: 't', name: 'T', markupOnCost: 1 }],
      items: { p: { article: 'x', description: 'p', costEach: 0.1, priceEach: {} } },
    };
    const q = quote(assemblyOf('p', 'p', 'p'), awkward, { tierId: 't' });
    expect(q.net).toBe(0.3);
  });
});

describe('formatQuote', () => {
  it('shows a dash for an unpriced line and labels the total partial', () => {
    const text = formatQuote(quote(assemblyOf('frame', 'tray'), CATALOGUE, { tierId: 'retail' }));
    expect(text).toContain('—');
    expect(text).toContain('Net (PARTIAL)');
    expect(text).toContain('NOT PRICED');

    // The one thing it must never do: print the unpriced line as a number.
    // Asserted on that row alone - a whole-text search for "0.00" also matches
    // the priced line's "100.00" and passes for the wrong reason.
    const trayRow = text.split('\n').find((l) => l.includes('Tray 320') && l.includes('008543'));
    expect(trayRow).toMatch(/—\s+—\s*$/);
    expect(trayRow).not.toMatch(/\d\.\d\d/);
  });

  it('labels a complete total plainly', () => {
    const text = formatQuote(quote(assemblyOf('frame', 'shelf'), CATALOGUE, { tierId: 'retail' }));
    expect(text).toContain('Net: GBP 159.99');
    expect(text).not.toContain('PARTIAL');
    expect(text).not.toContain('NOT PRICED');
  });

  it('names the price list it priced from', () => {
    expect(formatQuote(quote(assemblyOf('frame'), CATALOGUE))).toContain('Test list 2026');
  });
});
