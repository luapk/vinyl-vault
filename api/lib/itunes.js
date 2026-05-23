const BASE = 'https://itunes.apple.com';

function stripParens(s) {
  return s.replace(/\s*\([^)]*\)/g, '').trim();
}

function bestMatch(results, trackTitle) {
  if (!results.length) return null;
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(trackTitle);
  const sorted = results
    .filter(r => r.previewUrl)
    .sort((a, b) => {
      const aScore = norm(a.trackName || '').includes(target) ? 0 : 1;
      const bScore = norm(b.trackName || '').includes(target) ? 0 : 1;
      return aScore - bScore;
    });
  if (!sorted[0]) return null;
  return {
    previewUrl: sorted[0].previewUrl,
    durationMs: sorted[0].trackTimeMillis || null,
  };
}

function msToMmSs(ms) {
  if (!ms) return null;
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

async function searchTrackPreview(artist, trackTitle) {
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
      const match = bestMatch(data.results || [], trackTitle);
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
      const match = await searchTrackPreview(artist, track.title).catch(() => null);
      if (!match) return track;
      return {
        ...track,
        previewUrl: match.previewUrl,
        // Fill duration from iTunes only when Discogs didn't supply one
        duration: track.duration || msToMmSs(match.durationMs),
      };
    })
  );
}
