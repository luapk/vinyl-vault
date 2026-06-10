const BASE = 'https://itunes.apple.com';

function stripParens(s) {
  return s.replace(/\s*\([^)]*\)/g, '').trim();
}

export function parseDurationSecs(str) {
  if (!str) return null;
  const parts = str.split(':');
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  return null;
}

function msToMmSs(ms) {
  if (!ms) return null;
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

export const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

export function titleScore(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 4;

  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  let s = 0;

  if (wa.length && wb.length) {
    const overlap = wa.filter(w => wb.includes(w)).length;
    const coverage = overlap / Math.max(wa.length, wb.length);
    s += coverage >= 0.8 ? 3 : coverage >= 0.5 ? 2 : coverage >= 0.25 ? 1 : 0;
  }

  if ((na.includes(nb) || nb.includes(na)) && s < 3) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    s = Math.max(s, ratio >= 0.7 ? 2 : 1);
  }

  return s;
}

export function scoreMatch(result, artist, trackTitle, discogsDurationStr, releaseYear, releaseTitle) {
  const ts = titleScore(trackTitle, result.trackName || '');
  if (ts === 0) return 0;

  let score = ts;

  // Artist: mismatch is a penalty, not just a missed bonus.
  // Zero word-overlap against a known artist means it's the wrong recording.
  const na = norm(artist || ''), nb = norm(result.artistName || '');
  if (na && nb) {
    if (na === nb || na.includes(nb) || nb.includes(na)) score += 2;
    else {
      const wa = na.split(' ').filter(w => w.length > 2);
      const wb = nb.split(' ').filter(w => w.length > 2);
      if (wa.length && wb.length && wa.some(w => wb.includes(w))) score += 1;
      else score -= 2;  // no word overlap at all: clearly a different artist
    }
  }

  // Duration: tighter threshold — different versions/arrangements differ here
  if (discogsDurationStr && result.trackTimeMillis) {
    const discogsSecs = parseDurationSecs(discogsDurationStr);
    if (discogsSecs) {
      const diff = Math.abs(result.trackTimeMillis / 1000 - discogsSecs);
      if (diff > 45) return -1; // hard reject: clearly a different version
      score += diff < 5 ? 3 : diff < 15 ? 2 : diff < 30 ? 1 : 0;
    }
  }

  // Release year proximity: penalises re-recordings from a different era
  if (releaseYear && result.releaseDate) {
    const itunesYear = new Date(result.releaseDate).getFullYear();
    const gap = Math.abs(itunesYear - releaseYear);
    if (gap <= 2) score += 2;       // same era: strong positive
    else if (gap <= 5) score += 1;
    else if (gap > 15) score -= 2;  // clearly a later re-recording: penalise hard
  }

  // Album/collection title match: different versions usually sit on different albums
  if (releaseTitle && result.collectionName) {
    const albumScore = titleScore(releaseTitle, result.collectionName);
    if (albumScore >= 3) score += 2;
    else if (albumScore >= 1) score += 1;
  }

  return score;
}

const MIN_SCORE = 3;

export function bestMatch(results, artist, trackTitle, discogsDuration, releaseYear, releaseTitle) {
  const candidates = results
    .filter(r => r.previewUrl)
    .map(r => ({ r, s: scoreMatch(r, artist, trackTitle, discogsDuration, releaseYear, releaseTitle) }))
    .filter(({ s }) => s >= MIN_SCORE)
    .sort((a, b) => b.s - a.s);

  if (!candidates.length) return null;
  const { r } = candidates[0];
  return {
    previewUrl: r.previewUrl,
    durationMs: r.trackTimeMillis || null,
  };
}

async function searchTrackPreview(artist, trackTitle, discogsDuration, releaseYear, releaseTitle) {
  const strategies = [
    `${artist} ${trackTitle}`,
    trackTitle,
    stripParens(trackTitle),
  ].filter((s, i, arr) => s && arr.indexOf(s) === i);

  for (const q of strategies) {
    try {
      const res = await fetch(
        `${BASE}/search?term=${encodeURIComponent(q)}&entity=song&media=music&limit=10`
      );
      if (!res.ok) continue;
      const data = await res.json();
      const match = bestMatch(data.results || [], artist, trackTitle, discogsDuration, releaseYear, releaseTitle);
      if (match) return match;
    } catch {
      continue;
    }
  }
  return null;
}

export async function fillItunesPreviews(tracks, artist, releaseContext = {}) {
  const needsFill = tracks.some(t => !t.previewUrl);
  if (!needsFill) return tracks;

  const { releaseYear, releaseTitle } = releaseContext;

  return Promise.all(
    tracks.map(async track => {
      if (track.previewUrl) return track;
      const match = await searchTrackPreview(
        artist, track.title, track.duration, releaseYear, releaseTitle
      ).catch(() => null);
      if (!match) return track;
      return {
        ...track,
        previewUrl: match.previewUrl,
        duration: track.duration || msToMmSs(match.durationMs),
      };
    })
  );
}
