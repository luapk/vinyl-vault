import { describe, it, expect } from 'vitest';
import { backfillGenres, LOW_BUDGET } from '../genreBackfill.js';

// A db stand-in that records what was written.
function fakeDb(rows, { batchError = null } = {}) {
  const applied = [];
  return {
    applied,
    rpc: async (name, args) => {
      if (name === 'genre_backfill_batch') return batchError ? { error: batchError } : { data: rows };
      if (name === 'genre_backfill_apply') { applied.push(args); return { data: true }; }
      throw new Error(name);
    },
  };
}

const reply = (status, body = {}, remaining = 50) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (h) => (h.toLowerCase() === 'x-discogs-ratelimit-remaining' ? String(remaining) : null) },
  json: async () => body,
});

const opts = (fetchImpl) => ({ fetchImpl, sleep: async () => {}, headers: {}, deadline: Date.now() + 60_000 });

describe('genre backfill', () => {
  it('writes genres and styles together, the same shape a scan saves', async () => {
    const db = fakeDb([{ id: 'a', discogs_id: '1' }]);
    const out = await backfillGenres(db, opts(async () => reply(200, { genres: ['Electronic'], styles: ['Acid House'] })));
    expect(db.applied).toEqual([{ p_id: 'a', p_genres: ['Electronic', 'Acid House'] }]);
    expect(out.filled).toBe(1);
  });

  it('stops at the first 429 and writes nothing for that record', async () => {
    const db = fakeDb([{ id: 'a', discogs_id: '1' }, { id: 'b', discogs_id: '2' }]);
    let calls = 0;
    const out = await backfillGenres(db, opts(async () => { calls++; return reply(429); }));
    expect(calls).toBe(1);
    expect(db.applied).toEqual([]);
    expect(out.reason).toBe('ratelimited');
  });

  it('leaves the rest of the window to live scanning once the budget runs low', async () => {
    const db = fakeDb([{ id: 'a', discogs_id: '1' }, { id: 'b', discogs_id: '2' }]);
    const out = await backfillGenres(db, opts(async () => reply(200, { genres: ['Jazz'] }, LOW_BUDGET)));
    expect(db.applied.length).toBe(1);
    expect(out.reason).toBe('low-budget');
  });

  it('marks a release Discogs no longer has, but leaves a transient failure for another tick', async () => {
    const db = fakeDb([{ id: 'gone', discogs_id: '1' }, { id: 'flaky', discogs_id: '2' }, { id: 'down', discogs_id: '3' }]);
    const answers = [reply(404), reply(502), null];
    const out = await backfillGenres(db, opts(async () => {
      const a = answers.shift();
      if (!a) throw new Error('timeout');
      return a;
    }));
    expect(db.applied).toEqual([{ p_id: 'gone', p_genres: [] }]);
    expect(out.gone).toBe(1);
  });

  it('never fetches an id that is not a Discogs release id', async () => {
    const db = fakeDb([{ id: 'x', discogs_id: 'local-123' }]);
    let calls = 0;
    await backfillGenres(db, opts(async () => { calls++; return reply(200); }));
    expect(calls).toBe(0);
    expect(db.applied).toEqual([{ p_id: 'x', p_genres: [] }]);
  });

  it('does nothing, quietly, on a database without the migration', async () => {
    const db = fakeDb([], { batchError: { message: 'function does not exist' } });
    const out = await backfillGenres(db, opts(async () => { throw new Error('should not fetch'); }));
    expect(out).toMatchObject({ ran: false, reason: 'unavailable' });
  });
});
