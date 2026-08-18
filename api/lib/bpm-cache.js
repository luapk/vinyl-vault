import { createClient } from '@supabase/supabase-js';

// Shared BPM cache (public.track_bpm). Keyed on normalised artist + title +
// a 30s duration bucket so different versions of the same title (7" edit vs
// 12" mix) get separate rows while trivial pressing differences collapse.
// Service-role only: the table has RLS enabled with no policies.

export const normKey = s =>
  (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

// "m:ss" or "h:mm:ss" -> 30s bucket index; -1 when unknown/unparseable.
export function durationBucket(str) {
  if (!str) return -1;
  const parts = String(str).split(':').map(n => parseInt(n, 10));
  if (parts.some(Number.isNaN)) return -1;
  let secs = null;
  if (parts.length === 2) secs = parts[0] * 60 + parts[1];
  else if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (secs == null || secs <= 0) return -1;
  return Math.round(secs / 30);
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Two BPMs agree when within 2% of each other.
const agrees = (a, b) => Math.abs(a - b) <= Math.max(a, b) * 0.02;

// Octave-family relationship (one is roughly double the other): the classic
// waveform-analysis failure mode. Not agreement, but not a wrong-song match.
const octaveRelated = (a, b) => agrees(a * 2, b) || agrees(a, b * 2);

const CONF_RANK = { high: 3, medium: 2, low: 1 };

// Look up cached BPMs for a tracklist. Returns an array aligned with `tracks`:
// { bpm, source, confidence } or null per slot. Never throws.
export async function lookupBpms(artist, tracks) {
  const empty = tracks.map(() => null);
  const supabase = getServiceClient();
  if (!supabase) return empty;

  // A track carrying its own artist (compilations) is looked up under that
  // name, not the release artist. On a Various Artists release the release
  // artist is "Various", which matches nothing and would poison the cache.
  const artistFor = t => normKey(t?.artist || artist);

  const artistNorms = [...new Set(tracks.map(artistFor).filter(Boolean))];
  const titleNorms = [...new Set(tracks.map(t => normKey(t?.title)).filter(Boolean))];
  if (!artistNorms.length || !titleNorms.length) return empty;

  try {
    const { data, error } = await supabase
      .from('track_bpm')
      .select('artist_norm, title_norm, duration_bucket, bpm, source, confidence')
      .in('artist_norm', artistNorms)
      .in('title_norm', titleNorms);
    if (error || !data?.length) return empty;

    return tracks.map(t => {
      const an = artistFor(t);
      const tn = normKey(t?.title);
      if (!an || !tn) return null;
      const rows = data.filter(r => r.artist_norm === an && r.title_norm === tn);
      if (!rows.length) return null;
      const bucket = durationBucket(t?.duration);
      // Prefer the exact version (same duration bucket), then a row with
      // unknown duration, then any row only if the title is unambiguous.
      const hit =
        rows.find(r => bucket !== -1 && r.duration_bucket === bucket) ||
        rows.find(r => r.duration_bucket === -1) ||
        (rows.length === 1 ? rows[0] : null);
      if (!hit) return null;
      return { bpm: hit.bpm, source: hit.source, confidence: hit.confidence };
    });
  } catch {
    return empty;
  }
}

// Upsert resolved BPMs. `items`: [{ artist, title, duration, bpm, source }].
// Merge rules against an existing row:
//   - agreement within 2%: bump hits; a second independent source upgrades
//     confidence to high
//   - octave-related disagreement: metadata sources (deezer/getsongbpm) beat
//     waveform values, since title lookups do not make octave errors
//   - other disagreement: higher confidence wins; ties keep the existing row
// Never throws.
export async function storeBpms(items) {
  const supabase = getServiceClient();
  if (!supabase) return;

  const METADATA_SOURCES = new Set(['deezer', 'getsongbpm']);
  const clean = items
    .map(it => ({
      artist_norm: normKey(it?.artist),
      title_norm: normKey(it?.title),
      duration_bucket: durationBucket(it?.duration),
      bpm: Math.round(it?.bpm),
      source: String(it?.source || ''),
      confidence: CONF_RANK[it?.confidence] ? it.confidence : 'medium',
    }))
    .filter(it =>
      it.artist_norm && it.title_norm && it.source &&
      Number.isFinite(it.bpm) && it.bpm >= 40 && it.bpm <= 260
    );
  if (!clean.length) return;

  try {
    for (const it of clean) {
      const { data: existing } = await supabase
        .from('track_bpm')
        .select('id, bpm, source, confidence, hits')
        .eq('artist_norm', it.artist_norm)
        .eq('title_norm', it.title_norm)
        .eq('duration_bucket', it.duration_bucket)
        .maybeSingle();

      if (!existing) {
        await supabase.from('track_bpm').insert(it);
        continue;
      }

      if (agrees(existing.bpm, it.bpm)) {
        const independent = existing.source !== it.source;
        await supabase.from('track_bpm').update({
          hits: (existing.hits || 1) + 1,
          confidence: independent ? 'high' : existing.confidence,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
        continue;
      }

      const incomingMeta = METADATA_SOURCES.has(it.source);
      const existingMeta = METADATA_SOURCES.has(existing.source);
      const replace = octaveRelated(existing.bpm, it.bpm)
        ? (incomingMeta && !existingMeta)
        : (CONF_RANK[it.confidence] > CONF_RANK[existing.confidence]);

      if (replace) {
        await supabase.from('track_bpm').update({
          bpm: it.bpm,
          source: it.source,
          confidence: it.confidence,
          hits: 1,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      }
    }
  } catch {
    // cache writes are best-effort
  }
}
