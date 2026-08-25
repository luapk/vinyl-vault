// The CSV / text file import: one list of records in, matched releases out.
//
// Extracted so the Import card on the home screen and the Import section in
// the account panel run the same code. Two copies of a rate-limited,
// duplicate-aware import loop would be two sets of rules to keep in step.
//
// An import runs server-side when public.import_jobs exists: the rows become a
// job, this tab kicks the worker off and then only watches it, and a cron
// finishes anything still outstanding. That is what makes an import survive a
// locked phone or a closed browser. Without the table (the migration has not
// been run) the same work runs here in the browser, as it always did.
import { useState, useRef, useEffect, useCallback } from 'react';
import { Check } from '@phosphor-icons/react';
import { parseImportRows, IMPORT_ROW_CAP } from '../lib/importParse.js';
import { gapFor, createRateWindow, LIMIT_BACKOFF_MS, unmatchedImports } from '../lib/importBudget.js';
import { planDraftDedupe } from '../lib/draftDuplicates.js';
import { inspectImportShape } from '../lib/importShape.js';
import { supabase } from '../lib/supabase.js';

// Sleep in slices so cancelling does not have to wait out a long backoff.
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
  // What the lookup actually spent. A miss costs two (targeted, then fuzzy),
  // so assuming one is how a list of obscure records outruns the limit.
  const requests = typeof data?.requests === 'number' ? data.requests : 1;
  if (res.status === 429 || data?.rateLimited) return { outcome: 'limited', remaining, requests };
  if (!res.ok) return { outcome: 'error', remaining, requests };
  const matches = data.matches || [];
  const match = matches.find(x => x.coverUrl) || matches[0];
  return match ? { outcome: 'match', match, remaining, requests } : { outcome: 'nomatch', remaining, requests };
}

// One row, carried all the way to an answer worth saving. A rate limit is
// never an answer: it is waited out and retried. A transient error gets two
// quick retries and then counts as no match, since one bad row is not the
// cascading failure a rate limit is.
async function resolveRow(row, { isCancelled, onWaiting, budget }) {
  let errorTries = 0, limitTries = 0;
  for (;;) {
    if (isCancelled()) return { outcome: 'cancelled', remaining: null };
    // Hold until the window has room for the worst case (a miss, two
    // requests). This is the backstop under the even pacing between rows.
    if (budget) {
      const hold = budget.waitFor(2);
      if (hold > 0) {
        onWaiting?.(hold);
        await sleep(hold, isCancelled);
        if (isCancelled()) return { outcome: 'cancelled', remaining: null };
      }
    }
    const r = await lookupRelease(row);
    budget?.record(r.requests);
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
          {it.status === 'draft'   && tag('draft', 'rgba(240,190,80,0.75)')}
          {/* Name the wait and its length. A bare "waiting" for two minutes
              reads as a hang; "Discogs busy, 20s" reads as a queue. */}
          {it.status === 'waiting' && tag(it.waitSec ? `discogs busy ${it.waitSec}s` : 'waiting', 'rgba(240,190,80,0.75)')}
          {it.status === 'skipped' && tag('duplicate', 'rgba(var(--fg),0.3)')}
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

// Shown instead of importing when the file looks like a tracklist rather than
// a list of releases. It offers the thing the user almost certainly meant:
// column one held the release all along, so the same file read that way is a
// list of records. Importing it as it stands is still offered, because being
// told what your own file is and not being allowed to proceed is worse than
// the mistake.
function ImportShapeWarning({ shape, rowCount, onReleases, onAsIs, onCancel }) {
  const amber = 'rgba(240,190,80,0.85)';
  const button = (primary) => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9,
    fontSize: 15, fontWeight: primary ? 600 : 500, cursor: 'pointer',
    color: primary ? 'var(--bg-hex)' : 'rgba(var(--fg),0.7)',
    background: primary ? 'rgba(var(--fg),0.9)' : 'rgba(var(--fg),0.05)',
    border: primary ? 'none' : '1px solid rgba(var(--fg),0.12)',
  });
  return (
    <div>
      <p style={{ fontSize: 15, fontFamily: 'monospace', color: amber, marginBottom: 8 }}>
        This file looks like a tracklist, not a list of records.
      </p>
      <ul style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.5)', lineHeight: 1.6, marginBottom: 10, paddingLeft: 16 }}>
        {shape.reasons.map(r => <li key={r} style={{ listStyle: 'disc' }}>{r}</li>)}
      </ul>
      <p style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.5)', lineHeight: 1.6, marginBottom: 12 }}>
        Imported as it stands that is {rowCount} rows, one per track, and most
        will not match a release. Read as records it is {shape.releases.length}.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onReleases} style={button(true)}>
          Import {shape.releases.length} record{shape.releases.length === 1 ? '' : 's'}
        </button>
        <button onClick={onAsIs} style={button(false)}>Import all {rowCount} rows as they are</button>
        <button onClick={onCancel} style={{ ...button(false), background: 'transparent', border: 'none' }}>Cancel</button>
      </div>
    </div>
  );
}

export { ImportShapeWarning };

// ---- The server-side queue ---------------------------------------------------

const JOB_POLL_MS = 1500;
const UNFINISHED = ['queued', 'running'];

async function accessToken() {
  const { data } = await supabase?.auth.getSession() ?? { data: {} };
  return data?.session?.access_token || null;
}

// Start the worker now rather than waiting for the next cron tick. Failure is
// survivable by design: the cron picks the job up within a couple of minutes.
async function kickWorker() {
  try {
    const token = await accessToken();
    if (!token) return;
    await fetch('/api/import-worker', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch { /* the cron is the backstop */ }
}

async function createJob(userId, kind, rows, overflow) {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('import_jobs')
      .insert({ user_id: userId, kind, rows, total: rows.length, overflow })
      .select('*')
      .single();
    if (error || !data?.id) return null;
    return data;
  } catch {
    return null; // no table: run it in the browser instead
  }
}

function resultFromJob(job) {
  return {
    mode: job.kind === 'retry' ? 'retry' : 'import',
    added: job.added || 0,
    skipped: job.skipped || 0,
    matched: job.matched || 0,
    drafts: job.drafts || 0,
    stillUnmatched: (job.total || 0) - (job.matched || 0),
    stopped: job.status === 'cancelled' || job.status === 'failed',
    stoppedReason: null,
    overflow: job.overflow || 0,
  };
}

// ---- The hook ----------------------------------------------------------------

// Owns the whole import: parsing, the Discogs fan-out, per-row status, and
// the final tally. The caller supplies onAddRecordsBulk and renders whatever
// UI it likes around these values. collection + onUpdateRecord enable the
// retry pass over rows an earlier import could not match; userId + onReload
// enable the server-side queue (onReload pulls in what the worker wrote).
export function useFileImport(onAddRecordsBulk, { collection, onUpdateRecord, onRemoveRecord, userId, onReload } = {}) {
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
  // The job this tab is watching, when the run is server-side.
  const jobIdRef = useRef(null);
  // Set when a file's shape is questioned: the parsed rows are held here
  // rather than imported, until the user says how to read them.
  const [fileConfirm, setFileConfirm] = useState(null);
  // What is in the paste box, when a list is typed or pasted rather than
  // uploaded.
  const [pastedList, setPastedList] = useState('');

  // The retry pass reads the collection at the moment it runs, not at the
  // moment the hook rendered.
  const collectionRef = useRef(collection);
  useEffect(() => { collectionRef.current = collection; }, [collection]);
  const unmatchedCount = unmatchedImports(collection).length;
  // Duplicate drafts, which only exist because a re-import cannot recognise
  // them: an unmatched row has no Discogs id to de-duplicate on.
  const dupePlan = planDraftDedupe(collection);
  const duplicateCount = dupePlan.count;

  // Deleting records is not undoable, so the button asks once. The plan is
  // recomputed at the moment of the click rather than reusing the one this
  // render saw, in case the collection moved underneath it.
  const [confirmDedupe, setConfirmDedupe] = useState(false);
  function removeDuplicateDrafts() {
    if (!onRemoveRecord) return;
    if (!confirmDedupe) { setConfirmDedupe(true); return; }
    setConfirmDedupe(false);
    for (const id of planDraftDedupe(collectionRef.current).remove) onRemoveRecord(id);
  }

  // Keep the row currently being processed visible in the scrolling list.
  useEffect(() => {
    const active = importListRef.current?.querySelector('[data-active="1"]');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [fileProgress.done]);

  function resetFileImport() {
    setFileResult(null);
    setFileItems([]);
    setFileError('');
    setFileConfirm(null);
    jobIdRef.current = null;
  }

  const setItemStatus = (idx, status, extra) => setFileItems(prev => {
    const next = [...prev];
    if (next[idx]) next[idx] = { ...next[idx], status, ...extra };
    return next;
  });

  const isCancelled = () => cancelFileImport.current;

  // Watch a server-side job until it finishes. Everything shown while it runs
  // comes from the job row, so closing the tab and coming back mid-import
  // rejoins the same run rather than starting a new one.
  const watchJob = useCallback((jobId) => {
    jobIdRef.current = jobId;
    setFileImporting(true);
    let stop = false;
    const tick = async () => {
      if (stop || jobIdRef.current !== jobId) return;
      const { data: job, error } = await supabase.from('import_jobs').select('*').eq('id', jobId).single();
      if (error || !job) { setFileImporting(false); return; }
      const rows = Array.isArray(job.rows) ? job.rows : [];
      setFileItems(rows.map((r, i) => ({
        artist: r.artist, title: r.title,
        status: r.status && r.status !== 'pending' ? r.status : (i === job.cursor && job.status === 'running' ? 'searching' : 'pending'),
      })));
      setFileProgress({ done: job.cursor || 0, total: job.total || rows.length, matched: job.matched || 0 });
      if (UNFINISHED.includes(job.status)) { setTimeout(tick, JOB_POLL_MS); return; }
      // Done: the records were written by the worker, so pull them in.
      setFileResult(resultFromJob(job));
      setFileImporting(false);
      jobIdRef.current = null;
      onReload?.();
    };
    tick();
    return () => { stop = true; };
  }, [onReload]);

  // Rejoin an import left running by an earlier session. This is the whole
  // point of the queue: the phone locked, the tab closed, the import carried
  // on, and opening the app shows where it got to.
  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('import_jobs').select('*')
          .eq('user_id', userId).in('status', UNFINISHED)
          .order('created_at', { ascending: false }).limit(1);
        const job = data?.[0];
        if (!job || cancelled) return;
        watchJob(job.id);
        kickWorker();
      } catch { /* no table: nothing to rejoin */ }
    })();
    return () => { cancelled = true; };
  }, [userId, watchJob]);

  // ---- The in-browser fallback ----------------------------------------------
  //
  // Resolve each row against Discogs and bulk-add. Maximum-recall policy: a row
  // is NEVER dropped. Best match wins (preferring one with cover art); a row
  // with no match is still added as a draft record (identified: false) carrying
  // the artist/title, fine-tuned later via Re-identify or retryUnmatched.
  async function runInBrowser(rows, overflow) {
    const budget = createRateWindow();
    setFileItems(rows.map(r => ({ artist: r.artist, title: r.title, status: 'pending' })));
    setFileProgress({ done: 0, total: rows.length, matched: 0 });

    let matched = 0, drafts = 0, added = 0, skipped = 0, stopped = false, stoppedReason = null;
    for (let i = 0; i < rows.length; i++) {
      if (cancelFileImport.current) { stopped = true; break; }
      const row = rows[i];
      setItemStatus(i, 'searching');

      const r = await resolveRow(row, {
        isCancelled, budget,
        onWaiting: (ms) => setItemStatus(i, 'waiting', { waitSec: Math.max(1, Math.round(ms / 1000)) }),
      });
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
      if (i < rows.length - 1) await sleep(gapFor(r.remaining, r.requests), isCancelled);
    }
    setFileResult({ mode: 'import', added, skipped, matched, drafts, stopped, stoppedReason, overflow });
    setFileImporting(false);
  }

  async function startImport(rows, overflow) {
    cancelFileImport.current = false;
    setFileConfirm(null);
    setFileImporting(true);
    setFileError('');
    setFileResult(null);

    const job = await createJob(userId, 'import', rows.map(r => ({ artist: r.artist, title: r.title, status: 'pending' })), overflow);
    if (job) {
      watchJob(job.id);
      kickWorker();
      return;
    }
    await runInBrowser(rows, overflow);
  }

  // One text blob in, an import out. A pasted list and an uploaded file are the
  // same thing by the time they get here, so they cannot drift: the cap, the
  // shape check and the run are shared.
  async function importText(text, { badSource = 'Could not read that.' } = {}) {
    if (fileImporting) return;
    let rows, overflow = 0;
    try {
      // Parse everything, then apply the cap here so the count left behind is
      // known and can be reported. Silently truncating is how a 900-record
      // file used to look like a 500-record one that had finished.
      const all = parseImportRows(text, Infinity);
      rows = all.slice(0, IMPORT_ROW_CAP);
      overflow = all.length - rows.length;
    } catch {
      setFileError(badSource);
      return;
    }
    if (!rows.length) {
      setFileError('No records found. Use CSV columns like artist,title or lines like "Artist - Title".');
      return;
    }

    // Ask before importing a list whose shape says tracklist. The parser reads
    // column one as the artist, which is right for every ordinary export and
    // exactly wrong for a release/track listing -- 432 unmatchable rows wrong,
    // the one time it happened.
    const shape = inspectImportShape(rows);
    if (shape.looksLikeTracklist && shape.releases.length) {
      setFileError('');
      setFileResult(null);
      setFileConfirm({ rows, overflow, shape });
      return;
    }

    await startImport(rows, overflow);
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || fileImporting) return;
    let text;
    try {
      text = await file.text();
    } catch {
      setFileError('Could not read that file.');
      return;
    }
    await importText(text, { badSource: 'Could not read that file.' });
  }

  // Pasting beats saving a file and hunting for it in the picker, which on a
  // phone is most of the work.
  async function importPastedList() {
    const text = pastedList;
    if (!text.trim()) {
      setFileError('Paste a list first: one record per line, as "Artist - Title".');
      return;
    }
    await importText(text);
    setPastedList('');
  }

  // The user's answer to that question.
  function confirmImport(how) {
    const pending = fileConfirm;
    if (!pending) return;
    if (how === 'releases') return startImport(pending.shape.releases, pending.overflow);
    return startImport(pending.rows, pending.overflow);
  }

  // Second pass over rows an earlier import could not match. They cannot be
  // repaired by importing the same file again: de-duplication keys on the
  // Discogs id, and an unmatched row has none, so a re-import would add a
  // second copy of every one of them. This looks each one up again and fills
  // in the record that is already there.
  async function retryUnmatched() {
    if (fileImporting) return;
    const drafts = unmatchedImports(collectionRef.current);
    if (!drafts.length) return;

    cancelFileImport.current = false;
    setFileImporting(true);
    setFileError('');
    setFileResult(null);

    const job = await createJob(userId, 'retry',
      drafts.map(d => ({ artist: d.artist, title: d.title, recordId: d.id, status: 'pending' })), 0);
    if (job) {
      watchJob(job.id);
      kickWorker();
      return;
    }

    if (!onUpdateRecord) { setFileImporting(false); return; }
    const budget = createRateWindow();
    setFileItems(drafts.map(d => ({ artist: d.artist, title: d.title, status: 'pending' })));
    setFileProgress({ done: 0, total: drafts.length, matched: 0 });

    let matched = 0, stopped = false, stoppedReason = null;
    for (let i = 0; i < drafts.length; i++) {
      if (cancelFileImport.current) { stopped = true; break; }
      const draft = drafts[i];
      setItemStatus(i, 'searching');

      const r = await resolveRow({ artist: draft.artist, title: draft.title }, {
        isCancelled, budget,
        onWaiting: (ms) => setItemStatus(i, 'waiting', { waitSec: Math.max(1, Math.round(ms / 1000)) }),
      });
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
      if (i < drafts.length - 1) await sleep(gapFor(r.remaining, r.requests), isCancelled);
    }
    setFileResult({
      mode: 'retry', matched, drafts: 0, added: 0, skipped: 0,
      stillUnmatched: drafts.length - matched, stopped, stoppedReason, overflow: 0,
    });
    setFileImporting(false);
  }

  // Stop here. A server-side run is cancelled by marking the job: the worker
  // checks before every few rows, so it stops wherever it has got to.
  function stopImport() {
    cancelFileImport.current = true;
    const jobId = jobIdRef.current;
    if (jobId && supabase) supabase.from('import_jobs').update({ status: 'cancelled' }).eq('id', jobId).then(() => {}, () => {});
  }

  return {
    fileImporting, fileProgress, fileResult, fileError, fileItems,
    cancelFileImport, importFileRef, importListRef,
    resetFileImport, handleImportFile, stopImport,
    pastedList, setPastedList, importPastedList,
    fileConfirm, confirmImport,
    unmatchedCount, retryUnmatched,
    duplicateCount, confirmDedupe, removeDuplicateDrafts,
  };
}
