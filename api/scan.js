import { identifyFromImage, identifyFromText, generateCrateSuggestions } from './lib/vision.js';
import { searchDiscogs, fetchDiscogsRelease } from './lib/discogs.js';
import { enrichTracks } from './lib/spotify.js';
import { fillItunesPreviews } from './lib/itunes.js';
import { analyzeImage } from './lib/google-vision.js';

// Score how well a Discogs candidate matches Vision-identified metadata.
// Negative scores mean the candidate is likely a false catno collision.
function scoreCandidate(candidate, vision) {
  if (!vision) return 0;

  const norm = s =>
    (s || '').toLowerCase()
      .replace(/\s*\(\d+\)$/, '')   // strip Discogs "(2)" disambiguation suffixes
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const sim = (a, b) => {
    a = norm(a); b = norm(b);
    if (!a || !b) return null; // missing field: no signal, no penalty
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;
    const wa = a.split(' ').filter(w => w.length > 2);
    const wb = b.split(' ').filter(w => w.length > 2);
    if (!wa.length || !wb.length) return null;
    const hits = wa.filter(w => wb.includes(w)).length;
    return hits / Math.max(wa.length, wb.length);
  };

  let score = 0;
  const artistSim = sim(candidate.artist, vision.artist);
  const titleSim  = sim(candidate.recordTitle ?? candidate.title, vision.title);
  const labelSim  = sim(candidate.label, vision.label);

  // Artist is the dominant signal: a clear mismatch when we have artist info
  // strongly indicates a false catno hit from a different label/series.
  if (artistSim !== null) score += artistSim >= 0.5 ? 4 : artistSim >= 0.2 ? 1 : -3;
  if (titleSim  !== null) score += titleSim  >= 0.5 ? 4 : titleSim  >= 0.2 ? 1 : -1;
  if (labelSim  !== null && labelSim >= 0.5) score += 1;

  return score;
}

// Re-rank candidates by vision match score and drop clearly wrong ones
// when better alternatives exist.
function rankCandidates(candidates, vision) {
  if (!vision || candidates.length <= 1) return candidates;

  const scored = candidates.map(c => ({ c, s: scoreCandidate(c, vision) }));
  scored.sort((a, b) => b.s - a.s);

  const good = scored.filter(x => x.s >= 0);
  const result = good.length > 0 ? good : scored; // never return empty
  return result.map(x => x.c);
}

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

const visionFallback = (vision) => ({
  ...vision,
  tracklist: [],
  source: 'vision',
  coverUrl: null,
  identified: false,
  confidence: 'low',
  notes: 'No matching Discogs release found',
});

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
      // Both sources agree but on multiple: rank within the confirmed subset
      const candidates = rankCandidates(
        textMatches.filter(m => confirmedIds.includes(String(m.id))),
        vision
      );
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
    const rawMerged = [
      ...textMatches,
      ...googleOnlyReleases.filter(r => !seenIds.has(String(r.id))).map(toCandidate),
    ];

    // Drop candidates that clearly don't match the vision artist/title
    // (false catno collisions from different labels). Fall back to the full
    // list if filtering would remove everything.
    const mergedCandidates = rankCandidates(rawMerged, vision);

    if (mergedCandidates.length === 0) {
      return res.status(200).json({
        status: 'complete',
        release: { ...vision, tracklist: [], source: 'vision', coverUrl: null },
      });
    }

    if (mergedCandidates.length === 1) {
      const sole = mergedCandidates[0];
      const soleScore = scoreCandidate(sole, vision);
      // A clearly wrong-artist result (catno collision from a different label) is
      // worse than returning the raw Vision reading — skip the bad Discogs match.
      if (soleScore < -1 && (vision.artist || vision.title)) {
        return res.status(200).json({ status: 'complete', release: visionFallback(vision) });
      }
      const discogsRelease = rawMerged.indexOf(sole) < textMatches.length
        ? await fetchDiscogsRelease(sole.id)
        : googleOnlyReleases.find(r => String(r.id) === String(sole.id)) || await fetchDiscogsRelease(sole.id);
      const release = await buildRelease(discogsRelease, vision, hasSpotify, apiKey);
      return res.status(200).json({ status: 'complete', release });
    }

    // Multiple candidates: if they ALL clearly mismatch the vision artist/title,
    // skip the disambiguation screen and return the Vision reading instead.
    const allBad = mergedCandidates.every(c => scoreCandidate(c, vision) < -1);
    if (allBad && (vision.artist || vision.title)) {
      return res.status(200).json({ status: 'complete', release: visionFallback(vision) });
    }

    return res.status(200).json({ status: 'disambiguation', vision, candidates: mergedCandidates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
