import { searchDiscogs } from './lib/discogs.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.DISCOGS_PERSONAL_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'Discogs not configured', matches: [] });
  }

  const { artist, title, catalogNumber } = req.body || {};

  try {
    const matches = await searchDiscogs({ artist, title, catalogNumber });
    return res.status(200).json({ matches });
  } catch (err) {
    return res.status(500).json({ error: err.message, matches: [] });
  }
}
