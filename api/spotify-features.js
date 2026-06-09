import { enrichTracks } from './lib/spotify.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tracks, artist, releaseYear, releaseTitle } = req.body || {};
  if (!Array.isArray(tracks)) return res.status(400).json({ error: 'tracks array required' });

  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    return res.status(503).json({
      error: 'Spotify not configured',
      tracks: tracks.map(t => ({ ...t, bpm: null, key: null, energy: null, valence: null, spotifyMatch: false })),
    });
  }

  try {
    const enriched = await enrichTracks(tracks, artist || '', { releaseYear, releaseTitle });
    return res.status(200).json({ tracks: enriched });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      tracks: tracks.map(t => ({ ...t, bpm: null, key: null, energy: null, valence: null, spotifyMatch: false })),
    });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};
