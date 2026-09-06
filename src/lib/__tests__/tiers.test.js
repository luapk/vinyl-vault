import { describe, it, expect, afterEach } from 'vitest';
import { tierAllows, FEATURE_TIER, TIERS, setFeatureTierOverrides, effectiveFeatureTier } from '../pricing.js';

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

describe('feature tier overrides', () => {
  // public.feature_tiers can move one gate without a deploy. The rules that
  // matter are that it layers over the shipped map rather than replacing it,
  // and that an empty table is not a licence to open everything.
  afterEach(() => setFeatureTierOverrides({}));

  it('moves a single feature and leaves the rest alone', () => {
    setFeatureTierOverrides({ trace: TIERS.SELECTOR });
    expect(tierAllows('trace', TIERS.SELECTOR)).toBe(true);
    expect(tierAllows('bpmSorter', TIERS.SELECTOR)).toBe(false);
    expect(tierAllows('wishlist', TIERS.DIGGER)).toBe(false);
  });

  it('opens a feature to everyone with "free"', () => {
    setFeatureTierOverrides({ wishlist: 'free' });
    expect(tierAllows('wishlist', TIERS.DIGGER)).toBe(true);
    expect(effectiveFeatureTier('wishlist')).toBe(null);
  });

  it('can tighten a gate as well as loosen it', () => {
    setFeatureTierOverrides({ wishlist: TIERS.RESIDENT });
    expect(tierAllows('wishlist', TIERS.SELECTOR)).toBe(false);
    expect(tierAllows('wishlist', TIERS.RESIDENT)).toBe(true);
  });

  it('falls back to the shipped map when the table is empty', () => {
    // The failure this guards is the important one: a load that returns
    // nothing (offline, or the migration not run) must not read as "no gates".
    setFeatureTierOverrides({});
    expect(tierAllows('trace', TIERS.SELECTOR)).toBe(false);
    expect(effectiveFeatureTier('trace')).toBe(TIERS.RESIDENT);
  });

  it('still treats a lapsed subscriber as free under an override', () => {
    setFeatureTierOverrides({ trace: TIERS.SELECTOR });
    expect(tierAllows('trace', TIERS.SELECTOR, false)).toBe(false);
  });
});
