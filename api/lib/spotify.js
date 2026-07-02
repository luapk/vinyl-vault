let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Spotify credentials not configured');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(3000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

const normStr = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

// Parse a Discogs duration string ("m:ss" or "h:mm:ss") into seconds.
function parseDurationSecs(str) {
  if (!str) return null;
  const parts = String(str).split(':').map(n => parseInt(n, 10));
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function titleSim(a, b) {
  const na = normStr(a), nb = normStr(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  if (!wa.length || !wb.length) return (na.includes(nb) || nb.includes(na)) ? 0.5 : 0;
  const overlap = wa.filter(w => wb.includes(w)).length;
  const base = overlap / Math.max(wa.length, wb.length);
  // Substring match, but penalised by length ratio
  if ((na.includes(nb) || nb.includes(na)) && base < 0.5) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return Math.max(base, ratio >= 0.7 ? 0.5 : 0.25);
  }
  return base;
}

async function searchTrack(token, artist, trackTitle, releaseYear, discogsDuration) {
  const q = artist ? `track:${trackTitle} artist:${artist}` : `track:${trackTitle}`;
  const url = `https://api.spotify.com/v1/search?type=track&q=${encodeURIComponent(q)}&limit=8`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2500) });
  if (!res.ok) {
    console.log(`[spotify] search ${res.status} for "${q}"`);
    return null;
  }
  const data = await res.json();
  const items = data.tracks?.items || [];
  if (!items.length) {
    console.log(`[spotify] no results for "${q}"`);
    return null;
  }

  // Score each candidate: require title similarity >= 0.5 to avoid wrong-song matches
  const normArtist = normStr(artist || '');
  const artistWords = normArtist.split(' ').filter(w => w.length > 2);
  const wantSecs = parseDurationSecs(discogsDuration);

  const scored = items
    .map(t => {
      const sim = titleSim(trackTitle, t.name);
      if (sim < 0.5) return null;

      let s = sim;

      // Artist: penalise results with no word overlap against the searched artist.
      // Structured `artist:` query already narrows results, but can still miss.
      if (artistWords.length > 0) {
        const spotifyArtist = (t.artists || []).map(a => normStr(a.name)).join(' ');
        const spotifyWords = spotifyArtist.split(' ').filter(w => w.length > 2);
        const hasOverlap = artistWords.some(w => spotifyWords.includes(w)) ||
          spotifyWords.some(w => artistWords.includes(w));
        if (!hasOverlap && spotifyWords.length > 0) s -= 0.6;  // drops below 0.5 threshold even for exact title
      }

      // Duration: the single strongest disambiguator between same-named versions.
      // Discogs gives us the exact pressing length, so a big gap means it is a
      // different edit/version -- hard reject it rather than serve a wrong preview.
      if (wantSecs && t.duration_ms) {
        const diff = Math.abs(t.duration_ms / 1000 - wantSecs);
        if (diff > 45) return null;              // clearly a different version
        else if (diff < 4) s += 0.5;
        else if (diff < 12) s += 0.3;
        else if (diff < 25) s += 0.1;
      }

      // Year proximity: penalise re-recordings from a different era
      if (releaseYear && t.album?.release_date) {
        const trackYear = parseInt(t.album.release_date.slice(0, 4), 10);
        const gap = Math.abs(trackYear - releaseYear);
        if (gap <= 2) s += 0.3;
        else if (gap > 15) s -= 0.4;
      }

      return { t, s };
    })
    .filter(Boolean)
    .sort((a, b) => b.s - a.s);

  if (!scored.length) {
    console.log(`[spotify] no confident match for "${trackTitle}" in results`);
    return null;
  }

  const track = scored[0].t;
  const preview = track.preview_url || null;
  console.log(`[spotify] hit: id=${track.id} score=${scored[0].s.toFixed(2)} preview=${preview ? 'YES' : 'NULL'}`);
  return { id: track.id, previewUrl: preview };
}

// Spotify deprecated /v1/audio-features in Nov 2024 for new app credentials
// (403), so the only value left in this leg is preview URLs -- and apps created
// after the same cutoff get preview_url: null on every track too. If Spotify
// keeps matching tracks but never returns a preview, stop paying its latency
// for the rest of this lambda instance. iTunes and Deezer cover previews;
// Deezer, waveform analysis, and GetSongBPM cover BPM.
const PREVIEW_MISS_LIMIT = 8;
let previewMisses = 0;
let previewsDisabled = false;

function notePreviewOutcome(gotPreview) {
  if (gotPreview) {
    previewMisses = 0;
    return;
  }
  previewMisses += 1;
  if (previewMisses >= PREVIEW_MISS_LIMIT && !previewsDisabled) {
    previewsDisabled = true;
    console.log(`[spotify] ${PREVIEW_MISS_LIMIT} consecutive matches with no preview_url: previews unavailable for this app (deprecated). Skipping Spotify for this instance.`);
  }
}

const noMatch = { bpm: null, key: null, energy: null, valence: null, spotifyMatch: false, previewUrl: null };

export async function enrichTracks(tracks, artist, releaseContext = {}) {
  if (previewsDisabled) return tracks.map(track => ({ ...track, ...noMatch }));

  const token = await getToken();
  const { releaseYear } = releaseContext;

  return Promise.all(
    tracks.map(async track => {
      try {
        const result = await searchTrack(token, artist, track.title, releaseYear, track.duration);
        if (!result) return { ...track, ...noMatch };

        notePreviewOutcome(!!result.previewUrl);
        return {
          ...track,
          ...noMatch,
          previewUrl: result.previewUrl,
          spotifyMatch: !!result.previewUrl,
        };
      } catch {
        return { ...track, ...noMatch };
      }
    })
  );
}
