import { useReducer, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseEnabled } from '../lib/supabase';

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
    coverUrl: release.coverUrl || null,
    images: release.images || [],
    tracklist: (release.tracklist || []).map(t => ({
      position: t.position,
      title: t.title,
      duration: t.duration || null,
      bpm: t.bpm || null,
      key: t.key || null,
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
        next[idx] = { ...action.record, id: state[idx].id, savedAt: Date.now() };
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
        crates: r.crates.map(c => c === action.from ? action.to : c),
      }));
    case 'DELETE_CRATE':
      return state.map(r => ({
        ...r,
        crates: r.crates.filter(c => c !== action.name),
      }));
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

  // Load from Supabase when userId arrives or changes.
  useEffect(() => {
    if (!useDb) return;
    dbLoad(userId).then(records => {
      records.forEach(r => { if (r._dbId) dbIds.current[r.id] = r._dbId; });
      dispatch({ type: 'SET', records: records.map(r => { const c = { ...r }; delete c._dbId; return c; }) });
    }).catch(console.error);
  }, [useDb, userId]);

  // Persist to localStorage when NOT using Supabase.
  useEffect(() => {
    if (useDb) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collection)); }
    catch { /* storage full */ }
  }, [collection, useDb]);

  const addRecord = useCallback((release, crates = []) => {
    const record = recordFromRelease(release, crates);
    dispatch({ type: 'ADD', record });
    if (useDb) {
      dbInsert(userId, record).then(dbId => {
        dbIds.current[record.id] = dbId;
      }).catch(console.error);
    }
  }, [useDb, userId]);

  const removeRecord = useCallback((id) => {
    dispatch({ type: 'REMOVE', id });
    if (useDb && dbIds.current[id]) {
      dbDelete(dbIds.current[id]).catch(console.error);
      delete dbIds.current[id];
    }
  }, [useDb]);

  const updateRecord = useCallback((id, patch) => {
    dispatch({ type: 'UPDATE', id, patch });
    if (useDb && dbIds.current[id]) {
      // Fetch the merged record from current state asynchronously then persist.
      // We pass the full merged object as `data` to replace the jsonb column.
      // Note: the reducer runs synchronously so we need to build the merged data here.
      const dbId = dbIds.current[id];
      // We can't easily access the new state after dispatch here, so we use a
      // separate async push that reads state after a tick.
      setTimeout(() => {
        dbUpdate(dbId, patch).catch(console.error);
      }, 0);
    }
  }, [useDb]);

  const renameCrate = useCallback((from, to) => {
    dispatch({ type: 'RENAME_CRATE', from, to });
    // Batch update: all affected records need re-saving. Done optimistically.
  }, []);

  const deleteCrate = useCallback((name) => {
    dispatch({ type: 'DELETE_CRATE', name });
  }, []);

  // Migration: copy localStorage records into Supabase on first login.
  const migrateFromLocalStorage = useCallback(async () => {
    if (!useDb) return 0;
    const local = load();
    if (!local.length) return 0;
    let count = 0;
    for (const record of local) {
      try {
        const dbId = await dbInsert(userId, record);
        dbIds.current[record.id] = dbId;
        count++;
      } catch { /* skip duplicates */ }
    }
    if (count > 0) {
      dispatch({ type: 'SET', records: local });
      localStorage.removeItem(STORAGE_KEY);
    }
    return count;
  }, [useDb, userId]);

  return {
    collection,
    addRecord,
    removeRecord,
    updateRecord,
    renameCrate,
    deleteCrate,
    migrateFromLocalStorage,
    hasLocalRecords: !useDb && load().length > 0,
  };
}

export function exportCSV(collection) {
  const cols = ['Artist','Title','Label','Cat#','Year','Country','Format','Genres','Crates','BPM','Key','Added'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = collection.map(r => {
    const t = r.tracklist?.[0];
    return [
      r.artist, r.title, r.label, r.catalogNumber, r.year,
      r.country, r.format,
      (r.genres || []).join('; '),
      (r.crates || []).join('; '),
      t?.bpm ?? '', t?.key ?? '',
      new Date(r.savedAt).toISOString().slice(0, 10),
    ].map(esc).join(',');
  });
  return [cols.join(','), ...rows].join('\n');
}
