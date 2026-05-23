const BASE = 'https://itunes.apple.com';

function stripParens(s) {
  return s.replace(/\s*\([^)]*\)/g, '').trim();
}

function bestMatch(results, trackTitle) {
  if (!results.length) return null;
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(trackTitle);
  // Prefer exact or close title match
  const sorted = results
    .filter(r => r.previewUrl)
    .sort((a, b) => {
      const aScore = norm(a.trackName || '').includes(target) ? 0 : 1;
      const bScore = norm(b.trackName || '').includes(target) ? 0 : 1;
      return aScore - bScore;
    });
  return sorted[0]?.previewUrl || null;
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
      const url = bestMatch(data.results || [], trackTitle);
      if (url) return url;
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
      const previewUrl = await searchTrackPreview(artist, track.title).catch(() => null);
      return previewUrl ? { ...track, previewUrl } : track;
    })
  );
}
