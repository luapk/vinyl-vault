export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Only proxy known cover art CDNs (Discogs blocks cross-origin fetches,
  // so the client cannot download covers for caching without this hop)
  const allowed = [
    'https://i.discogs.com/',
    'https://img.discogs.com/',
    'https://st.discogs.com/',
    'https://i.scdn.co/',
  ];
  if (!allowed.some(prefix => url.startsWith(prefix))) {
    return res.status(400).json({ error: 'URL not allowed' });
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'VinylVault/1.0' },
    });
    if (!upstream.ok) return res.status(502).json({ error: 'Upstream error' });

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) {
      return res.status(502).json({ error: 'Not an image' });
    }

    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
