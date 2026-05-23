const BASE = 'https://itunes.apple.com';

function stripParens(s) {
  return s.replace(/\s*\([^)]*\)/g, '').trim();
}

function parseDurationSecs(str) {
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

const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

function titleScore(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 4;

  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  let s = 0;

  // Word overlap
  if (wa.length && wb.length) {
    const overlap = wa.filter(w => wb.includes(w)).length;
    const coverage = overlap / Math.max(wa.length, wb.length);
    s += coverage >= 0.8 ? 3 : coverage >= 0.5 ? 2 : coverage >= 0.25 ? 1 : 0;
  }

  // Substring match, penalised by length ratio (avoids "Rain" matching "Purple Rain")
  if ((na.includes(nb) || nb.includes(na)) && s < 3) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    s = Math.max(s, ratio >= 0.7 ? 2 : 1);
  }

  return s;
}

function scoreMatch(result, artist, trackTitle, discogsDurationStr) {
  const ts = titleScore(trackTitle, result.trackName || '');
  if (ts === 0) return 0; // no title similarity at all: skip immediately

  let score = ts;

  // Artist bonus (not a hard requirement — covers and VA releases exist)
  const na = norm(artist || ''), nb = norm(result.artistName || '');
  if (na && nb) {
    if (na === nb || na.includes(nb) || nb.includes(na)) score += 2;
    else {
      const wa = na.split(' ').filter(w => w.length > 2);
      const wb = nb.split(' ').filter(w => w.length > 2);
      if (wa.some(w => wb.includes(w))) score += 1;
    }
  }

  // Duration validation — hard reject if clearly different, bonus if close
  if (discogsDurationStr && result.trackTimeMillis) {
    const discogsSecs = parseDurationSecs(discogsDurationStr);
    if (discogsSecs) {
      const diff = Math.abs(result.trackTimeMillis / 1000 - discogsSecs);
      if (diff > 90) return -1; // clearly wrong track
      score += diff < 10 ? 2 : diff < 30 ? 1 : 0;
    }
  }

  return score;
}

// Minimum confidence: title must meaningfully match (score >= 2)
const MIN_SCORE = 2;

function bestMatch(results, artist, trackTitle, discogsDuration) {
  const candidates = results
    .filter(r => r.previewUrl)
    .map(r => ({ r, s: scoreMatch(r, artist, trackTitle, discogsDuration) }))
    .filter(({ s }) => s >= MIN_SCORE)
    .sort((a, b) => b.s - a.s);

  if (!candidates.length) return null;
  const { r } = candidates[0];
  return {
    previewUrl: r.previewUrl,
    durationMs: r.trackTimeMillis || null,
  };
}

async function searchTrackPreview(artist, trackTitle, discogsDuration) {
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
      const match = bestMatch(data.results || [], artist, trackTitle, discogsDuration);
      if (match) return match;
    } catch {
      continue;
    }
  }
  return null;
}

export async function fillItunesPreviews(tracks, artist) {
  const needsFill = tracks.some(t => !t.previewUrl);
  if (!needsFill) return tracks;

  return Promise.all(
    tracks.map(async track => {
      if (track.previewUrl) return track;
      const match = await searchTrackPreview(artist, track.title, track.duration).catch(() => null);
      if (!match) return track;
      return {
        ...track,
        previewUrl: match.previewUrl,
        duration: track.duration || msToMmSs(match.durationMs),
      };
    })
  );
}
