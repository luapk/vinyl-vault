import { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { cacheCover, isCachedCover } from '../lib/coverCache';

const STORAGE_KEY = 'vinylvault_collection';

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
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
      const idx = state.findIndex(
        r => r.artist === action.record.artist && r.title === action.record.title
      );
      if (idx >= 0) {
        const next = [...state];
        const old = state[idx];
        // Merge: keep existing user-assigned crates when re-saving the same record
        const crates = [...new Set([...(old.crates || []), ...(action.record.crates || [])])];
        next[idx] = { ...action.record, id: old.id, savedAt: Date.now(), crates };
        return next;
      }
      return [action.record, ...state];
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

function localNormalizeKey(artist, title) {
  return `${artist}${title}`.toLowerCase().replace(/[^a-z0-9]/g, '');
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
  // Also migrates any localStorage-only records into Supabase so all devices stay in sync.
  useEffect(() => {
    if (!useDb) { dbHasData.current = false; return; }
    dbLoad(userId).then(async records => {
      records.forEach(r => { if (r._dbId) dbIds.current[r.id] = r._dbId; });
      const rawRecords = records.map(r => { const c = { ...r }; delete c._dbId; return c; });

      // Deduplicate by artist+title, keeping the newest copy and deleting orphan rows.
      // Ghost rows are created when a record is re-scanned (addRecord previously inserted
      // a new DB row on every scan, even for records already in the collection).
      const seen = new Map();
      for (const r of rawRecords) {
        const key = `${r.artist}|||${r.title}`;
        const prev = seen.get(key);
        if (prev) {
          const dropOld = (r.savedAt || 0) >= (prev.savedAt || 0);
          const orphan = dropOld ? prev : r;
          const orphanDbId = dbIds.current[orphan.id];
          if (orphanDbId) {
            dbDelete(orphanDbId).catch(() => {});
            delete dbIds.current[orphan.id];
          }
          if (dropOld) seen.set(key, r);
        } else {
          seen.set(key, r);
        }
      }
      const dbRecords = [...seen.values()];
      const confirmed = new Set(dbRecords.map(r => r.id));

      // Push localStorage records that are not yet in Supabase into the DB.
      const local = load();
      if (local.length > 0) {
        const dbKeys = new Set(dbRecords.map(r => `${r.artist}|||${r.title}`));
        for (const record of local) {
          if (!dbKeys.has(`${record.artist}|||${record.title}`)) {
            try {
              const dbId = await dbInsert(userId, record);
              dbIds.current[record.id] = dbId;
              dbRecords.unshift(record);
              confirmed.add(record.id);
            } catch (e) {
              console.error('Migration failed for record', record.artist, record.title, e);
            }
          }
        }
      }

      if (dbRecords.length === 0 && !dbHasData.current) return;
      dbHasData.current = dbRecords.length > 0;
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
    // Check for a duplicate before dispatching so we can decide insert vs update.
    const existing = collectionRef.current.find(
      r => r.artist === record.artist && r.title === record.title
    );
    dispatch({ type: 'ADD', record });
    if (!useDb) return Promise.resolve();
    if (existing && dbIds.current[existing.id]) {
      // Duplicate: update the existing DB row instead of creating a ghost second row.
      // Merge crates so existing user assignments survive a re-scan.
      const mergedCrates = [...new Set([...(existing.crates || []), ...(record.crates || [])])];
      return dbUpdate(dbIds.current[existing.id], { ...record, id: existing.id, crates: mergedCrates })
        .then(() => { cacheCoverFor({ ...record, id: existing.id }); })
        .catch(console.error);
    }
    return dbInsert(userId, record).then(dbId => {
      dbIds.current[record.id] = dbId;
      setSyncedIds(s => s ? new Set([...s, record.id]) : new Set([record.id]));
      cacheCoverFor(record);
    });
  }, [useDb, userId, cacheCoverFor]);

  const removeRecord = useCallback((id) => {
    dispatch({ type: 'REMOVE', id });
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
    const newRecords = [];
    for (const release of releases) {
      const r = recordFromRelease(release, []);
      const isDupe = existing.some(
        e =>
          (r.discogsId && e.discogsId === r.discogsId) ||
          localNormalizeKey(r.artist, r.title) === localNormalizeKey(e.artist, e.title)
      );
      if (!isDupe) newRecords.push(r);
    }
    if (newRecords.length > 0) {
      dispatch({ type: 'BULK_ADD', records: newRecords });
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
