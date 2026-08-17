import { describe, it, expect } from 'vitest';
import {
  BADGE_TIERS, earnedTiers, unlockedCounts, nextTier, progressToward, planCelebration,
  unlockDates, stampUnlocks,
} from '../badges.js';

// A collection of n records saved one day apart, oldest first.
const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const madeOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, savedAt: START + i * DAY }));

describe('badge ladder', () => {
  it('is ordered and starts at 50, ends at 5000', () => {
    const counts = BADGE_TIERS.map(t => t.count);
    expect(counts[0]).toBe(50);
    expect(counts[counts.length - 1]).toBe(5000);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  });

  it('includes every milestone the brief asked to reward', () => {
    const counts = BADGE_TIERS.map(t => t.count);
    for (const c of [50, 100, 200, 350, 500, 1000]) expect(counts).toContain(c);
  });
});

describe('earnedTiers', () => {
  it('earns nothing below the first milestone', () => {
    expect(earnedTiers(49)).toEqual([]);
  });

  it('earns on the boundary, not one short of it', () => {
    expect(earnedTiers(50).map(t => t.count)).toEqual([50]);
    expect(earnedTiers(99).map(t => t.count)).toEqual([50]);
    expect(earnedTiers(100).map(t => t.count)).toEqual([50, 100]);
  });
});

describe('planCelebration', () => {
  it('celebrates the first milestone on a fresh ledger', () => {
    const { badge, celebrated } = planCelebration(50, []);
    expect(badge.count).toBe(50);
    expect(celebrated).toEqual([50]);
  });

  it('shows nothing before the first milestone', () => {
    expect(planCelebration(12, []).badge).toBeNull();
  });

  it('shows only the highest when several land at once', () => {
    // A bulk import takes the collection from nothing to 620 in one go.
    const { badge, celebrated } = planCelebration(620, []);
    expect(badge.count).toBe(500);
    // The skipped-past tiers are still banked, so they never fire later.
    expect(celebrated).toEqual([50, 100, 200, 350, 500]);
  });

  it('does not repeat a badge that has already been celebrated', () => {
    const first = planCelebration(200, []);
    expect(first.badge.count).toBe(200);
    const again = planCelebration(240, first.celebrated);
    expect(again.badge).toBeNull();
    expect(again.celebrated).toEqual(first.celebrated);
  });

  it('celebrates the next one when the count climbs again', () => {
    const at200 = planCelebration(200, []).celebrated;
    const { badge } = planCelebration(350, at200);
    expect(badge.count).toBe(350);
  });

  it('keeps the ledger when records are deleted, and stays quiet on re-crossing', () => {
    const at500 = planCelebration(500, []).celebrated;
    const shrunk = planCelebration(120, at500);
    expect(shrunk.badge).toBeNull();
    expect(shrunk.celebrated).toEqual(at500);
    expect(planCelebration(500, shrunk.celebrated).badge).toBeNull();
  });

  it('runs out of badges at the top of the ladder', () => {
    const all = planCelebration(5000, []).celebrated;
    expect(planCelebration(99999, all).badge).toBeNull();
  });
});

describe('unlockedCounts', () => {
  it('never demotes a badge the ledger has banked', () => {
    const unlocked = unlockedCounts(10, [50, 100]);
    expect(unlocked.has(50)).toBe(true);
    expect(unlocked.has(100)).toBe(true);
    expect(unlocked.has(200)).toBe(false);
  });
});

describe('nextTier', () => {
  it('points at the first locked milestone', () => {
    expect(nextTier(0).count).toBe(50);
    expect(nextTier(50).count).toBe(100);
    expect(nextTier(501).count).toBe(1000);
  });

  it('is null once the whole ladder is done', () => {
    expect(nextTier(5000)).toBeNull();
  });
});

describe('unlockDates', () => {
  it('dates a milestone from the record that crossed it', () => {
    const dates = unlockDates(madeOf(120));
    expect(dates[50]).toBe(START + 49 * DAY);   // the 50th record
    expect(dates[100]).toBe(START + 99 * DAY);
  });

  it('has no date for a milestone not yet reached', () => {
    const dates = unlockDates(madeOf(60));
    expect(dates[50]).toBeDefined();
    expect(dates[100]).toBeUndefined();
  });

  it('reads the collection in save order, not array order', () => {
    const shuffled = [...madeOf(60)].reverse();
    expect(unlockDates(shuffled)[50]).toBe(START + 49 * DAY);
  });

  it('falls back to the stored stamp when records have since been deleted', () => {
    const stored = { 50: START + 999 * DAY };
    // Only 10 records left, so the collection cannot account for the 50 badge.
    expect(unlockDates(madeOf(10), stored)[50]).toBe(stored[50]);
  });

  it('prefers the collection over the stored stamp, so historic badges are dated truthfully', () => {
    // The ledger stamped everything on the day the feature shipped; the
    // collection knows the 50th record actually landed in 2024.
    const stored = { 50: Date.UTC(2026, 7, 17) };
    expect(unlockDates(madeOf(60), stored)[50]).toBe(START + 49 * DAY);
  });

  it('ignores records with a missing or unusable savedAt', () => {
    const records = [...madeOf(50), { id: 'x' }, { id: 'y', savedAt: 'nonsense' }];
    expect(unlockDates(records)[50]).toBe(START + 49 * DAY);
  });

  it('survives an empty collection', () => {
    expect(unlockDates([])).toEqual({});
    expect(unlockDates()).toEqual({});
  });
});

describe('stampUnlocks', () => {
  it('stamps newly banked tiers and never rewrites an existing date', () => {
    const first = stampUnlocks({}, [50, 100], 1000);
    expect(first).toEqual({ 50: 1000, 100: 1000 });
    const second = stampUnlocks(first, [50, 100, 200], 5000);
    expect(second).toEqual({ 50: 1000, 100: 1000, 200: 5000 });
  });
});

describe('progressToward', () => {
  it('measures from the milestone below, so each step is a fresh climb', () => {
    expect(progressToward(0, BADGE_TIERS[0])).toBe(0);
    expect(progressToward(25, BADGE_TIERS[0])).toBeCloseTo(0.5);
    expect(progressToward(50, BADGE_TIERS[1])).toBe(0); // just earned 50, 100 is next
    expect(progressToward(75, BADGE_TIERS[1])).toBeCloseTo(0.5);
  });

  it('clamps to the 0..1 range and treats a finished ladder as complete', () => {
    expect(progressToward(9999, BADGE_TIERS[0])).toBe(1);
    expect(progressToward(0, null)).toBe(1);
  });
});
