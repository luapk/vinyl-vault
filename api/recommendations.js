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

// Query Discogs by style sorted by most-wanted -- the native hype signal.
async function queryStyle(style, headers) {
  try {
    const params = new URLSearchParams({
      style,
      type: 'release',
      format: 'Vinyl',
      sort: 'want',
      sort_order: 'desc',
      per_page: '10',
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

  const tags = (req.query.tags || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!tags.length) return res.status(400).json({ error: 'tags param required', results: [] });

  const headers = authHeaders(token);

  // Query all tags in parallel, then merge by want count so the hottest records win.
  const batches = await Promise.all(tags.map(t => queryStyle(t, headers)));

  // Flatten, dedupe by release id, then sort descending by want count.
  const seen = new Set();
  const pool = [];
  for (const batch of batches) {
    for (const r of batch) {
      if (seen.has(r.id) || !r.title) continue;
      seen.add(r.id);
      pool.push(r);
    }
  }
  pool.sort((a, b) => (b.community?.want ?? b.want ?? 0) - (a.community?.want ?? a.want ?? 0));

  const results = pool.slice(0, 3).map(r => {
    const { artist, title } = parseTitle(r.title);
    const wants = r.community?.want ?? r.want ?? null;
    return {
      id: String(r.id),
      artist,
      title,
      label: Array.isArray(r.label) ? r.label[0] : (r.label || null),
      year: r.year || null,
      thumb: r.cover_image || r.thumb || null,
      genre: (r.style || r.genre || [tags[0]])[0] || null,
      wants,
      buyUrl: `https://www.discogs.com/sell/list?release_id=${r.id}`,
    };
  });

  return res.status(200).json({ results });
}
