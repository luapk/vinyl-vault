import { fetchDiscogsRelease } from './lib/discogs.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.DISCOGS_PERSONAL_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'Discogs not configured' });
  }

  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const release = await fetchDiscogsRelease(id);
    return res.status(200).json(release);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
