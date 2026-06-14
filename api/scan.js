import { identifyFromImage, identifyFromText, generateCrateSuggestions } from './lib/vision.js';
import { searchDiscogs, fetchDiscogsRelease } from './lib/discogs.js';
import { enrichTracks } from './lib/spotify.js';
import { fillItunesPreviews } from './lib/itunes.js';
import { enrichWithDeezer } from './lib/deezer.js';
import { analyzeImage } from './lib/google-vision.js';
import { scoreCandidate, rankCandidates } from './lib/scoring.js';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth.js';

const SCAN_LIMITS = { digger: 50, selector: Infinity, resident: Infinity };

async function _doCheckAndIncrementScanLimit(userId) {
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

async function checkAndIncrementScanLimit(userId) {
  // 5s ceiling: a slow/unresponsive Supabase must not hang the scan pipeline.
  // On timeout we resolve null (allow the scan) rather than blocking the user.
  return Promise.race([
    _doCheckAndIncrementScanLimit(userId),
    new Promise(resolve => setTimeout(() => resolve(null), 5000)),
  ]);
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

  // Spotify, iTunes (release-anchored), Deezer, and crate suggestions all run in
  // parallel under a 10s ceiling. Deezer fills any gaps Spotify and iTunes miss
  // for both preview URLs and BPM. Running all three concurrently avoids the
  // latency of sequential fallbacks.
  const [enrichedTracks, itunesTracks, deezerTracks, suggestedBoxes] = await raceTimeout(
    Promise.all([
      (hasSpotify && tracklist.length > 0)
        ? enrichTracks(tracklist, release.artist, releaseContext).catch(() => nullTracks)
        : Promise.resolve(nullTracks),
      fillItunesPreviews(tracklist, release.artist, releaseContext).catch(() => null),
      enrichWithDeezer(tracklist, release.artist).catch(() => null),
      apiKey
        ? generateCrateSuggestions(release, apiKey).catch(() => vision?.suggestedBoxes || [])
        : Promise.resolve(vision?.suggestedBoxes || []),
    ]),
    10000,
    [nullTracks, null, null, vision?.suggestedBoxes || []],
  );

  // Merge: Spotify > iTunes > Deezer for previews; Deezer fills BPM gaps.
  const finalTracks = enrichedTracks.map((t, i) => {
    let out = t;
    if (!out.previewUrl) {
      const ip = itunesTracks?.[i]?.previewUrl || deezerTracks?.[i]?.previewUrl;
      if (ip) out = { ...out, previewUrl: ip };
    }
    if (out.bpm == null && deezerTracks?.[i]?.bpm != null) {
      out = { ...out, bpm: deezerTracks[i].bpm, bpmSource: deezerTracks[i].bpmSource };
    }
    return out;
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
    const t0 = Date.now();
    try {
      const discogsRelease = await fetchDiscogsRelease(discogsId);
      console.log(`[scan] discogsId=${discogsId} release fetch: ${Date.now() - t0}ms`);
      const release = await buildRelease(discogsRelease, clientVision, hasSpotify, apiKey);
      console.log(`[scan] buildRelease: ${Date.now() - t0}ms total`);
      return res.status(200).json({ status: 'complete', release });
    } catch (err) {
      console.log(`[scan] error in discogsId path: ${err.message} t=${Date.now() - t0}ms`);
      return res.status(500).json({ error: err.message });
    }
  }

  // Image scan path
  if (!image) return res.status(400).json({ error: 'image or discogsId required' });
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const t0 = Date.now();
  try {
    let vision, textMatches = [], trimmedGoogleIds = [], rawOcrText = null;

    if (googleVisionKey) {
      // Google Vision: OCR text + web-match Discogs IDs in one call (TEXT_DETECTION: fast).
      const vt = Date.now();
      const { ocrText, releaseIds } = await analyzeImage(image, googleVisionKey)
        .catch(() => ({ ocrText: null, releaseIds: [] }));
      console.log(`[scan] t=${Date.now() - t0}ms vision: ${Date.now() - vt}ms ocrLen=${ocrText?.length || 0} webIds=${releaseIds.length}`);
      trimmedGoogleIds = releaseIds;
      rawOcrText = ocrText;

      if (ocrText) {
        if (!hasDiscogs) {
          vision = await identifyFromText(ocrText, apiKey);
          return res.status(200).json({
            status: 'complete',
            release: { ...vision, tracklist: [], source: 'vision', coverUrl: null },
          });
        }

        // Claude interprets OCR text and a preliminary Discogs search (catno patterns
        // extracted from raw OCR) run in parallel. This saves Claude's ~5s latency
        // from the Discogs critical path. After both complete, a targeted supplement
        // with Claude's structured fields fills queries that rawText patterns miss.
        const ct = Date.now();
        const [visionResult, prelimMatches] = await Promise.all([
          identifyFromText(ocrText, apiKey),
          searchDiscogs({ rawText: rawOcrText }),
        ]);
        vision = visionResult;
        console.log(`[scan] t=${Date.now() - t0}ms claude+prelim: ${Date.now() - ct}ms artist="${vision.artist}" catno="${vision.catalogNumber}" prelim=${prelimMatches.length}`);

        // Targeted supplement: catno+artist, artist+title, label+title -- queries
        // that need Claude's interpreted fields and weren't in the raw-text pass.
        // Skip rawText here to avoid re-firing catno pattern URLs already run above.
        const st = Date.now();
        const refinedMatches = (vision.catalogNumber || vision.artist || vision.title)
          ? await searchDiscogs({
              catalogNumber: vision.catalogNumber,
              artist: vision.artist,
              title: vision.title,
              label: vision.label,
            }).catch(() => [])
          : [];
        const prelimIds = new Set(prelimMatches.map(m => m.id));
        const newFromRefined = refinedMatches.filter(m => !prelimIds.has(m.id));
        textMatches = [...prelimMatches, ...newFromRefined].slice(0, 15);
        console.log(`[scan] t=${Date.now() - t0}ms refined: ${Date.now() - st}ms +${newFromRefined.length} new total=${textMatches.length}`);
      } else {
        // No OCR text -- Claude reads the image directly
        vision = await identifyFromImage(image, mediaType, apiKey);
        console.log(`[scan] t=${Date.now() - t0}ms image claude (no ocr)`);

        if (!hasDiscogs) {
          return res.status(200).json({
            status: 'complete',
            release: { ...vision, tracklist: [], source: 'vision', coverUrl: null },
          });
        }

        const dt = Date.now();
        textMatches = await searchDiscogs({
          catalogNumber: vision.catalogNumber,
          artist: vision.artist,
          title: vision.title,
          label: vision.label,
          rawText: vision.rawText,
        });
        console.log(`[scan] t=${Date.now() - t0}ms discogs (from image): ${Date.now() - dt}ms matches=${textMatches.length}`);
      }
    } else {
      // No Google Vision -- Claude reads the image directly
      const ct = Date.now();
      vision = await identifyFromImage(image, mediaType, apiKey);
      console.log(`[scan] t=${Date.now() - t0}ms claude image: ${Date.now() - ct}ms`);

      if (!hasDiscogs) {
        return res.status(200).json({
          status: 'complete',
          release: { ...vision, tracklist: [], source: 'vision', coverUrl: null },
        });
      }

      const dt = Date.now();
      textMatches = await searchDiscogs({
        catalogNumber: vision.catalogNumber,
        artist: vision.artist,
        title: vision.title,
        label: vision.label,
        rawText: vision.rawText,
      });
      console.log(`[scan] t=${Date.now() - t0}ms discogs: ${Date.now() - dt}ms matches=${textMatches.length}`);
    }

    console.log('[scan] vision:', JSON.stringify({ artist: vision.artist, title: vision.title, label: vision.label, catalogNumber: vision.catalogNumber }));

    trimmedGoogleIds = trimmedGoogleIds.slice(0, 3).map(String);
    console.log('[scan] text matches:', textMatches.length, textMatches.map(m => `${m.id} ${m.artist} - ${m.recordTitle} (${m.catalogNumber})`));
    console.log('[scan] google ids:', trimmedGoogleIds);

    // Cross-reference: IDs that appear in both sources are confirmed matches
    const textIdSet = new Set(textMatches.map(m => String(m.id)));
    const confirmedIds = trimmedGoogleIds.filter(id => textIdSet.has(id));

    if (confirmedIds.length === 1) {
      // Both sources agree on exactly one release: auto-select with high confidence
      const rt = Date.now();
      const discogsRelease = await fetchDiscogsRelease(confirmedIds[0]);
      const release = await buildRelease(discogsRelease, vision, hasSpotify, apiKey);
      console.log(`[scan] confirmed single: release fetch+build ${Date.now() - rt}ms total=${Date.now() - t0}ms`);
      return res.status(200).json({ status: 'complete', release });
    }

    if (confirmedIds.length > 1) {
      // Both sources agree but on multiple: rank within the confirmed subset
      const candidates = rankCandidates(
        textMatches.filter(m => confirmedIds.includes(String(m.id))),
        vision
      );
      console.log(`[scan] disambiguation (confirmed ${confirmedIds.length}): t=${Date.now() - t0}ms`);
      return res.status(200).json({ status: 'disambiguation', vision, candidates });
    }

    // No overlap between sources. Build a merged candidate pool.
    // Google-only IDs need to be fetched; text-search IDs are already summarised.
    const googleOnlyIds = trimmedGoogleIds.filter(id => !textIdSet.has(id));
    const gt = Date.now();
    const googleOnlyReleases = googleOnlyIds.length > 0
      ? (await Promise.all(googleOnlyIds.map(id => fetchDiscogsRelease(id).catch(() => null)))).filter(Boolean)
      : [];
    if (googleOnlyIds.length > 0) {
      console.log(`[scan] google-only fetches (${googleOnlyIds.length}): ${Date.now() - gt}ms`);
    }

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
      console.log(`[scan] no candidates, vision fallback t=${Date.now() - t0}ms`);
      return res.status(200).json({
        status: 'complete',
        release: { ...vision, tracklist: [], source: 'vision', coverUrl: null },
      });
    }

    if (mergedCandidates.length === 1) {
      const sole = mergedCandidates[0];
      const soleScore = scoreCandidate(sole, vision);
      // A clearly wrong-artist result (catno collision from a different label) is
      // worse than returning the raw Vision reading -- skip the bad Discogs match.
      if (soleScore < -1 && (vision.artist || vision.title)) {
        console.log(`[scan] sole candidate bad score (${soleScore}), vision fallback t=${Date.now() - t0}ms`);
        return res.status(200).json({ status: 'complete', release: visionFallback(vision) });
      }
      const rt = Date.now();
      const cached = googleOnlyReleases.find(r => String(r.id) === String(sole.id));
      const discogsRelease = cached || await fetchDiscogsRelease(sole.id);
      const release = await buildRelease(discogsRelease, vision, hasSpotify, apiKey);
      console.log(`[scan] sole match: release fetch+build ${Date.now() - rt}ms total=${Date.now() - t0}ms`);
      return res.status(200).json({ status: 'complete', release });
    }

    // Multiple candidates: if they ALL clearly mismatch the vision artist/title,
    // skip the disambiguation screen and return the Vision reading instead.
    const allBad = mergedCandidates.every(c => scoreCandidate(c, vision) < -1);
    if (allBad && (vision.artist || vision.title)) {
      console.log(`[scan] all ${mergedCandidates.length} candidates bad, vision fallback t=${Date.now() - t0}ms`);
      return res.status(200).json({ status: 'complete', release: visionFallback(vision) });
    }

    console.log(`[scan] disambiguation: ${mergedCandidates.length} candidates t=${Date.now() - t0}ms`);
    return res.status(200).json({ status: 'disambiguation', vision, candidates: mergedCandidates });
  } catch (err) {
    console.log(`[scan] unhandled error: ${err.message} t=${Date.now() - t0}ms`);
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
