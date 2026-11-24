// Fills in genres on records saved before the file import kept them.
//
// For a long time a file import wrote every record with `genres: []`, because
// the search result it saved from was mapped without them. That left 3,204
// records across five accounts with nothing for the Range badges to count,
// two of them the largest collections in the product. The import now keeps
// genres (api/lib/discogs.js), and this drains the ones it missed: one Discogs
// release fetch per record, a small batch per cron tick.
//
// It is the lowest-priority thing that spends Discogs quota, and is built to
// lose every argument about it:
// - the import worker only calls it on a cron tick with no import locked, so
//   a running import always has the budget to itself;
// - it stops at the first 429 and whenever Discogs reports LOW_BUDGET or fewer
//   requests left in the window, leaving those for live scanning;
// - it is paced at one request every GAP_MS, under a third of the limit.
//
// The write is a guarded SQL update (genre_backfill_apply, in
// supabase/genre-backfill.sql) that only lands while the record still has no
// genres, so it can never overwrite genres the user or a scan put there in the
// meantime. A record that comes back from Discogs as gone (404) is marked
// checked with no genres, so it is not asked about again; a transient failure
// is left unmarked and comes round again, and the batch is drawn at random so
// a record that keeps failing cannot hold up the rest.
import { authHeaders } from './discogs.js';

export const BATCH = 30;
export const GAP_MS = 2000;
export const LOW_BUDGET = 15;
const BASE = 'https://api.discogs.com';

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function backfillGenres(db, {
  deadline = Date.now() + 60_000,
  max = BATCH,
  fetchImpl = fetch,
  sleep = defaultSleep,
  headers = null,
} = {}) {
  const { data: rows, error } = await db.rpc('genre_backfill_batch', { p_limit: max });
  // The migration has not been run on this database: nothing to do, and not
  // an error worth a cron alert every two minutes.
  if (error) return { ran: false, reason: 'unavailable', filled: 0, gone: 0 };
  if (!rows?.length) return { ran: true, reason: 'done', filled: 0, gone: 0 };

  const hdrs = headers || authHeaders();

  // One release: { genres } to write (an empty array marks it checked), or
  // { genres: null } to leave it for another tick, plus what Discogs said
  // about the budget.
  const lookup = async (discogsId) => {
    // Not a Discogs release id: nothing will ever answer, so mark it checked.
    if (!/^\d+$/.test(discogsId)) return { genres: [], spent: false };
    let res;
    try {
      res = await fetchImpl(`${BASE}/releases/${discogsId}`, { headers: hdrs, signal: AbortSignal.timeout(6000) });
    } catch {
      return { genres: null };           // timeout or network: try again another tick
    }
    const remaining = Number(res.headers?.get?.('x-discogs-ratelimit-remaining'));
    if (res.status === 429) return { genres: null, limited: true };
    if (res.status === 404) return { genres: [], remaining };
    if (!res.ok) return { genres: null, remaining };
    const j = await res.json().catch(() => null);
    return { genres: j ? [...(j.genres || []), ...(j.styles || [])] : null, remaining };
  };

  let filled = 0, gone = 0, stop = null;
  for (let i = 0; i < rows.length; i++) {
    if (Date.now() > deadline - 8_000) { stop = 'deadline'; break; }
    const row = rows[i];
    const r = await lookup(String(row.discogs_id || ''));
    if (r.limited) { stop = 'ratelimited'; break; }
    if (r.genres !== null) {
      const { data: applied } = await db.rpc('genre_backfill_apply', { p_id: row.id, p_genres: r.genres });
      if (applied) { if (r.genres.length) filled++; else gone++; }
    }
    if (Number.isFinite(r.remaining) && r.remaining <= LOW_BUDGET) { stop = 'low-budget'; break; }
    // Paced per request made, so a row that cost nothing costs no wait.
    if (i < rows.length - 1 && r.spent !== false) await sleep(GAP_MS);
  }
  return { ran: true, reason: stop || 'batch', filled, gone, batch: rows.length };
}
