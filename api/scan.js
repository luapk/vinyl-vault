import { identifyFromImage, identifyFromText, generateCrateSuggestions } from './lib/vision.js';
import { searchDiscogs, fetchDiscogsRelease } from './lib/discogs.js';
import { enrichTracks } from './lib/spotify.js';
import { fillItunesPreviews } from './lib/itunes.js';
import { analyzeImage } from './lib/google-vision.js';

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

  const [enrichedTracks, suggestedBoxes] = await Promise.all([
    (hasSpotify && tracklist.length > 0)
      ? enrichTracks(tracklist, release.artist).catch(() => tracklist.map(nullTrack))
      : Promise.resolve(tracklist.map(nullTrack)),
    apiKey
      ? generateCrateSuggestions(release, apiKey).catch(() => vision?.suggestedBoxes || [])
      : Promise.resolve(vision?.suggestedBoxes || []),
  ]);

  // iTunes fallback: fill any still-missing preview URLs (no API key, always runs)
  const finalTracks = await fillItunesPreviews(enrichedTracks, release.artist).catch(() => enrichedTracks);

  release.tracklist = finalTracks;
  release.suggestedBoxes = suggestedBoxes;
  release.source = finalTracks.some(t => t.spotifyMatch) ? 'discogs+spotify' : 'discogs';

  return release;
}

function toCandidate(r) {
  return {
    id: r.id, masterId: r.masterId, artist: r.artist,
    recordTitle: r.title, label: r.label, catalogNumber: r.catalogNumber,
    year: r.year, country: r.country, format: r.format, coverUrl: r.coverUrl,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, mediaType, discogsId, vision: clientVision } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasDiscogs = !!process.env.DISCOGS_PERSONAL_ACCESS_TOKEN;
  const hasSpotify = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
  const googleVisionKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;

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
    let vision, trimmedGoogleIds = [], rawOcrText = null;

    if (googleVisionKey) {
      // Google Vision: accurate OCR text + web-match Discogs IDs in one API call.
      // Use the OCR text with Claude (text-only) to avoid image-based hallucination.
      const { ocrText, releaseIds } = await analyzeImage(image, googleVisionKey)
        .catch(() => ({ ocrText: null, releaseIds: [] }));
      trimmedGoogleIds = releaseIds;
      rawOcrText = ocrText;
      console.log('[scan] google ocr:', ocrText?.slice(0, 200), '| ids:', trimmedGoogleIds);

      // Claude interprets clean OCR text — no image confusion possible
      vision = ocrText
        ? await identifyFromText(ocrText, apiKey)
        : await identifyFromImage(image, mediaType, apiKey);
    } else {
      vision = await identifyFromImage(image, mediaType, apiKey);
    }

    console.log('[scan] vision:', JSON.stringify({ artist: vision.artist, title: vision.title, label: vision.label, catalogNumber: vision.catalogNumber }));

    if (!hasDiscogs) {
      return res.status(200).json({
        status: 'complete',
        release: { ...vision, tracklist: [], source: 'vision', coverUrl: null },
      });
    }

    // Use raw Google OCR text (not Claude's interpreted rawText) for Discogs search —
    // Claude may alter or misread the catno when copying it into rawText, but the
    // OCR string is verbatim from Google and more likely to contain the correct catno.
    const textMatches = await searchDiscogs({
      catalogNumber: vision.catalogNumber,
      artist: vision.artist,
      title: vision.title,
      label: vision.label,
      rawText: rawOcrText || vision.rawText,
    });

    trimmedGoogleIds = trimmedGoogleIds.slice(0, 3).map(String);
    console.log('[scan] text matches:', textMatches.length, textMatches.map(m => `${m.id} ${m.artist} - ${m.recordTitle} (${m.catalogNumber})`));
    console.log('[scan] google ids:', trimmedGoogleIds);

    // Cross-reference: IDs that appear in both sources are confirmed matches
    const textIdSet = new Set(textMatches.map(m => String(m.id)));
    const confirmedIds = trimmedGoogleIds.filter(id => textIdSet.has(id));

    if (confirmedIds.length === 1) {
      // Both sources agree on exactly one release: auto-select with high confidence
      const discogsRelease = await fetchDiscogsRelease(confirmedIds[0]);
      const release = await buildRelease(discogsRelease, vision, hasSpotify, apiKey);
      return res.status(200).json({ status: 'complete', release });
    }

    if (confirmedIds.length > 1) {
      // Both sources agree but on multiple: show only the confirmed subset
      const candidates = textMatches.filter(m => confirmedIds.includes(String(m.id)));
      return res.status(200).json({ status: 'disambiguation', vision, candidates });
    }

    // No overlap between sources. Build a merged candidate pool.
    // Google-only IDs need to be fetched; text-search IDs are already summarised.
    const googleOnlyIds = trimmedGoogleIds.filter(id => !textIdSet.has(id));
    const googleOnlyReleases = googleOnlyIds.length > 0
      ? (await Promise.all(googleOnlyIds.map(id => fetchDiscogsRelease(id).catch(() => null)))).filter(Boolean)
      : [];

    // Merge: text matches first, then any Google-only releases not already present
    const seenIds = new Set(textMatches.map(m => String(m.id)));
    const mergedCandidates = [
      ...textMatches,
      ...googleOnlyReleases.filter(r => !seenIds.has(String(r.id))).map(toCandidate),
    ];

    if (mergedCandidates.length === 0) {
      return res.status(200).json({
        status: 'complete',
        release: { ...vision, tracklist: [], source: 'vision', coverUrl: null },
      });
    }

    if (mergedCandidates.length === 1) {
      const id = mergedCandidates[0].id;
      const discogsRelease = textMatches.length === 1
        ? await fetchDiscogsRelease(id)
        : googleOnlyReleases[0];
      const release = await buildRelease(discogsRelease, vision, hasSpotify, apiKey);
      return res.status(200).json({ status: 'complete', release });
    }

    return res.status(200).json({ status: 'disambiguation', vision, candidates: mergedCandidates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
