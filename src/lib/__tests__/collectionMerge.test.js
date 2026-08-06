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

describe('planLoadMerge -- unconfirmed local edits (dirty records) beat the cloud copy', () => {
  it('a dirty local record replaces the DB version and is queued for upload', () => {
    const dbRow = row('x', 'db-1', { artist: 'Wrong Pressing', savedAt: 1 });
    const localEdited = rec('x', { artist: 'Right Pressing', savedAt: 2 });
    const plan = planLoadMerge([dbRow], [localEdited], new Set(), new Set(['x']));
    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].artist).toBe('Right Pressing');
    expect(plan.toUpdate.map(r => r.id)).toEqual(['x']);
    expect(plan.dbIdMap.x).toBe('db-1');
  });

  it('the exact incident: 20 re-identified records survive a reload after failed syncs', () => {
    const dbRows = Array.from({ length: 20 }, (_, i) => row(`r${i}`, `db-${i}`, { artist: 'Draft', title: `T${i}` }));
    const locals = Array.from({ length: 20 }, (_, i) => rec(`r${i}`, { artist: 'Fine-Tuned', title: `T${i}` }));
    const dirty = new Set(locals.map(l => l.id));
    const plan = planLoadMerge(dbRows, locals, new Set(), dirty);
    expect(plan.records.every(r => r.artist === 'Fine-Tuned')).toBe(true);
    expect(plan.toUpdate).toHaveLength(20);
  });

  it('a non-dirty local copy still defers to the DB version (normal cross-device sync)', () => {
    const plan = planLoadMerge(
      [row('x', 'db-1', { artist: 'Cloud Newer' })],
      [rec('x', { artist: 'Local Stale' })],
      new Set(), new Set()
    );
    expect(plan.records[0].artist).toBe('Cloud Newer');
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('dirty record with no DB row goes through toInsert, not toUpdate', () => {
    const plan = planLoadMerge([], [rec('only-local')], new Set(), new Set(['only-local']));
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('an explicit delete (tombstone) still wins over a dirty flag', () => {
    const plan = planLoadMerge([], [rec('gone')], new Set(['gone']), new Set(['gone']));
    expect(plan.records).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
  });
});
