import { identifyFromImage, identifyFromText, generateCrateSuggestions } from './lib/vision.js';
import { searchDiscogs, fetchDiscogsRelease } from './lib/discogs.js';
import { enrichTracks } from './lib/spotify.js';
import { fillItunesPreviews } from './lib/itunes.js';
import { analyzeImage } from './lib/google-vision.js';
import { scoreCandidate, rankCandidates } from './lib/scoring.js';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth.js';

const SCAN_LIMITS = { digger: 50, selector: Infinity, resident: Infinity };

async function checkAndIncrementScanLimit(userId) {
  if (!userId) return null; // unauthenticated: allow (will be rate-limited separately)
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null; // payments not configured: don't block scans

  const supabase = createClient(url, key);
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status, scans_this_period, scans_period_end')
    .eq('id', userId)
    .single();

  if (!profile) return null;

  const tier   = profile.subscription_tier || 'digger';
  const status = profile.subscription_status || 'active';
  const limit  = SCAN_LIMITS[tier] ?? SCAN_LIMITS.digger;

  // Treat past_due as still having access (Stripe gives a grace period)
  const hasAccess = status === 'active' || status === 'trialing' || status === 'past_due';

  // Auto-reset if period has rolled over
  const now = new Date();
  const periodEnd = new Date(profile.scans_period_end);
  const currentCount = now >= periodEnd ? 0 : (profile.scans_this_period || 0);

  if (hasAccess && currentCount >= limit) {
    return { blocked: true, tier, limit, used: currentCount };
  }

  // Increment counter (the RPC handles reset atomically)
  await supabase.rpc('increment_scan_count', { p_user_id: userId });
  return null;
}


function raceTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
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

  const releaseContext = { releaseYear: release.year, releaseTitle: release.title };
  const nullTracks = tracklist.map(nullTrack);

  // Run Spotify, iTunes, and crate suggestions in parallel under a single 6s
  // ceiling. iTunes runs against the raw Discogs tracklist so it can start
  // immediately (does not need Spotify output). Spotify preview URLs take
  // priority; iTunes fills gaps. GetSongBPM is intentionally omitted here --
  // it runs client-side after the scan completes so it never blocks the UI.
  const [enrichedTracks, itunesTracks, suggestedBoxes] = await raceTimeout(
    Promise.all([
      (hasSpotify && tracklist.length > 0)
        ? enrichTracks(tracklist, release.artist, releaseContext).catch(() => nullTracks)
        : Promise.resolve(nullTracks),
      fillItunesPreviews(tracklist, release.artist, releaseContext).catch(() => null),
      apiKey
        ? generateCrateSuggestions(release, apiKey).catch(() => vision?.suggestedBoxes || [])
        : Promise.resolve(vision?.suggestedBoxes || []),
    ]),
    6000,
    [nullTracks, null, vision?.suggestedBoxes || []],
  );

  // Merge: keep Spotify preview where found; back-fill with iTunes where not.
  const finalTracks = enrichedTracks.map((t, i) => {
    if (t.previewUrl) return t;
    const ip = itunesTracks?.[i]?.previewUrl;
    return ip ? { ...t, previewUrl: ip } : t;
  });

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

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const { image, mediaType, discogsId, vision: clientVision } = req.body || {};

  // Enforce scan limits before doing any expensive work
  const limitResult = await checkAndIncrementScanLimit(authUser.id).catch(() => null);
  if (limitResult?.blocked) {
    return res.status(402).json({
      error: 'scan_limit_reached',
      tier: limitResult.tier,
      limit: limitResult.limit,
      used: limitResult.used,
    });
  }

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
      const cached = googleOnlyReleases.find(r => String(r.id) === String(sole.id));
      const discogsRelease = cached || await fetchDiscogsRelease(sole.id);
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
