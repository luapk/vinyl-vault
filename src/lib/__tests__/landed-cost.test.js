import { describe, it, expect } from 'vitest';
import {
  landedCost, corridorFor, packedWeight, recourseScore,
  FX_TO_GBP, UK_VAT_RATE, UK_HANDLING_FEE, UK_VAT_AT_BORDER_THRESHOLD, PACKED_GRAMS,
} from '../landedCost.js';

const sum = b => b.lines.reduce((t, l) => t + l.value, 0);

describe('corridorFor', () => {
  it('takes a Discogs country name, not just an ISO code', () => {
    expect(corridorFor('UK').label).toBe('United Kingdom');
    expect(corridorFor('Japan').label).toBe('Japan');
    expect(corridorFor('US').label).toBe('United States');
  });

  it('resolves a combined territory to its first recognised member', () => {
    expect(corridorFor('UK, Europe & US').label).toBe('United Kingdom');
  });

  it('falls back to the expensive corridor for anything unrecognised', () => {
    // An under-estimate is the failure that costs the user money, so an
    // unknown origin must never be cheaper than a known one.
    const unknown = corridorFor('Freedonia');
    expect(unknown.label).toBe('Rest of world');
    expect(unknown.ship[0]).toBeGreaterThan(corridorFor('UK').ship[0]);
  });

  it('gives no flagless historic state a cheap corridor by accident', () => {
    expect(corridorFor('Yugoslavia').label).toBe('Rest of world');
  });
});

describe('packedWeight', () => {
  it('defaults to a 12 inch single, which is what the app is mostly pointed at', () => {
    expect(packedWeight('Vinyl')).toBe(PACKED_GRAMS['12"']);
  });

  it('reads the shape out of freeform Discogs format strings', () => {
    expect(packedWeight('Vinyl', ['LP', 'Album'])).toBe(PACKED_GRAMS.LP);
    expect(packedWeight('Vinyl', ['7"', 'Single'])).toBe(PACKED_GRAMS['7"']);
    expect(packedWeight('Vinyl', ['10"'])).toBe(PACKED_GRAMS['10"']);
    expect(packedWeight('Box Set', ['6 x Vinyl'])).toBe(PACKED_GRAMS.BOX);
  });

  it('scales with disc count', () => {
    expect(packedWeight('Vinyl', ['2 x Vinyl', 'LP'])).toBeGreaterThan(PACKED_GRAMS.LP);
  });
});

describe('landedCost', () => {
  it('refuses a price it cannot use rather than guessing', () => {
    expect(landedCost({ price: 0, currency: 'GBP' })).toBeNull();
    expect(landedCost({ price: -5, currency: 'GBP' })).toBeNull();
    expect(landedCost({ price: NaN, currency: 'GBP' })).toBeNull();
    // Pricing yen as if they were pounds is the failure this guards.
    expect(landedCost({ price: 4000, currency: 'XYZ' })).toBeNull();
  });

  it('itemises to exactly the total, so the card adds up on screen', () => {
    const b = landedCost({ price: 40, currency: 'GBP', country: 'Japan', grams: 420 });
    expect(sum(b)).toBeCloseTo(b.total, 1);
  });

  it('charges a domestic order no VAT, no handling and no FX spread', () => {
    const b = landedCost({ price: 60, currency: 'GBP', country: 'UK', grams: 420 });
    expect(b.domestic).toBe(true);
    const byLabel = Object.fromEntries(b.lines.map(l => [l.label, l.value]));
    expect(byLabel['Import VAT']).toBe(0);
    expect(byLabel['Handling fee']).toBe(0);
    expect(byLabel['FX spread']).toBe(0);
    expect(b.total).toBeCloseTo(60 + b.lines[1].value, 2);
  });

  it('converts the asking price and keeps the original beside it', () => {
    const b = landedCost({ price: 4000, currency: 'JPY', country: 'Japan', grams: 420 });
    expect(b.askingPrice).toBe(4000);
    expect(b.askingCurrency).toBe('JPY');
    expect(b.currency).toBe('GBP');
    expect(b.lines[0].value).toBeCloseTo(4000 * FX_TO_GBP.JPY, 2);
    expect(b.lines[0].note).toBe('4000 JPY');
  });

  it('raises a handling fee only once the item clears the border threshold', () => {
    const under = landedCost({ price: UK_VAT_AT_BORDER_THRESHOLD - 5, currency: 'GBP', country: 'Germany', grams: 420 });
    const over = landedCost({ price: UK_VAT_AT_BORDER_THRESHOLD + 5, currency: 'GBP', country: 'Germany', grams: 420 });
    expect(under.vatAtBorder).toBe(false);
    expect(over.vatAtBorder).toBe(true);
    const fee = b => b.lines.find(l => l.label === 'Handling fee').value;
    expect(fee(under)).toBe(0);
    expect(fee(over)).toBe(UK_HANDLING_FEE);
  });

  it('charges VAT on both sides of the threshold, only in different places', () => {
    // The threshold moves WHERE VAT is paid, not WHETHER it is. Treating the
    // under-135 case as VAT-free would understate every cheap import.
    const under = landedCost({ price: 50, currency: 'GBP', country: 'Germany', grams: 420 });
    const vat = under.lines.find(l => l.label === 'Import VAT');
    expect(vat.value).toBeGreaterThan(0);
    expect(vat.note).toMatch(/charged by the seller/);
  });

  it('applies VAT to goods plus shipping, not to the item alone', () => {
    const b = landedCost({ price: 100, currency: 'GBP', country: 'Germany', grams: 420 });
    const ship = b.lines.find(l => l.label === 'Shipping').value;
    const vat = b.lines.find(l => l.label === 'Import VAT').value;
    expect(vat).toBeCloseTo((100 + ship) * UK_VAT_RATE, 2);
  });

  it('steps the shipping cost at the weight bands', () => {
    const single = landedCost({ price: 30, currency: 'GBP', country: 'Japan', grams: 420 });
    const album = landedCost({ price: 30, currency: 'GBP', country: 'Japan', grams: 620 });
    const box = landedCost({ price: 30, currency: 'GBP', country: 'Japan', grams: 1600 });
    const ship = b => b.lines.find(l => l.label === 'Shipping').value;
    expect(ship(single)).toBeLessThan(ship(album));
    expect(ship(album)).toBeLessThan(ship(box));
  });

  it('makes the cheap far-away copy cost more than the dearer local one', () => {
    // This is the entire argument for the feature: the asking price ranking
    // and the landed ranking must be able to disagree.
    const tokyo = landedCost({ price: 45, currency: 'GBP', country: 'Japan', grams: 420 });
    const bristol = landedCost({ price: 62, currency: 'GBP', country: 'UK', grams: 420 });
    expect(tokyo.askingPrice).toBeLessThan(bristol.askingPrice);
    expect(tokyo.total).toBeGreaterThan(bristol.total);
  });

  it('accepts live rates in place of the built-in table', () => {
    const live = { ...FX_TO_GBP, USD: 0.5 };
    const b = landedCost({ price: 100, currency: 'USD', country: 'US', grams: 420, rates: live });
    expect(b.rate).toBe(0.5);
    expect(b.lines[0].value).toBeCloseTo(50, 2);
    // A live rate carries no table date, so the card knows not to print one.
    expect(b.ratesDate).toBeNull();
  });

  it('reports a transit window so time to hand can be shown beside the price', () => {
    const b = landedCost({ price: 30, currency: 'GBP', country: 'Japan', grams: 420 });
    expect(b.daysMin).toBeGreaterThan(0);
    expect(b.daysMax).toBeGreaterThan(b.daysMin);
  });
});

describe('recourseScore', () => {
  it('ranks recourse by how practical returning the record actually is', () => {
    expect(recourseScore('GB').level).toBe('strong');
    expect(recourseScore('DE').level).toBe('fair');
    expect(recourseScore('JP').level).toBe('weak');
  });

  it('accepts a Discogs country name, not just an ISO code', () => {
    // Callers hold the release field, which says "UK", not "GB". Reading that
    // as unrecognised would quietly rate a domestic purchase as unreturnable.
    expect(recourseScore('UK').level).toBe('strong');
    expect(recourseScore('Germany').level).toBe('fair');
    expect(recourseScore('Japan').level).toBe('weak');
    expect(recourseScore('').level).toBe('weak');
  });
});
