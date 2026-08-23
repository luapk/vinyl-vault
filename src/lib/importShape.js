// Is this file a list of releases, or a list of tracks?
//
// The incident: a 457-row upload where the columns were release, then track.
// The parser takes column one as the artist and column two as the title, which
// is right for every ordinary export and exactly wrong for this one. It filed
// 432 rows that read "Bicep - Isles LP" by artist and "Sundial" by title,
// almost none of which can match a vinyl release, and nobody found out until
// the drafts piled up. A tracklist has a shape, so look at it and ask.

import { splitDashLine } from './importParse.js';

// "B1. Seasick Acid", "A2. Felice", "F2 Jeremy Irons". A release title
// effectively never opens with a side and position; a track in a listing very
// often does.
const POSITION_PREFIX = /^[A-H]\d{0,2}\s*[.):]\s*\S/;

// A release name sitting in the artist column brings its own separator with
// it: "Aloka - View Source (Haws)".
const HAS_SEPARATOR = /\s+[-–—]\s+/;

// Thresholds. Deliberately not near-certain: the cost of asking when the file
// was fine is one extra tap, and the cost of not asking is what happened.
const POSITION_SHARE = 0.15;
const SEPARATOR_SHARE = 0.5;
const REPEAT_RATIO = 3;      // rows per distinct artist; a tracklist repeats
const WEAK_POSITION_SHARE = 0.05;
const WEAK_SEPARATOR_SHARE = 0.2;
const MIN_ROWS = 8;          // below this there is not enough shape to judge

function share(rows, test) {
  if (!rows.length) return 0;
  return rows.filter(test).length / rows.length;
}

export function inspectImportShape(rows = []) {
  const clean = rows.filter(r => r && (r.artist || r.title));
  const positionShare = share(clean, r => POSITION_PREFIX.test((r.title || '').trim()));
  const separatorShare = share(clean, r => HAS_SEPARATOR.test((r.artist || '').trim()));
  const distinctArtists = new Set(clean.map(r => (r.artist || '').trim().toLowerCase())).size;
  const repeatRatio = distinctArtists ? clean.length / distinctArtists : 0;

  const reasons = [];
  if (positionShare >= POSITION_SHARE) {
    reasons.push(`${Math.round(positionShare * 100)}% of the titles start with a side and position, like "B1."`);
  }
  if (separatorShare >= SEPARATOR_SHARE) {
    reasons.push(`${Math.round(separatorShare * 100)}% of the first column looks like a release, not an artist`);
  }
  // On its own, an artist repeated across rows is just a collection with
  // several records by one name. Alongside either signal above it is the
  // giveaway: one release, one row per track.
  if (repeatRatio >= REPEAT_RATIO && !reasons.length
      && (positionShare >= WEAK_POSITION_SHARE || separatorShare >= WEAK_SEPARATOR_SHARE)) {
    reasons.push(`each entry in the first column repeats about ${Math.round(repeatRatio)} times, one row per track`);
  }

  const looksLikeTracklist = clean.length >= MIN_ROWS && reasons.length > 0;
  return {
    looksLikeTracklist,
    reasons,
    positionShare,
    separatorShare,
    repeatRatio,
    releases: looksLikeTracklist ? releasesFromTrackRows(clean) : [],
  };
}

// The releases hiding in a tracklist. Column one held them all along:
// "Bicep - Isles LP" over four rows is one record, not four. Split it the same
// way a plain "Artist - Title" line is split, then keep one of each.
export function releasesFromTrackRows(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const field = (row?.artist || '').trim();
    if (!field) continue;
    const { artist, title } = splitDashLine(field);
    const rec = { artist: artist.trim(), title: (title || field).trim() };
    if (!rec.artist && !rec.title) continue;
    const key = `${rec.artist}|${rec.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}
