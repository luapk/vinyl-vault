// Duplicate unmatched imports.
//
// An import row that matched nothing is saved as a draft with no Discogs
// release id. Record identity IS that id, so de-duplication cannot see drafts:
// importing the same file twice adds a second copy of every row that failed to
// match, and there was no way to tidy that up short of deleting them by hand.
//
// This finds the redundant copies. It never proposes removing an identified
// record: a draft is the copy that loses, always.
import { isUnmatchedImport } from './importBudget.js';

// Case, punctuation and spacing are noise; brackets are not. "Acid Cowboy
// (Multi Culti)" and "Acid Cowboy" are plausibly different releases, and these
// records have no release id to check against, so the comparison stays literal
// about everything the user actually typed.
function normalise(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}()[\]]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dedupeKey(record) {
  return `${normalise(record?.artist)}|${normalise(record?.title)}`;
}

// A row worth comparing. The title carries the identity here (plenty of import
// rows are a title with no artist), and "(untitled)" is the placeholder a row
// with no title at all is saved under. Two of those are not evidence of a
// duplicate, and deleting a record cannot be undone, so they are left alone.
function comparable(record) {
  const title = normalise(record?.title);
  if (!/[\p{L}\p{N}]/u.test(title)) return false;
  return title !== '(untitled)' && title !== 'untitled';
}

// Oldest first, so the copy that is kept is the one that has been in the
// collection longest (and is likelier to carry crates or notes).
function oldestFirst(a, b) {
  return (a.savedAt || 0) - (b.savedAt || 0) || String(a.id).localeCompare(String(b.id));
}

export function planDraftDedupe(collection) {
  const records = (collection || []).filter(r => r && r.id);
  const drafts = records.filter(isUnmatchedImport).sort(oldestFirst);

  // Keys already held by a record that did match. A draft duplicating one of
  // those is pure noise: the identified copy is strictly better.
  const identified = new Set();
  for (const r of records) {
    if (isUnmatchedImport(r)) continue;
    if (comparable(r)) identified.add(dedupeKey(r));
  }

  const keptDrafts = new Set();
  const remove = [];
  let againstIdentified = 0, againstDraft = 0;

  for (const d of drafts) {
    if (!comparable(d)) continue;
    const key = dedupeKey(d);
    if (identified.has(key)) { remove.push(d.id); againstIdentified++; continue; }
    if (keptDrafts.has(key)) { remove.push(d.id); againstDraft++; continue; }
    keptDrafts.add(key);
  }

  return { remove, count: remove.length, againstIdentified, againstDraft };
}
