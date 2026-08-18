import { describe, it, expect } from 'vitest';
import { unfiledRecords, normalizeCrateMeta, mergeCrateMeta, coverage } from '../smartCrates.js';

const rec = (id, crates) => ({ id, artist: 'A', title: 'T', ...(crates ? { crates } : {}) });

describe('unfiledRecords -- only records in no crate at all', () => {
  it('picks the records with no crates', () => {
    const out = unfiledRecords([rec('a'), rec('b', ['House']), rec('c', [])]);
    expect(out.map(r => r.id)).toEqual(['a', 'c']);
  });

  it('leaves a hand-filed record alone', () => {
    // The user's own filing is not the AI's to second-guess.
    expect(unfiledRecords([rec('a', ['Sunday Morning'])])).toEqual([]);
  });

  it('survives junk in the collection', () => {
    expect(unfiledRecords([null, undefined, rec('a')]).map(r => r.id)).toEqual(['a']);
  });
});

describe('normalizeCrateMeta -- tolerates the older names-only shape', () => {
  it('upgrades a list of plain names', () => {
    expect(normalizeCrateMeta(['Detroit Lineage'])).toEqual([{ name: 'Detroit Lineage', description: '' }]);
  });

  it('keeps descriptions', () => {
    expect(normalizeCrateMeta([{ name: 'Dubs', description: 'Heavy.' }]))
      .toEqual([{ name: 'Dubs', description: 'Heavy.' }]);
  });

  it('drops entries with no usable name', () => {
    expect(normalizeCrateMeta([{ description: 'x' }, { name: '  ' }, null, 5])).toEqual([]);
  });

  it('returns an empty list for anything that is not an array', () => {
    expect(normalizeCrateMeta(null)).toEqual([]);
    expect(normalizeCrateMeta({ crates: [] })).toEqual([]);
  });
});

describe('mergeCrateMeta', () => {
  const existing = [{ name: 'Detroit Lineage', description: 'Motor city.' }, { name: 'Dubs', description: '' }];

  it('a full run replaces the list', () => {
    const out = mergeCrateMeta(existing, [{ name: 'New Only', description: 'x' }], 'full');
    expect(out).toEqual([{ name: 'New Only', description: 'x' }]);
  });

  it('an unfiled run keeps the crates it filed into', () => {
    // The regression this guards: an unfiled run used to overwrite the list
    // with only the crates it touched, so every other crate stayed on its
    // records but disappeared from the suggestions.
    const out = mergeCrateMeta(existing, [{ name: 'Dubs', description: 'Heavy.' }], 'unfiled');
    expect(out.map(c => c.name)).toEqual(['Detroit Lineage', 'Dubs']);
  });

  it('fills in a description the existing entry never had', () => {
    const out = mergeCrateMeta(existing, [{ name: 'Dubs', description: 'Heavy.' }], 'unfiled');
    expect(out.find(c => c.name === 'Dubs').description).toBe('Heavy.');
  });

  it('does not overwrite a description that already exists', () => {
    const out = mergeCrateMeta(existing, [{ name: 'Detroit Lineage', description: 'Something else.' }], 'unfiled');
    expect(out.find(c => c.name === 'Detroit Lineage').description).toBe('Motor city.');
  });

  it('appends genuinely new crates', () => {
    const out = mergeCrateMeta(existing, [{ name: 'Late-Night Sheffield', description: 'y' }], 'unfiled');
    expect(out.map(c => c.name)).toEqual(['Detroit Lineage', 'Dubs', 'Late-Night Sheffield']);
  });

  it('treats a name differing only in case as the same crate', () => {
    const out = mergeCrateMeta(existing, [{ name: 'dubs', description: 'z' }], 'unfiled');
    expect(out).toHaveLength(2);
  });
});

describe('coverage -- says out loud what was left unfiled', () => {
  const sent = [rec('a'), rec('b'), rec('c')];

  it('counts filed and unfiled', () => {
    const out = coverage([{ ids: ['a'] }, { ids: ['b'] }], sent);
    expect(out).toEqual({ filed: 2, total: 3, unfiled: 1 });
  });

  it('counts a record in two crates once', () => {
    const out = coverage([{ ids: ['a', 'b'] }, { ids: ['a'] }], sent);
    expect(out).toEqual({ filed: 2, total: 3, unfiled: 1 });
  });

  it('ignores ids that were never sent', () => {
    const out = coverage([{ ids: ['a', 'ghost'] }], sent);
    expect(out).toEqual({ filed: 1, total: 3, unfiled: 2 });
  });

  it('handles nothing coming back', () => {
    expect(coverage([], sent)).toEqual({ filed: 0, total: 3, unfiled: 3 });
  });
});
