import { requireAuth } from './lib/auth.js';
import { storeBpms } from './lib/bpm-cache.js';

// Client-side waveform BPM results feed the shared cache through this
// endpoint (the track_bpm table is service-role only). Auth-gated so the
// cache cannot be poisoned anonymously; values are range-checked and merged
// octave-aware in storeBpms.
const ALLOWED_SOURCES = new Set(['waveform', 'waveform+arbiter']);
const MAX_ITEMS = 40;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const { tracks } = req.body || {};
  if (!Array.isArray(tracks) || !tracks.length) {
    return res.status(400).json({ error: 'tracks array required' });
  }

  const items = tracks
    .slice(0, MAX_ITEMS)
    .filter(t =>
      t && typeof t.artist === 'string' && typeof t.title === 'string' &&
      Number.isFinite(t.bpm) && ALLOWED_SOURCES.has(t.source)
    )
    .map(t => ({
      artist: t.artist,
      title: t.title,
      duration: typeof t.duration === 'string' ? t.duration : null,
      bpm: t.bpm,
      source: t.source,
      confidence: 'medium',
    }));

  if (items.length) await storeBpms(items);
  return res.status(200).json({ ok: true, stored: items.length });
}

export const config = {
  api: { bodyParser: { sizeLimit: '256kb' } },
};
