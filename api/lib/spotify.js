import { toCamelot } from '../../src/lib/camelot.js';

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

async function searchTrack(token, artist, trackTitle, releaseYear) {
  const q = artist ? `track:${trackTitle} artist:${artist}` : `track:${trackTitle}`;
  const url = `https://api.spotify.com/v1/search?type=track&q=${encodeURIComponent(q)}&limit=5`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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
    console.log(`[spotify] no confident title match for "${trackTitle}" in results`);
    return null;
  }

  const track = scored[0].t;
  const preview = track.preview_url || null;
  console.log(`[spotify] hit: id=${track.id} score=${scored[0].s.toFixed(2)} preview=${preview ? 'YES' : 'NULL'}`);
  return { id: track.id, previewUrl: preview };
}

async function fetchAudioFeatures(token, trackId) {
  const res = await fetch(
    `https://api.spotify.com/v1/audio-features/${trackId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    console.log(`[spotify] features=${res.status}`);
    return null;
  }
  const f = await res.json();
  console.log(`[spotify] features: bpm=${Math.round(f.tempo)} key=${f.key} mode=${f.mode}`);
  return f;
}

const noMatch = { bpm: null, key: null, energy: null, valence: null, spotifyMatch: false, previewUrl: null };

export async function enrichTracks(tracks, artist, releaseContext = {}) {
  const token = await getToken();
  const { releaseYear } = releaseContext;

  return Promise.all(
    tracks.map(async track => {
      try {
        const result = await searchTrack(token, artist, track.title, releaseYear);
        if (!result) return { ...track, ...noMatch };

        const features = await fetchAudioFeatures(token, result.id);
        if (!features) return { ...track, ...noMatch, previewUrl: result.previewUrl };

        return {
          ...track,
          bpm: features.tempo != null ? Math.round(features.tempo) : null,
          key: toCamelot(features.key, features.mode),
          energy: features.energy ?? null,
          valence: features.valence ?? null,
          spotifyMatch: true,
          previewUrl: result.previewUrl,
        };
      } catch {
        return { ...track, ...noMatch };
      }
    })
  );
}
