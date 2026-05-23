export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Only proxy known audio preview CDNs
  const allowed = [
    'https://audio-ssl.itunes.apple.com/',
    'https://a1.mzstatic.com/',
    'https://p.scdn.co/',
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
    const ct = upstream.headers.get('content-type') || 'audio/mpeg';

    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
