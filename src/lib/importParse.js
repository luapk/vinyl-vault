// ----- File import parsing ---------------------------------------------------
// Accepts loose CSV / TSV / plain text record lists -- deliberately forgiving,
// since exports come from all over (Discogs CSV, spreadsheets, notes apps).
// Returns [{ artist, title }] with blanks and in-file duplicates removed.

// How many records one file may import in a single run. The per-row Discogs
// lookup shares a rate limit with everyone else's scanning, so an unbounded
// file is one person degrading the app for all of them. Callers that want to
// tell the user what was left behind pass Infinity and apply the cap
// themselves.
export const IMPORT_ROW_CAP = 1000;

export const IMPORT_ARTIST_KEYS = ['artist', 'artists', 'artist name', 'performer', 'band'];
export const IMPORT_TITLE_KEYS = ['title', 'album', 'album title', 'release', 'release title', 'record', 'name'];

export function parseCsvLine(line, delim) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

// "Artist - Title" (hyphen/en/em dash); a line with no dash becomes title-only.
export function splitDashLine(line) {
  const parts = line.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - ') };
  return { artist: '', title: line };
}

export function parseImportRows(text, limit = IMPORT_ROW_CAP) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  // Pick the delimiter (tab / semicolon / comma) that appears on most lines.
  const counts = [['\t', 0], [';', 0], [',', 0]];
  for (const l of lines.slice(0, 25)) for (const d of counts) if (l.includes(d[0])) d[1]++;
  counts.sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] >= Math.min(lines.length, 2) ? counts[0][0] : null;

  let rows;
  if (delim) {
    const parsed = lines.map(l => parseCsvLine(l, delim));
    const head = parsed[0].map(c => c.toLowerCase().replace(/["']/g, '').trim());
    const aIdx = head.findIndex(h => IMPORT_ARTIST_KEYS.includes(h));
    const tIdx = head.findIndex(h => IMPORT_TITLE_KEYS.includes(h));
    if (aIdx !== -1 || tIdx !== -1) {
      // Recognised header row: take the named columns.
      rows = parsed.slice(1).map(cells => ({
        artist: aIdx !== -1 ? (cells[aIdx] || '') : '',
        title: tIdx !== -1 ? (cells[tIdx] || '') : '',
      }));
    } else {
      // No header: first column artist, second title; single column falls back
      // to dash-splitting.
      rows = parsed.map(cells =>
        cells.filter(Boolean).length >= 2 ? { artist: cells[0], title: cells[1] } : splitDashLine(cells[0] || '')
      );
    }
  } else {
    rows = lines.map(splitDashLine);
  }

  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const artist = (r.artist || '').trim();
    const title = (r.title || '').trim();
    if (!artist && !title) continue;
    const key = `${artist}|${title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ artist, title });
  }
  return out.slice(0, limit);
}
