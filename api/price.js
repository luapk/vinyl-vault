import { fetchDiscogsPrice } from './lib/discogs.js';
import { requireAuth } from './lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });
  if (!process.env.DISCOGS_PERSONAL_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'Discogs not configured' });
  }

  try {
    const price = await fetchDiscogsPrice(id);
    return res.status(200).json(price || { totalListings: 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
