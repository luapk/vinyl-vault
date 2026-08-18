// Smart crate bookkeeping.
//
// Two runs exist. A FULL run sorts the whole collection from scratch. An
// UNFILED run sends only the records that sit in no crate at all and asks
// Claude to file them into the crates that already exist, inventing a new one
// only when nothing fits. The second is the common case once a collection has
// been sorted once: a handful of new scans, not a re-think of the whole shelf.
//
// Nothing here removes a crate from a record. Applying a run only ever adds
// crate names, so a run that goes wrong costs a tidy-up, never a record.

// Records the AI has never filed and the user has not filed either. A record
// the user put in a crate by hand is theirs, and an unfiled run leaves it be.
export function unfiledRecords(collection = []) {
  return collection.filter(r => r && !(Array.isArray(r.crates) && r.crates.length > 0));
}

// Crate suggestions carry a description, which is what lets a later unfiled run
// file accurately into a crate it did not create. Descriptions used to be
// thrown away on apply, leaving the next run guessing from the name alone.
export function normalizeCrateMeta(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(c => (typeof c === 'string' ? { name: c, description: '' } : c))
    .filter(c => c && typeof c.name === 'string' && c.name.trim())
    .map(c => ({ name: c.name, description: typeof c.description === 'string' ? c.description : '' }));
}

// A full run replaces the suggestion list; an unfiled run adds to it. Merging
// (rather than replacing) is what stops an unfiled run from orphaning the
// crates it just filed records into: they stayed on the records but vanished
// from the quick-pick list.
export function mergeCrateMeta(existing, incoming, mode) {
  const next = normalizeCrateMeta(incoming);
  if (mode !== 'unfiled') return next;

  const merged = normalizeCrateMeta(existing);
  const seen = new Map(merged.map((c, i) => [c.name.toLowerCase(), i]));
  for (const crate of next) {
    const at = seen.get(crate.name.toLowerCase());
    if (at === undefined) {
      seen.set(crate.name.toLowerCase(), merged.length);
      merged.push(crate);
    } else if (!merged[at].description && crate.description) {
      merged[at] = { ...merged[at], description: crate.description };
    }
  }
  return merged;
}

// How much of what we sent actually got filed. Claude is told to leave a record
// unfiled rather than force it into a weak grouping, so a shortfall is normal
// and needs saying out loud: silence reads as "it missed some".
export function coverage(crates = [], sent = []) {
  const filed = new Set();
  for (const crate of crates) {
    for (const id of (crate?.ids || [])) if (typeof id === 'string') filed.add(id);
  }
  const sentIds = new Set(sent.map(r => r?.id).filter(Boolean));
  let hit = 0;
  for (const id of filed) if (sentIds.has(id)) hit++;
  return { filed: hit, total: sentIds.size, unfiled: Math.max(0, sentIds.size - hit) };
}
