const BASE = 'https://itunes.apple.com';

async function searchTrackPreview(artist, trackTitle) {
  const q = encodeURIComponent(`${artist} ${trackTitle}`.trim());
  try {
    const res = await fetch(`${BASE}/search?term=${q}&entity=song&media=music&limit=5`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.results || []).find(r => r.previewUrl)?.previewUrl || null;
  } catch {
    return null;
  }
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
