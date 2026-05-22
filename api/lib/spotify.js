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

async function searchTrack(token, artist, trackTitle) {
  // Only include artist filter when we have one — empty artist: produces malformed queries
  const q = artist ? `track:${trackTitle} artist:${artist}` : `track:${trackTitle}`;
  const url = `https://api.spotify.com/v1/search?type=track&q=${encodeURIComponent(q)}&limit=3`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.log(`[spotify] search ${res.status} for "${q}"`);
    return null;
  }
  const data = await res.json();
  const track = data.tracks?.items?.[0];
  if (!track) {
    console.log(`[spotify] no results for "${q}"`);
    return null;
  }
  console.log(`[spotify] matched "${track.name}" by "${track.artists?.[0]?.name}" previewUrl=${track.preview_url}`);
  return { id: track.id, previewUrl: track.preview_url || null };
}

async function fetchAudioFeatures(token, trackId) {
  const res = await fetch(
    `https://api.spotify.com/v1/audio-features/${trackId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    console.log(`[spotify] audio-features ${res.status} for ${trackId} — endpoint may be deprecated for this app`);
    return null;
  }
  return res.json();
}

const noMatch = { bpm: null, key: null, energy: null, valence: null, spotifyMatch: false, previewUrl: null };

export async function enrichTracks(tracks, artist) {
  const token = await getToken();

  return Promise.all(
    tracks.map(async track => {
      try {
        const result = await searchTrack(token, artist, track.title);
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
