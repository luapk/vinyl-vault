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

async function queryDiscogs(params, headers) {
  try {
    const url = `${BASE}/database/search?${new URLSearchParams({
      type: 'release',
      format: 'Vinyl',
      sort: 'date_added',
      sort_order: 'desc',
      per_page: '10',
      ...params,
    })}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

async function pickWithClaude(candidates, tasteProfile, apiKey) {
  const list = candidates
    .map((c, i) => `${i + 1}. ${c.artist || 'Various'} - ${c.title} (${[c.label, c.year].filter(Boolean).join(', ')})`)
    .join('\n');

  const prompt = `You are a music recommendation engine for a vinyl collector.

Their collection taste profile:
- Favourite labels: ${tasteProfile.labels.join(', ') || 'various'}
- Favourite artists: ${tasteProfile.artists.join(', ') || 'various'}
- Genres: ${tasteProfile.genres.join(', ') || 'various'}

These are new releases on their favourite labels and by their favourite artists:
${list}

Pick exactly 6 that would most excite this collector based on what they already own. Prefer variety -- avoid picking more than 2 from the same artist. For each pick write one sentence of max 10 words explaining why it fits their taste.

Return ONLY a JSON array, no other text:
[{"index": 1, "reason": "..."}, {"index": 2, "reason": "..."}, {"index": 3, "reason": "..."}, {"index": 4, "reason": "..."}, {"index": 5, "reason": "..."}, {"index": 6, "reason": "..."}]`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 450,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data.content?.[0]?.text || '[]')
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const picks = JSON.parse(raw);
    if (!Array.isArray(picks) || picks.length < 3) return null;
    return picks;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.DISCOGS_PERSONAL_ACCESS_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!token) return res.status(503).json({ error: 'Discogs not configured', results: [] });

  const labels  = (req.query.labels  || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
  const artists = (req.query.artists || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
  const genres  = (req.query.genres  || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);

  if (!labels.length && !artists.length) {
    return res.status(400).json({ error: 'labels or artists required', results: [] });
  }

  const headers = authHeaders(token);

  // Pull candidates from top labels + top artists in parallel
  const [labelBatches, artistBatches] = await Promise.all([
    Promise.all(labels.map(label => queryDiscogs({ label }, headers))),
    Promise.all(artists.map(artist => queryDiscogs({ artist }, headers))),
  ]);

  // Merge, dedupe -- label results first (stronger taste signal)
  const seen = new Set();
  const pool = [];
  for (const batch of [...labelBatches, ...artistBatches]) {
    for (const r of batch) {
      if (seen.has(r.id) || !r.title) continue;
      seen.add(r.id);
      const { artist, title } = parseTitle(r.title);
      pool.push({
        id: String(r.id),
        artist,
        title,
        label: Array.isArray(r.label) ? r.label[0] : (r.label || null),
        year: r.year || null,
        thumb: r.cover_image || r.thumb || null,
        buyUrl: `https://www.discogs.com/sell/list?release_id=${r.id}`,
      });
    }
  }

  if (pool.length === 0) return res.status(200).json({ results: [] });

  // Claude picks the best 3 from the pool with reasons
  let results = null;
  if (apiKey && pool.length > 3) {
    const picks = await pickWithClaude(pool, { labels, artists, genres }, apiKey);
    if (picks) {
      const mapped = picks
        .map(p => {
          const rec = pool[p.index - 1];
          return rec ? { ...rec, reason: p.reason || null } : null;
        })
        .filter(Boolean);
      if (mapped.length >= 3) results = mapped.slice(0, 6);
    }
  }

  // Fallback: first 3 from pool, no reason text
  if (!results) results = pool.slice(0, 6).map(r => ({ ...r, reason: null }));

  return res.status(200).json({ results });
}
