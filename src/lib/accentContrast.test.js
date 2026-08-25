import { describe, it, expect } from 'vitest';
import { relativeLuminance, legibleAccent, MAX_ON_LIGHT, MIN_ON_DARK } from './accentContrast.js';

const lum = (c) => relativeLuminance(c);

describe('legibleAccent', () => {
  // The actual bug: reset() parks the accent here until a cover is read, and
  // the active tab was drawn in it on a near-white page.
  it('darkens the default pale grey enough to read in light mode', () => {
    const before = { r: 200, g: 200, b: 200 };
    expect(lum(before)).toBeGreaterThan(MAX_ON_LIGHT);
    expect(lum(legibleAccent(before, false))).toBeLessThanOrEqual(MAX_ON_LIGHT);
  });

  it('leaves that same grey alone in dark mode, where it already outshines the rest', () => {
    expect(legibleAccent({ r: 200, g: 200, b: 200 }, true)).toEqual({ r: 200, g: 200, b: 200 });
  });

  // The point of the thresholds: the active tab must beat an inactive one,
  // which draws at roughly a mid grey in either theme.
  const INACTIVE = { r: 102, g: 102, b: 102 };
  it('comes out stronger than an inactive tab, both ways round', () => {
    expect(lum(legibleAccent({ r: 200, g: 200, b: 200 }, false))).toBeLessThan(lum(INACTIVE));
    expect(lum(legibleAccent({ r: 40, g: 40, b: 40 }, true))).toBeGreaterThan(lum(INACTIVE));
  });

  it('lifts a near-black cover accent out of a dark page', () => {
    const before = { r: 10, g: 10, b: 14 };
    expect(lum(before)).toBeLessThan(MIN_ON_DARK);
    expect(lum(legibleAccent(before, true))).toBeGreaterThanOrEqual(MIN_ON_DARK);
  });

  it('terminates on pure black and pure white', () => {
    expect(lum(legibleAccent({ r: 0, g: 0, b: 0 }, true))).toBeGreaterThanOrEqual(MIN_ON_DARK);
    expect(lum(legibleAccent({ r: 255, g: 255, b: 255 }, false))).toBeLessThanOrEqual(MAX_ON_LIGHT);
  });

  // Clamping rather than replacing is the point: a record with a strong cover
  // still tints its own chrome.
  it('keeps the hue it was given', () => {
    const out = legibleAccent({ r: 255, g: 80, b: 80 }, false);
    expect(out.r).toBeGreaterThan(out.g);
    expect(out.g).toBe(out.b);
  });

  it('leaves an accent that already reads exactly as it is', () => {
    const deep = { r: 60, g: 70, b: 10 };
    expect(legibleAccent(deep, false)).toEqual(deep);
  });

  it('survives a missing or malformed accent', () => {
    expect(legibleAccent(null, false)).toEqual({ r: 20, g: 20, b: 20 });
    expect(legibleAccent({ r: NaN, g: 1, b: 1 }, true)).toEqual({ r: 235, g: 235, b: 235 });
  });
});
