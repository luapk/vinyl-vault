import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchDiscogs } from '../discogs.js';

// The incident this guards: a friend imported a 165-record list. The first
// thirty rows matched and every row after them was saved as an unmatched
// draft. Two causes, both here: each manual lookup fired the targeted search
// AND the fuzzy search in parallel, so an import spent the 60-per-minute
// Discogs budget in about thirty rows; and once the limiter tripped, a 429
// came back as an empty result, which the importer read as "no such record".

const RESULT = { id: 1, title: 'Kraftwerk - The Mix', format: ['Vinyl'] };

function reply({ status = 200, results = [], remaining = '55' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k === 'X-Discogs-Ratelimit-Remaining' ? remaining : null) },
    json: async () => ({ results }),
  };
}

let calls;
beforeEach(() => {
  process.env.DISCOGS_PERSONAL_ACCESS_TOKEN = 'test-token';
  calls = [];
});
afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(handler) {
  vi.stubGlobal('fetch', async (url) => { calls.push(url); return handler(url); });
}

describe('manual search request budget', () => {
  it('spends one request on a row that matches', async () => {
    stubFetch(() => reply({ results: [RESULT] }));
    const matches = await searchDiscogs({ artist: 'Kraftwerk', title: 'The Mix', manual: true });
    expect(matches).toHaveLength(1);
    expect(calls).toHaveLength(1);
    // The one request is the targeted search, not the fuzzy catch-all.
    expect(calls[0]).toContain('release_title=');
  });

  it('falls back to the fuzzy query only when the targeted search is empty', async () => {
    stubFetch((url) => reply({ results: url.includes('q=') ? [RESULT] : [] }));
    const matches = await searchDiscogs({ artist: 'Kraftwerk', title: 'The Mix', manual: true });
    expect(matches).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('q=');
  });

  it('still runs every strategy in parallel for an image scan', async () => {
    stubFetch(() => reply({ results: [RESULT] }));
    await searchDiscogs({ artist: 'Kraftwerk', title: 'The Mix' });
    expect(calls.length).toBeGreaterThan(1);
  });
});

describe('rate limit is reported, never flattened into "no matches"', () => {
  it('sets meta.rateLimited when Discogs answers 429', async () => {
    stubFetch(() => reply({ status: 429, remaining: '0' }));
    const meta = { rateLimited: false, remaining: null };
    const matches = await searchDiscogs({ artist: 'Kraftwerk', title: 'The Mix', manual: true, meta });
    expect(matches).toEqual([]);
    expect(meta.rateLimited).toBe(true);
  }, 20000);

  it('reports the remaining budget so a long run can pace itself', async () => {
    stubFetch(() => reply({ results: [RESULT], remaining: '7' }));
    const meta = { rateLimited: false, remaining: null };
    await searchDiscogs({ artist: 'Kraftwerk', title: 'The Mix', manual: true, meta });
    expect(meta.remaining).toBe(7);
    expect(meta.rateLimited).toBe(false);
  });

  it('leaves meta alone when it is not asked for', async () => {
    stubFetch(() => reply({ results: [RESULT] }));
    await expect(searchDiscogs({ artist: 'A', title: 'B', manual: true })).resolves.toHaveLength(1);
  });
});
