import { describe, it, expect } from 'vitest';
import { planDraftDedupe, dedupeKey } from './draftDuplicates.js';

const draft = (id, artist, title, savedAt = 1) =>
  ({ id, artist, title, savedAt, discogsId: null, identified: false, source: 'file_import' });
const matched = (id, artist, title) =>
  ({ id, artist, title, savedAt: 1, discogsId: '99' + id, identified: true, source: 'discogs_import' });

describe('planDraftDedupe', () => {
  it('keeps the oldest copy and removes the rest', () => {
    const plan = planDraftDedupe([
      draft('a', 'Herbert', 'Part 4', 100),
      draft('b', 'Herbert', 'Part 4', 200),
      draft('c', 'Herbert', 'Part 4', 300),
    ]);
    expect(plan.remove).toEqual(['b', 'c']);
    expect(plan.count).toBe(2);
    expect(plan.againstDraft).toBe(2);
  });

  it('removes a draft that duplicates a record which did match', () => {
    const plan = planDraftDedupe([
      matched('m', 'Kraftwerk', 'The Mix'),
      draft('d', 'Kraftwerk', 'The Mix'),
    ]);
    expect(plan.remove).toEqual(['d']);
    expect(plan.againstIdentified).toBe(1);
  });

  it('never proposes removing an identified record', () => {
    const plan = planDraftDedupe([
      matched('m1', 'Kraftwerk', 'The Mix'),
      matched('m2', 'Kraftwerk', 'The Mix'),
    ]);
    expect(plan.remove).toEqual([]);
  });

  it('ignores case, punctuation and spacing', () => {
    expect(dedupeKey({ artist: 'Inigo  Vontier', title: 'Acid Cowboy!' }))
      .toBe(dedupeKey({ artist: 'INIGO VONTIER', title: 'acid cowboy' }));
  });

  // These records have no release id to check against, so a bracketed suffix
  // is all there is to tell two pressings apart. Merging on it would delete a
  // record the user actually owns.
  it('treats a bracketed suffix as part of the title', () => {
    const plan = planDraftDedupe([
      draft('a', 'Inigo Vontier', 'Acid Cowboy (Multi Culti)'),
      draft('b', 'Inigo Vontier', 'Acid Cowboy'),
    ]);
    expect(plan.remove).toEqual([]);
  });

  it('leaves blank rows alone rather than collapsing them all', () => {
    const plan = planDraftDedupe([
      draft('a', '', '(untitled)'),
      draft('b', '', '(untitled)'),
    ]);
    expect(plan.remove).toEqual([]);
  });

  it('is empty on an empty or missing collection', () => {
    expect(planDraftDedupe([]).count).toBe(0);
    expect(planDraftDedupe(null).count).toBe(0);
  });
});
