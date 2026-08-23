import { describe, it, expect } from 'vitest';
import { slimForCache, writeCollectionCache, safeSetItem, photosToKeep } from '../localCache.js';

const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
const HOSTED = 'https://example.com/cover.jpg';

const rec = (id, extra = {}) => ({ id, artist: 'A', title: 'T', savedAt: 1000, ...extra });

// A storage stand-in with a byte budget, which is what the real thing is.
function fakeStorage(limitBytes) {
  const data = new Map();
  return {
    data,
    setItem(k, v) {
      const total = [...data.entries()].reduce((n, [key, val]) => n + key.length + val.length, 0)
        - (data.has(k) ? k.length + data.get(k).length : 0)
        + k.length + v.length;
      if (total > limitBytes) {
        const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err;
      }
      data.set(k, v);
    },
    getItem: (k) => data.get(k) ?? null,
  };
}

describe('slimForCache -- photos only kept where they exist nowhere else', () => {
  it('drops the embedded photo for a record that is already in the cloud', () => {
    const [out] = slimForCache([rec('a', { coverUrl: PHOTO, images: [PHOTO, HOSTED] })], new Set());
    expect(out.coverUrl).toBeNull();
    expect(out.images).toEqual([HOSTED]);
  });

  it('keeps the photo for an unsynced record, whose only copy this is', () => {
    const [out] = slimForCache([rec('a', { coverUrl: PHOTO })], new Set(['a']));
    expect(out.coverUrl).toBe(PHOTO);
  });

  it('leaves hosted urls and every other field untouched', () => {
    const [out] = slimForCache([rec('a', { coverUrl: HOSTED, year: 1994, crates: ['Dubs'] })], new Set());
    expect(out.coverUrl).toBe(HOSTED);
    expect(out.year).toBe(1994);
    expect(out.crates).toEqual(['Dubs']);
  });
});

describe('writeCollectionCache -- degrades instead of failing', () => {
  it('writes everything when it fits', () => {
    const storage = fakeStorage(100_000);
    const res = writeCollectionCache(storage, 'k', [rec('a'), rec('b')], new Set());
    expect(res.ok).toBe(true);
    expect(res.level).toBe('slim');
    expect(JSON.parse(storage.getItem('k'))).toHaveLength(2);
  });

  it('drops an unsynced photo rather than losing the record itself', () => {
    // Budget fits the records but not the photo.
    const storage = fakeStorage(1200);
    const records = [rec('a', { coverUrl: PHOTO }), rec('b')];
    const res = writeCollectionCache(storage, 'k', records, new Set(['a']));
    expect(res.ok).toBe(true);
    expect(res.level).toBe('no-photos');
    const written = JSON.parse(storage.getItem('k'));
    expect(written).toHaveLength(2);                    // both records survive
    expect(written.find(r => r.id === 'a').coverUrl).toBeNull();
  });

  it('keeps the newest records when even slimmed data will not fit', () => {
    const many = Array.from({ length: 500 }, (_, i) => rec(`r${i}`, { savedAt: i }));
    const storage = fakeStorage(12_000);
    const res = writeCollectionCache(storage, 'k', many, new Set());
    expect(res.ok).toBe(true);
    expect(res.wrote).toBeLessThan(500);
    expect(res.dropped).toBeGreaterThan(0);
    const written = JSON.parse(storage.getItem('k'));
    // The most recent scans are the ones most likely to be unsynced.
    expect(written[0].savedAt).toBe(499);
  });

  it('reports failure rather than throwing when nothing fits at all', () => {
    const storage = fakeStorage(10);
    const res = writeCollectionCache(storage, 'k', [rec('a')], new Set());
    expect(res.ok).toBe(false);
  });

  it('gives up immediately on a non-quota error', () => {
    const storage = { setItem() { throw new TypeError('nope'); } };
    const res = writeCollectionCache(storage, 'k', [rec('a')], new Set());
    expect(res.ok).toBe(false);
    expect(res.error).toBeInstanceOf(TypeError);
  });
});

describe('safeSetItem -- a full quota must never take the app down', () => {
  it('returns false instead of throwing', () => {
    const storage = { setItem() { const e = new Error('q'); e.name = 'QuotaExceededError'; throw e; } };
    expect(safeSetItem(storage, 'k', 'v')).toBe(false);
  });
  it('returns true on success', () => {
    expect(safeSetItem(fakeStorage(1000), 'k', 'v')).toBe(true);
  });
});

describe('photosToKeep -- derived from the records being written', () => {
  it('keeps a record with no confirmed DB row', () => {
    const keep = photosToKeep([rec('a'), rec('b')], { b: 'row-1' });
    expect([...keep]).toEqual(['a']);
  });

  it('keeps a just-created record even though state has not caught up', () => {
    // The regression: the keep set used to come from component state, which
    // does not yet contain the record being saved, so the newest scan's photo
    // was stripped -- exactly the one most likely to be its only copy.
    const justAdded = rec('new');
    const existing = rec('old');
    const keep = photosToKeep([justAdded, existing], { old: 'row-1' });
    expect(keep.has('new')).toBe(true);
  });

  it('ignores records without an id', () => {
    expect([...photosToKeep([{ artist: 'no id' }, null], {})]).toEqual([]);
  });
});
