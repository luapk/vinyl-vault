// The CSV / text file import: one list of records in, matched releases out.
//
// Extracted so the Import card on the home screen and the Import section in
// the account panel run the same code. Two copies of a rate-limited,
// duplicate-aware import loop would be two sets of rules to keep in step.
import { useState, useRef, useEffect } from 'react';
import { Check } from '@phosphor-icons/react';
import { parseImportRows, IMPORT_ROW_CAP } from '../lib/importParse.js';
import { gapFor, LIMIT_BACKOFF_MS, unmatchedImports } from '../lib/importBudget.js';

// Sleep in slices so cancelling does not have to wait out a 60s backoff.
async function sleep(ms, isCancelled) {
  const step = 400;
  for (let waited = 0; waited < ms; waited += step) {
    if (isCancelled?.()) return;
    await new Promise(r => setTimeout(r, Math.min(step, ms - waited)));
  }
}

// One Discogs lookup, classified. The distinction that matters is 'limited'
// versus 'nomatch': they arrive as the same empty list, and treating the first
// as the second is what filed a whole collection as unidentifiable drafts.
async function lookupRelease({ artist, title }) {
  let res, data;
  try {
    res = await fetch('/api/discogs-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist, title }),
    });
    data = await res.json().catch(() => ({}));
  } catch {
    return { outcome: 'error', remaining: null };
  }
  const remaining = typeof data?.remaining === 'number' ? data.remaining : null;
  if (res.status === 429 || data?.rateLimited) return { outcome: 'limited', remaining };
  if (!res.ok) return { outcome: 'error', remaining };
  const matches = data.matches || [];
  const match = matches.find(x => x.coverUrl) || matches[0];
  return match ? { outcome: 'match', match, remaining } : { outcome: 'nomatch', remaining };
}

// One row, carried all the way to an answer worth saving. A rate limit is
// never an answer: it is waited out and retried. A transient error gets two
// quick retries and then counts as no match, since one bad row is not the
// cascading failure a rate limit is.
async function resolveRow(row, { isCancelled, onWaiting }) {
  let errorTries = 0, limitTries = 0;
  for (;;) {
    if (isCancelled()) return { outcome: 'cancelled', remaining: null };
    const r = await lookupRelease(row);
    if (r.outcome === 'limited') {
      if (limitTries >= LIMIT_BACKOFF_MS.length) return { outcome: 'ratelimited', remaining: 0 };
      const wait = LIMIT_BACKOFF_MS[limitTries++];
      onWaiting?.(wait);
      await sleep(wait, isCancelled);
      continue;
    }
    if (r.outcome === 'error') {
      if (errorTries >= 2) return { outcome: 'nomatch', remaining: r.remaining };
      await sleep(errorTries++ === 0 ? 2000 : 5000, isCancelled);
      continue;
    }
    return r;
  }
}

function releaseFromMatch(m, row) {
  return {
    id: m.id, artist: m.artist || row.artist, title: m.recordTitle || row.title,
    label: m.label, catalogNumber: m.catalogNumber, year: m.year,
    country: m.country, format: m.format, genres: [], tracklist: [],
    coverUrl: m.coverUrl, source: 'discogs_import',
  };
}

// Live per-row status list for the file import: a green tick lands on each
// row as it is saved; drafts and skipped duplicates are labelled inline.
function ImportStatusList({ items, listRef }) {
  const spinner = <div className="animate-spin" style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid rgba(var(--fg),0.12)', borderTopColor: 'rgba(var(--fg),0.5)' }} />;
  const statusIcon = (s) => {
    if (s === 'added') return <Check size={13} weight="bold" style={{ color: 'rgb(74,222,128)' }} />;
    if (s === 'draft') return <Check size={13} weight="bold" style={{ color: 'rgba(240,190,80,0.9)' }} />;
    if (s === 'skipped') return <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.3)', lineHeight: 1 }}>--</span>;
    if (s === 'searching' || s === 'waiting') return spinner;
    return <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid rgba(var(--fg),0.12)', display: 'inline-block' }} />;
  };
  const tag = (text, color) => (
    <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'monospace', color, flexShrink: 0 }}>{text}</span>
  );
  return (
    <div ref={listRef} style={{ maxHeight: 210, overflowY: 'auto', borderRadius: 10, border: '1px solid rgba(var(--fg),0.08)', background: 'rgba(var(--fg),0.03)', padding: '7px 12px', marginBottom: 10 }}>
      {items.map((it, i) => (
        <div key={i} data-active={it.status === 'searching' || it.status === 'waiting' ? '1' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '3px 0', minWidth: 0 }}>
          <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{statusIcon(it.status)}</span>
          <span style={{ fontSize: 13, fontFamily: 'monospace', color: it.status === 'skipped' ? 'rgba(var(--fg),0.3)' : 'rgba(var(--fg),0.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
            {it.artist ? `${it.artist} - ${it.title}` : (it.title || '(untitled)')}
          </span>
          {it.status === 'draft'    && tag('draft', 'rgba(240,190,80,0.75)')}
          {it.status === 'waiting'  && tag('waiting', 'rgba(240,190,80,0.75)')}
          {it.status === 'skipped'  && tag('duplicate', 'rgba(var(--fg),0.3)')}
        </div>
      ))}
    </div>
  );
}

export { ImportStatusList };

// The tally both import panels print when a run finishes. One copy, because
// the two panels have drifted apart before and the numbers are the part a
// user reads most carefully.
function ImportSummary({ result, total }) {
  const line = (color) => ({ fontSize: 14, fontFamily: 'monospace', color, marginBottom: 4 });
  const amber = 'rgba(240,190,80,0.85)';
  const retry = result.mode === 'retry';
  return (
    <>
      <p style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(120,220,140,0.9)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Check size={14} weight="bold" />
        {retry
          ? `Matched ${result.matched} of ${total}`
          : (result.stopped ? `Stopped -- ${result.added} of ${total} added` : `Added ${result.added} record${result.added === 1 ? '' : 's'}`)}
      </p>
      {/* A rate limit is Discogs asking for a minute, not a verdict on the
          records. Say so, and say what to do, rather than leaving a stopped
          run looking like a failed one. */}
      {result.stoppedReason === 'ratelimit' && (
        <p style={line(amber)}>
          Discogs stopped answering (too many lookups at once), so the run
          paused rather than filing the rest as unmatched. Wait a minute and
          {retry ? ' retry again' : ' upload the same file again'}: everything
          already matched is skipped, so it picks up where it left off.
        </p>
      )}
      {!retry && result.drafts > 0 && (
        <p style={line(amber)}>
          {result.drafts} couldn't be matched -- added as drafts. Use Match unmatched
          to look them up again, or open one and use Re-identify to pin the exact release.
        </p>
      )}
      {retry && result.stillUnmatched > 0 && (
        <p style={line(amber)}>
          {result.stillUnmatched} still unmatched. Open one and use Re-identify to
          search by hand.
        </p>
      )}
      {result.skipped > 0 && (
        <p style={line('rgba(var(--fg),0.35)')}>
          {result.skipped} already in your collection -- skipped as duplicates
        </p>
      )}
      {/* Never silent: a file over the cap used to finish looking exactly like
          one that fitted, with the remainder gone. */}
      {result.overflow > 0 && (
        <p style={line(amber)}>
          {result.overflow} more {result.overflow === 1 ? 'record was' : 'records were'} in the file
          but not imported: one file adds up to {IMPORT_ROW_CAP} at a time. Upload the rest in a second file.
        </p>
      )}
    </>
  );
}

export { ImportSummary };

// Owns the whole import: parsing, the Discogs fan-out, per-row status, and
// the final tally. The caller supplies onAddRecordsBulk and renders whatever
// UI it likes around these values. Pass collection + onUpdateRecord as well to
// enable the retry pass over rows an earlier import could not match.
export function useFileImport(onAddRecordsBulk, { collection, onUpdateRecord } = {}) {
  // File import (CSV / text) state
  const [fileImporting, setFileImporting] = useState(false);
  const [fileProgress, setFileProgress] = useState({ done: 0, total: 0, matched: 0 });
  const [fileResult, setFileResult] = useState(null);
  const [fileError, setFileError] = useState('');
  // Per-row live status: 'pending' | 'searching' | 'waiting' | 'added' | 'draft' | 'skipped'
  const [fileItems, setFileItems] = useState([]);
  const cancelFileImport = useRef(false);
  const importFileRef = useRef(null);
  const importListRef = useRef(null);

  // The retry pass reads the collection at the moment it runs, not at the
  // moment the hook rendered.
  const collectionRef = useRef(collection);
  useEffect(() => { collectionRef.current = collection; }, [collection]);
  const unmatchedCount = unmatchedImports(collection).length;

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

  const setItemStatus = (idx, status) => setFileItems(prev => {
    const next = [...prev];
    if (next[idx]) next[idx] = { ...next[idx], status };
    return next;
  });

  const isCancelled = () => cancelFileImport.current;

  // Resolve each parsed row against Discogs (vinyl-only search) and bulk-add.
  // Maximum-recall policy: a row is NEVER dropped. Best match wins (preferring
  // one with cover art); a row with no match is still added as a draft record
  // (identified: false) carrying the artist/title, which the user fine-tunes
  // via Re-identify in the record detail panel, or in bulk via retryUnmatched.
  // Matched rows use source 'discogs_import' so the existing lazy enrichment
  // pulls their tracklist on first open.
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

    let matched = 0, drafts = 0, added = 0, skipped = 0, stopped = false, stoppedReason = null;
    for (let i = 0; i < rows.length; i++) {
      if (cancelFileImport.current) { stopped = true; break; }
      const row = rows[i];
      setItemStatus(i, 'searching');

      const r = await resolveRow(row, { isCancelled, onWaiting: () => setItemStatus(i, 'waiting') });
      if (r.outcome === 'cancelled') { stopped = true; setItemStatus(i, 'pending'); break; }
      if (r.outcome === 'ratelimited') {
        // Rows from here on would all be drafted for a reason that has nothing
        // to do with the records. Stop instead, and leave the row untouched:
        // matched records de-duplicate by Discogs id, so running the same file
        // again picks up where this left off without doubling anything.
        stopped = true;
        stoppedReason = 'ratelimit';
        setItemStatus(i, 'pending');
        break;
      }

      const isDraft = r.outcome !== 'match';
      let release;
      if (isDraft) {
        drafts++;
        release = {
          id: null, artist: row.artist, title: row.title || '(untitled)',
          genres: [], tracklist: [], coverUrl: null,
          identified: false, confidence: 'low', source: 'file_import',
        };
      } else {
        matched++;
        release = releaseFromMatch(r.match, row);
      }
      // Add one row at a time so each tick in the list reflects a record that
      // is genuinely saved (and so duplicates are flagged on the right row).
      const res = await onAddRecordsBulk([release]);
      added += res.added;
      skipped += res.skipped;
      setItemStatus(i, res.skipped ? 'skipped' : (isDraft ? 'draft' : 'added'));
      setFileProgress({ done: i + 1, total: rows.length, matched });
      // Pace the Discogs fan-out off the budget Discogs itself reports.
      if (i < rows.length - 1) await sleep(gapFor(r.remaining), isCancelled);
    }
    setFileResult({ mode: 'import', added, skipped, matched, drafts, stopped, stoppedReason, overflow });
    setFileImporting(false);
  }

  // Second pass over rows an earlier import could not match. They cannot be
  // repaired by importing the same file again: de-duplication keys on the
  // Discogs id, and an unmatched row has none, so a re-import would add a
  // second copy of every one of them. This looks each one up again and fills
  // in the record that is already there.
  async function retryUnmatched() {
    if (fileImporting) return;
    const drafts = unmatchedImports(collectionRef.current);
    if (!drafts.length || !onUpdateRecord) return;

    cancelFileImport.current = false;
    setFileImporting(true);
    setFileError('');
    setFileResult(null);
    setFileItems(drafts.map(d => ({ artist: d.artist, title: d.title, status: 'pending' })));
    setFileProgress({ done: 0, total: drafts.length, matched: 0 });

    let matched = 0, stopped = false, stoppedReason = null;
    for (let i = 0; i < drafts.length; i++) {
      if (cancelFileImport.current) { stopped = true; break; }
      const draft = drafts[i];
      setItemStatus(i, 'searching');

      const r = await resolveRow({ artist: draft.artist, title: draft.title }, { isCancelled, onWaiting: () => setItemStatus(i, 'waiting') });
      if (r.outcome === 'cancelled') { stopped = true; setItemStatus(i, 'pending'); break; }
      if (r.outcome === 'ratelimited') { stopped = true; stoppedReason = 'ratelimit'; setItemStatus(i, 'pending'); break; }

      if (r.outcome === 'match') {
        matched++;
        const m = r.match;
        // Patch the record in place. Anything the user has added since the
        // import (crates, notes, conditions) is untouched.
        onUpdateRecord(draft.id, {
          discogsId: m.id,
          artist: m.artist || draft.artist,
          title:  m.recordTitle || draft.title,
          label: m.label || null,
          catalogNumber: m.catalogNumber || null,
          year: m.year || null,
          country: m.country || null,
          format: m.format || null,
          coverUrl: m.coverUrl || null,
          identified: true,
          confidence: 'high',
          source: 'discogs_import',
        });
        setItemStatus(i, 'added');
      } else {
        setItemStatus(i, 'draft');
      }
      setFileProgress({ done: i + 1, total: drafts.length, matched });
      if (i < drafts.length - 1) await sleep(gapFor(r.remaining), isCancelled);
    }
    setFileResult({
      mode: 'retry', matched, drafts: 0, added: 0, skipped: 0,
      stillUnmatched: drafts.length - matched, stopped, stoppedReason, overflow: 0,
    });
    setFileImporting(false);
  }

  return {
    fileImporting, fileProgress, fileResult, fileError, fileItems,
    cancelFileImport, importFileRef, importListRef,
    resetFileImport, handleImportFile,
    unmatchedCount, retryUnmatched,
  };
}
