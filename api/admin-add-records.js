import { createClient } from '@supabase/supabase-js';
import { searchDiscogs, fetchDiscogsRelease } from './lib/discogs.js';

// Admin-only bulk restore: takes a list of "Artist - Title" lines, resolves
// each against Discogs (vinyl only), and inserts the resulting records into a
// target user's collection. Built for recovering a collection lost before the
// sync fixes landed, where the records only ever existed on the user's device.
//
// POST { userId, lines: ["Artist - Title", ...], dryRun?: boolean }
// -> { results: [{ line, status, artist, title, year, coverUrl, discogsId }] }

// Mirrors recordFromRelease() in src/hooks/useCollection.js so restored rows
// are indistinguishable from scanned ones.
function recordFromRelease(release, crates = []) {
  const tags = [...(release.genres || [])].filter((t, i, arr) => arr.indexOf(t) === i);
  return {
    id: crypto.randomUUID(),
    discogsId: release.id || null,
    savedAt: Date.now(),
    artist: release.artist || '',
    title: release.title || '',
    label: release.label || null,
    catalogNumber: release.catalogNumber || null,
    year: release.year || null,
    country: release.country || null,
    format: release.format || null,
    genres: release.genres || [],
    tags,
    identified: true,
    confidence: 'high',
    source: 'discogs',
    notes: '',
    mediaCondition: '',
    sleeveCondition: '',
    coverUrl: release.coverUrl || null,
    images: release.images || [],
    tracklist: (release.tracklist || []).map(t => ({
      position: t.position,
      title: t.title,
      duration: t.duration || null,
      bpm: null, bpmSource: null, bpmConfidence: null,
      key: null, previewUrl: null, hot: false,
    })),
    crates,
  };
}

// "Artist - Title" (also accepts en/em dashes). Falls back to a bare query.
function parseLine(line) {
  const m = line.split(/\s+[-–—]\s+/);
  if (m.length >= 2) {
    return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
  }
  return { artist: '', title: line.trim() };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Supabase not configured on server' });
  }

  // Caller must be an authenticated admin.
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${authHeader.slice(7)}` } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });
  const { data: callerProfile } = await userClient
    .from('profiles').select('role').eq('id', user.id).single();
  if (callerProfile?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { userId, lines, dryRun } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'lines[] is required' });
  if (lines.length > 60) return res.status(400).json({ error: 'Max 60 lines per request' });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Existing discogsIds so a re-run never double-adds.
  const { data: existingRows } = await admin
    .from('records').select('data').eq('user_id', userId);
  const existingDiscogsIds = new Set(
    (existingRows || []).map(r => r.data?.discogsId).filter(Boolean).map(String)
  );

  const results = [];
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const { artist, title } = parseLine(line);
    try {
      // searchDiscogs is already constrained to format=Vinyl.
      const matches = await searchDiscogs({ artist, title, manual: true });
      if (!matches.length) {
        results.push({ line, status: 'not_found' });
        continue;
      }
      // Most likely = Discogs' own relevance order, preferring one with cover art.
      const best = matches.find(m => m.coverUrl) || matches[0];
      if (existingDiscogsIds.has(String(best.id))) {
        results.push({ line, status: 'already_present', artist: best.artist, title: best.recordTitle, discogsId: best.id });
        continue;
      }

      let release;
      try {
        release = await fetchDiscogsRelease(best.id);
      } catch {
        // Detail fetch failed (rate limit): fall back to search-result fields.
        release = {
          id: best.id, artist: best.artist, title: best.recordTitle,
          label: best.label, catalogNumber: best.catalogNumber, year: best.year,
          country: best.country, format: best.format, genres: [],
          tracklist: [], coverUrl: best.coverUrl, images: best.coverUrl ? [best.coverUrl] : [],
        };
      }

      const record = recordFromRelease(release);
      if (!dryRun) {
        const { error } = await admin.from('records').insert({ user_id: userId, data: record });
        if (error) { results.push({ line, status: 'insert_failed', error: error.message }); continue; }
      }
      existingDiscogsIds.add(String(best.id));
      results.push({
        line, status: dryRun ? 'matched' : 'added',
        artist: record.artist, title: record.title, year: record.year,
        label: record.label, coverUrl: record.coverUrl, discogsId: record.discogsId,
        tracks: record.tracklist.length,
      });
    } catch (err) {
      results.push({ line, status: 'error', error: err.message });
    }
  }

  return res.status(200).json({
    ok: true,
    dryRun: !!dryRun,
    added: results.filter(r => r.status === 'added').length,
    matched: results.filter(r => r.status === 'matched').length,
    results,
  });
}
