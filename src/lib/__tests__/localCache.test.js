import { describe, it, expect } from 'vitest';
import { slimForCache, writeCollectionCache, safeSetItem, photosToKeep, recordsToPin } from '../localCache.js';

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

// The ladder cuts by recency, which on its own decides by WHEN a record was
// saved rather than by whether this device is the last place it exists. An
// old unsynced record was being dropped while 400 records the cloud already
// holds were kept; the cloud ones come back on the next load, that one does
// not.
describe('the cache never drops a record the cloud does not have', () => {
  const bulky = (id, savedAt) => ({
    id, savedAt, artist: 'A'.repeat(400), title: 'T'.repeat(400),
    tracklist: Array.from({ length: 30 }, (_, k) => ({ position: `A${k}`, title: 'Track '.repeat(40), bpm: 120 })),
  });

  // A storage at its quota, like a real browser.
  const tightStorage = (quota) => {
    const store = new Map();
    return {
      store,
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        if (v.length > quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
        store.set(k, v);
      },
    };
  };

  it('keeps an old never-synced record when the ladder has to cut', () => {
    const records = Array.from({ length: 500 }, (_, i) => bulky(`r${i}`, 10_000 + i));
    const orphan = bulky('ORPHAN', 1);          // oldest, and in no cloud row
    records.push(orphan);
    const confirmed = Object.fromEntries(records.filter(r => r.id !== 'ORPHAN').map(r => [r.id, 'row']));
    const storage = tightStorage(2_000_000);

    const res = writeCollectionCache(storage, 'k', records,
      photosToKeep(records, confirmed), recordsToPin(records, confirmed));

    expect(res.ok).toBe(true);
    expect(res.dropped).toBeGreaterThan(0);                       // it did have to cut
    const cached = JSON.parse(storage.getItem('k'));
    expect(cached.some(r => r.id === 'ORPHAN')).toBe(true);
  });

  it('keeps an old record whose edit has not been confirmed', () => {
    const records = Array.from({ length: 500 }, (_, i) => bulky(`r${i}`, 10_000 + i));
    records.push(bulky('STRANDED', 1));
    const confirmed = Object.fromEntries(records.map(r => [r.id, 'row']));   // all in the cloud
    const dirty = new Set(['STRANDED']);                                     // but one edit is pending
    const storage = tightStorage(2_000_000);

    writeCollectionCache(storage, 'k', records,
      photosToKeep(records, confirmed, dirty), recordsToPin(records, confirmed, dirty));

    const cached = JSON.parse(storage.getItem('k'));
    expect(cached.some(r => r.id === 'STRANDED')).toBe(true);
  });

  it('keeps the photo of a dirty record, so the merge cannot push a hollow one', () => {
    const r = { id: 'r1', savedAt: 1, coverUrl: 'data:image/jpeg;base64,abc' };
    const keep = photosToKeep([r], { r1: 'row-1' }, new Set(['r1']));
    expect(keep.has('r1')).toBe(true);
  });

  it('falls back to only what exists nowhere else rather than failing', () => {
    const records = Array.from({ length: 300 }, (_, i) => bulky(`r${i}`, 10_000 + i));
    records.push(bulky('ORPHAN', 1));
    const confirmed = Object.fromEntries(records.filter(r => r.id !== 'ORPHAN').map(r => [r.id, 'row']));
    const storage = tightStorage(60_000);       // nothing like enough for 50

    const res = writeCollectionCache(storage, 'k', records,
      photosToKeep(records, confirmed), recordsToPin(records, confirmed));

    expect(res.ok).toBe(true);
    expect(res.level).toBe('pinned-only');
    expect(JSON.parse(storage.getItem('k')).map(r => r.id)).toEqual(['ORPHAN']);
  });
});
