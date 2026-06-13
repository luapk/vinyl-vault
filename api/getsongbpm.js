import { enrichBpm } from './lib/getsongbpm.js';
import { requireAuth } from './lib/auth.js';

// Proxy for client-side BPM backfill. Keeps GETSONGBPM_API_KEY server-side.
// Auth-gated so the shared API key quota cannot be drained anonymously.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const { tracks, artist } = req.body || {};
  if (!Array.isArray(tracks)) return res.status(400).json({ error: 'tracks array required' });

  if (!process.env.GETSONGBPM_API_KEY) {
    return res.status(503).json({ error: 'GetSongBPM not configured', tracks });
  }

  try {
    const enriched = await enrichBpm(tracks, artist || '');
    return res.status(200).json({ tracks: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message, tracks });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};
