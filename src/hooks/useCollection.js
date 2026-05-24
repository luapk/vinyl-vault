import { useReducer, useEffect, useCallback, useRef, useState } from 'react';
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
        crates: (r.crates || []).map(c => c === action.from ? action.to : c),
      }));
    case 'DELETE_CRATE':
      return state.map(r => ({
        ...r,
        crates: (r.crates || []).filter(c => c !== action.name),
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
  // null = dbLoad not yet complete; Set = IDs confirmed in Supabase.
  const [syncedIds, setSyncedIds] = useState(null);
  // True once dbLoad has confirmed the DB has records for this user.
  // Prevents an empty DB response from wiping a non-empty local collection.
  const dbHasData = useRef(false);
  // Mirror of collection so async writers can read the latest state without
  // dispatch-then-read races (needed for partial updates like crate changes).
  const collectionRef = useRef(collection);
  collectionRef.current = collection;

  // Load from Supabase when userId arrives or changes.
  // Also migrates any localStorage-only records into Supabase so all devices stay in sync.
  useEffect(() => {
    if (!useDb) { dbHasData.current = false; return; }
    dbLoad(userId).then(async records => {
      records.forEach(r => { if (r._dbId) dbIds.current[r.id] = r._dbId; });
      const dbRecords = records.map(r => { const c = { ...r }; delete c._dbId; return c; });
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
    }).catch(console.error);
  }, [useDb, userId]);

  // Always persist to localStorage so logout never destroys local data.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collection)); }
    catch { /* storage full */ }
  }, [collection]);

  const addRecord = useCallback((release, crates = []) => {
    const record = recordFromRelease(release, crates);
    dispatch({ type: 'ADD', record });
    if (useDb) {
      return dbInsert(userId, record).then(dbId => {
        dbIds.current[record.id] = dbId;
        setSyncedIds(s => s ? new Set([...s, record.id]) : new Set([record.id]));
      });
    }
    return Promise.resolve();
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

  return {
    collection,
    syncedIds,
    addRecord,
    removeRecord,
    updateRecord,
    renameCrate,
    deleteCrate,
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
