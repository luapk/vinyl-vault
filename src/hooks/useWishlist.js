import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseEnabled } from '../lib/supabase.js';
import { safeSetItem } from '../lib/localCache.js';
import { freshAccessToken } from '../lib/authToken.js';

// Wishlist state: the records a user wants, and the stored result of the last
// hunt against each one.
//
// Simpler than useCollection on purpose. A wishlist is tens of rows, not
// thousands, and every one of them is about something that is happening online
// right now, so there is nothing to gain from the full offline merge machinery.
// What it does keep is the two rules that matter from that file:
//
//   1. Every local key is scoped to the signed-in user id. A shared browser
//      must never show the previous account's wants to whoever signs in next.
//   2. The cache renders before the cloud load lands, so the tab is never a
//      spinner on a warm start.
//
// Until supabase/wishlist.sql has been run the tables do not exist. Every call
// here degrades to local-only rather than throwing, which is the same posture
// the file import takes towards its own migration: a missing migration costs
// sync, never the screen.

const key = (uid) => `vinylvault_wishlist:${uid}`;
const traceKey = (uid) => `vinylvault_traces:${uid}`;

function readCache(k) {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Postgres reports a missing table as 42P01. That is the migration not being
// run, which is a normal state for this feature, not an error to surface.
const isMissingTable = (error) => error?.code === '42P01';

export function useWishlist(userId) {
  const [items, setItems] = useState([]);
  const [traces, setTraces] = useState({});   // itemId -> payload
  const [loading, setLoading] = useState(true);
  const [tracing, setTracing] = useState({}); // itemId -> true while a hunt runs
  const [syncOff, setSyncOff] = useState(false);
  const userRef = useRef(userId);
  userRef.current = userId;

  // ---- local cache ---------------------------------------------------------
  const cacheItems = useCallback((next) => {
    if (!userRef.current) return;
    safeSetItem(localStorage, key(userRef.current), JSON.stringify(next));
  }, []);

  const cacheTraces = useCallback((next) => {
    if (!userRef.current) return;
    safeSetItem(localStorage, traceKey(userRef.current), JSON.stringify(next));
  }, []);

  // ---- load ----------------------------------------------------------------
  useEffect(() => {
    if (!userId) { setItems([]); setTraces({}); setLoading(false); return; }

    // Render the cache first so the tab has content immediately.
    const cachedItems = readCache(key(userId));
    if (Array.isArray(cachedItems)) setItems(cachedItems);
    const cachedTraces = readCache(traceKey(userId));
    if (cachedTraces && typeof cachedTraces === 'object') setTraces(cachedTraces);

    let cancelled = false;
    (async () => {
      if (!isSupabaseEnabled) { setLoading(false); return; }
      const [{ data: rows, error }, { data: results }] = await Promise.all([
        supabase.from('wishlist_items').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('trace_results').select('item_id, payload, checked_at').eq('user_id', userId),
      ]);
      if (cancelled) return;

      if (error) {
        if (isMissingTable(error)) setSyncOff(true);
        else console.log('[wishlist] load failed:', error.message);
        setLoading(false);
        return;
      }

      // Merge, never replace. A card added while the insert was failing (offline,
      // or the migration not run yet) exists only in the cache, and an empty or
      // partial cloud result would silently delete it -- the same no-data-loss
      // rule the collection merge follows. Cloud wins for rows it has; anything
      // local it does not know about is kept and stays flagged as unsynced.
      const cloud = (rows || []).map(fromRow);
      const cloudIds = new Set(cloud.map(i => i.id));
      const localOnly = (Array.isArray(cachedItems) ? cachedItems : [])
        .filter(i => i && i.id && !cloudIds.has(i.id))
        .map(i => ({ ...i, pending: true }));
      const mapped = [...cloud, ...localOnly];
      setItems(mapped);
      cacheItems(mapped);

      // Results merge on the same rule as the items above, and for the same
      // reason: a result the server never stored (the migration is not run, or
      // the write failed) lives only in the cache, and replacing wholesale
      // would throw away the answer the user is looking at every time they
      // reload. Cloud wins per item; anything only local survives.
      const byItem = { ...(cachedTraces && typeof cachedTraces === 'object' ? cachedTraces : {}) };
      for (const r of results || []) byItem[r.item_id] = r.payload;
      setTraces(byItem);
      cacheTraces(byItem);
      setLoading(false);
    })().catch(() => setLoading(false));

    return () => { cancelled = true; };
  }, [userId, cacheItems, cacheTraces]);

  // ---- add -----------------------------------------------------------------
  const addItem = useCallback(async (candidate, rawQuery = '') => {
    const uid = userRef.current;
    if (!uid) return null;

    // Same record twice is a mistake, not an intent. Identity is the Discogs
    // release id; an unresolved card has none and so can legitimately repeat.
    if (candidate.id) {
      const existing = items.find(i => i.releaseId && String(i.releaseId) === String(candidate.id));
      if (existing) return existing;
    }

    const optimistic = {
      id: crypto.randomUUID(),
      releaseId: candidate.id ? String(candidate.id) : null,
      rawQuery,
      artist: candidate.artist || '',
      title: candidate.title || '',
      label: candidate.label || null,
      catNo: candidate.catalogNumber || candidate.catNo || null,
      year: candidate.year || null,
      country: candidate.country || null,
      format: candidate.format || null,
      coverUrl: candidate.thumb || candidate.coverUrl || null,
      note: null,
      category: 'want',
      createdAt: new Date().toISOString(),
      pending: true,
    };

    setItems(prev => { const next = [optimistic, ...prev]; cacheItems(next); return next; });

    if (!isSupabaseEnabled || syncOff) return optimistic;

    const { data, error } = await supabase.from('wishlist_items').insert(toRow(optimistic, uid)).select().single();
    if (error) {
      if (isMissingTable(error)) setSyncOff(true);
      else console.log('[wishlist] insert failed:', error.message);
      // The card stays. It is on this device and in the cache; it just has not
      // synced, which is a smaller problem than losing what the user typed.
      return optimistic;
    }
    const saved = fromRow(data);
    setItems(prev => { const next = prev.map(i => (i.id === optimistic.id ? saved : i)); cacheItems(next); return next; });
    return saved;
  }, [items, cacheItems, syncOff]);

  // ---- remove --------------------------------------------------------------
  const removeItem = useCallback(async (itemId) => {
    setItems(prev => { const next = prev.filter(i => i.id !== itemId); cacheItems(next); return next; });
    setTraces(prev => { const next = { ...prev }; delete next[itemId]; cacheTraces(next); return next; });
    if (!isSupabaseEnabled || syncOff) return;
    const { error } = await supabase.from('wishlist_items').delete().eq('id', itemId);
    if (error && !isMissingTable(error)) console.log('[wishlist] delete failed:', error.message);
  }, [cacheItems, cacheTraces, syncOff]);

  const updateItem = useCallback(async (itemId, patch) => {
    setItems(prev => { const next = prev.map(i => (i.id === itemId ? { ...i, ...patch } : i)); cacheItems(next); return next; });
    if (!isSupabaseEnabled || syncOff) return;
    const row = {};
    if (patch.note !== undefined) row.note = patch.note;
    if (patch.category !== undefined) row.category = patch.category;
    if (!Object.keys(row).length) return;
    const { error } = await supabase.from('wishlist_items').update(row).eq('id', itemId);
    if (error && !isMissingTable(error)) console.log('[wishlist] update failed:', error.message);
  }, [cacheItems, syncOff]);

  // ---- trace ---------------------------------------------------------------
  const runTrace = useCallback(async (item, accessToken) => {
    if (!item?.releaseId) {
      return { error: 'This card has not been matched to a release yet, so there is nothing to trace.' };
    }
    setTracing(prev => ({ ...prev, [item.id]: true }));
    try {
      const token = await freshAccessToken(accessToken);
      const res = await fetch('/api/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId: item.pending ? null : item.id, releaseId: item.releaseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) return { locked: true, error: data.error || 'trace_requires_resident' };
      if (!res.ok) return { error: data.error || `Trace failed (${res.status}).` };

      setTraces(prev => { const next = { ...prev, [item.id]: data }; cacheTraces(next); return next; });
      return { payload: data };
    } catch (err) {
      return { error: err.message || 'Could not reach the server.' };
    } finally {
      setTracing(prev => { const next = { ...prev }; delete next[item.id]; return next; });
    }
  }, [cacheTraces]);

  const clearTrace = useCallback(async (itemId) => {
    setTraces(prev => { const next = { ...prev }; delete next[itemId]; cacheTraces(next); return next; });
    if (!isSupabaseEnabled || syncOff) return;
    const { error } = await supabase.from('trace_results').delete().eq('item_id', itemId);
    if (error && !isMissingTable(error)) console.log('[wishlist] clear trace failed:', error.message);
  }, [cacheTraces, syncOff]);

  return { items, traces, tracing, loading, syncOff, addItem, removeItem, updateItem, runTrace, clearTrace };
}

// ---- row mapping -----------------------------------------------------------
// Whitelisted both ways, for the same reason recordFromRelease is: a field that
// exists on one side and not the other disappears silently on the round trip.
function fromRow(r) {
  return {
    id: r.id,
    releaseId: r.release_id ? String(r.release_id) : null,
    rawQuery: r.raw_query || '',
    artist: r.artist || '',
    title: r.title || '',
    label: r.label || null,
    catNo: r.cat_no || null,
    year: r.year || null,
    country: r.country || null,
    format: r.format || null,
    coverUrl: r.cover_url || null,
    note: r.note || null,
    category: r.category || 'want',
    createdAt: r.created_at,
  };
}

function toRow(i, userId) {
  return {
    id: i.id,
    user_id: userId,
    release_id: i.releaseId ? Number(i.releaseId) : null,
    raw_query: i.rawQuery || null,
    artist: i.artist || null,
    title: i.title || null,
    label: i.label,
    cat_no: i.catNo,
    year: i.year,
    country: i.country,
    format: i.format,
    cover_url: i.coverUrl,
    note: i.note,
    category: i.category || 'want',
  };
}
