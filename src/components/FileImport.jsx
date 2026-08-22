// The CSV / text file import: one list of records in, matched releases out.
//
// Extracted so the Import card on the home screen and the Import section in
// the account panel run the same code. Two copies of a rate-limited,
// duplicate-aware import loop would be two sets of rules to keep in step.
import { useState, useRef, useEffect } from 'react';
import { Check } from '@phosphor-icons/react';
import { parseImportRows, IMPORT_ROW_CAP } from '../lib/importParse.js';

// Live per-row status list for the file import: a green tick lands on each
// row as it is saved; drafts and skipped duplicates are labelled inline.
function ImportStatusList({ items, listRef }) {
  const statusIcon = (s) => {
    if (s === 'added') return <Check size={13} weight="bold" style={{ color: 'rgb(74,222,128)' }} />;
    if (s === 'draft') return <Check size={13} weight="bold" style={{ color: 'rgba(240,190,80,0.9)' }} />;
    if (s === 'skipped') return <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.3)', lineHeight: 1 }}>--</span>;
    if (s === 'searching') return <div className="animate-spin" style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid rgba(var(--fg),0.12)', borderTopColor: 'rgba(var(--fg),0.5)' }} />;
    return <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid rgba(var(--fg),0.12)', display: 'inline-block' }} />;
  };
  return (
    <div ref={listRef} style={{ maxHeight: 210, overflowY: 'auto', borderRadius: 10, border: '1px solid rgba(var(--fg),0.08)', background: 'rgba(var(--fg),0.03)', padding: '7px 12px', marginBottom: 10 }}>
      {items.map((it, i) => (
        <div key={i} data-active={it.status === 'searching' ? '1' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '3px 0', minWidth: 0 }}>
          <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{statusIcon(it.status)}</span>
          <span style={{ fontSize: 13, fontFamily: 'monospace', color: it.status === 'skipped' ? 'rgba(var(--fg),0.3)' : 'rgba(var(--fg),0.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
            {it.artist ? `${it.artist} - ${it.title}` : (it.title || '(untitled)')}
          </span>
          {it.status === 'draft' && (
            <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'monospace', color: 'rgba(240,190,80,0.75)', flexShrink: 0 }}>draft</span>
          )}
          {it.status === 'skipped' && (
            <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'monospace', color: 'rgba(var(--fg),0.3)', flexShrink: 0 }}>duplicate</span>
          )}
        </div>
      ))}
    </div>
  );
}

export { ImportStatusList };

// Owns the whole import: parsing, the Discogs fan-out, per-row status, and
// the final tally. The caller supplies onAddRecordsBulk and renders whatever
// UI it likes around these values.
export function useFileImport(onAddRecordsBulk) {
  // File import (CSV / text) state
  const [fileImporting, setFileImporting] = useState(false);
  const [fileProgress, setFileProgress] = useState({ done: 0, total: 0, matched: 0 });
  const [fileResult, setFileResult] = useState(null);
  const [fileError, setFileError] = useState('');
  // Per-row live status: 'pending' | 'searching' | 'added' | 'draft' | 'skipped'
  const [fileItems, setFileItems] = useState([]);
  const cancelFileImport = useRef(false);
  const importFileRef = useRef(null);
  const importListRef = useRef(null);

  // Keep the row currently being processed visible in the scrolling list.
  useEffect(() => {
    const active = importListRef.current?.querySelector('[data-active="1"]');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [fileProgress.done]);

  function resetFileImport() {
    setFileResult(null);
    setFileItems([]);
    setFileError('');
  }

  // Resolve each parsed row against Discogs (vinyl-only search) and bulk-add.
  // Maximum-recall policy: a row is NEVER dropped. Best match wins (preferring
  // one with cover art); a row with no match is still added as a draft record
  // (identified: false) carrying the artist/title, which the user fine-tunes
  // via Re-identify in the record detail panel. Matched rows use source
  // 'discogs_import' so the existing lazy enrichment pulls their tracklist on
  // first open.
  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || fileImporting) return;
    let rows, overflow = 0;
    try {
      // Parse everything, then apply the cap here so the count left behind is
      // known and can be reported. Silently truncating is how a 900-record
      // file used to look like a 500-record one that had finished.
      const all = parseImportRows(await file.text(), Infinity);
      rows = all.slice(0, IMPORT_ROW_CAP);
      overflow = all.length - rows.length;
    } catch {
      setFileError('Could not read that file.');
      return;
    }
    if (!rows.length) {
      setFileError('No records found. Use CSV columns like artist,title or lines like "Artist - Title".');
      return;
    }
    cancelFileImport.current = false;
    setFileImporting(true);
    setFileError('');
    setFileResult(null);
    setFileItems(rows.map(r => ({ artist: r.artist, title: r.title, status: 'pending' })));
    setFileProgress({ done: 0, total: rows.length, matched: 0 });

    const setItemStatus = (idx, status) => setFileItems(prev => {
      const next = [...prev];
      if (next[idx]) next[idx] = { ...next[idx], status };
      return next;
    });

    let matched = 0, drafts = 0, added = 0, skipped = 0, stopped = false;
    for (let i = 0; i < rows.length; i++) {
      if (cancelFileImport.current) { stopped = true; break; }
      const row = rows[i];
      setItemStatus(i, 'searching');
      let release = null;
      try {
        const res = await fetch('/api/discogs-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artist: row.artist, title: row.title }),
        });
        const data = await res.json();
        const m = (data.matches || []).find(x => x.coverUrl) || (data.matches || [])[0];
        if (m) {
          matched++;
          release = {
            id: m.id, artist: m.artist || row.artist, title: m.recordTitle || row.title,
            label: m.label, catalogNumber: m.catalogNumber, year: m.year,
            country: m.country, format: m.format, genres: [], tracklist: [],
            coverUrl: m.coverUrl, source: 'discogs_import',
          };
        }
      } catch { /* network hiccup: fall through to draft */ }
      const isDraft = !release;
      if (isDraft) {
        drafts++;
        release = {
          id: null, artist: row.artist, title: row.title || '(untitled)',
          genres: [], tracklist: [], coverUrl: null,
          identified: false, confidence: 'low', source: 'file_import',
        };
      }
      // Add one row at a time so each tick in the list reflects a record that
      // is genuinely saved (and so duplicates are flagged on the right row).
      const res = await onAddRecordsBulk([release]);
      added += res.added;
      skipped += res.skipped;
      setItemStatus(i, res.skipped ? 'skipped' : (isDraft ? 'draft' : 'added'));
      setFileProgress({ done: i + 1, total: rows.length, matched });
      // Pace the Discogs fan-out to stay inside the shared rate limit.
      if (i < rows.length - 1) await new Promise(r => setTimeout(r, 650));
    }
    setFileResult({ added, skipped, matched, drafts, stopped, overflow });
    setFileImporting(false);
  }

  return {
    fileImporting, fileProgress, fileResult, fileError, fileItems,
    cancelFileImport, importFileRef, importListRef,
    resetFileImport, handleImportFile,
  };
}
