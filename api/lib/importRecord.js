// The record shape a background import writes.
//
// This mirrors recordFromRelease (src/hooks/useCollection.js), which is the
// client's whitelist of what a saved record contains. Two writers of the same
// shape is a drift risk worth naming: a field added there and forgotten here
// is a field that exists on records imported in the browser and is missing on
// records imported by the worker. Keep them in step.
import { randomUUID } from 'node:crypto';

export function recordFromMatch(match, row) {
  return {
    id: randomUUID(),
    discogsId: match.id || null,
    savedAt: Date.now(),
    artist: match.artist || row.artist || '',
    title: match.recordTitle || row.title || '',
    label: match.label || null,
    catalogNumber: match.catalogNumber || null,
    year: match.year || null,
    country: match.country || null,
    format: match.format || null,
    genres: [],
    tags: [],
    identified: true,
    confidence: 'high',
    // The lazy tracklist enrichment on the client keys on this source, so an
    // imported record fills itself in the first time it is opened.
    source: 'discogs_import',
    notes: '',
    mediaCondition: '',
    sleeveCondition: '',
    coverUrl: match.coverUrl || null,
    images: [],
    tracklist: [],
    crates: [],
  };
}

// A row that matched nothing. Kept rather than dropped: the artist and title
// the user typed are worth more than a gap, and retryUnmatched can come back
// for it later. No discogsId, which is exactly how it is found again.
export function draftFromRow(row) {
  return {
    id: randomUUID(),
    discogsId: null,
    savedAt: Date.now(),
    artist: row.artist || '',
    title: row.title || '(untitled)',
    label: null,
    catalogNumber: null,
    year: null,
    country: null,
    format: null,
    genres: [],
    tags: [],
    identified: false,
    confidence: 'low',
    source: 'file_import',
    notes: '',
    mediaCondition: '',
    sleeveCondition: '',
    coverUrl: null,
    images: [],
    tracklist: [],
    crates: [],
  };
}

// The fields a retry pass writes over a draft it has finally matched. Anything
// the user added in the meantime (crates, notes, conditions) is left alone.
export function patchFromMatch(match, existing) {
  return {
    discogsId: match.id || null,
    artist: match.artist || existing.artist || '',
    title: match.recordTitle || existing.title || '',
    label: match.label || null,
    catalogNumber: match.catalogNumber || null,
    year: match.year || null,
    country: match.country || null,
    format: match.format || null,
    coverUrl: match.coverUrl || null,
    identified: true,
    confidence: 'high',
    source: 'discogs_import',
  };
}
