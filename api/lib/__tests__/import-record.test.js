import { describe, it, expect } from 'vitest';
import { recordFromMatch, draftFromRow, patchFromMatch } from '../importRecord.js';
import { recordFromRelease } from '../../../src/hooks/useCollection.js';

// The background import worker writes records without going through the
// client. Two writers of one shape drift: a field added to the client's
// whitelist and forgotten here is a field that exists on records imported in
// the browser and is missing on records imported by the worker. This test is
// the thing that notices.

const MATCH = {
  id: '12345', artist: 'Kraftwerk', recordTitle: 'The Mix',
  label: 'EMI', catalogNumber: 'EM 1408', year: 1991,
  country: 'UK', format: 'LP', coverUrl: 'https://example.test/cover.jpg',
};
const ROW = { artist: 'Kraftwerk', title: 'The Mix' };

const clientKeys = Object.keys(recordFromRelease({ id: '1', artist: 'a', title: 'b' }, [])).sort();

describe('the worker writes the same record shape as the browser', () => {
  it('matches the client whitelist for a matched row', () => {
    expect(Object.keys(recordFromMatch(MATCH, ROW)).sort()).toEqual(clientKeys);
  });

  it('matches the client whitelist for a draft', () => {
    expect(Object.keys(draftFromRow(ROW)).sort()).toEqual(clientKeys);
  });
});

describe('recordFromMatch', () => {
  it('carries the release through, and marks it identified', () => {
    const r = recordFromMatch(MATCH, ROW);
    expect(r).toMatchObject({
      discogsId: '12345', artist: 'Kraftwerk', title: 'The Mix',
      label: 'EMI', year: 1991, country: 'UK',
      identified: true, confidence: 'high', source: 'discogs_import',
    });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('falls back to what the user typed when Discogs is missing a field', () => {
    const r = recordFromMatch({ id: '9' }, ROW);
    expect(r.artist).toBe('Kraftwerk');
    expect(r.title).toBe('The Mix');
  });
});

describe('draftFromRow', () => {
  it('is findable again: no discogsId, identified false, source file_import', () => {
    const d = draftFromRow(ROW);
    expect(d.discogsId).toBe(null);
    expect(d.identified).toBe(false);
    expect(d.source).toBe('file_import');
  });

  it('never saves an empty title', () => {
    expect(draftFromRow({ artist: 'x' }).title).toBe('(untitled)');
  });
});

describe('patchFromMatch', () => {
  it('touches only the identification fields', () => {
    const patch = patchFromMatch(MATCH, { artist: 'old', title: 'old' });
    expect(Object.keys(patch).sort()).toEqual([
      'artist', 'catalogNumber', 'confidence', 'country', 'coverUrl',
      'discogsId', 'format', 'identified', 'label', 'source', 'title', 'year',
    ]);
    // Nothing the user owns is in there: crates, notes and conditions survive.
    for (const owned of ['crates', 'notes', 'mediaCondition', 'sleeveCondition', 'tags', 'savedAt']) {
      expect(patch).not.toHaveProperty(owned);
    }
  });
});
