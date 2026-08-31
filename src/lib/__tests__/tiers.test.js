import { describe, it, expect } from 'vitest';
import { tierAllows, FEATURE_TIER, TIERS } from '../pricing.js';

describe('tierAllows', () => {
  it('lets a higher tier reach everything a lower one can', () => {
    for (const feature of Object.keys(FEATURE_TIER)) {
      expect(tierAllows(feature, TIERS.RESIDENT)).toBe(true);
    }
  });

  it('keeps the free tier out of every gated feature', () => {
    for (const feature of Object.keys(FEATURE_TIER)) {
      expect(tierAllows(feature, TIERS.DIGGER)).toBe(false);
    }
  });

  it('places each feature on the tier that sells it', () => {
    expect(tierAllows('wishlist', TIERS.SELECTOR)).toBe(true);
    expect(tierAllows('smartCrates', TIERS.SELECTOR)).toBe(true);
    expect(tierAllows('scanUnlimited', TIERS.SELECTOR)).toBe(true);
    // The BPM sorter and Trace are what Resident is for.
    expect(tierAllows('bpmSorter', TIERS.SELECTOR)).toBe(false);
    expect(tierAllows('trace', TIERS.SELECTOR)).toBe(false);
    expect(tierAllows('bpmSorter', TIERS.RESIDENT)).toBe(true);
    expect(tierAllows('trace', TIERS.RESIDENT)).toBe(true);
  });

  it('treats a lapsed subscriber as free, not as exempt', () => {
    // Cancelling once granted unlimited scans, because the limit was skipped
    // unless the subscription was active. The one status that should restrict
    // a person was the one that let them through.
    expect(tierAllows('trace', TIERS.RESIDENT, false)).toBe(false);
    expect(tierAllows('wishlist', TIERS.SELECTOR, false)).toBe(false);
  });

  it('leaves anything not in the map free to everyone', () => {
    expect(tierAllows('labelPrinting', TIERS.DIGGER)).toBe(true);
    expect(tierAllows('csvExport', TIERS.DIGGER)).toBe(true);
  });

  it('treats an unknown or missing tier as free', () => {
    expect(tierAllows('wishlist', undefined)).toBe(false);
    expect(tierAllows('wishlist', 'nonsense')).toBe(false);
  });
});
