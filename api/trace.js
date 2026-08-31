// POST /api/trace  { itemId, releaseId }
//
// Runs one hunt and stores the result against the caller's wishlist item, so
// coming back to the tab shows the answer rather than paying for it twice.
//
// Auth is mandatory and it is not decoration: this endpoint spends the shared
// Discogs rate limit, three or four requests at a time. Left open it would be
// the cheapest way for anyone to exhaust the budget that every user's scanning
// depends on.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth.js';
import { requireTier } from './lib/tier.js';
import { runTrace } from './lib/trace.js';

let cachedAdmin = null;
function admin() {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  return cachedAdmin;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  if (!process.env.DISCOGS_PERSONAL_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'Discogs not configured' });
  }

  const { itemId, releaseId } = req.body || {};
  if (!releaseId) return res.status(400).json({ error: 'releaseId required' });

  const db = admin();

  // Resident only, checked before any Discogs quota is spent. The tier map is
  // shared with the client so the button and the endpoint agree.
  if (!await requireTier('trace', authUser.id, res)) return;

  // If an itemId is given it must belong to the caller. Without this check any
  // signed-in user could write a trace result onto somebody else's wishlist row.
  let ownedItemId = null;
  if (itemId) {
    const { data: item } = await db
      .from('wishlist_items')
      .select('id')
      .eq('id', itemId)
      .eq('user_id', authUser.id)
      .maybeSingle();
    if (!item) return res.status(404).json({ error: 'Wishlist item not found' });
    ownedItemId = item.id;
  }

  let payload;
  try {
    payload = await runTrace(releaseId);
  } catch (err) {
    const msg = String(err?.message || '');
    // A rate limit is not a verdict about the record. Say so, and let the
    // client offer a retry rather than storing an empty result that would then
    // read as "nothing found".
    if (/429|rate limit/i.test(msg)) {
      return res.status(429).json({ error: 'Discogs is rate limiting right now. Try again in a minute.' });
    }
    console.log(`[trace] release ${releaseId} failed: ${msg}`);
    return res.status(502).json({ error: 'Could not reach Discogs for that release.' });
  }

  // Persist only when the hunt was for a real wishlist row. A trace fired
  // without one still returns, it just is not stored.
  if (ownedItemId) {
    const { error } = await db.from('trace_results').upsert({
      item_id: ownedItemId,
      user_id: authUser.id,
      release_id: Number(releaseId) || null,
      payload,
      checked_at: payload.checkedAt,
    }, { onConflict: 'item_id' });
    // A failed write costs the user a re-trace, not the result they are
    // looking at, so it is logged and swallowed rather than thrown.
    if (error) console.log(`[trace] store failed for item ${ownedItemId}: ${error.message}`);
  }

  return res.status(200).json(payload);
}
