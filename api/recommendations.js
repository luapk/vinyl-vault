const BASE = 'https://api.discogs.com';
const UA = 'VinylVault/1.0';

function authHeaders(token) {
  return {
    Authorization: `Discogs token=${token}`,
    'User-Agent': UA,
    Accept: 'application/json',
  };
}

function parseTitle(combined) {
  const idx = (combined || '').indexOf(' - ');
  return idx === -1
    ? { artist: '', title: combined || '' }
    : { artist: combined.slice(0, idx), title: combined.slice(idx + 3) };
}

async function queryGenre(style, year, headers) {
  try {
    const params = new URLSearchParams({
      style,
      type: 'release',
      format: 'Vinyl',
      year: String(year),
      sort: 'date_added',
      sort_order: 'desc',
      per_page: '8',
    });
    const res = await fetch(`${BASE}/database/search?${params}`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.DISCOGS_PERSONAL_ACCESS_TOKEN;
  if (!token) return res.status(503).json({ error: 'Discogs not configured', results: [] });

  const genres = (req.query.genres || '')
    .split(',')
    .map(g => g.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!genres.length) return res.status(400).json({ error: 'genres param required', results: [] });

  const headers = authHeaders(token);
  const currentYear = new Date().getFullYear();
  const seen = new Set();
  const results = [];

  for (const year of [currentYear, currentYear - 1]) {
    if (results.length >= 3) break;
    const batches = await Promise.all(genres.map(g => queryGenre(g, year, headers)));
    for (const batch of batches) {
      for (const r of batch) {
        if (results.length >= 3) break;
        if (seen.has(r.id) || !r.title) continue;
        seen.add(r.id);
        const { artist, title } = parseTitle(r.title);
        if (!title) continue;
        results.push({
          id: String(r.id),
          artist,
          title,
          label: Array.isArray(r.label) ? r.label[0] : (r.label || null),
          year: r.year || null,
          thumb: r.cover_image || r.thumb || null,
          genre: (r.style || r.genre || [genres[0]])[0] || null,
          buyUrl: `https://www.discogs.com/sell/list?release_id=${r.id}`,
        });
      }
      if (results.length >= 3) break;
    }
  }

  return res.status(200).json({ results: results.slice(0, 3) });
}
