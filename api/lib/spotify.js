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
  const q = `track:${trackTitle} artist:${artist}`;
  const url = `https://api.spotify.com/v1/search?type=track&q=${encodeURIComponent(q)}&limit=3`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.tracks?.items?.[0]?.id || null;
}

async function fetchAudioFeatures(token, trackId) {
  const res = await fetch(
    `https://api.spotify.com/v1/audio-features/${trackId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  return res.json();
}

const noMatch = { bpm: null, key: null, energy: null, valence: null, spotifyMatch: false };

export async function enrichTracks(tracks, artist) {
  const token = await getToken();

  return Promise.all(
    tracks.map(async track => {
      try {
        const trackId = await searchTrack(token, artist, track.title);
        if (!trackId) return { ...track, ...noMatch };

        const features = await fetchAudioFeatures(token, trackId);
        if (!features) return { ...track, ...noMatch };

        return {
          ...track,
          bpm: features.tempo != null ? Math.round(features.tempo) : null,
          key: toCamelot(features.key, features.mode),
          energy: features.energy ?? null,
          valence: features.valence ?? null,
          spotifyMatch: true,
        };
      } catch {
        return { ...track, ...noMatch };
      }
    })
  );
}
