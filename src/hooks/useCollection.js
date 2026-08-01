import { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { cacheCover, isCachedCover } from '../lib/coverCache';
import { planLoadMerge } from '../lib/collectionMerge';

const STORAGE_KEY = 'vinylvault_collection';
const BACKUP_KEY = 'vinylvault_collection_backup';
const TOMBSTONE_KEY = 'vinylvault_deleted_ids';

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

// Explicit user deletions, remembered so a deleted record is never
// resurrected by the local->cloud merge. Bounded to the most recent 400.
function loadTombstones() {
  try { return new Set(JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '[]')); }
  catch { return new Set(); }
}
function addTombstone(id) {
  try {
    const t = [...loadTombstones(), id].slice(-400);
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(t));
  } catch { /* storage full */ }
}

function recordFromRelease(release, crates) {
  const tags = [
    ...(release.suggestedBoxes || []),
    ...(release.genres || []),
  ].filter((t, i, arr) => arr.indexOf(t) === i);

  return {
    id: crypto.randomUUID(),
    discogsId: release.id || null,
    savedAt: Date.now(),
    artist: release.artist || '',
    title: release.title || '',
    label: release.label || null,
    catalogNumber: release.catalogNumber || null,
    year: release.year || null,
    country: release.country || null,
    format: release.format || null,
    genres: release.genres || [],
    tags,
    identified: release.identified ?? true,
    confidence: release.confidence || 'high',
    source: release.source || 'discogs',
    notes: release.notes || '',
    mediaCondition: release.mediaCondition || '',
    sleeveCondition: release.sleeveCondition || '',
    coverUrl: release.coverUrl || null,
    images: release.images || [],
    tracklist: (release.tracklist || []).map(t => ({
      position: t.position,
      title: t.title,
      duration: t.duration || null,
      bpm: t.bpm || null,
      bpmSource: t.bpmSource || null,
      bpmConfidence: t.bpmConfidence || null,
      key: t.key || null,
      previewUrl: t.previewUrl || null,
      hot: t.hot || false,
    })),
    crates,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET':
      return action.records;
    case 'ADD': {
      const rec = action.record;
      // Record identity is the Discogs release id. Re-scanning the same release
      // updates it in place; a different pressing (different discogsId) is kept
      // separately; and an unidentified record (no discogsId) is ALWAYS treated
      // as new so it can never be merged away. Matching on artist+title was the
      // data-loss bug -- doubles, pressings and blank-field scans all collided.
      const idx = rec.discogsId
        ? state.findIndex(r => r.discogsId && r.discogsId === rec.discogsId)
        : -1;
      if (idx >= 0) {
        const next = [...state];
        const old = state[idx];
        // Merge: keep existing user-assigned crates when re-saving the same record
        const crates = [...new Set([...(old.crates || []), ...(rec.crates || [])])];
        // Spread old first so fields the normaliser doesn't know about
        // (priceData, priceCheckedAt) survive a re-scan.
        next[idx] = { ...old, ...rec, id: old.id, savedAt: Date.now(), crates };
        return next;
      }
      return [rec, ...state];
    }
    case 'REMOVE':
      return state.filter(r => r.id !== action.id);
    case 'UPDATE':
      return state.map(r => r.id === action.id ? { ...r, ...action.patch } : r);
    case 'RENAME_CRATE':
      return state.map(r => ({
        ...r,
        crates: (r.crates || []).map(c => c === action.from ? action.to : c),
      }));
    case 'DELETE_CRATE':
      return state.map(r => ({
        ...r,
        crates: (r.crates || []).filter(c => c !== action.name),
      }));
    case 'BULK_ADD':
      return [...action.records, ...state];
    default:
      return state;
  }
}

// ─── Supabase persistence helpers ─────────────────────────────────────────────

async function dbLoad(userId) {
  const { data, error } = await supabase
    .from('records')
    .select('id, data, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ ...row.data, _dbId: row.id }));
}

async function dbInsert(userId, record) {
  const { data, error } = await supabase
    .from('records')
    .insert({ user_id: userId, data: record })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function dbUpdate(dbId, patch) {
  const { error } = await supabase
    .from('records')
    .update({ data: patch })
    .eq('id', dbId);
  if (error) throw error;
}

async function dbDelete(dbId) {
  const { error } = await supabase
    .from('records')
    .delete()
    .eq('id', dbId);
  if (error) throw error;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCollection(userId = null) {
  const [collection, dispatch] = useReducer(reducer, null, load);
  const useDb = isSupabaseEnabled && !!userId;

  // Track db row IDs keyed by local record id so we can update/delete.
  const dbIds = useRef({});
  // null = dbLoad not yet complete; Set = IDs confirmed in Supabase.
  const [syncedIds, setSyncedIds] = useState(null);
  // True once dbLoad has confirmed the DB has records for this user.
  // Prevents an empty DB response from wiping a non-empty local collection.
  const dbHasData = useRef(false);
  // True once the initial dbLoad+merge has completed; gates the background
  // retry so it can't insert duplicates before dbIds is populated.
  const dbLoadedRef = useRef(false);
  // Mirror of collection so async writers can read the latest state without
  // dispatch-then-read races (needed for partial updates like crate changes).
  const collectionRef = useRef(collection);
  collectionRef.current = collection;

  // Copy a record's cover into Supabase storage and swap coverUrl to the
  // durable URL (keeping the original in sourceCoverUrl). Fire-and-forget;
  // on any failure the record keeps its original hotlinked URL.
  const cacheCoverFor = useCallback(async (record) => {
    if (!useDb || !record?.coverUrl || isCachedCover(record.coverUrl)) return;
    const url = await cacheCover(userId, record.id, record.coverUrl);
    if (!url) return;
    const patch = { coverUrl: url, sourceCoverUrl: record.coverUrl };
    dispatch({ type: 'UPDATE', id: record.id, patch });
    const dbId = dbIds.current[record.id];
    if (dbId) {
      const current = collectionRef.current.find(r => r.id === record.id) || record;
      dbUpdate(dbId, { ...current, ...patch }).catch(() => {});
    }
  }, [useDb, userId]);

  // Load from Supabase when userId arrives or changes.
  // MERGE, never replace: the cloud view and the local view are combined so a
  // record present on this device can only leave the collection via an
  // explicit user delete. This is the invariant that ends the data-loss bugs:
  // previously the load "SET" replaced state with the cloud view, so any
  // record whose insert had failed (e.g. every scan made while the session was
  // expired) was dropped from state -- and the debounced localStorage write
  // then destroyed the only remaining copy.
  useEffect(() => {
    if (!useDb) { dbHasData.current = false; return; }
    dbLoad(userId).then(async rows => {
      // The merge decision is a pure, unit-tested function (collectionMerge.js).
      // Its invariant: local records are NEVER dropped -- whether or not their
      // upload succeeded -- unless the user explicitly deleted them
      // (tombstone). Trade-off, chosen deliberately: a record deleted on
      // another device can reappear here (annoying, recoverable) rather than
      // an unsynced record being destroyed (catastrophic, unrecoverable).
      const plan = planLoadMerge(rows, [...collectionRef.current, ...load()], loadTombstones());
      const dbRecords = plan.records;
      Object.assign(dbIds.current, plan.dbIdMap);
      for (const rowId of plan.spareRowIds) dbDelete(rowId).catch(() => {});

      const confirmed = new Set(Object.keys(plan.dbIdMap));
      // Upload local-only records; a failure leaves the record in state as
      // unsynced (amber badge) and the background retry keeps trying.
      for (const record of plan.toInsert) {
        try {
          const dbId = await dbInsert(userId, record);
          dbIds.current[record.id] = dbId;
          confirmed.add(record.id);
        } catch (e) {
          console.error('Sync pending for', record.artist || '(unidentified)', record.title || '', e);
        }
      }

      // Paranoia snapshot: if this merge would still drop any id present in
      // current state, stash the pre-merge state in a backup key first so a
      // future bug can never destroy the last copy of a collection.
      try {
        const nextIds = new Set(dbRecords.map(r => r.id));
        if (collectionRef.current.some(r => r?.id && !nextIds.has(r.id))) {
          localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: Date.now(), records: collectionRef.current }));
        }
      } catch { /* storage full */ }

      if (dbRecords.length === 0 && !dbHasData.current) return;
      dbHasData.current = dbRecords.length > 0;
      dbLoadedRef.current = true;
      setSyncedIds(confirmed);
      dispatch({ type: 'SET', records: dbRecords });

      // Backfill: migrate a few hotlinked covers into storage per login so
      // existing collections converge without a burst of uploads.
      const uncached = dbRecords
        .filter(r => r.coverUrl && !isCachedCover(r.coverUrl))
        .slice(0, 10);
      for (const r of uncached) await cacheCoverFor(r);
    }).catch(console.error);
  }, [useDb, userId, cacheCoverFor]);

  // Background retry: any record still without a DB row is re-attempted every
  // 25s while logged in. Transient failures -- an expired session mid-scan, a
  // network drop -- become eventual consistency instead of silent loss. Stops
  // at the first failure each tick (if one insert fails, e.g. session dead,
  // the rest will too) and tries again next tick.
  useEffect(() => {
    if (!useDb) return;
    const t = setInterval(async () => {
      if (!dbLoadedRef.current) return;
      const tombstones = loadTombstones();
      const unsynced = collectionRef.current.filter(
        r => r?.id && !dbIds.current[r.id] && !tombstones.has(r.id)
      );
      for (const r of unsynced) {
        try {
          const dbId = await dbInsert(userId, r);
          dbIds.current[r.id] = dbId;
          setSyncedIds(s => new Set([...(s || []), r.id]));
          cacheCoverFor(r);
        } catch { break; }
      }
    }, 25000);
    return () => clearInterval(t);
  }, [useDb, userId, cacheCoverFor]);

  // Always persist to localStorage so logout never destroys local data.
  // Debounced 800ms so rapid state changes (crate edits, BPM updates) don't
  // serialise the whole array on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collection)); }
      catch { /* storage full */ }
    }, 800);
    return () => clearTimeout(t);
  }, [collection]);

  const addRecord = useCallback((release, crates = []) => {
    const record = recordFromRelease(release, crates);
    // Duplicate = same Discogs release. Unidentified records (no discogsId) are
    // never duplicates, so they always insert as a fresh row.
    const existing = record.discogsId
      ? collectionRef.current.find(r => r.discogsId && r.discogsId === record.discogsId)
      : null;
    dispatch({ type: 'ADD', record });
    // Persist a brand-new record to localStorage immediately (the debounced
    // effect could miss it if the app closes/crashes within 800ms).
    if (!existing) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...collectionRef.current])); } catch { /* storage full */ }
    }
    if (!useDb) return Promise.resolve();
    if (existing && dbIds.current[existing.id]) {
      // Duplicate: update the existing DB row instead of creating a ghost second row.
      // Merge crates so existing user assignments survive a re-scan.
      const mergedCrates = [...new Set([...(existing.crates || []), ...(record.crates || [])])];
      return dbUpdate(dbIds.current[existing.id], { ...existing, ...record, id: existing.id, crates: mergedCrates })
        .then(() => { cacheCoverFor({ ...record, id: existing.id }); })
        .catch(console.error);
    }
    return dbInsert(userId, record).then(dbId => {
      dbIds.current[record.id] = dbId;
      setSyncedIds(s => s ? new Set([...s, record.id]) : new Set([record.id]));
      cacheCoverFor(record);
    }).catch(e => {
      // Insert failed (dead session, offline): the record stays in state and
      // localStorage as unsynced; the background retry will land it later.
      console.error('Sync pending for', record.artist || '(unidentified)', e);
    });
  }, [useDb, userId, cacheCoverFor]);

  const removeRecord = useCallback((id) => {
    dispatch({ type: 'REMOVE', id });
    // Tombstone the explicit delete so the local->cloud merge never
    // resurrects it.
    addTombstone(id);
    if (!useDb) return;
    if (dbIds.current[id]) {
      dbDelete(dbIds.current[id]).catch(console.error);
      delete dbIds.current[id];
    } else {
      // Fallback: dbIds mapping is missing (race or ghost row). Delete by the
      // local id stored inside the data jsonb column so nothing is left behind.
      supabase
        .from('records')
        .delete()
        .eq('user_id', userId)
        .filter('data->>id', 'eq', id)
        .then(({ error }) => { if (error) console.error(error); })
        .catch(console.error);
    }
  }, [useDb, userId]);

  const updateRecord = useCallback((id, patch) => {
    dispatch({ type: 'UPDATE', id, patch });
    if (useDb && dbIds.current[id]) {
      const dbId = dbIds.current[id];
      // dbUpdate replaces the whole jsonb `data` column, so we must send the
      // FULL merged record. Compute it from the latest known state to avoid
      // wiping fields not included in the patch.
      const current = collectionRef.current.find(r => r.id === id) || {};
      const merged = { ...current, ...patch };
      dbUpdate(dbId, merged).catch(console.error);
    }
  }, [useDb]);

  const renameCrate = useCallback((from, to) => {
    dispatch({ type: 'RENAME_CRATE', from, to });
    if (!useDb) return;
    collectionRef.current
      .filter(r => (r.crates || []).includes(from))
      .forEach(r => {
        const dbId = dbIds.current[r.id];
        if (!dbId) return;
        const merged = { ...r, crates: r.crates.map(c => c === from ? to : c) };
        dbUpdate(dbId, merged).catch(console.error);
      });
  }, [useDb]);

  const deleteCrate = useCallback((name) => {
    dispatch({ type: 'DELETE_CRATE', name });
    if (!useDb) return;
    collectionRef.current
      .filter(r => (r.crates || []).includes(name))
      .forEach(r => {
        const dbId = dbIds.current[r.id];
        if (!dbId) return;
        const merged = { ...r, crates: r.crates.filter(c => c !== name) };
        dbUpdate(dbId, merged).catch(console.error);
      });
  }, [useDb]);

  const addRecordsBulk = useCallback(async (releases) => {
    const existing = collectionRef.current;
    // Skip only genuine duplicates -- same Discogs release id, whether already
    // in the collection or earlier in this same batch. Records without a
    // discogsId (unidentified) are always kept: they must never be dropped as
    // "duplicates" just because they share a blank artist/title.
    const seenDiscogs = new Set(existing.map(e => e.discogsId).filter(Boolean));
    const newRecords = [];
    for (const release of releases) {
      const r = recordFromRelease(release, []);
      if (r.discogsId && seenDiscogs.has(r.discogsId)) continue;
      if (r.discogsId) seenDiscogs.add(r.discogsId);
      newRecords.push(r);
    }
    if (newRecords.length > 0) {
      dispatch({ type: 'BULK_ADD', records: newRecords });
      // Persist immediately (the effect that writes localStorage is debounced
      // 800ms; a crash inside that window after a batch scan would otherwise
      // lose freshly-added records that also hadn't reached Supabase yet).
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...newRecords, ...existing])); } catch { /* storage full */ }
      if (useDb) {
        try {
          const { data, error } = await supabase
            .from('records')
            .insert(newRecords.map(r => ({ user_id: userId, data: r })))
            .select('id');
          if (!error && data) {
            data.forEach((row, i) => {
              if (newRecords[i]) dbIds.current[newRecords[i].id] = row.id;
            });
            setSyncedIds(s => {
              const next = new Set(s || []);
              newRecords.forEach(r => next.add(r.id));
              return next;
            });
            // Cache covers sequentially in the background to avoid a burst of
            // parallel proxy fetches and storage uploads after a batch scan.
            (async () => {
              for (const r of newRecords) await cacheCoverFor(r);
            })();
          }
        } catch (e) {
          console.error('Bulk insert error', e);
        }
      }
    }
    return { added: newRecords.length, skipped: releases.length - newRecords.length };
  }, [useDb, userId, cacheCoverFor]);

  return {
    collection,
    syncedIds,
    addRecord,
    removeRecord,
    updateRecord,
    renameCrate,
    deleteCrate,
    addRecordsBulk,
  };
}

export function exportCSV(collection) {
  const cols = ['Artist','Title','Label','Cat#','Year','Country','Format','Genres','Crates','BPM','Key','Vinyl Condition','Sleeve Condition','Added'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = collection.map(r => {
    const t = r.tracklist?.[0];
    return [
      r.artist, r.title, r.label, r.catalogNumber, r.year,
      r.country, r.format,
      (r.genres || []).join('; '),
      (r.crates || []).join('; '),
      t?.bpm ?? '', t?.key ?? '',
      r.mediaCondition ?? '', r.sleeveCondition ?? '',
      new Date(r.savedAt).toISOString().slice(0, 10),
    ].map(esc).join(',');
  });
  return [cols.join(','), ...rows].join('\n');
}
