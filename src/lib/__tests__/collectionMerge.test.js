import { describe, it, expect } from 'vitest';
import { planLoadMerge } from '../collectionMerge.js';

const rec = (id, extra = {}) => ({ id, artist: '', title: '', savedAt: 1000, ...extra });
const row = (id, dbId, extra = {}) => ({ ...rec(id, extra), _dbId: dbId });

describe('planLoadMerge -- the no-data-loss invariant', () => {
  it('keeps every local-only record even though it has no DB row (dead-session scans)', () => {
    // The exact incident: ~20 records scanned while the session was expired,
    // so none reached Supabase. The merge must keep all of them.
    const locals = Array.from({ length: 20 }, (_, i) => rec(`local-${i}`, { artist: `A${i}`, title: `T${i}` }));
    const plan = planLoadMerge([row('cloud-1', 'db-1')], locals, new Set());
    expect(plan.records).toHaveLength(21);
    expect(plan.toInsert).toHaveLength(20);
    for (const l of locals) expect(plan.records.some(r => r.id === l.id)).toBe(true);
  });

  it('never merges records that merely share artist+title (doubles, pressings, blanks)', () => {
    const locals = [
      rec('a', { artist: 'Nick Cave', title: 'From Her to Eternity' }),
      rec('b', { artist: 'Nick Cave', title: 'From Her to Eternity' }), // second copy
      rec('c', { artist: '', title: '' }), // unidentified
      rec('d', { artist: '', title: '' }), // another unidentified
    ];
    const plan = planLoadMerge([], locals, new Set());
    expect(plan.records).toHaveLength(4);
  });

  it('does not resurrect explicitly deleted records (tombstones)', () => {
    const plan = planLoadMerge(
      [row('kept', 'db-1')],
      [rec('kept'), rec('deleted-one')],
      new Set(['deleted-one'])
    );
    expect(plan.records).toHaveLength(1);
    expect(plan.toInsert).toHaveLength(0);
  });

  it('local record already in the cloud is not re-inserted or duplicated', () => {
    const plan = planLoadMerge([row('x', 'db-1', { savedAt: 2000 })], [rec('x')], new Set());
    expect(plan.records).toHaveLength(1);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.dbIdMap).toEqual({ x: 'db-1' });
  });

  it('dedupes DB rows only on the internal UUID, keeping the newest', () => {
    const plan = planLoadMerge(
      [row('same', 'db-old', { savedAt: 1 }), row('same', 'db-new', { savedAt: 2 })],
      [],
      new Set()
    );
    expect(plan.records).toHaveLength(1);
    expect(plan.dbIdMap.same).toBe('db-new');
    expect(plan.spareRowIds).toEqual(['db-old']);
  });

  it('duplicate ids across state and localStorage collapse to one (state wins)', () => {
    const inState = rec('dup', { artist: 'State' });
    const inStorage = rec('dup', { artist: 'Storage' });
    const plan = planLoadMerge([], [inState, inStorage], new Set());
    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].artist).toBe('State');
  });

  it('empty cloud + local records: nothing is lost', () => {
    const plan = planLoadMerge([], [rec('only-local')], new Set());
    expect(plan.records).toHaveLength(1);
    expect(plan.toInsert).toHaveLength(1);
  });

  it('records without an id are ignored, not crashed on', () => {
    const plan = planLoadMerge([{ _dbId: 'db-x' }], [{ artist: 'no id' }, null], new Set());
    expect(plan.records).toHaveLength(0);
  });
});
