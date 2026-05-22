import { identifyFromImage, generateCrateSuggestions } from './lib/vision.js';
import { searchDiscogs, fetchDiscogsRelease } from './lib/discogs.js';
import { enrichTracks } from './lib/spotify.js';

async function buildRelease(discogsRelease, vision, hasSpotify, apiKey) {
  const release = { ...discogsRelease };

  release.identified = true;
  release.confidence = 'high';
  release.notes = vision?.notes || '';
  if (!release.genres || release.genres.length === 0) {
    release.genres = vision?.genres || [];
  }

  const tracklist = release.tracklist || [];
  const nullTrack = t => ({ ...t, bpm: null, key: null, energy: null, valence: null, spotifyMatch: false, previewUrl: null });

  // Run Spotify enrichment and crate suggestion generation in parallel
  const [enrichedTracks, suggestedBoxes] = await Promise.all([
    (hasSpotify && tracklist.length > 0)
      ? enrichTracks(tracklist, release.artist).catch(() => tracklist.map(nullTrack))
      : Promise.resolve(tracklist.map(nullTrack)),
    apiKey
      ? generateCrateSuggestions(release, apiKey).catch(() => vision?.suggestedBoxes || [])
      : Promise.resolve(vision?.suggestedBoxes || []),
  ]);

  release.tracklist = enrichedTracks;
  release.suggestedBoxes = suggestedBoxes;
  release.source = enrichedTracks.some(t => t.spotifyMatch) ? 'discogs+spotify' : 'discogs';

  return release;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, mediaType, discogsId, vision: clientVision } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasDiscogs = !!process.env.DISCOGS_PERSONAL_ACCESS_TOKEN;
  const hasSpotify = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

  // Post-disambiguation: client has picked a specific Discogs release
  if (discogsId) {
    if (!hasDiscogs) return res.status(503).json({ error: 'Discogs not configured' });
    try {
      const discogsRelease = await fetchDiscogsRelease(discogsId);
      const release = await buildRelease(discogsRelease, clientVision, hasSpotify, apiKey);
      return res.status(200).json({ status: 'complete', release });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Image scan path
  if (!image) return res.status(400).json({ error: 'image or discogsId required' });
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const vision = await identifyFromImage(image, mediaType, apiKey);

    if (!hasDiscogs) {
      return res.status(200).json({
        status: 'complete',
        release: { ...vision, tracklist: [], source: 'vision', coverUrl: null },
      });
    }

    const matches = await searchDiscogs({
      catalogNumber: vision.catalogNumber,
      artist: vision.artist,
      title: vision.title,
      label: vision.label,
      rawText: vision.rawText,
    });

    if (matches.length === 0) {
      return res.status(200).json({
        status: 'complete',
        release: { ...vision, tracklist: [], source: 'vision', coverUrl: null },
      });
    }

    if (matches.length === 1) {
      const discogsRelease = await fetchDiscogsRelease(matches[0].id);
      const release = await buildRelease(discogsRelease, vision, hasSpotify, apiKey);
      return res.status(200).json({ status: 'complete', release });
    }

    // Multiple matches: let the user pick
    return res.status(200).json({ status: 'disambiguation', vision, candidates: matches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
