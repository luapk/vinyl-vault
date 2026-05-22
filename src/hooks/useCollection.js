import { useReducer, useEffect } from 'react';

const STORAGE_KEY = 'vinylvault_collection';

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function recordFromRelease(release, crates) {
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
    suggestedBoxes: release.suggestedBoxes || [],
    crates,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'ADD': {
      // Replace existing record with same artist+title, otherwise prepend
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
    case 'UPDATE': {
      return state.map(r => r.id === action.id ? { ...r, ...action.patch } : r);
    }
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

export function useCollection() {
  const [collection, dispatch] = useReducer(reducer, null, load);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collection)); }
    catch { /* storage full */ }
  }, [collection]);

  return {
    collection,
    addRecord: (release, crates = []) =>
      dispatch({ type: 'ADD', record: recordFromRelease(release, crates) }),
    removeRecord: (id) => dispatch({ type: 'REMOVE', id }),
    updateRecord: (id, patch) => dispatch({ type: 'UPDATE', id, patch }),
    renameCrate: (from, to) => dispatch({ type: 'RENAME_CRATE', from, to }),
    deleteCrate: (name) => dispatch({ type: 'DELETE_CRATE', name }),
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
